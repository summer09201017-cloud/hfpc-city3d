import "./styles.css";
// main.js —— UI 接線:首頁、HUD、都市小地圖、鍵盤/觸控/手把 → game.input、音效、換載具快捷列、PWA。
// 鍵位:↑/W 油門、↓/S 煞車、←→/AD 轉向、Shift 渦輪、Space 手煞、V 視角、1~5 換載具、H 玩法、Esc 選單。
// ★ 換載具不用回選單(使用者要的自由切換):數字鍵或畫面下方那排鈕,停著開著都能換。
import { CityGame, CAR_COLORS, VEHICLES, VEHICLE_IDS, SPEED_MODES, SPEED_LABELS, CITY } from "./game.js";
import { worldSize, blockCenter, isPark, isPlaza } from "./city.js";
import { AudioManager } from "./audio.js";
import { GamepadInput } from "./gamepad.js";
import { loadSettings, saveSettings } from "./storage.js";
import { AGE, AGE_IDS, getAgePref, setAgePref, matchAge } from "./age.js";
import { primeVoice, speakLine, setVoiceEnabled } from "./voice.js";
import { lineFor, COOLDOWN } from "./commentary.js";
import { HOWTO } from "./voicePhrases.js";

const $ = (id) => document.getElementById(id);
const ui = {
  canvas: $("gameCanvas"),
  tripCard: $("tripCard"), vehicleText: $("vehicleText"), surfaceText: $("surfaceText"), distText: $("distText"), blockText: $("blockText"),
  miniWrap: $("miniWrap"), miniMap: $("miniMap"), viewTag: $("viewTag"),
  speedPanel: $("speedPanel"), speedText: $("speedText"), turboRow: $("turboRow"), turboFill: $("turboFill"), turboLabel: $("turboLabel"), speedHint: $("speedHint"),
  statusMessage: $("statusMessage"), vehicleBar: $("vehicleBar"),
  tLeft: $("tLeft"), tRight: $("tRight"), tGas: $("tGas"), tBrake: $("tBrake"), tBoost: $("tBoost"),
  menuButton: $("menuButton"), audioButton: $("audioButton"), cameraButton: $("cameraButton"), helpButton: $("helpButton"), fsButton: $("fsButton"),
  helpOverlay: $("helpOverlay"), helpCloseButton: $("helpCloseButton"), helpSpeakButton: $("helpSpeakButton"),
  homeScreen: $("homeScreen"), vehicleSelect: $("vehicleSelect"), colorSelect: $("colorSelect"), speedSelect: $("speedSelect"),
  pedSelect: $("pedSelect"), audioSelect: $("audioSelect"), vehicleHint: $("vehicleHint"), startButton: $("startButton"),
  agePresets: $("agePresets"),
};

const saved = loadSettings();
const settings = {
  vehicle: VEHICLES[saved.vehicle] ? saved.vehicle : "car",
  colorIdx: Number.isInteger(saved.colorIdx) && saved.colorIdx >= 0 && saved.colorIdx < CAR_COLORS.length ? saved.colorIdx : 1,
  speed: SPEED_MODES.includes(saved.speed) ? saved.speed : "easy",
  peds: saved.peds !== false,
};
let audioEnabled = saved.audioEnabled !== false;
let helpSeen = saved.helpSeen === true;

const fill = (sel, items, value) => {
  sel.innerHTML = "";
  for (const it of items) {
    const o = document.createElement("option");
    o.value = String(it.value); o.textContent = it.label;
    if (String(it.value) === String(value)) o.selected = true;
    sel.appendChild(o);
  }
};
fill(ui.vehicleSelect, VEHICLE_IDS.map((id) => ({ value: id, label: `${VEHICLES[id].emoji} ${VEHICLES[id].label}` })), settings.vehicle);
fill(ui.colorSelect, CAR_COLORS.map((c, i) => ({ value: i, label: c.label })), settings.colorIdx);
fill(ui.speedSelect, SPEED_MODES.map((m) => ({ value: m, label: SPEED_LABELS[m] })), settings.speed);
ui.pedSelect.value = settings.peds ? "on" : "off";
ui.audioSelect.value = audioEnabled ? "on" : "off";

