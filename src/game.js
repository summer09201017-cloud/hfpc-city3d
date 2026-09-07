// game.js —— 都市自由行駛:THREE 場景 + 自由模式狀態機。
// ★ 與 racing3d 最大的不同:**沒有比賽**——沒有倒數、沒有圈數、沒有名次、沒有結算。
//   狀態只有 menu → driving,想停就停、想去哪就去哪。
// ★ 三條使用者拍板的規則(0907):
//   ① 可以開上人行道、可以穿越廣場 —— 地面只決定快慢,不擋路
//   ② 撞不傷人 —— 行人會先閃開,真的碰到只是被推開 + 車減速,不倒地不消失
//   ③ 隨時換載具 —— 停下來按一顆鈕就換(車 / 摩托車 / 馬 / 跑步 / 懸浮車)
// ★ 沿用 racing3d 的鐵則:this.running 只給 RAF;mesh.visible 一律嚴格 boolean;鏡頭狀態建構子就有數字。
import * as THREE from "three";
import { CITY, SURFACES, worldSize, blockCenter, roadCenter, isPlaza, isPark, buildBuildings, buildPedestrians, stepPedestrians, surfaceAt, nearestRoadPoint, PED } from "./city.js";
import { CAR, DIFFICULTY, createCar, placeAt, stepCar, emptyInput, resolveCollisions, rpm01, kmh, clamp, wrapAngle, forwardOf } from "./vehicle.js";
import { VEHICLES, VEHICLE_IDS, vehicleParams } from "./vehicles.js";
import { makeCarRig, makeMotoRig, makeHorseRig, makeHoverRig, makeRunnerRig } from "./rigs.js";

export { CITY, SURFACES, VEHICLES, VEHICLE_IDS, DIFFICULTY };

/* 視角五檔(與 racing3d 同一套慣例:每檔都要有中文名,缺名=畫面印 undefined)。 */
export const CAM_VIEWS = ["chase", "hood", "cockpit", "bird", "shoulder"];
export const CAM_LABELS = { chase: "追尾跟隨", hood: "車頭", cockpit: "駕駛座", bird: "高空俯瞰", shoulder: "過肩" };
export const CAM_KEY = "city3d-camview";

export const CAR_COLORS = [
  { id: "red", label: "烈焰紅", hex: 0xe53935 },
  { id: "blue", label: "海洋藍", hex: 0x1e88e5 },
  { id: "yellow", label: "陽光黃", hex: 0xfdd835 },
  { id: "green", label: "青草綠", hex: 0x43a047 },
  { id: "purple", label: "葡萄紫", hex: 0x8e24aa },
  { id: "orange", label: "橘子橘", hex: 0xfb8c00 },
  { id: "white", label: "珍珠白", hex: 0xf5f5f5 },
];

/* 難度=車速檔(自由世界沒有對手,這只是「開多快」)。沿用 racing3d 的數字,孩子跨站不用重學。 */
export const SPEED_MODES = ["kids", "child", "easy", "normal"];
export const SPEED_LABELS = { kids: "慢慢逛(86 km/h)", child: "輕鬆(108)", easy: "一般(133)", normal: "快(158)" };

export const DEFAULT_SETTINGS = { vehicle: "car", colorIdx: 1, speed: "easy", peds: true };

const lambert = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });

