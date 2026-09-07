/* ============================================================
   gamepad.js — 零相依手把支援(投影到電視/大螢幕時用搖桿玩)
   · 跨專案、可離線、守嵌入契約:不碰任何 DOM 外殼、不改遊戲核心。
   · 兩種接法:
     (A) 鍵盤橋接(零改動,最省):把手把按鍵「合成」成 keydown/keyup 事件,
         你原本監聽鍵盤的遊戲直接就能用手把玩,一行接上。
     (B) 輪詢狀態(乾淨):每幀呼叫 poll(),讀 .dir / .held / .justPressed,
         自己決定怎麼套(適合已有自家 input 狀態機的引擎,如約拿/參孫)。
   · 標準 layout(Xbox/多數 USB 手把):A=跳/確認、B=衝刺/返回、左搖桿/十字鍵=方向、
     Start=暫停。死區、邊緣偵測(justPressed)、連線/斷線都處理好。
   · 沒插手把 = 完全靜默(不報錯、不影響鍵盤滑鼠觸控)。
   ============================================================ */

// 標準按鈕索引(W3C standard gamepad mapping)
const BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 }

// 預設:手把動作 → 要合成的鍵盤 key(對齊本系列遊戲最常見的鍵位)
// 多數遊戲監聽 ArrowKeys / Space / Enter / Shift / Escape / 'p';可用 keymap 覆寫。
const DEFAULT_KEYMAP = {
  up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
  A: ' ',         // 跳 / 確認(Space)
  B: 'Shift',     // 衝刺 / 返回(Shift;本系列長按加速常用 Shift)
  X: 'Enter',     // 確認 / 開始
  Y: 'p',         // 暫停(有些關用 p)
  START: 'Escape',// 暫停 / 選單
  BACK: 'Escape',
}

export class GamepadInput {
  /**
   * @param {object} [opts]
   * @param {'keyboard'|'poll'} [opts.mode='poll']  keyboard=合成鍵盤事件;poll=只更新狀態
   * @param {object} [opts.keymap]                  覆寫 DEFAULT_KEYMAP(只在 keyboard 模式用)
   * @param {EventTarget} [opts.target=window]      合成鍵盤事件派發到哪(預設 window)
   * @param {number} [opts.deadzone=0.35]           左搖桿死區
   * @param {(connected:boolean,id:string)=>void} [opts.onConnect] 連線/斷線回呼(可顯示「🎮 手把已連線」)
   */
  constructor(opts = {}) {
    this.mode = opts.mode || 'poll'
    this.keymap = { ...DEFAULT_KEYMAP, ...(opts.keymap || {}) }
    this.target = opts.target || (typeof window !== 'undefined' ? window : null)
    this.deadzone = opts.deadzone ?? 0.35
    this.onConnect = opts.onConnect || null

    this.connected = false
    this.dir = { up: false, down: false, left: false, right: false } // 方向(十字鍵 OR 左搖桿)
    this.held = {}        // 這一刻按住的動作:held.A / held.B / held.up ...
    this.justPressed = {} // 這一幀「剛按下」的動作(邊緣);讀完自動清,適合跳/確認

    this._prev = {}       // 上一幀 held 快照(算 justPressed 用)
    this._synthDown = {}  // keyboard 模式:目前已派發 keydown、尚未 keyup 的 key

    this._onGp = (e) => { this.connected = true; this.onConnect && this.onConnect(true, e.gamepad?.id || '') }
    this._offGp = (e) => {
      // 還有沒有別的手把?沒了才算斷線
      const pads = this._pads()
      this.connected = pads.some(Boolean)
      if (!this.connected) { this._releaseAllSynth(); this.onConnect && this.onConnect(false, e.gamepad?.id || '') }
    }
    if (this.target && this.target.addEventListener) {
      this.target.addEventListener('gamepadconnected', this._onGp)
      this.target.addEventListener('gamepaddisconnected', this._offGp)
    }
  }

  _pads() {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return []
    return Array.from(navigator.getGamepads()).filter(Boolean)
  }

  /** 每幀呼叫一次(放在 requestAnimationFrame 迴圈裡)。沒手把就立即 return。 */
  poll() {
    const pads = this._pads()
    if (!pads.length) { if (this.connected) this.connected = false; return }
    this.connected = true

    // 合併所有手把(多人同樂時任一手把都能動;單人就一支)
    const down = {}
    for (const pad of pads) {
      const b = pad.buttons, ax = pad.axes
      const pressed = (i) => b[i] && b[i].pressed
      // 方向:十字鍵 OR 左搖桿(超過死區)
      const lx = ax[0] || 0, ly = ax[1] || 0
      if (pressed(BTN.UP)    || ly < -this.deadzone) down.up = true
      if (pressed(BTN.DOWN)  || ly >  this.deadzone) down.down = true
      if (pressed(BTN.LEFT)  || lx < -this.deadzone) down.left = true
      if (pressed(BTN.RIGHT) || lx >  this.deadzone) down.right = true
      for (const k of ['A', 'B', 'X', 'Y', 'START', 'BACK', 'LB', 'RB']) if (pressed(BTN[k])) down[k] = true
    }

    // 更新 held + dir
    this.held = down
    this.dir = { up: !!down.up, down: !!down.down, left: !!down.left, right: !!down.right }

    // 邊緣:這一幀剛按下的(true 現在、上一幀 false)
    const jp = {}
    for (const k of Object.keys(down)) if (down[k] && !this._prev[k]) jp[k] = true
    this.justPressed = jp

    // keyboard 模式:把 held 變化合成成 keydown/keyup
    if (this.mode === 'keyboard') this._syncSynthKeys(down)

    this._prev = down
  }

  // 把目前 held 與已派發的合成鍵對齊:新按下→keydown、放開→keyup
  _syncSynthKeys(down) {
    const wanted = {}
    for (const action of Object.keys(down)) {
      const key = this.keymap[action]
      if (key) wanted[key] = true
    }
    // 新增的:派 keydown
    for (const key of Object.keys(wanted)) if (!this._synthDown[key]) this._dispatchKey('keydown', key)
    // 消失的:派 keyup
    for (const key of Object.keys(this._synthDown)) if (!wanted[key]) this._dispatchKey('keyup', key)
    this._synthDown = wanted
  }

  _dispatchKey(type, key) {
    if (!this.target || typeof KeyboardEvent === 'undefined') return
    const code = key === ' ' ? 'Space'
      : key.length === 1 ? (/[a-z]/i.test(key) ? 'Key' + key.toUpperCase() : 'Digit' + key)
      : key // ArrowUp/Shift/Enter/Escape... 直接當 code 夠多數遊戲用
    const ev = new KeyboardEvent(type, { key, code, bubbles: true, cancelable: true, _synthetic: true })
    try { Object.defineProperty(ev, 'gamepadSynthetic', { value: true }) } catch {}
    this.target.dispatchEvent(ev)
  }

  _releaseAllSynth() {
    for (const key of Object.keys(this._synthDown)) this._dispatchKey('keyup', key)
    this._synthDown = {}
  }

  /** 解除事件監聽 + 放開所有合成鍵(嵌入關 destroy() 時呼叫,守嵌入契約) */
  destroy() {
    this._releaseAllSynth()
    if (this.target && this.target.removeEventListener) {
      this.target.removeEventListener('gamepadconnected', this._onGp)
      this.target.removeEventListener('gamepaddisconnected', this._offGp)
    }
  }
}

// CommonJS 相容(若用 require);ESM 用 import { GamepadInput }
if (typeof module !== 'undefined' && module.exports) module.exports = { GamepadInput, BTN, DEFAULT_KEYMAP }
