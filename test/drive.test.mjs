// drive.test.mjs —— 駕駛層(stepCar + 都市地面 + 建築 + 行人),純 node、零瀏覽器。
// ★ 這支守的是 0907 使用者拍板那句話在「開起來」時真的成立:
//   人行道開得上去、廣場穿得過去、撞到人只掉速,而建築是唯一會擋住你的東西。
import assert from "node:assert/strict";
import { CITY, blockCenter, roadCenter, surfaceAt, buildBuildings, buildingAt, worldSize, PED, EDGE, stepPedestrians } from "../src/city.js";
import { DIFFICULTY, createCar, placeAt, emptyInput, stepCar, kmh, CAR } from "../src/vehicle.js";
import { VEHICLE_IDS, VEHICLES, vehicleParams } from "../src/vehicles.js";

let pass = 0;
const test = (name, fn) => { fn(); pass++; console.log("  ✓", name); };
const CFG = DIFFICULTY.normal;
const BUILDINGS = buildBuildings();

/** 在某個座標朝某方向全油門跑 sec 秒,回傳跑了幾公尺 + 事件。 */
function driveStraight({ x, z, heading = 0, vehicle = "car", cfg = CFG, sec = 6, buildings = [], noRescue = true }) {
  const car = createCar({ vehicle, params: vehicleParams(vehicle) });
  placeAt(car, x, z, heading);
  const input = { ...emptyInput(), throttle: 1 };
  const events = [];
  const x0 = car.x, z0 = car.z;
  for (let i = 0; i < Math.round(sec * 60); i++) {
    events.push(...stepCar(car, input, 1 / 60, cfg, buildings, { noRescue }));
  }
  return { car, dist: Math.hypot(car.x - x0, car.z - z0), events };
}

/**
 * 某個地面上的「終端速度」:全油門,但每幀把車放回原點 —— 跑步機。
 * ★ 一定要這樣量:直開四秒就開出那一格了,量到的會是隔壁地面(公園那題第一版就踩到)。
 */
function terminalSpeed({ x, z, vehicle = "car", cfg = CFG, sec = 8 }) {
  const car = createCar({ vehicle, params: vehicleParams(vehicle) });
  placeAt(car, x, z, 0);
  const input = { ...emptyInput(), throttle: 1 };
  for (let i = 0; i < Math.round(sec * 60); i++) {
    stepCar(car, input, 1 / 60, cfg, [], { noRescue: true });
    car.x = x; car.z = z;                 // 跑步機:位置歸位,地面才不會變
  }
  return car.speed;
}

/* ── ① 人行道與廣場:開得上去、穿得過去 ── */
test("★ 人行道開得上去(會慢,但不是牆)", () => {
  const b = blockCenter(1, 1);
  const walkZ = b.z - (CITY.block / 2 - CITY.walk / 2);
  assert.equal(surfaceAt(b.x, walkZ).id, "walk", "測試點沒踩在人行道上,測試本身無效");
  const r = driveStraight({ x: b.x, z: walkZ, heading: Math.PI / 2, sec: 4 });
  assert.ok(r.car.speed > 3, `在人行道上開不動(${kmh(r.car.speed)} km/h)`);
  assert.ok(r.dist > 20, `在人行道上四秒只走了 ${r.dist.toFixed(1)}m`);
});

test("★ 廣場穿得過去(整格都能開,不會被彈回來)", () => {
  const [c, rr] = CITY.plazas[0];
  const p = blockCenter(c, rr);
  // 從廣場西緣往東直開:整格 60m 一路穿到對面那條街
  const r = driveStraight({ x: p.x - CITY.block / 2 + 2, z: p.z, heading: Math.PI / 2, sec: 3.5, buildings: BUILDINGS });
  assert.ok(r.dist > CITY.block - 2, `沒穿過整個廣場(只走了 ${r.dist.toFixed(1)}m,廣場寬 ${CITY.block}m)`);
  assert.ok(!r.events.some((e) => e.type === "bump"), "穿越廣場時撞到東西了 —— 廣場裡不該有障礙");
  assert.ok(r.events.some((e) => e.type === "surface" && e.from === "plaza"), "全程沒踩過廣場,測試本身無效");
});

