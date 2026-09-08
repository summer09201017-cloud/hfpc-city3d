// game.js —— 都市自由行駛:THREE 場景 + 自由模式狀態機。
// ★ 與 racing3d 最大的不同:**沒有比賽**——沒有倒數、沒有圈數、沒有名次、沒有結算。
//   狀態只有 menu → driving,想停就停、想去哪就去哪。
// ★ 三條使用者拍板的規則(0907):
//   ① 可以開上人行道、可以穿越廣場 —— 地面只決定快慢,不擋路
//   ② 撞不傷人 —— 行人會先閃開,真的碰到只是被推開 + 車減速,不倒地不消失
//   ③ 隨時換載具 —— 停下來按一顆鈕就換(車 / 摩托車 / 馬 / 跑步 / 懸浮車)
// ★ 沿用 racing3d 的鐵則:this.running 只給 RAF;mesh.visible 一律嚴格 boolean;鏡頭狀態建構子就有數字。
import * as THREE from "three";
import { CITY, SURFACES, worldSize, blockCenter, roadCenter, isPlaza, isPark, isTunnel, buildBuildings, buildPedestrians, stepPedestrians, surfaceAt, nearestRoadPoint, buildStreetProps, dailyRoute, todayKey, ARRIVE_R, PED } from "./city.js";
import { CAR, DIFFICULTY, createCar, placeAt, stepCar, emptyInput, resolveCollisions, rpm01, kmh, clamp, wrapAngle, forwardOf, rightOf } from "./vehicle.js";
import { VEHICLES, VEHICLE_IDS, vehicleParams } from "./vehicles.js";
import { makeCarRig, makeMotoRig, makeHorseRig, makeHoverRig, makeRunnerRig, makeHair } from "./rigs.js";

export { CITY, SURFACES, VEHICLES, VEHICLE_IDS, DIFFICULTY };

/* 視角五檔(與 racing3d 同一套慣例:每檔都要有中文名,缺名=畫面印 undefined)。 */
export const CAM_VIEWS = ["chase", "hood", "cockpit", "bird", "shoulder"];
export const CAM_LABELS = { chase: "追尾跟隨", hood: "車頭", cockpit: "駕駛座", bird: "高空俯瞰", shoulder: "過肩" };
export const CAM_KEY = "city3d-camview";

/* 🚶 下車走路(第二期):走路不是第六種載具,是「暫時離開載具」的狀態 ——
   車停在原地等你回來,走遠了要自己走回去(小地圖會標停車點)。
   ★ 走路的快慢**不吃難度檔**:幼幼檔的孩子也是用同樣的速度走路,不然「下車」變成另一個難度旋鈕。 */
export const WALK_CFG = { id: "walk", label: "走路", maxSpeed: 2.6, accel: 9, grip: 12, assist: 0, aiMax: 0, aiLatAcc: 0, aiSkill: 0, aiBoost: 0 };
/* 👁 距離裁切:遠處的小東西不畫。
   ★ 這裡省的是 **draw call**,不是物件數 —— 街邊攤與行人各自十幾個小 mesh,
   放大到 9×9 之後全畫會掉到 38 fps;超過半徑就整個 Group visible=false,three 的
   projectObject 直接跳過整支子樹。近處仍是全細節,所以看不出被裁過。
   ★ 建築刻意**不裁**:遠處的樓是天際線,裁掉會看到城市憑空消失。 */
export const CULL = { street: 150, ped: 190 };

