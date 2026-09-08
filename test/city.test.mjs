// city.test.mjs —— 都市地基層(純函數,零 THREE、零瀏覽器)。
// ★ 這支守的是 0907 使用者拍板的世界規則:
//   「要能開上人行道、能穿越廣場,但撞不傷人。」
//   ⇒ ①沒有任何一種地面是牆(全部 speedMul > 0)②建築是唯一的障礙,而且推得出來 ③行人不會消失、不會壞掉。
import assert from "node:assert/strict";
import {
  CITY, SURFACES, PED,
  worldSize, blockCenter, blockAt, isPlaza, isPark, surfaceAt,
  buildBuildings, buildingAt, resolveBuilding,
  buildPedestrians, stepPedestrians, nearestRoadPoint, roadCenter, isTunnel, buildStreetProps, STALL_KINDS,
} from "../src/city.js";

let pass = 0;
const test = (name, fn) => { fn(); pass++; console.log("  ✓", name); };

/* ① 地面:全部開得上去 —— 掃過全城 + 城外,沒有一個點是牆 */
test("每一種地面都開得上去(speedMul > 0,沒有一種是牆)", () => {
  for (const [id, s] of Object.entries(SURFACES)) {
    assert.ok(s.speedMul > 0, `${id} 的 speedMul 必須 > 0,否則它就是一道隱形牆`);
    assert.equal(s.id, id, `${id} 的 id 欄位要跟鍵一致(HUD 直接顯示它)`);
    assert.ok(typeof s.label === "string" && s.label.length > 0, `${id} 要有中文名(HUD 會印)`);
  }
});

test("全城掃 40401 點:每點都有合法地面,沒有洞、沒有牆", () => {
  const { w, h } = worldSize();
  let n = 0;
  const seen = new Set();
  for (let i = 0; i <= 200; i++) {
    for (let j = 0; j <= 200; j++) {
      const x = -w / 2 - 40 + (w + 80) * (i / 200);
      const z = -h / 2 - 40 + (h + 80) * (j / 200);
      const s = surfaceAt(x, z);
      assert.ok(s && SURFACES[s.id] === s, `(${x},${z}) 回傳了不認得的地面`);
      assert.ok(s.speedMul > 0, `(${x},${z}) 的地面 speedMul 不是正數`);
      seen.add(s.id); n++;
    }
  }
  assert.equal(n, 201 * 201);
  for (const want of ["road", "walk", "plaza", "grass"]) {
    assert.ok(seen.has(want), `全城掃不到 ${want} —— 這種地面根本沒鋪出來`);
  }
});

test("廣場中心是廣場、公園中心是草地、街道是馬路、街廓外圈是人行道", () => {
  for (const [c, r] of CITY.plazas) {
    const p = blockCenter(c, r);
    assert.equal(surfaceAt(p.x, p.z).id, "plaza", `廣場 (${c},${r}) 的中心不是廣場`);
    assert.ok(isPlaza(c, r));
  }
  for (const [c, r] of CITY.parks) {
    const p = blockCenter(c, r);
    assert.equal(surfaceAt(p.x, p.z).id, "grass", `公園 (${c},${r}) 的中心不是草地`);
    assert.ok(isPark(c, r));
  }
  // 兩個街廓中間那條街
  const road = roadCenter(0, 0);
  assert.equal(surfaceAt(road.x, blockCenter(0, 0).z).id, "road", "兩個街廓中間應該是馬路");
  // 一般街廓的外圈(行人走的那一圈)
  const g = blockCenter(0, 0);
  assert.equal(surfaceAt(g.x, g.z - (CITY.block / 2 - CITY.walk / 2)).id, "walk", "街廓外圈應該是人行道");
});