test("★ 公園草地也開得進去,只是很慢(不是隱形牆)", () => {
  const [c, rr] = CITY.parks[0];
  const p = blockCenter(c, rr);
  const r = driveStraight({ x: p.x, z: p.z, heading: 0, sec: 2 });
  assert.equal(r.car.surface, "grass", "兩秒就開出公園了,測試點要往中心擺");
  assert.ok(r.car.speed > 2, `公園裡完全開不動(${kmh(r.car.speed)} km/h)`);
  assert.ok(r.dist > 5, `公園裡兩秒只走了 ${r.dist.toFixed(1)}m,等於被牆擋住`);
});

test("馬路最快、人行道其次、草地最慢(地面只影響快慢)", () => {
  const road = roadCenter(1, 1), blk = blockCenter(1, 1), park = blockCenter(...CITY.parks[0]);
  const vRoad = terminalSpeed({ x: road.x, z: road.z });
  const vWalk = terminalSpeed({ x: blk.x, z: blk.z - (CITY.block / 2 - CITY.walk / 2) });
  const vGrass = terminalSpeed({ x: park.x, z: park.z });
  assert.ok(vRoad > vWalk, `馬路(${kmh(vRoad)})沒有比人行道(${kmh(vWalk)})快`);
  assert.ok(vWalk > vGrass, `人行道(${kmh(vWalk)})沒有比草地(${kmh(vGrass)})快`);
  assert.ok(vGrass > 3, `草地慢到幾乎開不動(${kmh(vGrass)} km/h)—— 那就是隱形牆了`);
});

test("換地面會發事件(HUD 才知道要換字)", () => {
  const blk = blockCenter(1, 1);
  const r = driveStraight({ x: blk.x, z: blk.z, heading: 0, sec: 8, buildings: [] });
  const surf = r.events.filter((e) => e.type === "surface");
  assert.ok(surf.length >= 1, "從街廓開到馬路卻沒發過 surface 事件");
  for (const e of surf) {
    assert.ok(typeof e.label === "string" && e.label.length > 0, "surface 事件沒有中文 label,HUD 會印 undefined");
    assert.ok(e.from !== e.to, "surface 事件的 from/to 一樣,等於沒換");
  }
});

/* ── ② 建築:唯一真的擋路的東西 ── */
test("撞到建築會掉速、會發 bump,而且車不會留在牆裡", () => {
  const b = BUILDINGS.find((q) => q.h > 12);
  const car = createCar({ vehicle: "car", params: vehicleParams("car") });
  placeAt(car, b.x, b.z - b.d - 14, 0);           // 對著它的南面直衝
  const input = { ...emptyInput(), throttle: 1 };
  let bumped = false, top = 0;
  for (let i = 0; i < 300; i++) {
    top = Math.max(top, car.speed);
    for (const e of stepCar(car, input, 1 / 60, CFG, BUILDINGS, { noRescue: true })) {
      if (e.type === "bump") bumped = true;
    }
  }
  assert.ok(bumped, "直直撞上大樓卻沒有 bump 事件");
  assert.equal(buildingAt(BUILDINGS, car.x, car.z, 0.5), null, "車停在建築物裡面了");
  assert.ok(car.speed < top, "撞建築完全沒掉速");
});

test("卡在建築旁邊會被救回馬路上(不會永遠卡死)", () => {
  const b = BUILDINGS[3];
  const car = createCar({ vehicle: "car", params: vehicleParams("car") });
  placeAt(car, b.x, b.z - b.d - 2, 0);            // 車頭頂著牆
  const input = { ...emptyInput(), throttle: 1 };
  let rescued = false;
  for (let i = 0; i < 60 * 8 && !rescued; i++) {
    if (stepCar(car, input, 1 / 60, CFG, BUILDINGS).includes("rescue")) rescued = true;
  }
  assert.ok(rescued, "頂著牆猛踩油門八秒都沒被救援");
  assert.equal(surfaceAt(car.x, car.z).id, "road", "救回來卻不在馬路上");
});

