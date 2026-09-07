// city.js —— 都市地基(純函數,零依賴 THREE,node 可直測)。
// ★ 與賽車(racing3d)最大的不同:這裡**沒有賽道中線**。車在 xz 平面完全自由移動,
//   「開在哪裡」只由地面材質決定速度,**不擋路** ⇒ 可以開上人行道、可以穿越廣場(0907 使用者點名)。
//   真正擋路的只有建築物;而行人**撞不傷**:會先閃開,真的碰到也只是被推開 + 車減速。
//
// 佈局:格狀街廓 —— cols × rows 個街廓,街廓之間是街道。
//   街廓內縮 walkWidth 是人行道,再內縮才是建築基地;某些格改成廣場(整格都是可走的鋪面)。
//   世界座標原點在都市中心,x 往東、z 往南。

export const CITY = {
  cols: 6, rows: 6,          // 街廓數
  block: 60,                 // 街廓邊長(含人行道)
  road: 16,                  // 街道總寬(雙向)
  walk: 5,                   // 人行道寬(街廓外圈)
  plazas: [[2, 2], [4, 1]],  // 哪幾格是廣場(整格鋪面、沒有建築)
  parks: [[1, 4], [4, 4]],   // 哪幾格是公園(草地 + 樹,可以開進去但很慢)
};

/* 地面材質:速度倍率 + 額外減速(車體層直接吃這兩個值)。
   ★ 全部都能開 —— 差別只在快慢與抖動,沒有一種是牆。 */
export const SURFACES = {
  road:  { id: "road",  label: "馬路",   speedMul: 1.0,  drag: 0,   bump: 0 },
  walk:  { id: "walk",  label: "人行道", speedMul: 0.72, drag: 1.2, bump: 0.5 },   // 開得上去,但會慢會抖
  plaza: { id: "plaza", label: "廣場",   speedMul: 0.9,  drag: 0.4, bump: 0.15 },  // 穿得過去,略慢
  grass: { id: "grass", label: "草地",   speedMul: 0.55, drag: 3.0, bump: 0.9 },   // 公園草皮,很慢
};

const gridSpan = () => CITY.block + CITY.road;                    // 一格(街廓 + 一條街)的間距
export const worldSize = () => ({ w: CITY.cols * gridSpan(), h: CITY.rows * gridSpan() });
/**
 * 街廓 (c,r) 的中心世界座標。
 * ★ 一格的跨距 g = block + road,街廓本體佔前 CITY.block、街道佔後 CITY.road ⇒ 中心在 block/2,不是 g/2。
 *   (寫成 g*(c+0.5) 會整個偏 road/2:行人的生成圈會落到馬路上,建築也會往路中間擠。)
 */
export function blockCenter(c, r) {
  const g = gridSpan(), { w, h } = worldSize();
  return { x: -w / 2 + g * c + CITY.block / 2, z: -h / 2 + g * r + CITY.block / 2 };
}
/** 街廓 (c,r) 右側/下側那條街的中心線交會點(救援與測試用)。 */
export function roadCenter(c, r) {
  const g = gridSpan(), { w, h } = worldSize();
  return { x: -w / 2 + g * c + CITY.block + CITY.road / 2, z: -h / 2 + g * r + CITY.block + CITY.road / 2 };
}
/* 城界緩衝帶:城外不是牆,是一圈「愈開愈黏」的荒地 —— 車還在動,只是回不去更遠。
   ★ 為什麼要有:馬/跑步/懸浮車草地零減速,不設緩衝就會一路開到天邊,畫面外什麼都沒有(drive.test ⑤ 抓到:x=795)。 */
export const EDGE = { margin: 26, stick: 2.6 };
/** 超出城界幾公尺(城內回 0)。 */
export function outsideDepth(x, z) {
  const { w, h } = worldSize();
  const dx = Math.max(0, Math.abs(x) - w / 2), dz = Math.max(0, Math.abs(z) - h / 2);
  return Math.hypot(dx, dz);
}

const inList = (list, c, r) => list.some(([a, b]) => a === c && b === r);
export const isPlaza = (c, r) => inList(CITY.plazas, c, r);
export const isPark = (c, r) => inList(CITY.parks, c, r);

/** 世界座標 → 落在哪一格街廓(可能超出邊界,回傳 null)。 */
export function blockAt(x, z) {
  const g = gridSpan(), { w, h } = worldSize();
  const c = Math.floor((x + w / 2) / g), r = Math.floor((z + h / 2) / g);
  if (c < 0 || r < 0 || c >= CITY.cols || r >= CITY.rows) return null;
  return { c, r };
}

/**
 * 這個點是什麼地面。★ 判定順序:先看在不在街道上(街廓之間),再看格內是廣場/公園/一般街廓。
 * 回傳 SURFACES 的其中一個(都市外圍當草地,開得出去但很慢——不做隱形牆)。
 */