test("blockCenter 真的在街廓正中央、roadCenter 真的在馬路上(不是差了半條街)", () => {
  for (let c = 0; c < CITY.cols; c++) {
    for (let r = 0; r < CITY.rows; r++) {
      const b = blockCenter(c, r);
      assert.deepEqual(blockAt(b.x, b.z), { c, r }, `blockCenter(${c},${r}) 落到別格去了`);
      // 隧道格例外:它的正中央**就是**穿堂通道,是馬路才對
      if (!isTunnel(c, r)) assert.notEqual(surfaceAt(b.x, b.z).id, "road", `blockCenter(${c},${r}) 掉在馬路上`);
      const rc = roadCenter(c, r);
      assert.equal(surfaceAt(rc.x, rc.z).id, "road", `roadCenter(${c},${r}) 不在馬路上`);
    }
  }
});

test("行人生成圈整圈都在人行道上(不是生在馬路中間)", () => {
  for (const p of buildPedestrians()) {
    const s = surfaceAt(p.x, p.z);
    assert.notEqual(s.id, "road", `行人 ${p.id} 生在馬路上 @(${p.x.toFixed(1)},${p.z.toFixed(1)})`);
  }
});

test("★ 隧道:格中央是可以開的通道、兩側是人行道、牆不擋在通道裡", () => {
  assert.ok(CITY.tunnels.length >= 1, "一條隧道都沒有");
  const bs = buildBuildings();
  for (const [c, r] of CITY.tunnels) {
    const p = blockCenter(c, r);
    assert.equal(surfaceAt(p.x, p.z).id, "road", `隧道 (${c},${r}) 的通道中央不是馬路`);
    // 通道邊緣內側仍是馬路、外側是人行道
    const half = CITY.tunnelWidth / 2;
    assert.equal(surfaceAt(p.x + half - 0.5, p.z).id, "road", "通道邊緣內側應該還是馬路");
    assert.equal(surfaceAt(p.x + half + CITY.tunnelWall + 2, p.z).id, "walk", "通道外側應該是人行道");
    // 這一格只有兩道牆,而且牆不可以侵入通道
    const walls = bs.filter((b) => b.c === c && b.r === r);
    assert.equal(walls.length, 2, `隧道格 (${c},${r}) 應該剛好兩道牆,不是 ${walls.length}`);
    for (const w of walls) {
      assert.equal(w.kind, "tunnelWall");
      assert.ok(Math.abs(w.x - p.x) - w.w >= half - 0.01, `牆侵入通道了(牆內側 ${(Math.abs(w.x - p.x) - w.w).toFixed(2)} < 半寬 ${half})`);
    }
  }
});

test("★ 隧道貫穿整格:沿通道南北向掃一整條,每一點都是馬路", () => {
  for (const [c, r] of CITY.tunnels) {
    const p = blockCenter(c, r);
    for (let i = 0; i <= 60; i++) {
      const z = p.z - CITY.block / 2 + (CITY.block * i) / 60;
      assert.equal(surfaceAt(p.x, z).id, "road", `隧道 (${c},${r}) 在 z 偏移 ${(z - p.z).toFixed(1)} 斷掉了`);
    }
  }
});

test("城外不是隱形牆,是很慢的草地(開得出去,回得來)", () => {
  const { w, h } = worldSize();
  assert.equal(blockAt(w, h), null, "城外不該對應到任何街廓");
  assert.equal(surfaceAt(w, h).id, "grass");
  assert.ok(SURFACES.grass.speedMul > 0);
});

/* ② 建築:唯一的障礙 */
test("建築是決定性的(同 seed 兩次完全一樣)", () => {
  const a = buildBuildings(20260907), b = buildBuildings(20260907), c = buildBuildings(1);
  assert.equal(a.length, b.length);
  assert.deepEqual(a.map((x) => [x.x, x.z, x.w, x.d]), b.map((x) => [x.x, x.z, x.w, x.d]));
  assert.notDeepEqual(a.map((x) => x.x), c.map((x) => x.x), "換 seed 應該要換佈局");
  assert.ok(a.length > 30, `建築太少(${a.length}),都市會空`);
});

test("廣場與公園裡沒有建築(才穿得過去)", () => {
  for (const b of buildBuildings()) {
    const cell = blockAt(b.x, b.z);
    assert.ok(cell, "建築跑到城外了");
    assert.ok(!isPlaza(cell.c, cell.r), `廣場 (${cell.c},${cell.r}) 裡不該有建築,不然穿不過去`);
    assert.ok(!isPark(cell.c, cell.r), `公園 (${cell.c},${cell.r}) 裡不該有建築`);
  }
});