const audio = new AudioManager();
audio.setEnabled(audioEnabled);
const game = new CityGame({ canvas: ui.canvas });
window.__city3d = game;
game.settings.vehicle = settings.vehicle;
game.settings.colorIdx = settings.colorIdx;
game.settings.speed = settings.speed;
game.settings.peds = settings.peds;
game.setVehicle(settings.vehicle);
game.setColor(settings.colorIdx);

const resize = () => game.resize(ui.canvas.clientWidth || innerWidth, ui.canvas.clientHeight || innerHeight);
addEventListener("resize", resize);
resize();

function updateVehicleHint() {
  const v = VEHICLES[settings.vehicle] || VEHICLES.car;
  ui.vehicleHint.textContent = `${v.emoji} ${v.label}:${v.blurb}`;
}
updateVehicleHint();

/* 🔊 人聲導覽(預烤 mp3;沒烤過的句子靜默,絕不用 Web Speech)*/
primeVoice();
setVoiceEnabled(audioEnabled);
const lastSpoke = new Map();
let lastBlocks = -1;               // 逛過幾個街區(變了才報里程碑)
function speakEvent(type, d) {
  const text = lineFor(type, d);
  if (!text) return;
  const gap = COOLDOWN[type] ?? 6;
  const now = performance.now() / 1000;
  if (gap > 0 && now - (lastSpoke.get(text) || -1e9) < gap) return;
  lastSpoke.set(text, now);
  speakLine(text);
}

/* 👶 年齡三檔(kid-age-modes):一鍵設好車速與視角,跨站共用 hfpc-age-pref */
function buildAgeButtons() {
  ui.agePresets.innerHTML = "";
  for (const id of AGE_IDS) {
    const a = AGE[id];
    const b = document.createElement("button");
    b.className = "age-btn"; b.dataset.age = id;
    b.innerHTML = `<b>${a.emoji} ${a.label}</b><small>${a.sub}</small>`;
    b.addEventListener("click", () => applyAge(id));
    ui.agePresets.appendChild(b);
  }
}
function syncAgeButtons() {
  const on = matchAge(settings, game.camView);
  for (const b of ui.agePresets.querySelectorAll(".age-btn")) b.classList.toggle("on", b.dataset.age === on);
}
function applyAge(id) {
  const a = AGE[id];
  if (!a) return;
  settings.speed = a.speed;
  saveSettings({ speed: a.speed });
  game.settings.speed = a.speed;
  ui.speedSelect.value = a.speed;
  game.setCamView(a.camView);
  setAgePref(id);
  syncAgeButtons();
  audio.uiTap();
}
buildAgeButtons();
// 開場沿用跨站偏好:別站選過幼幼,這站就是幼幼(選一次、全系列記得)
applyAgePrefOnBoot();
function applyAgePrefOnBoot() {
  const pref = getAgePref();
  // 只有「這台機還沒在本站選過車速」才套用,不然會蓋掉使用者自己調過的
  if (saved.speed === undefined) applyAge(pref);
  else syncAgeButtons();
}

/* ── 換載具快捷列(開著也能換)── */
function buildVehicleBar() {
  ui.vehicleBar.innerHTML = "";
  VEHICLE_IDS.forEach((id, i) => {
    const b = document.createElement("button");
    b.className = "veh-btn";
    b.dataset.veh = id;
    b.innerHTML = `<span class="veh-ico">${VEHICLES[id].emoji}</span><span class="veh-key">${i + 1}</span>`;
    b.title = `${VEHICLES[id].label}(按 ${i + 1})`;
    b.addEventListener("click", () => switchVehicle(id));
    ui.vehicleBar.appendChild(b);
  });
  syncVehicleBar();
}
function syncVehicleBar() {
  for (const b of ui.vehicleBar.querySelectorAll(".veh-btn")) b.classList.toggle("on", b.dataset.veh === settings.vehicle);
}
function switchVehicle(id) {
  settings.vehicle = game.setVehicle(id);
  saveSettings({ vehicle: settings.vehicle });
  game.setColor(settings.colorIdx);
  ui.vehicleSelect.value = settings.vehicle;
  syncVehicleBar(); updateVehicleHint(); audio.uiTap();
}
buildVehicleBar();