export function surfaceAt(x, z) {
  const b = blockAt(x, z);
  if (!b) return SURFACES.grass;
  const g = gridSpan(), { w, h } = worldSize();
  // 格內的相對位置(0..g)
  const lx = (x + w / 2) - b.c * g, lz = (z + h / 2) - b.r * g;
  // 街道:格的最後 CITY.road 那一段(右側與下側)+ 第一格前面那半條
  const onRoadX = lx > CITY.block || lx < 0;
  const onRoadZ = lz > CITY.block || lz < 0;
  if (onRoadX || onRoadZ) return SURFACES.road;
  if (isPlaza(b.c, b.r)) return SURFACES.plaza;
  if (isPark(b.c, b.r)) return SURFACES.grass;
  // 一般街廓:外圈是人行道,內部是建築基地(建築本身另外做碰撞,基地地面仍是人行道)
  // 外圈人行道、內部建築基地,地面都算人行道(建築本身另外做碰撞)
  return SURFACES.walk;
}

/* ── 建築(唯一真的擋路的東西)────────────────────────────
   每個一般街廓內放 1~4 棟矩形樓;廣場與公園不放。用決定性亂數 ⇒ 每次開都一樣。 */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 產生全都市的建築 [{ x, z, w, d, h, c, r, kind }](w/d = 半寬半深,方便 AABB)。 */
export function buildBuildings(seed = 20260907) {
  const rnd = mulberry32(seed);
  const out = [];
  const inner = CITY.block - CITY.walk * 2;   // 建築基地邊長
  for (let r = 0; r < CITY.rows; r++) {
    for (let c = 0; c < CITY.cols; c++) {
      if (isPlaza(c, r) || isPark(c, r)) continue;
      const center = blockCenter(c, r);
      const n = 1 + Math.floor(rnd() * 3);    // 1~3 棟
      const placed = [];
      for (let i = 0; i < n; i++) {
        // ★ 最多試 8 次,擺不下就少一棟 —— 同一格的樓**不可以重疊**:
        //   重疊會做出凹角,resolveBuilding 把車推出 A 之後正好推進 B,車就在兩棟之間彈到卡死(city.test ⑤ 抓到的)。
        for (let attempt = 0; attempt < 8; attempt++) {
          const bw = inner * (0.28 + rnd() * 0.3) / 2;
          const bd = inner * (0.28 + rnd() * 0.3) / 2;
          const ox = (rnd() - 0.5) * (inner / 2 - bw);
          const oz = (rnd() - 0.5) * (inner / 2 - bd);
          const gap = 3.2;   // 兩棟之間至少留一台車寬,不然中間那條縫是死巷
          if (placed.some((q) => Math.abs(center.x + ox - q.x) < q.w + bw + gap && Math.abs(center.z + oz - q.z) < q.d + bd + gap)) continue;
          const b = {
            x: center.x + ox, z: center.z + oz, w: bw, d: bd,
            h: 8 + rnd() * 26, c, r,
            kind: rnd() < 0.22 ? "shop" : "tower",
            tint: rnd(),
          };
          placed.push(b); out.push(b);
          break;
        }
      }
    }
  }
  return out;
}

/** 這個點在不在某棟建築裡(AABB);回傳那棟或 null。 */
export function buildingAt(buildings, x, z, pad = 0) {
  for (const b of buildings) {
    if (Math.abs(x - b.x) <= b.w + pad && Math.abs(z - b.z) <= b.d + pad) return b;
  }
  return null;
}

/**
 * 把車推出建築物(往穿入最少的那一軸推)。回傳 { hit, nx, nz, speedMul } —— 沒撞到 hit=false。
 * ★ 溫柔規則:只推開 + 掉速,不翻車不爆炸(與 racing3d 同一套精神)。
 */
export function resolveBuilding(buildings, x, z, radius = 1.1) {
  let nx = x, nz = z, hit = false, axis = null;
  // ★ 推最多 4 次:第一次推出 A 之後有可能正好落在 B 裡(兩棟靠得近),不再推一次車會卡在牆內。
  for (let pass = 0; pass < 4; pass++) {
    const b = buildingAt(buildings, nx, nz, radius);
    if (!b) break;
    hit = true;
    const dx = nx - b.x, dz = nz - b.z;
    const penX = b.w + radius - Math.abs(dx);
    const penZ = b.d + radius - Math.abs(dz);
    if (penX < penZ) { nx += Math.sign(dx || 1) * penX; axis = "x"; }
    else { nz += Math.sign(dz || 1) * penZ; axis = "z"; }
  }
  if (!hit) return { hit: false, nx: x, nz: z, speedMul: 1 };
  return { hit: true, nx, nz, speedMul: 0.45, axis };
}

/* ── 行人(撞不傷)────────────────────────────
   在人行道與廣場上走;車靠近會**先閃開**,真的碰到也只是被推開 + 車減速。
   不倒地、不流血、不消失 —— 這是給孩子玩的都市。 */