test("建築不會蓋到馬路上(不然路會被堵死)", () => {
  for (const b of buildBuildings()) {
    // 隧道側牆是例外:它的內側**本來就**貼著通道邊界(通道是馬路),
    // 「不侵入通道」由上面那條隧道測試用嚴格不等式驗
    if (b.kind === "tunnelWall") continue;
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const s = surfaceAt(b.x + dx * b.w, b.z + dz * b.d);
      assert.notEqual(s.id, "road", `建築角落壓到馬路 @(${b.x},${b.z})`);
    }
  }
});

test("撞進建築一定推得出來,不會卡在裡面", () => {
  const bs = buildBuildings();
  for (const b of bs.slice(0, 20)) {
    for (const [ox, oz] of [[0, 0], [b.w * 0.4, 0], [0, b.d * 0.4], [-b.w * 0.4, b.d * 0.4]]) {
      const r = resolveBuilding(bs, b.x + ox, b.z + oz, 1.1);
      assert.ok(r.hit, "在建築正中央卻說沒撞到");
      assert.ok(Number.isFinite(r.nx) && Number.isFinite(r.nz), "推出來的座標是 NaN");
      assert.ok(r.speedMul > 0 && r.speedMul < 1, "撞建築應該掉速但不是歸零");
      assert.equal(buildingAt(bs, r.nx, r.nz, -0.05), null, `推出去之後還在建築裡 @(${b.x},${b.z})`);
    }
  }
});

test("沒撞到就不要謊報撞到(馬路中央是乾淨的)", () => {
  const bs = buildBuildings();
  const a = blockCenter(0, 0), b = blockCenter(1, 0);
  const r = resolveBuilding(bs, (a.x + b.x) / 2, a.z, 1.1);
  assert.equal(r.hit, false, "馬路中央不該回報撞到建築");
});

/* ③ 行人:撞不傷 */
test("行人是決定性的、數量對、座標都是有限數", () => {
  const a = buildPedestrians(77), b = buildPedestrians(77);
  assert.equal(a.length, PED.count);
  assert.deepEqual(a.map((p) => [p.x, p.z]), b.map((p) => [p.x, p.z]));
  for (const p of a) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.z) && Number.isFinite(p.dir));
});

test("★ 開車輾過去 900 幀:人一個都沒少、沒有一個變 NaN", () => {
  const peds = buildPedestrians();
  const before = peds.length;
  const car = { x: -200, z: 0, speed: 20 };
  for (let i = 0; i < 900; i++) {
    car.x += 0.35;                       // 橫穿整座城
    stepPedestrians(peds, [car], 1 / 60);
  }
  assert.equal(peds.length, before, "撞完之後行人少了 —— 人不可以消失");
  for (const p of peds) {
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.z), `行人 ${p.id} 座標壞掉了`);
    assert.ok(Number.isFinite(p.dir) && Number.isFinite(p.flee));
  }
});

test("★ 車停在人身上:人被推開(不是站著被輾),而且回報碰撞事件", () => {
  const peds = [{ id: "p", x: 0, z: 0, dir: 0, t: 0, flee: 0, shirt: 0, home: { c: 2, r: 2 } }];
  const car = { x: 0, z: 0, speed: 18 };
  const hits = stepPedestrians(peds, [car], 1 / 60);
  assert.equal(hits.length, 1, "貼在一起卻沒回報碰撞");
  assert.ok(Math.hypot(peds[0].x, peds[0].z) > 1, "人沒有被推開");
  assert.ok(peds[0].flee > 0, "被碰到之後應該進入閃避狀態");
});

