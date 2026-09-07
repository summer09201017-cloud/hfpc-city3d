// vehicle.js —— 都市自由行駛的車體模型(純函數,零依賴,node 可直測)。
// 收割自 racing3d(賽車),**拿掉整個賽道語意**:沒有里程、沒有圈數、沒有名次、沒有逆向、沒有中線。
//   racing3d:車的位置要投影回賽道中線 ⇒ (里程, 左右偏移)
//   city3d  :車在 xz 平面**完全自由**,地面只決定快慢、不擋路(可以開上人行道、穿越廣場)
// 真正擋路的只有建築物;行人撞不傷(由 city.js 的 stepPedestrians 處理閃避,這裡只吃「被碰到要掉速」的結果)。
//   forward = (sin h, cos h)、right = (−cos h, sin h)(與 racing3d 同一套,測試釘死)
//   ★ 按右 steer=+1 ⇒ heading 遞減(從上往下看=順時鐘)。
import { surfaceAt, resolveBuilding, nearestRoadPoint, SURFACES, EDGE, outsideDepth, worldSize } from "./city.js";

export const CAR = {
  length: 4.2, width: 1.9, wheelRadius: 0.36,
  turnRate: 2.3,          // rad/s(滿舵、低速)
  steerFullSpeed: 4,      // 低於此速度轉向率隨速度線性縮(停著不能原地打轉)
  highSpeedFalloff: 30,   // 高速轉向變鈍:mul = 1/(1+(v/falloff)^2*0.7)(0906 極速提高 ⇒ 24→30,50 m/s 時仍有 0.34 轉向)
  drag: 0.0024,           // 二次空阻(m/s² per (m/s)²)(0906:0.0032→0.0024,否則職業檔加速到不了新極速;試算見 CLAUDE.md)
  roll: 0.7,              // 滾動阻力 m/s²
  brake: 17,              // 煞車減速 m/s²(0906 極速提高 ⇒ 15→17,職業檔 180 km/h 仍 <3 秒煞停)
  reverseMax: 7,
  grassSpeedMul: 0.55,    // 出界最高速倍率
  grassDrag: 3.2,         // 出界額外減速 m/s²
  wallBounce: 0.55,       // 撞牆保留速度
  wallSpin: 0.35,         // 撞牆後車頭拉回切線方向的比例
  boostAccel: 6.5, boostSpeedMul: 1.16,
  turboBurn: 0.27, turboRegen: 0.085, turboRearm: 0.3,   // 見底要回到 0.3 才能再衝(遲滯,race-stage-kit ⑥)
  slipGain: 0.9,          // 轉彎把多少前進動量變成橫向滑移(甩尾感):穩態 lat = yaw·v·slipGain/grip
  handbrakeGrip: 1.6,     // 手煞時抓地(越小越滑)
  stuckSeconds: 2.5,      // 卡住多久自動救援
};

/* 難度五檔(3d-game-kit「量值可調」):玩家極速/加速、AI 極速與技巧、幼兒輔助、抓地。
   speed 單位 m/s(×3.6 = km/h)。0906 使用者要「極速更高」:kids 24 m/s=86 km/h … hard 50 m/s=180 km/h
   (每檔加速也跟著加,不然到不了極速;drag 同步 0.0032→0.0024,試算見 CLAUDE.md「極速調校」)。
   assist = 該檔預設的「AI 輕扶回中」強度(0906:kids 0.6→0.85 更保母、child 0.4→0.55);玩家可用選單開關覆寫(assistStrength)。 */
export const DIFFICULTY = {
  kids:   { id: "kids",   label: "幼兒", maxSpeed: 24, accel: 10,   grip: 9,   assist: 0.85, aiMax: 22,   aiLatAcc: 6,   aiSkill: 0.45, aiBoost: 0.05 },
  child:  { id: "child",  label: "兒童", maxSpeed: 30, accel: 12,   grip: 8,   assist: 0.55, aiMax: 27,   aiLatAcc: 7.5, aiSkill: 0.6,  aiBoost: 0.15 },
  easy:   { id: "easy",   label: "入門", maxSpeed: 37, accel: 14,   grip: 7,   assist: 0.3,  aiMax: 33,   aiLatAcc: 9,   aiSkill: 0.75, aiBoost: 0.3 },
  normal: { id: "normal", label: "標準", maxSpeed: 44, accel: 16,   grip: 6.5, assist: 0,    aiMax: 40,   aiLatAcc: 11,  aiSkill: 0.88, aiBoost: 0.5 },
  hard:   { id: "hard",   label: "職業", maxSpeed: 50, accel: 18,   grip: 6,   assist: 0,    aiMax: 48,   aiLatAcc: 13,  aiSkill: 0.97, aiBoost: 0.7 },
};