ui.vehicleSelect.addEventListener("change", () => switchVehicle(ui.vehicleSelect.value));
ui.colorSelect.addEventListener("change", () => { settings.colorIdx = Number(ui.colorSelect.value); saveSettings({ colorIdx: settings.colorIdx }); game.setColor(settings.colorIdx); });
ui.speedSelect.addEventListener("change", () => { settings.speed = ui.speedSelect.value; saveSettings({ speed: settings.speed }); game.settings.speed = settings.speed; syncAgeButtons(); });
ui.pedSelect.addEventListener("change", () => { settings.peds = ui.pedSelect.value === "on"; saveSettings({ peds: settings.peds }); game.settings.peds = settings.peds; });
ui.audioSelect.addEventListener("change", () => setAudio(ui.audioSelect.value === "on"));

function setAudio(on) {
  audioEnabled = on;
  audio.setEnabled(on);
  setVoiceEnabled(on);           // 靜音就連人聲一起關(不然按了靜音還有人在講話)
  ui.audioButton.textContent = on ? "音效開啟" : "音效關閉";
  ui.audioSelect.value = on ? "on" : "off";
  saveSettings({ audioEnabled: on });
}
ui.audioButton.addEventListener("click", () => { setAudio(!audioEnabled); audio.unlock(); });

/* 內建瀏覽器提醒(in-app-browser-guard):教會連結都走 LINE 發,而 LINE 的 WebView 常拒絕全螢幕/鎖向。
   ★ 只提醒不擋、開場就講、只講「換瀏覽器」那一條(其他建議在這個情境下都是錯的指引)。 */
const IN_APP = (() => {
  const ua = navigator.userAgent || "";
  // ⚠ 一定要用 \bLine\/ 而不是 /line/i：offline、Baseline、inline 都會誤中
  if (/\bLine\//i.test(ua) || /\bLIFF\b/i.test(ua)) return { n: "LINE", m: "右上角「⋯」→「用其他瀏覽器開啟」" };
  if (/FBAN|FBAV|FB_IAB|FB4A/i.test(ua)) return { n: "Facebook", m: "右上角「⋯」→「在外部瀏覽器中開啟」" };
  if (/Instagram/i.test(ua)) return { n: "Instagram", m: "右上角「⋯」→「在瀏覽器中開啟」" };
  if (/MicroMessenger/i.test(ua)) return { n: "微信", m: "右上角「⋯」→「在瀏覽器中開啟」" };
  return null;
})();
if (IN_APP) {
  const hint = document.createElement("p");
  hint.className = "home-hint";
  hint.style.cssText = "background:rgba(255,180,60,.16);padding:8px 12px;border-radius:12px";
  hint.textContent = `📱 你是從 ${IN_APP.n} 打開的:全螢幕與橫向鎖定可能沒反應。想要完整體驗請 ${IN_APP.m}。`;
  ui.startButton.parentNode.insertBefore(hint, ui.startButton);
}

/* 全螢幕 + 鎖橫向(force-landscape-pwa) */
function enterImmersive(force = false) {
  try {
    if (!force && !(matchMedia && matchMedia("(pointer: coarse)").matches)) return;
    const lock = () => { try { screen.orientation?.lock?.("landscape").catch(() => {}); } catch { /* ignore */ } };
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) {
      const p = el.requestFullscreen();
      p && p.then ? p.then(lock).catch(() => {}) : lock();
    } else lock();
  } catch { /* ignore */ }
}
ui.fsButton.addEventListener("click", () => {
  if (document.fullscreenElement) { document.exitFullscreen?.(); return; }
  if (!document.documentElement.requestFullscreen || IN_APP) { flashMessage(IN_APP ? `${IN_APP.n} 內建瀏覽器不支援全螢幕:${IN_APP.m}` : "這個瀏覽器不支援全螢幕"); return; }
  enterImmersive(true);
});
addEventListener("pointerdown", () => enterImmersive(false), { once: true, passive: true });

