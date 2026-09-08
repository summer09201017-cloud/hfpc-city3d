// city.js —— 都市地基(純函數,零依賴 THREE,node 可直測)。
// ★ 與賽車(racing3d)最大的不同:這裡**沒有賽道中線**。車在 xz 平面完全自由移動,
//   「開在哪裡」只由地面材質決定速度,**不擋路** ⇒ 可以開上人行道、可以穿越廣場(0907 使用者點名)。
//   真正擋路的只有建築物;而行人**撞不傷**:會先閃開,真的碰到也只是被推開 + 車減速。
//
// 佈局:格狀街廓 —— cols × rows 個街廓,街廓之間是街道。
//   街廓內縮 walkWidth 是人行道,再內縮才是建築基地;某些格改成廣場(整格都是可走的鋪面)。
//   世界座標原點在都市中心,x 往東、z 往南。

export const CITY = {
  cols: 9, rows: 9,          // 街廓數(0908 使用者「地圖再大一些」:6×6=456m 見方 → 9×9=684m,面積 2.25 倍)
  block: 60,                 // 街廓邊長(含人行道)
  road: 16,                  // 街道總寬(雙向)
  walk: 5,                   // 人行道寬(街廓外圈)
  // 廣場與公園要**散開**:擠在一起等於只有一個大空地,而且遠端整片都是同樣的樓會迷路
  plazas: [[4, 4], [1, 2], [7, 1], [2, 7], [6, 6]],   // 整格鋪面、沒有建築(中央那格是市中心大廣場)
  parks: [[1, 6], [6, 2], [3, 1], [8, 5], [4, 8]],    // 草地 + 樹,開得進去但很慢
  // 🚇 這幾格街廓中間有一條**南北向的穿堂隧道**:車可以直接從北邊那條街開進去、南邊那條街出來。
  //    兩側是牆(唯一會擋路的東西),頂上有蓋,裡面有燈。
  tunnels: [[3, 4], [6, 3], [2, 6]],
  tunnelWidth: 13,     // 通道淨寬(兩台車錯得開)
  tunnelWall: 3,       // 側牆厚度
  tunnelHeight: 6.2,   // 淨高
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
export const isTunnel = (c, r) => inList(CITY.tunnels, c, r);

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
  // 隧道格:格內正中央那條南北向通道是馬路(車真的開得過去),兩側仍是人行道
  if (isTunnel(b.c, b.r) && Math.abs(lx - CITY.block / 2) <= CITY.tunnelWidth / 2) return SURFACES.road;
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
      if (isTunnel(c, r)) {
        // 隧道格:不放樓,改放兩道貫穿整格的側牆(牆是建築 ⇒ 會擋路;頂蓋只是景,不擋)
        const off = CITY.tunnelWidth / 2 + CITY.tunnelWall / 2;
        for (const sx of [-1, 1]) {
          out.push({
            x: center.x + sx * off, z: center.z, w: CITY.tunnelWall / 2, d: CITY.block / 2,
            h: CITY.tunnelHeight + 1.4, c, r, kind: "tunnelWall", tint: rnd(),
          });
        }
        continue;
      }
      // ★ 象限配置:把 50×50 的建築基地切成 2×2 四個象限,每棟挑一個**沒被用過的**象限。
      //   這樣天生不重疊,不必再做碰撞重試——上一版用「隨機擺 + gap 檢查、最多試 8 次」,
      //   但 ox 只能晃 ±5m 而兩棟半寬加起來就要 29m ⇒ 第二棟幾乎永遠試不進去,
      //   整座城變成每格剛好一棟(9×9 的城只有 71 棟,空得像模型)。
      const quads = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
      for (let i = quads.length - 1; i > 0; i--) {      // 決定性洗牌
        const j = Math.floor(rnd() * (i + 1));
        [quads[i], quads[j]] = [quads[j], quads[i]];
      }
      const n = 1 + Math.floor(rnd() * 3);              // 每格 1~3 棟
      const qh = inner / 4;                             // 象限半邊長 12.5
      for (let i = 0; i < n; i++) {
        const [qx, qz] = quads[i];
        const bw = qh * (0.44 + rnd() * 0.36);          // 半寬 5.5 ~ 10
        const bd = qh * (0.44 + rnd() * 0.36);
        const jx = (rnd() - 0.5) * (qh - bw);           // 在象限裡晃一點,不要排得像棋盤
        const jz = (rnd() - 0.5) * (qh - bd);
        out.push({
          x: center.x + qx * qh + jx, z: center.z + qz * qh + jz, w: bw, d: bd,
          h: 8 + rnd() * 26, c, r,
          kind: rnd() < 0.22 ? "shop" : "tower",
          tint: rnd(),
        });
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

/* ── 🗺 今日路線(0908 使用者第二期的「任務」)────────────────────────
   自由漫遊不該有「你必須做」的任務,所以這裡做的是**建議路線**:
   每天由日期決定五個地標,依序造訪,HUD 告訴你下一站在哪、還有幾公尺。
   不去也沒關係,城照樣隨你逛;去完了灑彩帶。全班同一天拿到同一條路線。 */
export const ARRIVE_R = 13;      // 進到幾公尺內算到站

/** 都市裡所有值得去的點(廣場、公園、隧道口、市中心噴水池)。決定性,不吃亂數。 */
export function buildLandmarks() {
  const out = [];
  const mid = [Math.floor(CITY.cols / 2), Math.floor(CITY.rows / 2)];
  CITY.plazas.forEach(([c, r], i) => {
    const p = blockCenter(c, r);
    const isMid = c === mid[0] && r === mid[1];
    out.push({
      id: `plaza-${c}-${r}`, kind: "plaza",
      label: isMid ? "市中心大廣場" : `第 ${i + 1} 廣場`,
      emoji: isMid ? "⛲" : "🏛️", x: p.x, z: p.z,
    });
  });
  CITY.parks.forEach(([c, r], i) => {
    const p = blockCenter(c, r);
    out.push({ id: `park-${c}-${r}`, kind: "park", label: `第 ${i + 1} 公園`, emoji: "🌳", x: p.x, z: p.z });
  });
  CITY.tunnels.forEach(([c, r], i) => {
    const p = blockCenter(c, r);
    out.push({ id: `tunnel-${c}-${r}`, kind: "tunnel", label: `第 ${i + 1} 號隧道`, emoji: "🚇", x: p.x, z: p.z });
  });
  return out;
}

/** 今天的日期字串(本地時區;★ 不可以用 toISOString,那是 UTC,台灣半夜會跳成前一天)。 */
export function todayKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function hashStr(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
  return h >>> 0;
}

/**
 * 今日路線:從地標裡挑 n 個排成順序。同一天同一條(全班一樣),換一天就換一條。
 * ★ 用日期 hash 當種子,不用 Math.random —— 不然重新整理就換一條,「今日」就沒意義了。
 */
export function dailyRoute(key = todayKey(), n = 5) {
  const all = buildLandmarks();
  const rnd = mulberry32(hashStr(key));
  const pool = all.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
  }
  return pool.slice(0, Math.min(n, pool.length));
}

/* ── 🍢 街邊生活(0908 使用者:「人行道上有路邊攤販叫賣小吃、有路邊餐桌椅,有人坐著喝咖啡吃下午茶」)
   攤子與桌椅擺在**人行道**上,純景觀:不擋路、不判定 —— 車照樣開得過去(這座城的規則沒變)。
   位置決定性生成,每次開都一樣,孩子記得住「那攤蚵仔煎在哪」。 */
export const STREET_LIFE = {
  // ★ 密度是效能與熱鬧的取捨:每邊都擺(0.55+0.45=必定有)會做出 272 處、上千個 mesh,
  //   場景物件從 4900 衝到 6500 會掉幀。0.16+0.12 ⇒ 每格約 1.1 處、全城約 80 處,
  //   「走幾步就看到一攤」已經夠熱鬧。
  stallChance: 0.16,     // 一般街廓的每一邊有攤子的機率
  cafeChance: 0.12,      // 那一邊改成露天座的機率
  inset: 1.9,            // 離人行道外緣多遠(太貼會卡在馬路邊)
  cafeSeats: 3,          // 一組露天座幾張椅子
};
export const STALL_KINDS = [
  { id: "noodle", label: "麵攤", emoji: "🍜", awning: 0xe0563f },
  { id: "grill", label: "烤肉串", emoji: "🍢", awning: 0xd8a33a },
  { id: "bao", label: "包子饅頭", emoji: "🥟", awning: 0xf0f0ea },
  { id: "drink", label: "手搖飲", emoji: "🧋", awning: 0x59b3a0 },
  { id: "fruit", label: "水果攤", emoji: "🍉", awning: 0x6fbf4a },
];

/**
 * 街邊擺設:回傳 [{ kind:"stall"|"cafe", x, z, rot, ... }]。
 * ★ 一律擺在人行道那一圈(街廓外緣往內縮 inset),不會落到車道上——city.test 逐點驗。
 */
export function buildStreetProps(seed = 4242) {
  const rnd = mulberry32(seed);
  const out = [];
  const ring = CITY.block / 2 - CITY.walk / 2;      // 人行道中線離街廓中心多遠
  for (let r = 0; r < CITY.rows; r++) {
    for (let c = 0; c < CITY.cols; c++) {
      if (isPlaza(c, r) || isPark(c, r) || isTunnel(c, r)) continue;   // 廣場/公園/隧道自己有景
      const center = blockCenter(c, r);
      // 四個邊各自決定要不要擺;side: 0=北 1=東 2=南 3=西
      for (let side = 0; side < 4; side++) {
        const roll = rnd();
        const along = (rnd() - 0.5) * (CITY.block - CITY.walk * 2 - 8);   // 沿著那一邊的位置
        const d = ring - STREET_LIFE.inset;
        let x = center.x, z = center.z, rot = 0;
        if (side === 0) { x += along; z -= d; rot = Math.PI; }
        else if (side === 1) { x += d; z += along; rot = -Math.PI / 2; }
        else if (side === 2) { x += along; z += d; rot = 0; }
        else { x -= d; z += along; rot = Math.PI / 2; }
        if (roll < STREET_LIFE.stallChance) {
          const k = STALL_KINDS[Math.floor(rnd() * STALL_KINDS.length)];
          out.push({ kind: "stall", stall: k.id, label: k.label, emoji: k.emoji, awning: k.awning, x, z, rot, c, r });
        } else if (roll < STREET_LIFE.stallChance + STREET_LIFE.cafeChance) {
          out.push({ kind: "cafe", x, z, rot, seats: STREET_LIFE.cafeSeats, umbrella: rnd() < 0.75, c, r, taken: rnd() });
        }
      }
    }
  }
  return out;
}

/* ── 行人(撞不傷)────────────────────────────
   在人行道與廣場上走;車靠近會**先閃開**,真的碰到也只是被推開 + 車減速。
   不倒地、不流血、不消失 —— 這是給孩子玩的都市。 */
export const PED = {
  count: 90,           // 0908 地圖放大 2.25 倍,行人跟著加(40 → 90),不然大城市空得像沒人住
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
    // ★ 隧道格要跳過:行人的生成圈是繞著街廓走的,會穿過通道 ⇒ 有人生在車道正中央
    let c = 0, r = 0;
    for (let t = 0; t < 24; t++) {
      c = Math.floor(rnd() * CITY.cols); r = Math.floor(rnd() * CITY.rows);
      if (!isTunnel(c, r)) break;
    }
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