/* 「AI 扶回中」強度(0907 使用者實玩拍板:「希望可以調整是輕輕扶還是重重扶或中等扶」+「所有難度都可以」):
   auto=照難度預設(幼兒/兒童/入門有、標準/職業無);light/medium/strong=不管哪一檔難度都給那個強度;off=完全自己開。
   ★ 強度是乘在 PD 輸出上的係數,不是改 kP/kD —— 手感一致,只是「扶多用力」。 */
/* 輔助的 PD 參數(量值可調):dead=半寬的幾成內完全不介入、kP 拉回力、kD 煞住衝過頭。 */
export const ASSIST = { dead: 0.45, kP: 2.2, kD: 0.9 };

/* 甩尾計量(v8,0907 使用者點名):按住手煞且真的在滑 ⇒ 累積;放開時依累積量送一段免費渦輪。
   minLat  能開始累積的橫向滑移(m/s);太小的抖動不算
   perUnit 累積速率(每「1 m/s 滑移 × 1 秒」得幾點)
   need    至少要幾點才給獎勵(不然點一下手煞就有,變成無腦亂按)
   maxHold 累積上限(對應最長獎勵)
   secPer  每一點換幾秒渦輪 */
export const DRIFT = { minLat: 2.2, perUnit: 0.34, need: 1, maxHold: 3.2, secPer: 0.42 };
/** 甩尾累積 → 送幾秒免費加速(不到 need 不給,超過 maxHold 不再多給)。 */
export function driftReward(charge) {
  if (!(charge >= DRIFT.need)) return 0;
  return Math.min(DRIFT.maxHold, charge) * DRIFT.secPer;
}

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
export const forwardOf = (h) => ({ x: Math.sin(h), z: Math.cos(h) });
export const rightOf = (h) => ({ x: -Math.cos(h), z: Math.sin(h) });

export function emptyInput() {
  return { throttle: 0, brake: 0, steer: 0, boost: false, handbrake: false };
}

/** 建一台車的狀態(全數字初值=NaN 疫苗)。 */
export function createCar({ x = 0, z = 0, heading = 0, y = 0, name = "車手", isPlayer = false, playerIdx = 0, colorIdx = 0, vehicle = "car", params = null } = {}) {
  return {
    name, isPlayer, playerIdx, colorIdx,
    vehicle, params,   // v4 載具:params = vehicleParams(vehicle)(vehicles.js);null = 基底 CAR
    x, y, z, heading,
    speed: 0,        // 前進速度(可負=倒車)
    lat: 0,          // 橫向滑移速度(+右)
    steer: 0,        // 平滑後的轉向 −1..1
    yawRate: 0,
    accel: 0,        // 這幀的縱向加速度(給視覺俯仰)
    latAcc: 0,       // 這幀的橫向加速度(給視覺側傾)
    turbo: 1, tired: false, boosting: false,
    surface: "road",          // 現在踩在什麼地面(road / walk / plaza / grass)
    offRoad: false,           // 不在馬路上(不是壞事,只是比較慢)
    stuckT: 0, bumpT: 0, hitPedT: 0,
    stars: 0,   // 之後接道具層再用
    drift: 0, driftPeak: 0,   // 甩尾計量:目前累積 / 這次甩尾的最高累積(給 HUD 與播報)
    startBoostT: 0,           // 免費加速剩幾秒(甩尾獎勵灌進來的;遊戲層每幀強制 boost 再退油)
    atEdge: false,            // 頂在城界緩衝帶外緣(HUD 提示用)
    finished: false, finishTime: 0, lapTimes: [], lapStartT: 0, bestLap: 0,
    slopePitch: 0,
    wheelSpin: 0,
  };
}