/* ── beacons:-done(逛完一趟回選單)/ -dwell(真實停留)。開啟打點在 index.html。 ── */
const PING = "https://hfpc-play-stats.summer09201017.workers.dev/api/ping?g=";
const isLocal = ["localhost", "127.0.0.1", ""].includes(location.hostname);
let driveStartedAt = 0;
function sendDone() {
  try {
    if (isLocal || !navigator.sendBeacon || !driveStartedAt) return;
    const dt = Math.round((performance.now() - driveStartedAt) / 1000);
    driveStartedAt = 0;                       // 一趟只算一次
    if (dt >= 3) navigator.sendBeacon(PING + "city3d-done&t=" + dt);
  } catch { /* ignore */ }
}
const openedAt = performance.now();
let dwellSent = false;
function sendDwell() {
  if (dwellSent || isLocal) return;
  const s2 = Math.round((performance.now() - openedAt) / 1000);
  if (s2 >= 3 && s2 <= 1800 && navigator.sendBeacon) { dwellSent = true; navigator.sendBeacon(PING + "city3d-dwell&t=" + s2); }
}
addEventListener("pagehide", () => { sendDone(); sendDwell(); });
document.addEventListener("visibilitychange", () => { if (document.hidden) { sendDwell(); audio.suspend(); } else audio.resume(); });

function startDrive() {
  driveStartedAt = performance.now();
  audio.unlock(); audio.startEngine();
  enterImmersive(false);
  ui.homeScreen.classList.remove("visible");
  game.beginDrive();
  lastBlocks = -1; lastSpoke.clear();
  buildMiniBase();
  if (!helpSeen) { openHelp(); helpSeen = true; saveSettings({ helpSeen: true }); }
  // 幼幼檔自動唸「怎麼玩」(還不識字的孩子);其他檔按 🔊 才唸
  if (getAgePref() === "kinder") setTimeout(() => speakLine(HOWTO), 400);
  else speakEvent("begin", {});
}
ui.startButton.addEventListener("click", startDrive);
const toMenu = () => { sendDone(); ui.homeScreen.classList.add("visible"); ui.helpOverlay.classList.remove("visible"); game.backToMenu(); };
ui.menuButton.addEventListener("click", toMenu);
ui.cameraButton.addEventListener("click", () => { game.cycleCamView(); audio.uiTap(); });
function openHelp() { ui.helpOverlay.classList.add("visible"); }
function closeHelp() { ui.helpOverlay.classList.remove("visible"); }
ui.helpButton.addEventListener("click", openHelp);
ui.helpCloseButton.addEventListener("click", closeHelp);
ui.helpSpeakButton.addEventListener("click", () => { audio.unlock(); speakLine(HOWTO); });

/* ── 輸入 ── */
const codes = new Set();
const touch = { left: false, right: false, gas: false, brake: false, boost: false };
const gp = new GamepadInput({ mode: "poll", onConnect: (on) => { if (on) flashMessage("🎮 手把已連線"); } });
let steer = 0;
const PREVENT = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "ShiftLeft", "ShiftRight"]);
addEventListener("keydown", (e) => {
  if (e.target && ["SELECT", "INPUT", "TEXTAREA"].includes(e.target.tagName)) return;
  const k = e.key, c = e.code;
  if (k === "Escape") { if (ui.helpOverlay.classList.contains("visible")) closeHelp(); else if (game.phase !== "menu") toMenu(); return; }
  if (k === "h" || k === "H") { ui.helpOverlay.classList.contains("visible") ? closeHelp() : openHelp(); return; }
  if (k === "v" || k === "V") { game.cycleCamView(); audio.uiTap(); return; }
  if (k >= "1" && k <= "5") { const id = VEHICLE_IDS[Number(k) - 1]; if (id) switchVehicle(id); return; }
  if (PREVENT.has(c)) e.preventDefault();
  codes.add(c);
  audio.unlock();
});
addEventListener("keyup", (e) => codes.delete(e.code));
addEventListener("blur", () => codes.clear());