test("行人會先閃開:車靠近時往遠離車的方向跑", () => {
  const p = { id: "p", x: 0, z: 0, dir: 0, t: 0, flee: 0, shirt: 0, home: { c: 3, r: 3 } };
  const c0 = blockCenter(3, 3);
  p.x = c0.x; p.z = c0.z;
  const car = { x: c0.x, z: c0.z - PED.senseR * 0.6, speed: 20 };
  const d0 = Math.hypot(p.x - car.x, p.z - car.z);
  for (let i = 0; i < 30; i++) stepPedestrians([p], [car], 1 / 60);
  const d1 = Math.hypot(p.x - car.x, p.z - car.z);
  assert.ok(d1 > d0, `行人沒有閃開(${d0.toFixed(2)} → ${d1.toFixed(2)})`);
});

test("行人不會被趕到天邊(離自己的街廓有繩長)", () => {
  const peds = buildPedestrians();
  const car = { x: 0, z: 0, speed: 30 };
  for (let i = 0; i < 1800; i++) {
    car.x = Math.sin(i / 30) * 300; car.z = Math.cos(i / 41) * 300;
    stepPedestrians(peds, [car], 1 / 60);
  }
  for (const p of peds) {
    const c = blockCenter(p.home.c, p.home.r);
    assert.ok(Math.hypot(p.x - c.x, p.z - c.z) <= CITY.block * 0.75 + 0.5, `行人 ${p.id} 被趕出自己的街廓太遠`);
  }
});

/* ④ 街邊生活 */
test("★ 路邊攤與露天座**全部**擺在人行道上(一個都不可以擺到車道)", () => {
  const ps = buildStreetProps();
  assert.ok(ps.length >= 30, `街邊擺設只有 ${ps.length} 處,太冷清`);
  for (const p of ps) {
    const su = surfaceAt(p.x, p.z);
    assert.equal(su.id, "walk", `${p.kind} 擺到 ${su.label} 上了 @(${p.x.toFixed(1)},${p.z.toFixed(1)})`);
  }
});

test("街邊擺設是決定性的、而且不會擺進廣場/公園/隧道", () => {
  const a = buildStreetProps(), b = buildStreetProps();
  assert.deepEqual(a.map((p) => [p.kind, p.x, p.z]), b.map((p) => [p.kind, p.x, p.z]));
  for (const p of a) {
    assert.ok(!isPlaza(p.c, p.r) && !isPark(p.c, p.r) && !isTunnel(p.c, p.r), `擺進了特殊街廓 (${p.c},${p.r})`);
  }
});

test("每個攤子都有招牌要用的品名與 emoji(缺了畫面會印 undefined)", () => {
  const ids = new Set(STALL_KINDS.map((k) => k.id));
  for (const p of buildStreetProps()) {
    if (p.kind !== "stall") continue;
    assert.ok(ids.has(p.stall), `不認得的攤種 ${p.stall}`);
    assert.ok(typeof p.label === "string" && p.label.length > 0, "攤子沒有中文品名");
    assert.ok(typeof p.emoji === "string" && p.emoji.length > 0, "攤子沒有 emoji");
    assert.ok(Number.isFinite(p.awning), "攤子沒有棚色");
  }
});

test("露天座的座位數與入座比例都是合法數字", () => {
  for (const p of buildStreetProps()) {
    if (p.kind !== "cafe") continue;
    assert.ok(Number.isInteger(p.seats) && p.seats >= 2, `座位數怪怪的:${p.seats}`);
    assert.ok(p.taken >= 0 && p.taken <= 1, `入座比例超出 0~1:${p.taken}`);
    assert.equal(typeof p.umbrella, "boolean", "有沒有傘要是 boolean");
  }
});

/* ⑤ 救援落點 */
test("卡住救援一定放回馬路上", () => {
  const { w, h } = worldSize();
  for (let i = 0; i < 60; i++) {
    const x = -w / 2 + (w * i) / 59, z = -h / 2 + (h * ((i * 7) % 60)) / 59;
    const p = nearestRoadPoint(x, z);
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.z));
    assert.equal(surfaceAt(p.x, p.z).id, "road", `救援落點 (${p.x.toFixed(1)},${p.z.toFixed(1)}) 不在馬路上`);
  }
});

console.log(`city.test: ${pass} 項全過`);