/* ── ③ 撞不傷人 ── */
test("★ 撞到行人:人不會少、車只掉速(這是給孩子玩的都市)", () => {
  // ★ 行人一定要放在**自己的街廓**裡:離家太遠會先被 leash 拉回去,車根本追不到(第一版就這樣白測)
  const home = { c: 2, r: 2 };
  const hc = blockCenter(home.c, home.r);
  const peds = [{ id: "p", x: hc.x, z: hc.z + 10, dir: 0, t: 0, flee: 0, shirt: 0, home }];
  const car = createCar({ vehicle: "car", params: vehicleParams("car") });
  placeAt(car, hc.x, hc.z, 0);
  car.speed = 20;
  const input = { ...emptyInput(), throttle: 1 };
  let hits = 0, minSpeed = Infinity;
  for (let i = 0; i < 240; i++) {
    stepCar(car, input, 1 / 60, CFG, [], { noRescue: true });
    for (const h of stepPedestrians(peds, [car], 1 / 60)) {
      void h;
      hits++;
      car.speed *= PED.carSlow;                     // 遊戲層的規則:碰到人只掉速
      minSpeed = Math.min(minSpeed, car.speed);
    }
  }
  assert.ok(hits >= 1, "從人身上開過去卻沒有回報任何碰撞");
  assert.equal(peds.length, 1, "行人消失了");
  assert.ok(Number.isFinite(peds[0].x) && Number.isFinite(peds[0].z), "行人座標壞掉");
  assert.ok(minSpeed > 0, "撞到人把車打成靜止 —— 應該只是掉速,不是撞死卡住");
  assert.ok(Number.isFinite(car.speed) && car.speed > 0, "撞完人之後車開不動了");
});

/* ── ④ 五種載具:各有各的地盤 ── */
test("五種載具都有完整參數包(缺一個就會 NaN)", () => {
  for (const id of VEHICLE_IDS) {
    const P = vehicleParams(id);
    for (const k of Object.keys(CAR)) assert.ok(Number.isFinite(P[k]), `${id} 的 ${k} 不是數字`);
    assert.ok(Number.isFinite(P.accelMul) && Number.isFinite(P.gripMul));
    assert.ok(typeof VEHICLES[id].label === "string" && VEHICLES[id].emoji, `${id} 沒有中文名或 emoji`);
  }
  assert.equal(VEHICLE_IDS.length, 5);
});

test("★ 越野型(馬/跑步/懸浮車)在草地上比賽車快 —— 才有抄近路這個選擇", () => {
  const park = blockCenter(...CITY.parks[0]);
  const speed = (id) => terminalSpeed({ x: park.x, z: park.z, vehicle: id });
  const car = speed("car");
  for (const id of ["horse", "run", "hover"]) {
    assert.ok(speed(id) > car * 1.2, `${VEHICLES[id].label}在草地上沒有比賽車快多少,越野就沒意義了`);
  }
  assert.ok(speed("moto") < car * 1.2, "摩托車不該是越野型(它的長處在鑽小巷)");
});

test("★ 馬路上跑最遠的是懸浮車 —— 直線加成有兌現", () => {
  const road = roadCenter(2, 2);
  const dist = Object.fromEntries(VEHICLE_IDS.map((id) => [id, driveStraight({ x: road.x, z: road.z, heading: 0, vehicle: id, sec: 7 }).dist]));
  const best = VEHICLE_IDS.reduce((a, b) => (dist[a] >= dist[b] ? a : b));
  assert.equal(best, "hover", `馬路直線冠軍是 ${best},不是懸浮車(${Object.entries(dist).map(([k, v]) => `${k} ${v.toFixed(0)}m`).join(" / ")})`);
});

test("沒有哪一型是「正確答案」:馬路冠軍與草地冠軍不是同一型", () => {
  const road = roadCenter(2, 2), park = blockCenter(...CITY.parks[0]);
  const win = (x, z) => VEHICLE_IDS
    .map((id) => [id, terminalSpeed({ x, z, vehicle: id })])
    .reduce((a, b) => (a[1] >= b[1] ? a : b))[0];
  assert.notEqual(win(road.x, road.z), win(park.x, park.z), "馬路與草地的冠軍是同一型 —— 那就沒得選了");
});

/* ── ⑤ NaN 疫苗 ── */
test("亂踩 6000 幀(含手煞、倒車、渦輪)不會生出 NaN,也不會超過極速", () => {
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const cap = CFG.maxSpeed * CAR.boostSpeedMul * 1.05 + 0.01;
  for (const id of VEHICLE_IDS) {
    const car = createCar({ vehicle: id, params: vehicleParams(id) });
    const r = roadCenter(3, 3);
    placeAt(car, r.x, r.z, 0);
    const input = emptyInput();
    for (let i = 0; i < 6000; i++) {
      if (i % 17 === 0) { input.throttle = rnd() < 0.75 ? 1 : 0; input.brake = rnd() < 0.15 ? 1 : 0; }
      if (i % 23 === 0) input.steer = rnd() * 2 - 1;
      if (i % 41 === 0) { input.boost = rnd() < 0.3; input.handbrake = rnd() < 0.2; }
      stepCar(car, input, 1 / 60, CFG, BUILDINGS);
      for (const k of ["x", "z", "speed", "heading", "lat", "steer", "turbo", "drift"]) {
        assert.ok(Number.isFinite(car[k]), `${id} 第 ${i} 幀的 ${k} 變成 ${car[k]}`);
      }
      assert.ok(Math.abs(car.speed) <= cap, `${id} 第 ${i} 幀速度 ${car.speed} 超過上限 ${cap}`);
    }
    const { w, h } = worldSize();
    assert.ok(Math.abs(car.x) < w, `${id} 開到天邊去了(x=${car.x})`);
    assert.ok(Math.abs(car.z) < h, `${id} 開到天邊去了(z=${car.z})`);
  }
});