export const WALK = {
  reach: 4.5,        // 離停放的載具幾公尺內按得到「上車」
  dropSide: 1.9,     // 下車時人出現在載具左側幾公尺(不要生在車體裡)
};
/** 走路的車體參數:轉得比誰都快、身體最窄、草地完全不減速;渦輪=小跑步。 */
export const WALK_PARAMS = {
  ...CAR, accelMul: 1, gripMul: 1,
  turnRate: CAR.turnRate * 1.9, steerFullSpeed: 1.2, highSpeedFalloff: 60,
  width: 0.55, length: 0.55, wheelRadius: 0.9,
  grassSpeedMul: 1, grassDrag: 0, slipGain: 0.12, handbrakeGrip: 6,
  boostSpeedMul: 2.1, boostAccel: 4.5, turboBurn: 0.3, turboRegen: 0.12,
  reverseMax: 1.2, brake: 9, roll: 1.6, drag: 0.02,
  straightAccel: 1, cornerGrip: 1,
};

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

    this.streetGroups = [];         // 街邊擺設的群組(距離裁切用)
    this.routeKey = todayKey();     // 今日路線是哪一天的
    this.route = dailyRoute(this.routeKey);
    this.routeIdx = 0;              // 下一站是第幾個(= route.length 表示走完了)
    this.routeDone = false;
    this.onFoot = false;            // 現在是不是用兩條腿(下車走路)
    this.parked = null;             // 停在原地的載具 { vehicle, x, z, heading, rig }
    this.buildings = buildBuildings();
    this.peds = buildPedestrians();
    // 驗收要用:廣場/公園的中心座標(使用者點名「能穿越廣場」,測試得知道廣場在哪)
    this.plazaCenters = CITY.plazas.map(([c, r]) => blockCenter(c, r));
    this.parkCenters = CITY.parks.map(([c, r]) => blockCenter(c, r));
    this.tunnelCenters = CITY.tunnels.map(([c, r]) => blockCenter(c, r));
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
        if (isTunnel(c, r)) {
          // 通道那條帶鋪成柏油(跟 surfaceAt 說同一件事:那裡真的是馬路)
          const lane = new THREE.Mesh(new THREE.PlaneGeometry(CITY.tunnelWidth, CITY.block), lambert(0x3f434b));
          lane.rotation.x = -Math.PI / 2; lane.position.set(p.x, 0.02, p.z);
          scene.add(lane);
        }
        const m = new THREE.Mesh(blockGeo, lambert(color));
        m.rotation.x = -Math.PI / 2; m.position.set(p.x, 0.01, p.z);
        scene.add(m);
        if (isPark(c, r)) this._buildPark(scene, p);
        if (isPlaza(c, r)) this._buildPlazaDressing(scene, p);
      }
    }
    // 街道中央的白虛線(讓「這是馬路」看得出來)
    this._buildRoadMarks(scene);
    this._buildRoadDetail(scene);
    this._buildTunnels(scene);
    this._buildStreetLife(scene);
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

  /** 🚇 隧道:兩道側牆(牆本身是建築、會擋路)+ 頂蓋 + 兩排燈條 + 兩端門框。 */
  /**
   * 🛣 道路網細化(0908 使用者「道路網細化」)——**全部是視覺**,不動幾何也不動物理:
   * 緣石、斑馬線、停止線、主幹道雙黃線、路燈、路口紅綠燈。
   * ★ 刻意不改街道寬度:blockCenter / roadCenter / surfaceAt / 建築配置全部吃同一組數字,
   *   動寬度等於重算整座城,而使用者要的「細化」看的是路面長什麼樣。
   * ★★ 一律用 InstancedMesh:這些東西是「同一個小物擺幾百次」,逐個建 Mesh 會做出
   *   約 5800 個物件、實測掉到 31 fps;instanced 之後同樣的內容只剩十幾個 draw call、回到 60。
   */
  _buildRoadDetail(scene) {
    const g = CITY.block + CITY.road, { w, h } = worldSize();
    const half = CITY.road / 2;
    const _m4 = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion();
    const _e = new THREE.Euler(), _s = new THREE.Vector3(1, 1, 1);
    /** items = [[x, y, z, rx, ry, rz]];一次建成一個 InstancedMesh。 */
    const instanced = (geometry, material, items) => {
      if (!items.length) return null;
      const im = new THREE.InstancedMesh(geometry, material, items.length);
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        _p.set(it[0], it[1], it[2]);
        _e.set(it[3] || 0, it[4] || 0, it[5] || 0);
        _q.setFromEuler(_e);
        im.setMatrixAt(i, _m4.compose(_p, _q, _s));
      }
      im.instanceMatrix.needsUpdate = true;
      im.frustumCulled = false;   // 這一批橫跨全城,整體 culling 沒意義、還可能誤裁
      scene.add(im);
      return im;
    };

    const kerbMat = lambert(0xc9ccd2), zebraMat = new THREE.MeshBasicMaterial({ color: 0xf4f4f0 });
    const yellowMat = new THREE.MeshBasicMaterial({ color: 0xe8c33a });
    const poleMat = lambert(0x596070), lampMat = new THREE.MeshBasicMaterial({ color: 0xfff3cf });
    const boxMat = lambert(0x2b3038);
    const FLAT = -Math.PI / 2;

    // ① 緣石:每個街廓外圍一圈矮邊條 —— 人行道與馬路的界線一眼看得出來
    const kerbH = 0.16, kerbW = 0.5;
    const kerbLongItems = [], kerbSideItems = [];
    for (let r = 0; r < CITY.rows; r++) {
      for (let c = 0; c < CITY.cols; c++) {
        if (isTunnel(c, r)) continue;                 // 隧道格中間是通道,不圍
        const p = blockCenter(c, r);
        for (const sz of [-1, 1]) kerbLongItems.push([p.x, kerbH / 2, p.z + sz * (CITY.block / 2 + kerbW / 2)]);
        for (const sx of [-1, 1]) kerbSideItems.push([p.x + sx * (CITY.block / 2 + kerbW / 2), kerbH / 2, p.z]);
      }
    }
    instanced(new THREE.BoxGeometry(CITY.block + kerbW * 2, kerbH, kerbW), kerbMat, kerbLongItems);
    instanced(new THREE.BoxGeometry(kerbW, kerbH, CITY.block), kerbMat, kerbSideItems);

    // ② 斑馬線 + 停止線 + ⑤ 紅綠燈:每個路口一組
    const zebraA = [], zebraB = [], stopA = [], stopB = [];
    const tlPole = [], tlBox = [], tlRed = [], tlAmber = [], tlGreen = [];
    for (let i = 1; i <= CITY.cols; i++) {
      for (let j = 1; j <= CITY.rows; j++) {
        const ix = -w / 2 + i * g - half, iz = -h / 2 + j * g - half;   // 路口中心
        for (const sz of [-1, 1]) {
          for (let k = -3; k <= 3; k++) zebraA.push([ix, 0.035, iz + sz * (half + 1.6) + k * 1.15, FLAT]);
          stopA.push([ix, 0.035, iz + sz * (half + 5.4), FLAT]);
        }
        for (const sx of [-1, 1]) {
          for (let k = -3; k <= 3; k++) zebraB.push([ix + sx * (half + 1.6) + k * 1.15, 0.035, iz, FLAT]);
          stopB.push([ix + sx * (half + 5.4), 0.035, iz, FLAT]);
        }
        // 對角兩支就夠(四支太密、也太吃 draw call)
        for (const d of [[-1, -1], [1, 1]]) {
          const px = ix + d[0] * (half + 1.2), pz = iz + d[1] * (half + 1.2);
          tlPole.push([px, 1.8, pz]);
          tlBox.push([px, 3.7, pz]);
          tlRed.push([px, 3.98, pz + 0.16]);
          tlAmber.push([px, 3.7, pz + 0.16]);
          tlGreen.push([px, 3.42, pz + 0.16]);
        }
      }
    }
    instanced(new THREE.PlaneGeometry(CITY.road - 3, 0.62), zebraMat, zebraA);
    instanced(new THREE.PlaneGeometry(0.62, CITY.road - 3), zebraMat, zebraB);
    instanced(new THREE.PlaneGeometry(CITY.road - 2, 0.4), zebraMat, stopA);
    instanced(new THREE.PlaneGeometry(0.4, CITY.road - 2), zebraMat, stopB);
    instanced(new THREE.CylinderGeometry(0.09, 0.11, 3.6, 8), poleMat, tlPole);
    instanced(new THREE.BoxGeometry(0.34, 0.86, 0.3), boxMat, tlBox);
    const lens = new THREE.CircleGeometry(0.1, 10);
    instanced(lens, new THREE.MeshBasicMaterial({ color: 0xe5453a }), tlRed);
    instanced(lens, new THREE.MeshBasicMaterial({ color: 0xe8a33a }), tlAmber);
    instanced(lens, new THREE.MeshBasicMaterial({ color: 0x49c26a }), tlGreen);

    // ③ 主幹道:每 3 條街挑一條,中央畫雙黃線(看起來就是大道)
    const yA = [], yB = [];
    for (let i = 1; i <= CITY.cols; i++) {
      if (i % 3 !== 0) continue;
      const x = -w / 2 + i * g - half;
      for (let z = -h / 2 + 4; z < h / 2; z += 9) for (const sx of [-1, 1]) yA.push([x + sx * 0.22, 0.034, z, FLAT]);
    }
    for (let j = 1; j <= CITY.rows; j++) {
      if (j % 3 !== 0) continue;
      const z = -h / 2 + j * g - half;
      for (let x = -w / 2 + 4; x < w / 2; x += 9) for (const sz of [-1, 1]) yB.push([x, 0.034, z + sz * 0.22, FLAT]);
    }
    instanced(new THREE.PlaneGeometry(0.22, 6.5), yellowMat, yA);
    instanced(new THREE.PlaneGeometry(6.5, 0.22), yellowMat, yB);

    // ④ 路燈:沿著街道每 26 公尺一盞,擺在人行道側
    const lpPole = [], lpArm = [], lpHead = [];
    for (let i = 1; i <= CITY.cols; i++) {
      const x = -w / 2 + i * g - half;
      for (let z = -h / 2 + 13; z < h / 2; z += 26) {
        for (const sx of [-1, 1]) {
          const px = x + sx * (half + 0.9);
          lpPole.push([px, 2.6, z]);
          lpArm.push([px - sx * 0.75, 5.1, z]);
          lpHead.push([px - sx * 1.4, 5.02, z]);
        }
      }
    }
    instanced(new THREE.CylinderGeometry(0.1, 0.13, 5.2, 8), poleMat, lpPole);
    instanced(new THREE.BoxGeometry(1.5, 0.11, 0.14), poleMat, lpArm);
    instanced(new THREE.BoxGeometry(0.7, 0.16, 0.32), lampMat, lpHead);
  }

  _buildTunnels(scene) {
    const wallMat = lambert(0x8d8779), roofMat = lambert(0x6f6a5e), trimMat = lambert(0x3c3a34);
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff2c4 });
    const halfW = CITY.tunnelWidth / 2, wt = CITY.tunnelWall, H = CITY.tunnelHeight;
    for (const [c, r] of CITY.tunnels) {
      const p = blockCenter(c, r);
      const g = new THREE.Group(); g.position.set(p.x, 0, p.z); scene.add(g);
      // 側牆(視覺;碰撞由 buildBuildings 的 tunnelWall 負責,兩者尺寸一致)
      for (const sx of [-1, 1]) {
        const wall = new THREE.Mesh(new THREE.BoxGeometry(wt, H + 1.4, CITY.block), wallMat);
        wall.position.set(sx * (halfW + wt / 2), (H + 1.4) / 2, 0); g.add(wall);
      }
      const roof = new THREE.Mesh(new THREE.BoxGeometry(CITY.tunnelWidth + wt * 2 + 0.4, 0.9, CITY.block), roofMat);
      roof.position.y = H + 0.45; g.add(roof);
      // 兩端門框(入口一眼看得出來)
      for (const sz of [-1, 1]) {
        const frame = new THREE.Mesh(new THREE.BoxGeometry(CITY.tunnelWidth + wt * 2 + 1.6, 1.5, 1.1), trimMat);
        frame.position.set(0, H + 1.1, sz * (CITY.block / 2 - 0.4)); g.add(frame);
      }
      // 天花板燈條:每 8 公尺一盞,隧道裡才不會黑成一片
      for (let z = -CITY.block / 2 + 5; z < CITY.block / 2; z += 8) {
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.14, 0.5), lampMat);
        lamp.position.set(0, H - 0.15, z); g.add(lamp);
      }
    }
  }

  /** 🍢 街邊生活:路邊攤(推車+遮陽棚+老闆)與露天座(桌椅傘+坐著喝下午茶的人)。純景觀,不擋路。 */
  _buildStreetLife(scene) {
    this.streetProps = buildStreetProps();
    // 幾何與材質共用一份:74 處 × 十幾個 mesh,不共用會白白吃記憶體
    const geo = {
      cartBody: new THREE.BoxGeometry(1.9, 0.85, 0.95),
      cartTop: new THREE.BoxGeometry(2.05, 0.1, 1.1),
      post: new THREE.BoxGeometry(0.08, 1.5, 0.08),
      awning: new THREE.BoxGeometry(2.4, 0.1, 1.5),
      wheel: new THREE.CylinderGeometry(0.22, 0.22, 0.1, 10),
      sign: new THREE.BoxGeometry(1.55, 0.66, 0.06),
      plate: new THREE.CylinderGeometry(0.14, 0.12, 0.03, 12),
      steam: new THREE.SphereGeometry(0.09, 6, 5),
      table: new THREE.CylinderGeometry(0.52, 0.52, 0.08, 14),
      tableLeg: new THREE.CylinderGeometry(0.07, 0.09, 0.72, 8),
      chairSeat: new THREE.BoxGeometry(0.42, 0.07, 0.42),
      chairBack: new THREE.BoxGeometry(0.42, 0.42, 0.06),
      chairLeg: new THREE.BoxGeometry(0.05, 0.42, 0.05),
      umbPole: new THREE.CylinderGeometry(0.045, 0.045, 2.3, 8),
      umbTop: new THREE.ConeGeometry(1.35, 0.45, 12),
      cup: new THREE.CylinderGeometry(0.055, 0.045, 0.11, 8),
      torso: new THREE.BoxGeometry(0.4, 0.5, 0.26),
      thigh: new THREE.BoxGeometry(0.16, 0.2, 0.42),
      shin: new THREE.BoxGeometry(0.15, 0.42, 0.16),
      legStand: new THREE.BoxGeometry(0.16, 0.76, 0.18),
      neck: new THREE.CylinderGeometry(0.072, 0.088, 0.15, 8),
      skull: new THREE.SphereGeometry(0.18, 10, 8),
      eye: new THREE.SphereGeometry(0.03, 6, 6),
      arm: new THREE.CylinderGeometry(0.045, 0.045, 0.42, 8),
    };
    const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const mat = {
      wood: lambert(0x8a5a34), metal: lambert(0xb9bec7), dark: lambert(0x33383f),
      skin: lambert(0xf1c9a5), cup: lambert(0xffffff),
      steam: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.32 }),
      table: lambert(0xdcd3c2), chair: lambert(0x6b4a2b), umbrella: lambert(0xd9534f),
    };
    const SHIRTS = [0xe05c4a, 0x4a86e0, 0x4ac07a, 0xe0b44a, 0x9a6be0, 0xe07ac0];
    const HAIR = [0x2b2118, 0x4a3527, 0x1d1a17, 0x6b4a2b, 0x3a2c22, 0x8a6a3f];
    // 招牌:每種攤子畫一張(emoji + 品名),五張共用 ⇒ 一眼看得出這攤賣什麼
    const signCache = new Map();
    const signMaterial = (stallId, emoji, label, bg) => {
      if (signCache.has(stallId)) return signCache.get(stallId);
      const cv = document.createElement("canvas");
      cv.width = 256; cv.height = 108;
      const c = cv.getContext("2d");
      c.fillStyle = "#" + bg.toString(16).padStart(6, "0");
      c.fillRect(0, 0, cv.width, cv.height);
      c.fillStyle = "rgba(255,255,255,0.92)";
      c.fillRect(6, 6, cv.width - 12, cv.height - 12);
      c.textAlign = "center"; c.textBaseline = "middle";
      c.font = "54px system-ui, 'Segoe UI Emoji'";
      c.fillText(emoji, 58, 56);
      c.fillStyle = "#23262d";
      c.font = "bold 44px system-ui, 'Microsoft JhengHei'";
      c.fillText(label, 158, 58);
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      const m = new THREE.MeshBasicMaterial({ map: tex });
      signCache.set(stallId, m);
      return m;
    };
    const put3 = (parent, geometry, material, x, y, z) => {
      const m = new THREE.Mesh(geometry, material);
      m.position.set(x, y, z); parent.add(m); return m;
    };

    /**
     * 一個人。pose="sit" 坐著(腿彎在桌下、手搭桌上、手邊一杯咖啡);pose="stand" 站著(腿直立)。
     * ★ 站姿不能用「坐姿整個抬高」湊:那會做出**懸空盤腿**的老闆(0908 截圖實錘)。
     */
    const person = (parent, x, z, faceRot, idx, pose) => {
      const p = new THREE.Group();
      p.position.set(x, 0, z); p.rotation.y = faceRot; parent.add(p);
      const shirt = lambert(SHIRTS[idx % SHIRTS.length]);
      const stand = pose === "stand";
      const yTorso = stand ? 1.02 : 0.72;
      if (stand) {
        put3(p, geo.legStand, mat.dark, -0.11, 0.38, 0);
        put3(p, geo.legStand, mat.dark, 0.11, 0.38, 0);
      } else {
        put3(p, geo.thigh, mat.dark, -0.11, 0.5, 0.2);
        put3(p, geo.thigh, mat.dark, 0.11, 0.5, 0.2);
        put3(p, geo.shin, mat.dark, -0.11, 0.21, 0.38);
        put3(p, geo.shin, mat.dark, 0.11, 0.21, 0.38);
      }
      put3(p, geo.torso, shirt, 0, yTorso, 0);
      put3(p, geo.neck, mat.skin, 0, yTorso + 0.28, 0);
      put3(p, geo.skull, mat.skin, 0, yTorso + 0.44, 0);
      const hairG = makeHair(HAIR[(idx * 3 + 1) % HAIR.length], { r: 0.188, detail: "low" });
      hairG.position.set(0, yTorso + 0.46, -0.008); p.add(hairG);
      put3(p, geo.eye, white, -0.06, yTorso + 0.47, 0.155);
      put3(p, geo.eye, white, 0.06, yTorso + 0.47, 0.155);
      if (stand) {
        // 站著的老闆:雙手垂在身側微微向前(像在招呼客人)
        const aL = put3(p, geo.arm, shirt, -0.245, yTorso + 0.02, 0.04); aL.rotation.x = 0.22;
        const aR = put3(p, geo.arm, shirt, 0.245, yTorso + 0.02, 0.04); aR.rotation.x = 0.22;
      } else {
        // 坐著:手肘往前搭在桌沿,手邊一杯咖啡
        const aL = put3(p, geo.arm, shirt, -0.235, 0.84, 0.12); aL.rotation.x = 0.78;
        const aR = put3(p, geo.arm, shirt, 0.235, 0.84, 0.12); aR.rotation.x = 0.78;
        put3(p, geo.cup, mat.cup, 0.2, 0.81, 0.34);
      }
      return p;
    };

    this.streetGroups = [];
    for (let i = 0; i < this.streetProps.length; i++) {
      const s = this.streetProps[i];
      const g = new THREE.Group();
      g.position.set(s.x, 0, s.z); g.rotation.y = s.rot;
      scene.add(g);
      this.streetGroups.push({ g, x: s.x, z: s.z });
      if (s.kind === "stall") {
        put3(g, geo.cartBody, mat.wood, 0, 0.62, 0);
        put3(g, geo.cartTop, mat.metal, 0, 1.09, 0);
        put3(g, geo.wheel, mat.dark, -0.8, 0.22, 0.42).rotation.z = Math.PI / 2;
        put3(g, geo.wheel, mat.dark, 0.8, 0.22, 0.42).rotation.z = Math.PI / 2;
        for (const sx of [-1, 1]) put3(g, geo.post, mat.metal, sx * 1.0, 1.85, -0.1);
        put3(g, geo.awning, lambert(s.awning), 0, 2.6, -0.1);
        put3(g, geo.sign, signMaterial(s.stall, s.emoji, s.label, s.awning), 0, 2.18, 0.62);   // 招牌掛在棚沿下,面向客人
        // 熱氣從攤面往上飄(小吃嘛):三顆小球斜著上升,不要擋住老闆的臉
        for (let k = 0; k < 3; k++) put3(g, geo.steam, mat.steam, 0.42 + k * 0.1, 1.25 + k * 0.24, 0.1);
        // 老闆站在攤子後面、**面向客人**(局部 +z 就是街道那一側;給 Math.PI 會讓他背對客人)
        person(g, 0, -0.95, 0, i, "stand");
      } else {
        put3(g, geo.table, mat.table, 0, 0.76, 0);
        put3(g, geo.tableLeg, mat.metal, 0, 0.36, 0);
        // 桌上的下午茶:一個盤子 + 兩杯(空桌面看起來像還沒開店)
        put3(g, geo.plate, mat.cup, -0.14, 0.815, 0.1);
        put3(g, geo.cup, mat.cup, 0.16, 0.855, -0.05);
        put3(g, geo.cup, mat.cup, 0.02, 0.855, 0.24);
        if (s.umbrella) {
          put3(g, geo.umbPole, mat.metal, 0, 1.15, 0);
          put3(g, geo.umbTop, mat.umbrella, 0, 2.42, 0);
        }
        for (let k = 0; k < s.seats; k++) {
          const a = (k / s.seats) * Math.PI * 2 + 0.4;
          const cx = Math.sin(a) * 0.95, cz = Math.cos(a) * 0.95;
          const chair = new THREE.Group();
          chair.position.set(cx, 0, cz); chair.rotation.y = a + Math.PI; g.add(chair);
          put3(chair, geo.chairSeat, mat.chair, 0, 0.45, 0);
          put3(chair, geo.chairBack, mat.chair, 0, 0.68, -0.18);
          for (const leg of [[-0.17, -0.17], [0.17, -0.17], [-0.17, 0.17], [0.17, 0.17]]) {
            put3(chair, geo.chairLeg, mat.chair, leg[0], 0.23, leg[1]);
          }
          if (k / s.seats < s.taken) person(g, cx * 0.86, cz * 0.86, a + Math.PI, i * 7 + k, "sit");
        }
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
    const HAIR = [0x2b2118, 0x4a3527, 0x1d1a17, 0x6b4a2b, 0x3a2c22, 0x8a6a3f];   // 髮色六款(配 shirt 索引,決定性)
    const skin = lambert(0xf1c9a5);
    this.pedMeshes = [];
    for (const p of this.peds) {
      const g = new THREE.Group();
      // ★ 上半身(軀幹+脖子+頭+頭髮+五官)包成一組一起上下擺:
      //   只讓 body 擺、頭不動的話,走路時頭會跟身體分家(加了脖子之後特別明顯)。
      const upper = new THREE.Group(); g.add(upper);
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.75, 0.28), lambert(shirts[p.shirt % shirts.length]));
      body.position.y = 0.95; upper.add(body);
      const legs = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.6, 0.26), lambert(0x394a63));
      legs.position.y = 0.35; g.add(legs);
      // 脖子(0908:騎士補了脖子,滿街路人卻還是「頭直接坐在肩膀上」)
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.16, 8), skin);
      neck.position.y = 1.35; upper.add(neck);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 10, 8), skin);
      head.position.y = 1.53; upper.add(head);
      // 頭髮:跟騎士同一支 makeHair(路人數量多,用 low 只做 3 片;輪廓一樣,省 draw call)
      const hair = makeHair(HAIR[p.shirt % HAIR.length], { r: 0.198, detail: "low" });
      hair.position.y = 1.55; upper.add(hair);
      for (const sx of [-1, 1]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.032, 6, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
        eye.position.set(sx * 0.06, 1.56, 0.16); upper.add(eye);
        const ear = new THREE.Mesh(new THREE.SphereGeometry(0.034, 6, 6), skin);
        ear.position.set(sx * 0.185, 1.55, -0.015); ear.scale.set(0.6, 1.1, 1); upper.add(ear);
      }
      g.position.set(p.x, 0, p.z);
      scene.add(g);
      this.pedMeshes.push({ g, body, upper });
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

  /* ─────────────── 🚶 下車走路(第二期) ─────────────── */

  /** 現在按得到「上車」嗎(走路中 + 有停放的載具 + 走得夠近)。 */
  canMount() {
    if (!this.onFoot || !this.parked || !this.player) return false;
    return Math.hypot(this.player.x - this.parked.x, this.player.z - this.parked.z) <= WALK.reach;
  }

  /** 離停放的載具還有幾公尺(不在走路狀態回 0)。 */
  distToParked() {
    if (!this.onFoot || !this.parked || !this.player) return 0;
    return Math.hypot(this.player.x - this.parked.x, this.player.z - this.parked.z);
  }

  /** 下車 / 上車一鍵切換(F)。回傳切換後是不是在走路。 */
  toggleFoot() {
    if (this.phase !== "driving") return this.onFoot;
    return this.onFoot ? this._mount() : this._dismount();
  }

  _dismount() {
    const car = this.player;
    if (!car) return false;
    // 載具留在原地:rig 不從場景移除,只是不再跟著玩家動
    this.parked = { vehicle: this.settings.vehicle, x: car.x, z: car.z, heading: car.heading, rig: this.rig };
    this.rig.group.position.set(car.x, 0, car.z);
    this.rig.group.rotation.y = car.heading;
    if (this.rig.flame) this.rig.flame.visible = false;
    for (const m of this.rig.hide) m.visible = true;          // 停著的車要看得見(不管剛才是不是駕駛座視角)
    if (this.rig.cockpit) this.rig.cockpit.visible = false;

    // 人站到載具左側(不要生在車體裡)
    const right = rightOf(car.heading);
    const px = car.x - right.x * WALK.dropSide, pz = car.z - right.z * WALK.dropSide;
    this.rig = makeRunnerRig(CAR_COLORS[this.settings.colorIdx % CAR_COLORS.length].hex, { interior: false });
    this.scene.add(this.rig.group);
    const walker = createCar({ isPlayer: true, vehicle: "run", params: WALK_PARAMS, colorIdx: this.settings.colorIdx });
    placeAt(walker, px, pz, car.heading);
    this.player = walker;
    this.onFoot = true;
    this.cam.snap = true;
    if (this.cam.view === "cockpit") this.setCamView("chase");   // 走路沒有駕駛座
    this.say(`🚶 下車了 —— ${VEHICLES[this.parked.vehicle].emoji} 在原地等你,走回來按 F 上車`, 3.5);
    this._emit("dismount", { vehicle: this.parked.vehicle });
    this._syncRig(0);
    this.pushHud();
    return true;
  }

  _mount() {
    if (!this.parked) return false;
    if (!this.canMount()) {
      const d = Math.round(this.distToParked());
      this.say(`${VEHICLES[this.parked.vehicle].emoji} 還在 ${d} 公尺外,走近一點再按 F`, 2.5);
      return true;
    }
    this.scene.remove(this.rig.group);          // 收掉步行者
    const p = this.parked;
    this.rig = p.rig;
    this.settings.vehicle = p.vehicle;
    const car = createCar({ isPlayer: true, vehicle: p.vehicle, params: vehicleParams(p.vehicle), colorIdx: this.settings.colorIdx });
    placeAt(car, p.x, p.z, p.heading);
    this.player = car;
    this.parked = null;
    this.onFoot = false;
    this.cam.snap = true;
    this.say(`上車了 —— ${VEHICLES[p.vehicle].emoji} ${VEHICLES[p.vehicle].label}`, 2);
    this._emit("mount", { vehicle: p.vehicle });
    this._syncRig(0);
    this.pushHud();
    return false;
  }

  /** 換載具:停在原地換,不用回選單(使用者要的「自由切換」)。 */
  setVehicle(id) {
    // 走路中不能換載具:車停在別的地方,換了會把停放的那台弄丟
    if (this.onFoot) { this.say("🚶 走路中不能換載具 —— 先走回去按 F 上車", 2.5); return this.settings.vehicle; }
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

  beginDrive() {
    this._clearFoot();
    this.phase = "driving"; this.distance = 0; this.pedBumps = 0; this.visited.clear();
    this.routeKey = todayKey(); this.route = dailyRoute(this.routeKey); this.routeIdx = 0; this.routeDone = false;
    this._syncBeacon();
    this.say("想去哪就去哪 —— 人行道、廣場、公園都能開,按 F 可以下車走走", 4);
    this.pushHud();
  }
  backToMenu() { this._clearFoot(); this.phase = "menu"; this.pushHud(); }

  /** 回到「坐在載具上」的乾淨狀態:收掉步行者、把停放的那台還原成玩家車。 */
  _clearFoot() {
    if (!this.onFoot) return;
    if (this.rig) this.scene.remove(this.rig.group);      // 步行者
    if (this.parked && this.parked.rig) this.scene.remove(this.parked.rig.group);
    this.onFoot = false; this.parked = null;
    this.rig = null; this.player = null;
    this._spawnPlayer();
  }

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
    const cfg = this.onFoot ? WALK_CFG : (DIFFICULTY[this.settings.speed] || DIFFICULTY.easy);
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
      if (this.phase === "driving") this._checkRoute();
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

  /** 下一站(走完了回 null)。 */
  nextStop() { return this.routeIdx < this.route.length ? this.route[this.routeIdx] : null; }

  /** 到下一站還有幾公尺(走完了回 0)。 */
  distToStop() {
    const s = this.nextStop();
    if (!s || !this.player) return 0;
    return Math.hypot(this.player.x - s.x, this.player.z - s.z);
  }

  /** 每幀檢查有沒有到站。到了就換下一站,全部走完灑彩帶(事件交給呼叫端)。 */
  _checkRoute() {
    const s = this.nextStop();
    if (!s || !this.player) return;
    if (this.distToStop() > ARRIVE_R) return;
    this.routeIdx++;
    const next = this.nextStop();
    if (next) {
      this.say(`✅ 到 ${s.emoji} ${s.label} 了!下一站:${next.emoji} ${next.label}`, 3.5);
      this._emit("stop", { reached: s, next, index: this.routeIdx, total: this.route.length });
    } else {
      this.routeDone = true;
      this.say(`🎉 今日路線全部走完了!${this.route.length} 站,厲害`, 5);
      this._emit("routedone", { total: this.route.length });
    }
    this._syncBeacon();
    this.pushHud();
  }

  /** 目標光柱:下一站的位置立一根看得到的柱子(遠遠就找得到方向)。 */
  _syncBeacon() {
    if (!this.scene) return;
    const s = this.nextStop();
    if (!this._beacon) {
      const g = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({ color: 0xffd479, transparent: true, opacity: 0.42 });
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 2.6, 26, 12, 1, true), mat);
      pillar.position.y = 13; g.add(pillar);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(4.2, 0.35, 8, 26), new THREE.MeshBasicMaterial({ color: 0xffd479 }));
      ring.rotation.x = Math.PI / 2; ring.position.y = 0.12; g.add(ring);
      this._beacon = g; this.scene.add(g);
    }
    this._beacon.visible = !!s;
    if (s) this._beacon.position.set(s.x, 0, s.z);
  }

  /** 展示/驗收用的自動駕駛:沿路蛇行,快到城界就轉回市中心(不然四秒就開出城,量到的都是邊緣)。 */
  _autopilotInput(car) {
    const { w, h } = worldSize();
    // ★ 要**沿著馬路**走,不能隨機蛇行:街廓裡滿是樓,蛇行四秒必撞進去卡死
    //   (0908 地圖放大 + 建築改象限配置之後實測到的:車 4 秒後 speed 0.14、stuckT 1.03)。
    //   做法:取正前方 25m 那一點最近的馬路中心當目標,轉向它 ⇒ 到路口會自然順著轉。
    const f = forwardOf(car.heading);
    const t = nearestRoadPoint(car.x + f.x * 25, car.z + f.z * 25);
    let want = Math.atan2(t.x - car.x, t.z - car.z);
    if (Math.max(Math.abs(car.x) / (w / 2), Math.abs(car.z) / (h / 2)) > 0.62) {
      want = Math.atan2(-car.x, -car.z);            // 快到城界就掉頭回市中心
    }
    let steer = clamp(wrapAngle(want - car.heading) * 1.6, -1, 1);
    if (car.bumpT > 0) steer = clamp(steer + 0.8 * Math.sign(steer || 1), -1, 1);   // 剛撞到就轉得更用力
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
    const px = this.player ? this.player.x : 0, pz = this.player ? this.player.z : 0;
    const pedR2 = CULL.ped * CULL.ped, stR2 = CULL.street * CULL.street;
    for (const s of this.streetGroups) {
      s.g.visible = !!(((s.x - px) ** 2 + (s.z - pz) ** 2) < stR2);
    }
    for (let i = 0; i < this.peds.length; i++) {
      const p = this.peds[i], m = this.pedMeshes[i];
      if (!m) continue;
      m.g.visible = !!(((p.x - px) ** 2 + (p.z - pz) ** 2) < pedR2);
      if (!m.g.visible) continue;
      m.g.position.set(p.x, 0, p.z);
      m.g.rotation.y = p.dir;
      // 走路上下擺(逃跑時快一點);撞到只是往旁邊跳,不倒地
      const bob = Math.sin(this.time * (p.flee > 0 ? 14 : 7) + i) * 0.05;
      m.upper.position.y = Math.abs(bob);
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
    const cfg = this.onFoot ? WALK_CFG : (DIFFICULTY[this.settings.speed] || DIFFICULTY.easy);
    const su = p ? (SURFACES[p.surface] || SURFACES.road) : SURFACES.road;
    return {
      phase: this.phase,
      speedKmh: p ? kmh(p.speed) : 0,
      rpm: p ? rpm01(p.speed, cfg.maxSpeed) : 0,
      turbo: p ? p.turbo : 1, tired: !!(p && p.tired), boosting: !!(p && p.boosting),
      surface: su.id, surfaceLabel: su.label,
      vehicle: this.onFoot ? "walk" : this.settings.vehicle,
      vehicleLabel: this.onFoot ? "走路" : (VEHICLES[this.settings.vehicle] ? VEHICLES[this.settings.vehicle].label : ""),
      onFoot: this.onFoot,
      parked: this.parked ? { x: this.parked.x, z: this.parked.z, vehicle: this.parked.vehicle, label: VEHICLES[this.parked.vehicle].label, emoji: VEHICLES[this.parked.vehicle].emoji } : null,
      canMount: this.canMount(),
      route: this.route.map((r, i) => ({ label: r.label, emoji: r.emoji, x: r.x, z: r.z, done: i < this.routeIdx })),
      routeIdx: this.routeIdx,
      routeDone: this.routeDone,
      nextStop: this.nextStop() ? { label: this.nextStop().label, emoji: this.nextStop().emoji, x: this.nextStop().x, z: this.nextStop().z } : null,
      stopDist: Math.round(this.distToStop()),
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