export const PED = {
  count: 40,
  speed: 1.5,          // 平常走路 m/s
  fleeSpeed: 4.2,      // 察覺車子時的閃避速度
  senseR: 9,           // 幾公尺內會察覺車子
  hitR: 1.3,           // 這麼近算碰到
  bumpBack: 2.4,       // 被碰到時往旁邊跳幾公尺
  carSlow: 0.72,       // 碰到人,車掉速到幾成(有代價,但不是懲罰)
};

/** 產生行人(決定性)。每個行人在自己的街廓外圈繞著走。 */
export function buildPedestrians(seed = 77) {
  const rnd = mulberry32(seed);
  const out = [];
  for (let i = 0; i < PED.count; i++) {
    const c = Math.floor(rnd() * CITY.cols), r = Math.floor(rnd() * CITY.rows);
    const center = blockCenter(c, r);
    const ring = CITY.block / 2 - CITY.walk / 2;
    const a = rnd() * Math.PI * 2;
    out.push({
      id: `ped-${i}`,
      x: center.x + Math.cos(a) * ring, z: center.z + Math.sin(a) * ring,
      dir: rnd() * Math.PI * 2,
      t: rnd() * 10,
      flee: 0,
      shirt: Math.floor(rnd() * 6),
      home: { c, r },
    });
  }
  return out;
}

/**
 * 推進行人一幀。cars = [{x,z,speed}] 用來閃避。回傳這一幀「被碰到」的事件陣列。
 * ★ 碰到只回報,不改車 —— 車怎麼減速由呼叫端決定(純函數不碰別人的狀態)。
 */
export function stepPedestrians(peds, cars, dt) {
  const hits = [];
  for (const p of peds) {
    p.t += dt;
    // 找最近的車
    let near = null, nd = Infinity;
    for (const car of cars) {
      const d = Math.hypot(car.x - p.x, car.z - p.z);
      if (d < nd) { nd = d; near = car; }
    }
    if (near && nd < PED.senseR) {
      // 閃開:往「遠離車」的方向轉
      p.dir = Math.atan2(p.x - near.x, p.z - near.z);
      p.flee = Math.max(p.flee, 0.8);
    } else if (p.t % 4 < dt) {
      p.dir += (Math.random() - 0.5) * 1.2;   // 平常隨機晃(不影響判定,只是看起來像人)
    }
    const spd = p.flee > 0 ? PED.fleeSpeed : PED.speed;
    p.flee = Math.max(0, p.flee - dt);
    p.x += Math.sin(p.dir) * spd * dt;
    p.z += Math.cos(p.dir) * spd * dt;
    // 別走太遠離自己的街廓(不然全城的人都被車趕到邊界)
    const c = blockCenter(p.home.c, p.home.r);
    const away = Math.hypot(p.x - c.x, p.z - c.z);
    const leash = CITY.block * 0.75;
    if (away > leash) {
      p.x = c.x + (p.x - c.x) / away * leash;
      p.z = c.z + (p.z - c.z) / away * leash;
      p.dir = Math.atan2(c.x - p.x, c.z - p.z);
    }
    if (near && nd < PED.hitR) {
      // 被碰到:往車的反方向跳開一點(不倒地、不消失)
      const a = Math.atan2(p.x - near.x, p.z - near.z);
      p.x += Math.sin(a) * PED.bumpBack;
      p.z += Math.cos(a) * PED.bumpBack;
      p.flee = 1.6;
      hits.push({ ped: p, car: near });
    }
  }
  return hits;
}

/** 都市裡最近的「馬路中央」——卡住救援用(把車放回路上,不是放回某條賽道)。 */
export function nearestRoadPoint(x, z) {
  const g = gridSpan(), { w, h } = worldSize();
  // 第 i 條街的中心線在 -half + g*i + block + road/2;★ i 要夾在 0..n-1,
  //   不夾的話車卡在城市邊緣時會被「救」到城外草地上(city.test ⑦ 抓到的)。
  const snap = (v, half, n) => {
    const i = Math.min(n - 1, Math.max(0, Math.round((v + half - CITY.block - CITY.road / 2) / g)));
    return -half + g * i + CITY.block + CITY.road / 2;
  };
  const gx = snap(x, w / 2, CITY.cols), gz = snap(z, h / 2, CITY.rows);
  // 另一軸也要留在城內,否則吸到街上、卻停在城界之外
  const inx = Math.min(w / 2 - 1, Math.max(-w / 2 + 1, x));
  const inz = Math.min(h / 2 - 1, Math.max(-h / 2 + 1, z));
  // 選離自己較近的那一軸吸附(留在原本那條街上)
  return Math.abs(gx - x) < Math.abs(gz - z) ? { x: gx, z: inz } : { x: inx, z: gz };
}