test("五檔難度極速一檔比一檔高,而且都到得了", () => {
  const road = roadCenter(1, 3);
  let prev = 0;
  for (const id of ["kids", "child", "easy", "normal", "hard"]) {
    const cfg = DIFFICULTY[id];
    const v = terminalSpeed({ x: road.x, z: road.z, cfg, sec: 14 });   // 跑步機:直開十四秒會衝出城界緩衝帶,量到的是被拉慢的速度
    assert.ok(v > prev, `${cfg.label} 的實測極速 ${kmh(v)} 沒有比上一檔 ${kmh(prev)} 高`);
    assert.ok(v > cfg.maxSpeed * 0.9, `${cfg.label} 十四秒還到不了九成極速(${kmh(v)} / ${kmh(cfg.maxSpeed)})`);
    assert.ok(v <= cfg.maxSpeed + 0.01, `${cfg.label} 超過了自己的極速`);
    prev = v;
  }
});

test("★ 城界是緩衝帶不是牆:開得出去、慢下來、回得來", () => {
  const { w } = worldSize();
  const car = createCar({ vehicle: "horse", params: vehicleParams("horse") });   // 草地零減速的那型最會跑
  placeAt(car, w / 2 - 30, 0, Math.PI / 2);
  const input = { ...emptyInput(), throttle: 1 };
  let edged = false;
  for (let i = 0; i < 60 * 60; i++) {
    if (stepCar(car, input, 1 / 60, CFG, [], { noRescue: true }).some((e) => e.type === "edge")) edged = true;
  }
  assert.ok(edged, "一直往城外開卻沒發過 edge 事件");
  assert.ok(car.x <= w / 2 + EDGE.margin + 0.01, `衝出緩衝帶了(x=${car.x.toFixed(0)},界線 ${(w / 2 + EDGE.margin).toFixed(0)})`);
  assert.ok(car.x > w / 2, "測試本身無效:車根本沒開出城");
  // 掉頭回城:回得來,而且回到城內就恢復速度
  car.heading = -Math.PI / 2;
  for (let i = 0; i < 60 * 8; i++) stepCar(car, input, 1 / 60, CFG, [], { noRescue: true });
  assert.ok(car.x < w / 2, `掉頭八秒回不了城(x=${car.x.toFixed(0)})`);
  assert.ok(car.speed > 10, `回城之後還是黏住(${kmh(car.speed)} km/h)`);
  assert.equal(car.atEdge, false, "回城了 atEdge 沒清掉,HUD 會一直喊回頭");
});

test("放開油門會停下來,而且不會自己倒退", () => {
  const road = roadCenter(2, 1);
  const car = createCar({ vehicle: "car", params: vehicleParams("car") });
  placeAt(car, road.x, road.z, 0);
  car.speed = 30;
  const input = emptyInput();
  for (let i = 0; i < 60 * 30; i++) stepCar(car, input, 1 / 60, CFG, [], { noRescue: true });
  assert.equal(car.speed, 0, `滑行三十秒還在動(${car.speed})`);
});

test("煞車可以倒車,但倒車速度有上限", () => {
  const road = roadCenter(3, 1);
  const car = createCar({ vehicle: "car", params: vehicleParams("car") });
  placeAt(car, road.x, road.z, 0);
  const input = { ...emptyInput(), brake: 1 };
  for (let i = 0; i < 60 * 6; i++) stepCar(car, input, 1 / 60, CFG, [], { noRescue: true });
  assert.ok(car.speed < -1, `踩煞車六秒沒有倒車(${car.speed})`);
  assert.ok(car.speed >= -CAR.reverseMax - 0.01, `倒車超速(${car.speed})`);
});

console.log(`drive.test: ${pass} 項全過`);