const bindHold = (btn, name) => {
  if (!btn) return;
  const on = (e) => { e.preventDefault(); touch[name] = true; btn.classList.add("active"); audio.unlock(); try { btn.setPointerCapture(e.pointerId); } catch { /* ignore */ } };
  const off = () => { touch[name] = false; btn.classList.remove("active"); };
  btn.addEventListener("pointerdown", on);
  for (const ev of ["pointerup", "pointercancel", "pointerleave"]) btn.addEventListener(ev, off);
  btn.addEventListener("contextmenu", (e) => e.preventDefault());
};
bindHold(ui.tLeft, "left"); bindHold(ui.tRight, "right"); bindHold(ui.tGas, "gas"); bindHold(ui.tBrake, "brake"); bindHold(ui.tBoost, "boost");

const smooth = (cur, target, dt) => { cur += (target - cur) * Math.min(1, dt * (target === 0 ? 12 : 6)); return Math.abs(cur) < 0.01 ? 0 : cur; };
function pollInput(dt) {
  gp.poll();
  if (gp.justPressed.Y) { game.cycleCamView(); audio.uiTap(); }
  if (gp.justPressed.START && game.phase !== "menu") toMenu();
  if (gp.justPressed.A && game.phase === "menu") startDrive();
  const has = (c) => codes.has(c);
  const left = has("KeyA") || has("ArrowLeft") || touch.left || gp.dir.left;
  const right = has("KeyD") || has("ArrowRight") || touch.right || gp.dir.right;
  steer = smooth(steer, (right ? 1 : 0) - (left ? 1 : 0), dt);
  const inp = game.input;
  inp.steer = steer;
  inp.throttle = (has("KeyW") || has("ArrowUp") || touch.gas || gp.held.A || gp.held.RT) ? 1 : 0;
  inp.brake = (has("KeyS") || has("ArrowDown") || touch.brake || gp.held.B || gp.held.LT) ? 1 : 0;
  inp.boost = has("ShiftLeft") || has("ShiftRight") || touch.boost || !!gp.held.X;
  inp.handbrake = has("Space") || !!gp.held.RB;
}

/* ── 都市小地圖:街廓底圖畫一次,車與行人每幀疊 ── */
let miniBase = null, miniFit = { s: 1, ox: 0, oy: 0 };
function buildMiniBase() {
  const W = ui.miniMap.width, H = ui.miniMap.height;
  const { w, h } = worldSize();
  const s = Math.min((W - 12) / w, (H - 12) / h);
  miniFit = { s, ox: W / 2, oy: H / 2 };
  const off = document.createElement("canvas"); off.width = W; off.height = H;
  const c = off.getContext("2d");
  c.fillStyle = "#3b4150"; c.fillRect(0, 0, W, H);
  for (let r = 0; r < CITY.rows; r++) {
    for (let col = 0; col < CITY.cols; col++) {
      const p = blockCenter(col, r);
      const [x, y] = miniXY(p.x, p.z);
      const size = CITY.block * s;
      c.fillStyle = isPark(col, r) ? "#63a856" : isPlaza(col, r) ? "#d8cdb4" : "#9aa0a8";
      c.fillRect(x - size / 2, y - size / 2, size, size);
    }
  }
  miniBase = off;
}
function miniXY(x, z) { return [miniFit.ox + x * miniFit.s, miniFit.oy + z * miniFit.s]; }
function drawMini(hud) {
  if (!miniBase || !hud.car) return;
  const c = ui.miniMap.getContext("2d");
  c.clearRect(0, 0, ui.miniMap.width, ui.miniMap.height);
  c.drawImage(miniBase, 0, 0);
  c.fillStyle = "rgba(255,255,255,0.75)";
  for (const p of hud.peds) { const [x, y] = miniXY(p.x, p.z); c.fillRect(x - 0.8, y - 0.8, 1.6, 1.6); }
  const [cx, cy] = miniXY(hud.car.x, hud.car.z);
  c.fillStyle = "#" + CAR_COLORS[settings.colorIdx].hex.toString(16).padStart(6, "0");
  c.strokeStyle = "#fff"; c.lineWidth = 2;
  c.beginPath(); c.arc(cx, cy, 4.5, 0, Math.PI * 2); c.fill(); c.stroke();
}