/** 把車放到都市裡某個世界座標與朝向(開新局、救援都用它)。 */
export function placeAt(car, x, z, heading = 0) {
  car.x = x; car.z = z; car.y = 0; car.heading = heading;
  car.speed = 0; car.lat = 0; car.steer = 0; car.yawRate = 0; car.latRate = 0;
  car.stuckT = 0; car.bumpT = 0; car.hitPedT = 0; car.oilT = 0;
  const su = surfaceAt(x, z);
  car.surface = su.id; car.offRoad = su.id !== "road";
}

/**
 * 推進一幀。回傳事件陣列(surface 換地面 / bump 撞建築 / rescue / boost / boostend / drift)。
 * cfg = DIFFICULTY[x];buildings = buildBuildings();opts.noRescue 關掉自動救援(測試用)。
 */
export function stepCar(car, input, dt, cfg, buildings = [], opts = {}) {
  const events = [];
  if (dt <= 0) return events;
  const P = car.params || CAR;                        // v4 載具參數包(沒給=賽車基底;vehicles.js)
  // v9 地形適性:依上一幀所在路段給加成(不動極速——極速永遠由難度管)
  // ★ 都市版的地形適性:沒有曲率,改用「在不在馬路上」——
  //   直線型(懸浮車 straightAccel 高)在馬路上最強;靈活型(摩托車/跑步 cornerGrip 高)離開馬路才發揮。
  const terrAccel = car.surface === "road" ? (P.straightAccel ?? 1) : 1;
  const terrGrip = car.surface === "road" ? 1 : (P.cornerGrip ?? 1);
  const accelMul = (P.accelMul ?? 1) * terrAccel, gripMul = (P.gripMul ?? 1) * terrGrip;

  // ── 轉向平滑(都市沒有「中線」可以扶,輔助那一套留在賽車那邊)
  const steerTarget = clamp(input.steer || 0, -1, 1);
  car.steer += (steerTarget - car.steer) * Math.min(1, dt * 7);

  // ── 渦輪(統一計費:玩家與 AI 同規則)
  const wantBoost = !!input.boost && car.turbo > 0 && !car.tired && car.speed > 1;
  if (wantBoost !== car.boosting) events.push(wantBoost ? "boost" : "boostend");
  car.boosting = wantBoost;
  if (car.boosting) {
    car.turbo = Math.max(0, car.turbo - P.turboBurn * dt);
    if (car.turbo <= 0) { car.tired = true; car.boosting = false; events.push("boostend"); }
  } else {
    car.turbo = Math.min(1, car.turbo + P.turboRegen * dt);
    if (car.tired && car.turbo >= P.turboRearm) car.tired = false;
  }

  // ── 縱向
  const throttle = clamp(input.throttle || 0, 0, 1);
  const brake = clamp(input.brake || 0, 0, 1);
  // ★ 地面只決定快慢、不擋路;越野型載具(grassSpeedMul 高)幾乎不受影響 ⇒ 馬/跑步/懸浮車可以直接穿公園與廣場抄近路
  const su = SURFACES[car.surface] || SURFACES.road;
  const offroad = clamp(((P.grassSpeedMul ?? 0.55) - 0.5) / 0.5, 0, 1);
  const surfMul = su.speedMul + (1 - su.speedMul) * offroad;
  const surfDrag = su.drag * (1 - offroad);
  let maxSpeed = cfg.maxSpeed * surfMul;
  if (car.boosting) maxSpeed *= P.boostSpeedMul;
  let a = 0;
  const v = car.speed, sv = Math.sign(v);
  if (throttle > 0) {
    // 加速隨接近極速遞減(有檔位感),超過極速就不再推
    const frac = clamp(v / maxSpeed, 0, 1);
    a += cfg.accel * accelMul * throttle * (1 - frac * 0.6) * (v < maxSpeed ? 1 : 0);
    if (car.boosting) a += P.boostAccel * (1 - frac * 0.5);
  }
  if (brake > 0) {
    if (v > 0.4) a -= P.brake * brake;
    else if (v > -P.reverseMax) a -= cfg.accel * accelMul * 0.45 * brake;   // 倒車
  }
  a -= sv * (P.roll + P.drag * v * v);
  if (surfDrag > 0) a -= sv * surfDrag;
  if (v > maxSpeed) a -= (v - maxSpeed) * 1.5;                     // 渦輪結束/出界 ⇒ 順順收速
  if (v <= maxSpeed && a > 0) a = Math.min(a, (maxSpeed - v) / dt);   // 這幀不越過極速(0906 drag 變小後會在極速上下抖 ±0.1,測試「不超過極速」抓到)
  const v2 = v + a * dt;
  car.speed = (Math.abs(v2) < 0.12 && throttle === 0 && brake === 0) ? 0 : v2;
  if (v !== 0 && Math.sign(v2) !== sv && throttle === 0 && brake === 0) car.speed = 0; // 純阻力不會反向
  car.speed = clamp(car.speed, -P.reverseMax, cfg.maxSpeed * P.boostSpeedMul * 1.05);
  car.accel = (car.speed - v) / dt;

  // ── 轉向(轉向率隨速度:低速線性縮、高速變鈍)
  const spd = Math.abs(car.speed);
  const sf = clamp(spd / P.steerFullSpeed, 0, 1) / (1 + (spd / P.highSpeedFalloff) ** 2 * 0.7);
  const yaw = -car.steer * P.turnRate * sf * (car.speed >= 0 ? 1 : -1);
  car.yawRate = yaw;
  car.heading = wrapAngle(car.heading + yaw * dt);

  // ── 橫向滑移:轉彎把一部分前進動量甩到外側,再被抓地吃掉(手煞=抓地變小=甩尾)
  const grip = (input.handbrake ? P.handbrakeGrip : cfg.grip * gripMul * (car.surface === "road" ? 1 : 0.85));
  const latBefore = car.lat;
  car.lat += yaw * car.speed * P.slipGain * dt;    // yaw<0(右轉)⇒ lat<0(往左=外側);★ 要乘 dt(漏掉=每幀灌一秒的滑移,首跑實踩)
  car.lat *= Math.exp(-grip * dt);
  car.latAcc = (car.lat - latBefore) / dt;

  // ── 甩尾計量(v8):按住手煞且真的在滑才累積;放開手煞時結算獎勵(事件由呼叫端接)
  if (input.handbrake && Math.abs(car.lat) > DRIFT.minLat && Math.abs(car.speed) > 6) {
    car.drift = Math.min(DRIFT.maxHold * 1.2, car.drift + (Math.abs(car.lat) - DRIFT.minLat) * DRIFT.perUnit * dt);
    car.driftPeak = Math.max(car.driftPeak, car.drift);
  } else if (car.drift > 0) {
    const sec = driftReward(car.drift);
    const charge = car.drift;
    car.drift = 0;
    if (sec > 0) events.push({ type: "drift", seconds: sec, charge });
    else car.driftPeak = 0;
  }

  // ── 位移
  const f = forwardOf(car.heading), r = rightOf(car.heading);
  car.x += (f.x * car.speed + r.x * car.lat) * dt;
  car.z += (f.z * car.speed + r.z * car.lat) * dt;

  // ── 地面:只決定快慢,不擋路(可以開上人行道、穿越廣場)
  const wasSurface = car.surface;
  const suNow = surfaceAt(car.x, car.z);
  car.surface = suNow.id;
  car.offRoad = suNow.id !== "road";
  if (suNow.id !== wasSurface) events.push({ type: "surface", from: wasSurface, to: suNow.id, label: suNow.label });

  // ── 城界:不是牆,是一圈愈開愈黏的荒地。★ 越野型草地零減速,沒有這段會一路開到畫面外什麼都沒有的地方。
  const depth = outsideDepth(car.x, car.z);
  if (depth > 0) {
    car.speed *= Math.max(0, 1 - Math.min(1, depth / EDGE.margin) * EDGE.stick * dt);
    if (depth > EDGE.margin) {
      const { w, h } = worldSize();
      car.x = clamp(car.x, -(w / 2 + EDGE.margin), w / 2 + EDGE.margin);
      car.z = clamp(car.z, -(h / 2 + EDGE.margin), h / 2 + EDGE.margin);
      if (!car.atEdge) events.push({ type: "edge" });      // 遊戲層拿去說「回城裡吧」
      car.atEdge = true;
    }
  } else if (car.atEdge) car.atEdge = false;

  // ── 建築物:唯一真的擋路的東西(溫柔規則:推開 + 掉速,不翻不爆)
  const hitB = resolveBuilding(buildings, car.x, car.z, 1.1);
  if (hitB.hit) {
    const hitSpeed = Math.abs(car.speed);
    car.x = hitB.nx; car.z = hitB.nz;
    car.speed *= hitB.speedMul;
    car.lat *= -0.3;
    car.bumpT = 0.45;
    events.push({ type: "bump", speed: hitSpeed });
  }
  car.bumpT = Math.max(0, car.bumpT - dt);
  car.hitPedT = Math.max(0, (car.hitPedT || 0) - dt);

  // ── 卡住自動救援:貼著建築物磨或動不了太久 ⇒ 放回最近的馬路中央
  const stuck = spd < 1.6 && (hitB.hit || (input.throttle > 0.3 && spd < 1));
  car.stuckT = stuck ? car.stuckT + dt : 0;
  if (car.stuckT > P.stuckSeconds && !opts.noRescue) {
    const p = nearestRoadPoint(car.x, car.z);
    placeAt(car, p.x, p.z, car.heading);
    events.push("rescue");
  }

  car.wheelSpin += (car.speed / P.wheelRadius) * dt;
  return events;
}