export class CityGame {
  constructor({ canvas = null, headless = false } = {}) {
    this.canvas = canvas;
    this.headless = headless || !canvas;
    this.phase = "menu";            // menu | driving(沒有第三種——這裡沒有比賽)
    this.running = false;           // ★ 只給 RAF
    this.settings = { ...DEFAULT_SETTINGS };
    this.input = emptyInput();
    this.autopilot = false;         // 測試/展示用
    this.time = 0;
    this.message = ""; this.messageT = 0;
    this.onHud = null; this.onEvent = null;
    this.distance = 0;              // 這一趟開了幾公尺(自由世界的「成績」)
    this.visited = new Set();       // 逛過哪些街廓
    this.pedBumps = 0;

    this.buildings = buildBuildings();
    this.peds = buildPedestrians();
    // 驗收要用:廣場/公園的中心座標(使用者點名「能穿越廣場」,測試得知道廣場在哪)
    this.plazaCenters = CITY.plazas.map(([c, r]) => blockCenter(c, r));
    this.parkCenters = CITY.parks.map(([c, r]) => blockCenter(c, r));
    this.player = null; this.rig = null;

    const saved = (key, fallback) => { try { const v = typeof localStorage !== "undefined" ? localStorage.getItem(key) : null; return v && CAM_VIEWS.includes(v) ? v : fallback; } catch { return fallback; } };
    this.cam = {
      view: saved(CAM_KEY, "chase"), snap: true, shake: 0,
      pos: new THREE.Vector3(0, 12, -40), look: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), fov: 62,
      chaseDir: new THREE.Vector3(0, 0, 1),
      d: { pos: new THREE.Vector3(), look: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), fov: 62, near: 0.3, kPos: 1, kLook: 1, kUp: 1, hard: false },
      camera: new THREE.PerspectiveCamera(62, 16 / 9, 0.3, 4000),
    };
    this._v1 = new THREE.Vector3(); this._v2 = new THREE.Vector3(); this._v3 = new THREE.Vector3();
    this._q = new THREE.Quaternion(); this._e = new THREE.Euler();
    this._vw = 1280; this._vh = 720;
    this.reducedMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

    this.renderer = null;
    if (!this.headless) {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    }
    this.scene = null; this.pedMeshes = [];
    this._buildWorld();
    this._spawnPlayer();
    this.cam.snap = true;
  }

  get camera() { return this.cam.camera; }
  get camView() { return this.cam.view; }
  say(text, seconds = 2.5) { this.message = text; this.messageT = seconds; }
  _emit(type, data) { if (this.onEvent) this.onEvent(type, data); }

  /* ───────────────────────── 世界 ───────────────────────── */

  _buildWorld() {
    const scene = new THREE.Scene();
    const { w, h } = worldSize();
    scene.background = new THREE.Color(0x9fc9ef);
    scene.fog = new THREE.Fog(0xcfe3f5, 260, 1500);
    scene.add(new THREE.HemisphereLight(0xe8f2ff, 0x6f7d63, 0.9));
    const sun = new THREE.DirectionalLight(0xfff1d6, 1.25);
    sun.position.set(220, 380, 160);
    scene.add(sun);
    scene.add(new THREE.AmbientLight(0xffffff, 0.18));

    // ★ 地面要跟 surfaceAt 說同一件事:城界(w×h 的方形)以內是柏油、以外是草地。
    //   原本用一個圓環當草原,半徑從 328 起算、城界卻在 228 —— 中間那圈看起來是路、判定卻是草地(看得到的謊)。
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(w + 900, h + 900), lambert(0x5f9d52));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.03;
    scene.add(ground);
    const asphalt = new THREE.Mesh(new THREE.PlaneGeometry(w, h), lambert(0x4a4e57));
    asphalt.rotation.x = -Math.PI / 2; asphalt.position.y = -0.02;
    scene.add(asphalt);

    // 每個街廓鋪一塊面:一般=人行道灰、廣場=米色磚、公園=草綠
    const blockGeo = new THREE.PlaneGeometry(CITY.block, CITY.block);
    for (let r = 0; r < CITY.rows; r++) {
      for (let c = 0; c < CITY.cols; c++) {
        const p = blockCenter(c, r);
        const color = isPark(c, r) ? 0x63a856 : isPlaza(c, r) ? 0xd8cdb4 : 0x9aa0a8;
        const m = new THREE.Mesh(blockGeo, lambert(color));
        m.rotation.x = -Math.PI / 2; m.position.set(p.x, 0.01, p.z);
        scene.add(m);
        if (isPark(c, r)) this._buildPark(scene, p);
        if (isPlaza(c, r)) this._buildPlazaDressing(scene, p);
      }
    }
    // 街道中央的白虛線(讓「這是馬路」看得出來)
    this._buildRoadMarks(scene);
    this._buildBuildings(scene);
    this._buildPedMeshes(scene);
    this.scene = scene;
  }

  _buildRoadMarks(scene) {
    const g = CITY.block + CITY.road, { w, h } = worldSize();
    const mat = new THREE.MeshBasicMaterial({ color: 0xf2f2f2 });
    const dash = new THREE.PlaneGeometry(0.35, 4);
    // ★ i 從 1 起:第 i-1 格的街在 g*i - road/2;i=0 會畫出一排飄在城外草地上的虛線
    for (let i = 1; i <= CITY.cols; i++) {
      const x = -w / 2 + i * g - CITY.road / 2;
      for (let z = -h / 2; z < h / 2; z += 9) {
        const m = new THREE.Mesh(dash, mat);
        m.rotation.x = -Math.PI / 2; m.position.set(x, 0.03, z);
        scene.add(m);
      }
    }
    for (let j = 1; j <= CITY.rows; j++) {
      const z = -h / 2 + j * g - CITY.road / 2;
      for (let x = -w / 2; x < w / 2; x += 9) {
        const m = new THREE.Mesh(dash, mat);
        m.rotation.x = -Math.PI / 2; m.rotation.z = Math.PI / 2; m.position.set(x, 0.03, z);
        scene.add(m);
      }
    }
  }

  _buildPark(scene, p) {
    const trunk = new THREE.CylinderGeometry(0.26, 0.34, 2.4, 7);
    const crown = new THREE.SphereGeometry(2.2, 9, 7);
    const tMat = lambert(0x6b4a2b), cMat = lambert(0x2f8f3f);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2, rr = 8 + (i % 3) * 6;
      const x = p.x + Math.cos(a) * rr, z = p.z + Math.sin(a) * rr;
      const t = new THREE.Mesh(trunk, tMat); t.position.set(x, 1.2, z); scene.add(t);
      const c = new THREE.Mesh(crown, cMat); c.position.set(x, 3.6, z); scene.add(c);
    }
  }

  _buildPlazaDressing(scene, p) {
    // 廣場中央一座噴水池(可以繞著開,撞不到——它只是矮圈)
    const ring = new THREE.Mesh(new THREE.TorusGeometry(4, 0.5, 8, 24), lambert(0xe8e2d2));
    ring.rotation.x = Math.PI / 2; ring.position.set(p.x, 0.4, p.z);
    scene.add(ring);
    const water = new THREE.Mesh(new THREE.CircleGeometry(3.8, 20), lambert(0x63b6e8));
    water.rotation.x = -Math.PI / 2; water.position.set(p.x, 0.15, p.z);
    scene.add(water);
  }

  _buildBuildings(scene) {
    const palette = [0xd9cbb6, 0xc3d0d9, 0xd6bfc0, 0xbfc9b4, 0xcfc6d9, 0xe0d3b8];
    for (const b of this.buildings) {
      const color = palette[Math.floor(b.tint * palette.length) % palette.length];
      const m = new THREE.Mesh(new THREE.BoxGeometry(b.w * 2, b.h, b.d * 2), lambert(color));
      m.position.set(b.x, b.h / 2, b.z);
      scene.add(m);
      // 窗戶:四面各貼一排暗色小方塊(不做玻璃材質,省效能)
      const winMat = lambert(0x3b4a5e);
      const rows = Math.max(2, Math.floor(b.h / 4));
      for (let i = 1; i < rows; i++) {
        const y = (i / rows) * b.h;
        for (const [sx, sz, rot] of [[0, b.d + 0.02, 0], [0, -b.d - 0.02, Math.PI], [b.w + 0.02, 0, Math.PI / 2], [-b.w - 0.02, 0, -Math.PI / 2]]) {
          const strip = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(1, (sx === 0 ? b.w : b.d) * 1.5), 0.9), winMat);
          strip.position.set(b.x + sx, y, b.z + sz); strip.rotation.y = rot;
          scene.add(strip);
        }
      }
      if (b.kind === "shop") {
        const awn = new THREE.Mesh(new THREE.BoxGeometry(b.w * 2 + 0.6, 0.25, 1.2), lambert(0xd9584a));
        awn.position.set(b.x, 3.2, b.z + b.d + 0.5);
        scene.add(awn);
      }
    }
  }

  /** 行人:矮圓柱身體 + 頭 + 兩隻手(遠看是人,近看不恐怖);撞不傷,所以不做倒地動畫。 */
  _buildPedMeshes(scene) {
    const shirts = [0xe05c4a, 0x4a86e0, 0x4ac07a, 0xe0b44a, 0x9a6be0, 0xe07ac0];
    const skin = lambert(0xf1c9a5);
    this.pedMeshes = [];
    for (const p of this.peds) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.75, 0.28), lambert(shirts[p.shirt % shirts.length]));
      body.position.y = 0.95; g.add(body);
      const legs = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.6, 0.26), lambert(0x394a63));
      legs.position.y = 0.35; g.add(legs);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 10, 8), skin);
      head.position.y = 1.5; g.add(head);
      for (const sx of [-1, 1]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.032, 6, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
        eye.position.set(sx * 0.06, 1.53, 0.16); g.add(eye);
      }
      g.position.set(p.x, 0, p.z);
      scene.add(g);
      this.pedMeshes.push({ g, body });
    }
  }

  /* ───────────────────────── 玩家 ───────────────────────── */

  _makeRig(vehicle, hex) {
    const opts = { interior: true };
    if (vehicle === "moto") return makeMotoRig(hex, opts, VEHICLES.moto.over.wheelRadius || 0.34);
    if (vehicle === "horse") return makeHorseRig(hex, opts);
    if (vehicle === "hover") return makeHoverRig(hex, opts);
    if (vehicle === "run") return makeRunnerRig(hex, opts);
    return makeCarRig(hex, opts);
  }

  _spawnPlayer(keepPose = null) {
    if (this.rig) this.scene.remove(this.rig.group);
    const v = VEHICLES[this.settings.vehicle] ? this.settings.vehicle : "car";
    const hex = CAR_COLORS[this.settings.colorIdx % CAR_COLORS.length].hex;
    this.rig = this._makeRig(v, hex);
    this.scene.add(this.rig.group);
    const car = createCar({ isPlayer: true, vehicle: v, params: vehicleParams(v), colorIdx: this.settings.colorIdx });
    // 出發點:**市中心那個十字路口**(自由漫遊要一開場就看得到城,從角落起步整座城都在背後)
    const p = roadCenter(Math.floor(CITY.cols / 2) - 1, Math.floor(CITY.rows / 2) - 1);
    const start = keepPose || { x: p.x, z: p.z, heading: 0 };
    placeAt(car, start.x, start.z, start.heading);
    if (keepPose) car.speed = 0;
    this.player = car;
    this._syncRig(0);
  }

  /** 換載具:停在原地換,不用回選單(使用者要的「自由切換」)。 */
  setVehicle(id) {
    const v = VEHICLES[id] ? id : "car";
    if (v === this.settings.vehicle) return v;
    this.settings.vehicle = v;
    const pose = this.player ? { x: this.player.x, z: this.player.z, heading: this.player.heading } : null;
    this._spawnPlayer(pose);
    this.cam.snap = true;
    this.say(`換成 ${VEHICLES[v].emoji} ${VEHICLES[v].label}`, 2);
    this._emit("vehicle", { id: v, label: VEHICLES[v].label });
    this.pushHud();
    return v;
  }

  setColor(idx) {
    idx = ((idx % CAR_COLORS.length) + CAR_COLORS.length) % CAR_COLORS.length;
    this.settings.colorIdx = idx;
    if (this.rig) this.rig.paint.color.setHex(CAR_COLORS[idx].hex);
  }

  start() {
    if (this.running || this.headless) return;
    this.running = true;
    let last = performance.now();
    const loop = (now) => {
      if (!this.running) return;
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      this.update(dt);
      this.render();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
  stop() { this.running = false; }

  beginDrive() { this.phase = "driving"; this.distance = 0; this.pedBumps = 0; this.visited.clear(); this.say("想去哪就去哪 —— 人行道、廣場、公園都能開", 4); this.pushHud(); }
  backToMenu() { this.phase = "menu"; this.pushHud(); }

  resize(width, height) {
    this._vw = Math.max(1, width | 0); this._vh = Math.max(1, height | 0);
    if (this.renderer) this.renderer.setSize(this._vw, this._vh, false);
    this.cam.camera.aspect = this._vw / this._vh;
    this.cam.camera.updateProjectionMatrix();
  }

  /* ───────────────────────── 迴圈 ───────────────────────── */

  update(dt) {
    dt = Math.min(dt, 1 / 20);
    this.time += dt;
    if (this.messageT > 0) { this.messageT -= dt; if (this.messageT <= 0) this.message = ""; }
    const cfg = DIFFICULTY[this.settings.speed] || DIFFICULTY.easy;
    const car = this.player;
    if (car) {
      const before = { x: car.x, z: car.z };
      const input = this.autopilot ? this._autopilotInput(car) : this.input;
      let evs;
      if (car.startBoostT > 0) {
        const t0 = car.turbo, tired0 = car.tired;
        evs = stepCar(car, { ...input, boost: true }, dt, cfg, this.buildings, {});
        car.turbo = t0; car.tired = tired0;
        car.startBoostT = Math.max(0, car.startBoostT - dt);
      } else evs = stepCar(car, input, dt, cfg, this.buildings, {});
      for (const e of evs) this._onEvent(car, e);
      if (this.phase === "driving") {
        this.distance += Math.hypot(car.x - before.x, car.z - before.z);
        const b = this._blockOf(car.x, car.z);
        if (b) this.visited.add(b);
      }
      // 行人:先閃開,碰到只推開 + 車減速(★ 撞不傷人)
      if (this.settings.peds !== false) {
        for (const hit of stepPedestrians(this.peds, [car], dt)) {
          if ((car.hitPedT || 0) > 0) continue;
          car.hitPedT = 1.2;
          car.speed *= PED.carSlow;
          this.pedBumps++;
          this.say("⚠ 小心行人!他跳開了,沒事", 2);
          this._emit("ped", { total: this.pedBumps });
        }
      }
      this._syncRig(dt);
      this._syncPeds(dt);
    }
    this._updateCamera(dt);
    this.pushHud();
  }

  _blockOf(x, z) {
    const g = CITY.block + CITY.road, { w, h } = worldSize();
    const c = Math.floor((x + w / 2) / g), r = Math.floor((z + h / 2) / g);
    if (c < 0 || r < 0 || c >= CITY.cols || r >= CITY.rows) return null;
    return `${c},${r}`;
  }

  /** 展示/驗收用的自動駕駛:沿路蛇行,快到城界就轉回市中心(不然四秒就開出城,量到的都是邊緣)。 */
  _autopilotInput(car) {
    const { w, h } = worldSize();
    let steer = Math.sin(this.time * 0.6) * 0.35;
    if (Math.max(Math.abs(car.x) / (w / 2), Math.abs(car.z) / (h / 2)) > 0.62) {
      steer = clamp(wrapAngle(Math.atan2(-car.x, -car.z) - car.heading) * 1.4, -1, 1);   // 朝市中心
    }
    return { ...emptyInput(), throttle: 1, steer };
  }

  _onEvent(car, e) {
    const type = typeof e === "string" ? e : e.type;
    if (type === "bump") { this.cam.shake = Math.min(1, 0.3 + (e.speed || 0) / 40); this._emit("bump", { speed: e.speed || 0 }); }
    else if (type === "surface") { this._emit("surface", e); if (e.to !== "road") this.say(`開上${e.label}了`, 1.2); }
    else if (type === "rescue") { this.say("卡住了,幫你放回路上", 2); this._emit("rescue", {}); }
    else if (type === "drift") { car.startBoostT = Math.max(car.startBoostT || 0, e.seconds); this.say(`🌀 甩尾漂亮!送你 ${e.seconds.toFixed(1)} 秒加速`, 1.8); this._emit("drift", e); }
    else if (type === "edge") { this.say("🏙️ 到城外了,掉頭回市區吧", 2.5); this._emit("edge", {}); }
    else if (type === "boost") this._emit("boost", {});
    else if (type === "boostend") this._emit("boostend", {});
  }

  _syncRig(dt) {
    const car = this.player, rig = this.rig;
    if (!car || !rig) return;
    rig.group.position.set(car.x, car.y, car.z);
    rig.group.rotation.y = car.heading;
    const pitchT = clamp(-car.accel * 0.012, -0.07, 0.07);
    const rollT = rig.leanIn ? clamp(-car.yawRate * car.speed * 0.02, -0.45, 0.45) : clamp(car.yawRate * car.speed * 0.006 + car.latAcc * 0.004, -0.14, 0.14);
    const k = dt > 0 ? Math.min(1, dt * 7) : 1;
    rig.tilt.rotation.x += (pitchT - rig.tilt.rotation.x) * k;
    rig.tilt.rotation.z += (rollT - rig.tilt.rotation.z) * k;
    if (car.bumpT > 0) rig.tilt.rotation.z += Math.sin(car.bumpT * 40) * 0.02 * car.bumpT;
    for (const w of rig.wheels) {
      w.spin.rotation.x = car.wheelSpin;
      if (w.front) w.pivot.rotation.y = -car.steer * 0.5;
    }
    if (rig.flame) rig.flame.visible = !!car.boosting;
    if (rig.tailMat) rig.tailMat.emissiveIntensity = (this.input.brake > 0 && this.phase === "driving") ? 1.0 : 0.35;
    if (rig.anim) rig.anim(car, dt);
    if (rig.cockpit) {
      const { wheel, wheelAxis = "z", wheelGain = 1.7, needlePivot } = rig.cockpit.userData;
      if (wheel) wheel.rotation[wheelAxis] = car.steer * wheelGain;
      if (needlePivot) {
        const cfg = DIFFICULTY[this.settings.speed] || DIFFICULTY.easy;
        const frac = clamp(Math.abs(car.speed) / (cfg.maxSpeed * CAR.boostSpeedMul), 0, 1);
        needlePivot.rotation.z = (330 + frac * 240) * Math.PI / 180;
      }
    }
    const hideNow = this.cam.view === "cockpit" && this.phase === "driving";
    for (const m of rig.hide) m.visible = !hideNow;
    // ★ 第一人稱內裝(儀表板/方向盤/速度錶)只該在駕駛座視角看得到。
    //   漏掉這一行,跑步那顆速度錶就會**浮在人的胸前**,追尾視角一眼看到(0908 使用者實玩回報);
    //   車與摩托車也一樣,只是內裝藏在車體裡比較看不出來。
    if (rig.cockpit) rig.cockpit.visible = hideNow;
  }

  _syncPeds(dt) {
    for (let i = 0; i < this.peds.length; i++) {
      const p = this.peds[i], m = this.pedMeshes[i];
      if (!m) continue;
      m.g.position.set(p.x, 0, p.z);
      m.g.rotation.y = p.dir;
      // 走路上下擺(逃跑時快一點);撞到只是往旁邊跳,不倒地
      const bob = Math.sin(this.time * (p.flee > 0 ? 14 : 7) + i) * 0.05;
      m.body.position.y = 0.95 + Math.abs(bob);
    }
  }

  /* ───────────────────────── 鏡頭 ───────────────────────── */

  setCamView(id) {
    if (!CAM_VIEWS.includes(id)) return;
    this.cam.view = id; this.cam.snap = true;
    try { if (typeof localStorage !== "undefined") localStorage.setItem(CAM_KEY, id); } catch { /* ignore */ }
    this._emit("view", { id, label: CAM_LABELS[id] });
    this.pushHud();
  }
  cycleCamView() { this.setCamView(CAM_VIEWS[(CAM_VIEWS.indexOf(this.cam.view) + 1) % CAM_VIEWS.length]); }

  _desiredCamera(dt) {
    const c = this.cam, d = c.d, car = this.player;
    d.hard = false; d.near = 0.3; d.kPos = 1 - Math.exp(-0.016 * 7); d.kLook = d.kPos; d.kUp = 1 - Math.exp(-0.016 * 3);
    d.up.set(0, 1, 0);
    if (!car) { d.pos.set(0, 60, 80); d.look.set(0, 0, 0); d.fov = 55; return; }
    const VEH = VEHICLES[car.vehicle] || VEHICLES.car;
    const f = forwardOf(car.heading);
    const pump = this.reducedMotion ? 0 : clamp(Math.abs(car.speed) / 44, 0, 1.2);
    const cx = car.x, cy = car.y, cz = car.z;
    if (c.view === "chase") {
      this._v1.set(f.x, 0, f.z);
      if (c.snap) c.chaseDir.copy(this._v1); else c.chaseDir.lerp(this._v1, 1 - Math.exp(-dt * 4)).normalize();
      const dir = c.chaseDir, back = 7.6 + pump * 1.6;
      d.pos.set(cx - dir.x * back, cy + 3.0 + pump * 0.3, cz - dir.z * back);
      d.look.set(cx + dir.x * 5, cy + 1.1, cz + dir.z * 5);
      d.fov = 62 + pump * 8; d.kPos = 1; d.kLook = 1;
    } else if (c.view === "hood") {
      this.rig.tilt.updateWorldMatrix(true, false);
      this._v1.set(VEH.hood.x, VEH.hood.y, VEH.hood.z).applyMatrix4(this.rig.tilt.matrixWorld);
      this._v2.set(0, 0, 1).transformDirection(this.rig.tilt.matrixWorld);
      d.pos.copy(this._v1); d.look.copy(this._v1).addScaledVector(this._v2, 30); d.look.y -= 0.15;
      d.fov = 66 + pump * 7; d.kPos = 1; d.kLook = 1;
    } else if (c.view === "cockpit") {
      this._e.set(this.rig.tilt.rotation.x * 0.7, car.heading, this.rig.tilt.rotation.z * 0.4, "YXZ");
      this._q.setFromEuler(this._e);
      this._v1.set(VEH.eye.x, VEH.eye.y, VEH.eye.z).applyQuaternion(this._q).add(this.rig.group.position);
      this._v2.set(0, 0, 1).applyQuaternion(this._q);
      this._v3.set(0, 1, 0).applyQuaternion(this._q);
      this._v2.applyAxisAngle(this._v3, -car.steer * 0.16);
      d.pos.copy(this._v1); d.look.copy(this._v1).addScaledVector(this._v2, 30); d.look.y -= 0.9;
      d.up.copy(this._v3);
      d.fov = 74 + pump * 6; d.near = 0.05; d.kPos = 1; d.kLook = 1; d.kUp = 1;
    } else if (c.view === "bird") {
      d.pos.set(cx + f.x * 0.01, cy + 70, cz + f.z * 0.01);
      d.look.set(cx + f.x * 8, cy, cz + f.z * 8);
      d.up.set(f.x, 0, f.z);           // ★ 正上方視角 up 要明確定(0826 撞球雷)
      d.fov = 58; d.kPos = 1 - Math.exp(-0.016 * 3.5); d.kLook = d.kPos; d.kUp = 1 - Math.exp(-0.016 * 2.5);
    } else {                            // shoulder:斜後高一點,看得到街景(都市版特有)
      this._v1.set(f.x, 0, f.z);
      if (c.snap) c.chaseDir.copy(this._v1); else c.chaseDir.lerp(this._v1, 1 - Math.exp(-dt * 3)).normalize();
      const dir = c.chaseDir;
      d.pos.set(cx - dir.x * 11 - dir.z * 5, cy + 6.5, cz - dir.z * 11 + dir.x * 5);
      d.look.set(cx + dir.x * 6, cy + 1.4, cz + dir.z * 6);
      d.fov = 58;
    }
  }

  _updateCamera(dt) {
    const c = this.cam, d = c.d, cam = c.camera;
    this._desiredCamera(dt);
    if (c.snap || d.hard) {
      c.pos.copy(d.pos); c.look.copy(d.look); c.up.copy(d.up); c.fov = d.fov; c.snap = false;
    } else {
      const fix = (k) => 1 - Math.pow(1 - k, dt * 60);
      c.pos.lerp(d.pos, fix(d.kPos)); c.look.lerp(d.look, fix(d.kLook));
      c.up.lerp(d.up, fix(d.kUp)).normalize();
      c.fov += (d.fov - c.fov) * fix(0.08);
    }
    cam.position.copy(c.pos);
    if (c.shake > 0 && !this.reducedMotion && c.view !== "cockpit") {
      cam.position.x += (Math.random() - 0.5) * c.shake * 0.35;
      cam.position.y += (Math.random() - 0.5) * c.shake * 0.25;
    }
    c.shake = Math.max(0, c.shake - dt * 2.5);
    cam.up.copy(c.up);
    cam.lookAt(c.look);
    if (Math.abs(cam.fov - c.fov) > 0.05 || cam.near !== d.near) { cam.fov = c.fov; cam.near = d.near; cam.updateProjectionMatrix(); }
  }

  render() {
    if (!this.renderer || !this.scene) return;
    this.renderer.setViewport(0, 0, this._vw, this._vh);
    this.renderer.render(this.scene, this.cam.camera);
  }

  /* ───────────────────────── HUD ───────────────────────── */

  pushHud() { if (this.onHud) this.onHud(this.hud()); }

  hud() {
    const p = this.player;
    const cfg = DIFFICULTY[this.settings.speed] || DIFFICULTY.easy;
    const su = p ? (SURFACES[p.surface] || SURFACES.road) : SURFACES.road;
    return {
      phase: this.phase,
      speedKmh: p ? kmh(p.speed) : 0,
      rpm: p ? rpm01(p.speed, cfg.maxSpeed) : 0,
      turbo: p ? p.turbo : 1, tired: !!(p && p.tired), boosting: !!(p && p.boosting),
      surface: su.id, surfaceLabel: su.label,
      vehicle: this.settings.vehicle,
      vehicleLabel: VEHICLES[this.settings.vehicle] ? VEHICLES[this.settings.vehicle].label : "",
      camView: this.cam.view, camLabel: CAM_LABELS[this.cam.view],
      distance: Math.round(this.distance),
      blocks: this.visited.size, totalBlocks: CITY.cols * CITY.rows,
      pedBumps: this.pedBumps,
      message: this.message,
      car: p ? { x: p.x, z: p.z, heading: p.heading } : null,
      peds: this.peds.map((q) => ({ x: q.x, z: q.z })),
    };
  }
}