/* ── HUD ── */
let flashTimer = 0;
function flashMessage(text) { ui.statusMessage.textContent = text; flashTimer = 2.5; }
game.onHud = (hud) => {
  const driving = hud.phase === "driving";
  ui.tripCard.hidden = !driving; ui.miniWrap.hidden = !driving; ui.speedPanel.hidden = !driving; ui.vehicleBar.hidden = !driving;
  if (driving) {
    const v = VEHICLES[hud.vehicle] || VEHICLES.car;
    ui.vehicleText.textContent = `${v.emoji} ${v.label}`;
    ui.surfaceText.textContent = hud.surface === "road" ? "在馬路上" : `在${hud.surfaceLabel}上`;
    ui.distText.textContent = String(hud.distance);
    ui.blockText.textContent = `${hud.blocks}/${hud.totalBlocks}`;
    if (hud.blocks !== lastBlocks) { lastBlocks = hud.blocks; speakEvent("blocks", { blocks: hud.blocks, total: hud.totalBlocks }); }
    ui.speedText.textContent = String(hud.speedKmh);
    ui.turboLabel.textContent = `⚡ ${v.boostLabel}`;
    ui.turboFill.style.transform = `scaleX(${Math.max(0, Math.min(1, hud.turbo)).toFixed(3)})`;
    ui.turboRow.classList.toggle("tired", !!hud.tired);
    ui.turboRow.classList.toggle("boosting", !!hud.boosting);
    ui.viewTag.textContent = `視角:${hud.camLabel}`;
    drawMini(hud);
  }
  if (flashTimer <= 0 && hud.message) ui.statusMessage.textContent = hud.message;
  else if (flashTimer <= 0 && !hud.message && driving) ui.statusMessage.textContent = "想去哪就去哪";
};

game.onEvent = (type, d) => {
  speakEvent(type, d);
  if (type === "bump") audio.bump(d.speed);
  else if (type === "boost") audio.boost();
  else if (type === "rescue") audio.rescue();
  else if (type === "ped") audio.wrongWay();
  else if (type === "surface") audio.offtrack();
  else if (type === "view") syncAgeButtons();
  else if (type === "vehicle") {
    // ★ 一律以遊戲為準回頭校正 UI:任何不經 switchVehicle 的換車路徑,快捷列都不會亮錯顆
    settings.vehicle = d.id;
    ui.vehicleSelect.value = d.id;
    syncVehicleBar(); updateVehicleHint();
    audio.uiTap();
  }
};

/* ── 主迴圈:輸入 + 引擎聲掛在 game 的 RAF 前 ── */
const origUpdate = game.update.bind(game);
game.update = (dt) => {
  pollInput(dt);
  origUpdate(dt);
  if (flashTimer > 0) flashTimer -= dt;
  const p = game.player;
  if (p) {
    const active = game.phase === "driving";
    audio.setEngine(active ? Math.abs(p.speed) / 44 : 0.1, active ? game.input.throttle : 0, !!p.boosting,
      Math.min(1, Math.abs(p.lat) / 6), active, (VEHICLES[p.vehicle] || VEHICLES.car).sound);
  }
};
game.start();

if ("serviceWorker" in navigator && !["localhost", "127.0.0.1"].includes(location.hostname)) {
  addEventListener("load", () => { navigator.serviceWorker.register("./sw.js").catch(() => {}); });
}