export const kmh = (ms) => Math.round(Math.abs(ms) * 3.6);

/**
 * 車對車碰撞(溫柔版):把對手位置轉到本車座標,重疊就沿「穿入最少」的軸各推一半,
 * 追撞方掉一點速。不翻車、不旋轉、不判罰。回傳 [{car, other, speed}](給音效/鏡頭抖)。
 */
export function resolveCollisions(cars) {
  const events = [];
  for (let i = 0; i < cars.length; i++) {
    for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i], b = cars[j];
      const pa = a.params || CAR, pb = b.params || CAR;                       // v4:各自車寬車長(摩托車窄好鑽)
      const HW2 = (pa.width + pb.width) / 2 + 0.1, HL2 = (pa.length + pb.length) / 2 + 0.1;
      const dx = b.x - a.x, dz = b.z - a.z;
      if (dx * dx + dz * dz > (Math.max(pa.length, pb.length) + 1) ** 2) continue;
      const f = forwardOf(a.heading), r = rightOf(a.heading);
      const lx = dx * r.x + dz * r.z;        // b 在 a 的右側幾米
      const lz = dx * f.x + dz * f.z;        // b 在 a 的前方幾米
      const penX = HW2 - Math.abs(lx), penZ = HL2 - Math.abs(lz);
      if (penX <= 0 || penZ <= 0) continue;
      let px = 0, pz = 0;
      if (penX < penZ) { const s = Math.sign(lx || 1) * penX / 2; px = r.x * s; pz = r.z * s; }
      else { const s = Math.sign(lz || 1) * penZ / 2; px = f.x * s; pz = f.z * s; }
      a.x -= px; a.z -= pz; b.x += px; b.z += pz;
      const rel = Math.abs(a.speed - b.speed);
      if (penZ <= penX) {
        // 追撞:後車掉速、前車被推一點
        const rear = lz > 0 ? a : b, front = rear === a ? b : a;
        rear.speed *= 0.9; front.speed = Math.max(front.speed, rear.speed * 0.98);
      } else {
        // 側擦:兩台都掉一點、往兩邊彈開
        a.speed *= 0.985; b.speed *= 0.985;
        a.lat -= Math.sign(lx || 1) * 0.6; b.lat += Math.sign(lx || 1) * 0.6;
      }
      events.push({ car: a, other: b, speed: rel }); events.push({ car: b, other: a, speed: rel });
    }
  }
  return events;
}

/** 引擎轉速 0..1(給音效與轉速表):四速假檔位,每檔內隨速度爬升。 */
export function rpm01(speed, maxSpeed) {
  const frac = clamp(Math.abs(speed) / Math.max(1, maxSpeed), 0, 1.15);
  const gears = 4;
  const g = Math.min(gears - 1, Math.floor(frac * gears));
  const inGear = frac * gears - g;
  return clamp(0.25 + inGear * 0.7 + g * 0.02, 0.2, 1);
}
