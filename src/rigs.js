// rigs.js —— 載具 3D 外型(v4):🏍️ 摩托車 / 🐎 馬。與 game.js `_makeCarRig` 同一個回傳契約:
//   { group, tilt, wheels:[{pivot,spin,front}], hide:[駕駛座視角要藏的], flame, cockpit(userData:{wheel,wheelAxis,wheelGain,needlePivot}),
//     tailMat|null, paint, kind, leanIn, anim(car,dt)|null }
// 人物鐵則(3d-figure-kit):有臉(眼白+瞳孔+微笑)、帽子露耳(耳前無髮);馬照 mount-riding-kit 馬體鐵則:矩形身體(Box 不用圓筒)、長腿 v3、鬃毛三件套、雙眼雙耳。
// 座標:原點=地面、+z 朝前;隊色只走 `paint` 一個材質(setPlayerColor 換色不重建)。
import * as THREE from "three";
import { CAR } from "./vehicle.js";

const V = () => new THREE.Vector3();

const lambert = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });
const box = (w, h, d, mat) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
const put = (mesh, x, y, z, parent) => { mesh.position.set(x, y, z); parent.add(mesh); return mesh; };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/**
 * 🧑‍🦱 頭髮(共用:騎士 / 路人 / 街邊人物都用這一支)。回傳 Group,原點 = 頭球中心。
 *
 * ★ 這一套是 0908 使用者實玩兩輪回饋長出來的,三條都不能省:
 *   ① **主髮體不可以蓋到赤道**。蓋到赤道(θ=π/2)的半球,下緣是一整圈**水平線**,
 *      從任何角度看都是那條線 —— 那就是「妹妹頭」的本體。收到 θ≈1.42(耳朵上方)就結束,
 *      後腦與瀏海各自往下補,側面輪廓才會變成「前眉毛、側耳上、後後頸」的斜線。
 *   ② **後腦不可以是一片等半徑球面**。單一半徑 + 單一顏色 = 一塊塑膠板(使用者原話:「太平整」)。
 *      拆成三束,半徑、長度、明度都差一點,邊界自然出現階梯,側面看才有髮束厚度。
 *   ③ **髮色不要用接近黑的顏色**。0x2b2118 那種深度下,再多層次也看不出來。
 * ★ 不做的事:鬢角 —— 往下延伸的側髮一定會蓋到耳朵,而「眼耳嘴眉齊」是人物鐵則。
 *
 * @param {number} hairColor 髮色(建議 0x3a2b1c ~ 0x8a6a3f,別用接近黑的)
 * @param {{r?:number, detail?:"full"|"low"}} opts r=髮球半徑(約頭球 ×1.16);
 *        "low" 只做 3 片給路人(輪廓一樣、省 draw call),"full" 做 7 片
 */
export function makeHair(hairColor, { r = 0.2, detail = "full" } = {}) {
  const g = new THREE.Group();
  const FRONT = Math.PI / 2, BACK = Math.PI * 1.5;
  const piece = (geo, color, dy, dz, sx, sy, sz) => {
    const m = new THREE.Mesh(geo, lambert(color));
    m.position.set(0, dy || 0, dz || 0);
    m.scale.set(sx || 1.02, sy || 0.94, sz || 1.06);
    g.add(m);
    return m;
  };
  // ① 主髮體:收在耳朵上方(θ 1.42),**不要**蓋到赤道
  piece(new THREE.SphereGeometry(r, 14, 10, 0, Math.PI * 2, 0, 1.42), hairColor);
  // ② 後腦中央束:最長、最亮
  const nape = piece(new THREE.SphereGeometry(r * 1.035, 12, 7, BACK - 0.46, 0.92, 1.34, 0.60), shadeHex(hairColor, 16), 0, -0.006, 1.0, 0.97, 1.08);
  nape.userData.napeGuard = true;
  // ③ 瀏海:斜的(對稱的直瀏海正是妹妹頭),下緣停在眉毛、不壓眼睛
  const bangs = piece(new THREE.SphereGeometry(r * 1.012, 14, 7, FRONT - 1.06, 2.12, 1.30, 0.32), hairColor, -0.004, 0.004, 1.02, 1.0, 1.04);
  bangs.rotation.x = -0.05;
  bangs.rotation.z = 0.13;
  if (detail !== "full") return g;
  // ④ 後腦左右束:短一點、暗一點 ⇒ 邊界有階梯
  for (const phi of [BACK - 1.30, BACK + 0.44]) {
    piece(new THREE.SphereGeometry(r * 1.005, 12, 6, phi, 0.86, 1.38, 0.48), shadeHex(hairColor, -14), 0, -0.002, 1.01, 0.96, 1.05);
  }
  // ⑤ 後頸髮尖:窄、略往後翹
  const tail = piece(new THREE.SphereGeometry(r * 0.975, 12, 6, BACK - 0.52, 1.04, 1.80, 0.25), hairColor, -0.008, -0.004, 0.99, 1, 1.10);
  tail.userData.napeGuard = true;
  // ⑥ 側髮:把「瀏海比主髮體低」的直角缺口填成斜坡;下緣停在耳朵上方
  for (const phi of [0.30, Math.PI - 0.82]) {
    piece(new THREE.SphereGeometry(r * 1.008, 12, 6, phi, 0.52, 1.42, 0.16), shadeHex(hairColor, -8), -0.002, 0, 1.02, 0.95, 1.05);
  }
  // ⑦ 分線高光:死色的球面最顯廉價
  piece(new THREE.SphereGeometry(r * 1.005, 12, 8, FRONT - 1.34, 1.12, 0.08, 0.66), shadeHex(hairColor, 34), 0.002, 0, 1.02, 1, 1.05);
  return g;
}

/** 把顏色提亮/壓暗 amt(可負)。髮束之間的明度差就是靠這個。 */
export function shadeHex(hex, amt) {
  const ch = (v) => Math.max(0, Math.min(255, v + amt));
  return (ch((hex >> 16) & 255) << 16) | (ch((hex >> 8) & 255) << 8) | ch(hex & 255);
}

/**
 * 🪖 安全帽(共用)。回傳 Group,原點 = 頭球中心。
 * ★ 帽子跟頭髮相反:**光滑是對的**,但一定要有帽箍 + 通風脊 + 帽舌,
 *   不然就只是一個倒扣的碗。後腦護片只包正後方 ±72°,兩側留空才**不蓋耳朵**。
 */
export function makeHelmet(shellColor, { r = 0.2 } = {}) {
  const g = new THREE.Group();
  const BACK = Math.PI * 1.5;
  const mat = lambert(shellColor), trim = lambert(0x2a2f3a);
  const piece = (geo, m, dy, dz) => {
    const mesh = new THREE.Mesh(geo, m || mat);
    mesh.position.set(0, dy || 0, dz || 0);
    mesh.scale.set(1.02, 1, 1.05);
    g.add(mesh);
    return mesh;
  };
  piece(new THREE.SphereGeometry(r, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2));
  const nape = piece(new THREE.SphereGeometry(r, 16, 8, BACK - 1.266, 2.532, Math.PI / 2 - 0.03, 0.56));
  nape.userData.napeGuard = true;
  const brim = new THREE.Mesh(new THREE.TorusGeometry(r * 1.015, 0.015, 6, 22), trim);
  brim.rotation.x = Math.PI / 2; brim.scale.set(1.02, 1.05, 1); g.add(brim);
  for (const sx of [-1, 1]) {   // 通風脊:安全帽 vs 碗 最省事的分辨點
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.024, 0.30), trim);
    rib.position.set(sx * 0.045, r * 0.925, 0.01); rib.rotation.x = 0.06; g.add(rib);
  }
  const peak = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.024, 0.085), mat);   // 帽舌
  peak.position.set(0, 0.012, r * 0.98); peak.rotation.x = 0.24; g.add(peak);
  return g;
}

/**
 * 騎士頭(臉部鐵則):脖子 + 膚色頭球 + 安全帽或頭髮 + 眼白/瞳孔 + 微笑 + 露出的耳。
 * 原點 = 脖子底(往下多伸一截埋進軀幹,呼叫端把 position 對準**軀幹上緣**即可)。
 * @param {number} hatMat 安全帽顏色(通常用車色)
 * @param {*} skin 膚色材質
 * @param {{helmet?:boolean, hairColor?:number}} opts helmet=false ⇒ 戴頭髮(跑步/走路的人不戴安全帽)
 */
function makeRiderHead(hatMat, skin, { helmet = true, hairColor = 0x43301f } = {}) {
  const g = new THREE.Group();
  // 脖子(0908 使用者實玩:「摩托車的人頭怎會長在背上,也沒有脖子」)。
  // ★ 圓柱往下多伸一截、埋進軀幹裡 ⇒ 各 rig 只要把 head.position 對準軀幹上緣就接得起來,不會露斷面。
  // ★★ 加了脖子還要**看得到**:第一版整截被頭球包住,四種人形的 head.position 各抬高 3~5cm 才露得出來。
  const neck = put(new THREE.Mesh(new THREE.CylinderGeometry(0.082, 0.098, 0.18, 10), skin), 0, -0.04, 0, g);
  neck.userData.neck = true;
  put(new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), skin), 0, 0.17, 0, g);

  const top = helmet
    ? makeHelmet(typeof hatMat === "number" ? hatMat : 0x1e88e5)
    : makeHair(hairColor, { r: 0.2, detail: "full" });
  top.position.set(0, 0.2, -0.01);
  g.add(top);

  for (const sx of [-1, 1]) {
    put(new THREE.Mesh(new THREE.SphereGeometry(0.036, 8, 6), lambert(0xffffff)), sx * 0.06, 0.18, 0.15, g);
    put(new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 6), lambert(0x111111)), sx * 0.06, 0.18, 0.182, g);
    // 耳朵:要在頭中心偏後、與眼同高(擺太前側面看像鼻子);帽子與頭髮都**不准蓋到它**
    const ear = put(new THREE.Mesh(new THREE.SphereGeometry(0.032, 6, 6), skin), sx * 0.166, 0.172, -0.015, g);
    ear.scale.set(0.62, 1.15, 1);
  }
  const smile = put(new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.008, 6, 10, Math.PI), lambert(0x7a3b2e)), 0, 0.11, 0.165, g);
  smile.rotation.z = Math.PI;   // 弧開口朝上=微笑
  return g;
}

/** 速度表(與車內同款契約):θ = 330° + frac·240°,+rotation.z 對駕駛是順時鐘。回傳 { group, needlePivot }。 */
function makeGauge(r = 0.1) {
  const gauge = new THREE.Group();
  gauge.add(new THREE.Mesh(new THREE.CircleGeometry(r, 28), new THREE.MeshBasicMaterial({ color: 0x0b0e15, side: THREE.DoubleSide })));
  gauge.add(new THREE.Mesh(new THREE.TorusGeometry(r, r * 0.07, 6, 28), lambert(0xd0d4dc)));
  for (let i = 0; i <= 8; i++) {
    const th = (330 + i * 30) * Math.PI / 180;
    const tick = new THREE.Mesh(new THREE.BoxGeometry(r * 0.17, r * 0.05, 0.004), new THREE.MeshBasicMaterial({ color: i >= 7 ? 0xff5040 : 0xdde3ee, side: THREE.DoubleSide }));
    tick.position.set(Math.cos(th) * r * 0.83, Math.sin(th) * r * 0.83, -0.004); tick.rotation.z = th; gauge.add(tick);
  }
  const needlePivot = new THREE.Group(); needlePivot.position.z = -0.006; gauge.add(needlePivot);
  const needle = new THREE.Mesh(new THREE.BoxGeometry(r * 0.87, r * 0.09, 0.004), new THREE.MeshBasicMaterial({ color: 0xff4a3d, side: THREE.DoubleSide }));
  needle.position.x = r * 0.43; needlePivot.add(needle);
  needlePivot.rotation.z = 330 * Math.PI / 180;
  return { group: gauge, needlePivot };
}

/* ═══════════════════════ 🏎️ 賽車(從 racing3d 的 game.js 抽出來,原樣) ═══════════════════════ */
export function makeCarRig(hex, { interior = false } = {}) {
  const group = new THREE.Group();
  const tilt = new THREE.Group();      // 俯仰/側傾掛這裡
  group.add(tilt);
  const paint = new THREE.MeshLambertMaterial({ color: hex });
  const dark = lambert(0x1f2229);
  const glass = new THREE.MeshLambertMaterial({ color: 0x21395c, transparent: true, opacity: 0.72 });
  const hide = [];   // 駕駛座視角要藏的(車艙/窗/車頂/駕駛頭)
  const add = (mesh, x, y, z, parent = tilt) => { mesh.position.set(x, y, z); parent.add(mesh); return mesh; };

  add(new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.42, 4.0), paint), 0, 0.62, 0);          // 底盤/引擎蓋
  add(new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.22, 4.15), dark), 0, 0.42, 0);        // 下裙
  add(new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.18, 0.14), dark), 0, 0.5, 2.06);        // 前保桿
  add(new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.18, 0.14), dark), 0, 0.5, -2.06);       // 後保桿
  const cabin = add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 1.7), paint), 0, 1.08, -0.35); hide.push(cabin);
  const wind = add(new THREE.Mesh(new THREE.BoxGeometry(1.44, 0.52, 0.06), glass), 0, 1.08, 0.62); wind.rotation.x = -0.42; hide.push(wind);
  const rear = add(new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.42, 0.06), glass), 0, 1.1, -1.24); rear.rotation.x = 0.38; hide.push(rear);
  for (const sx of [-1, 1]) {
    const sw = add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.36, 1.3), glass), sx * 0.76, 1.1, -0.3); hide.push(sw);
  }
  // 燈
  const headMat = new THREE.MeshLambertMaterial({ color: 0xfff6d0, emissive: 0xfff2b0, emissiveIntensity: 0.9 });
  const tailMat = new THREE.MeshLambertMaterial({ color: 0xff3b30, emissive: 0xff2a2a, emissiveIntensity: 0.35 });
  for (const sx of [-1, 1]) {
    add(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.06), headMat), sx * 0.6, 0.74, 2.02);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.06), tailMat), sx * 0.6, 0.72, -2.02);
  }
  // 尾翼
  add(new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.06, 0.42), dark), 0, 1.12, -1.95);
  for (const sx of [-1, 1]) add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, 0.08), dark), sx * 0.6, 0.97, -1.95);
  // 渦輪火焰(只在 boosting 亮;visible 一律 !!)
  const flame = add(new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.9, 8), new THREE.MeshBasicMaterial({ color: 0xffa321 })), 0, 0.5, -2.5);
  flame.rotation.x = -Math.PI / 2; flame.visible = false;
  // 輪子(前輪掛轉向 pivot)
  const tireGeo = new THREE.CylinderGeometry(CAR.wheelRadius, CAR.wheelRadius, 0.3, 18); tireGeo.rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.32, 12); hubGeo.rotateZ(Math.PI / 2);
  const tireMat = lambert(0x171717), hubMat = lambert(0xbfc5cf);
  const wheels = [];
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const pivot = new THREE.Group(); pivot.position.set(sx * 0.86, CAR.wheelRadius, sz * 1.35); tilt.add(pivot);
    const spin = new THREE.Group(); pivot.add(spin);
    spin.add(new THREE.Mesh(tireGeo, tireMat)); spin.add(new THREE.Mesh(hubGeo, hubMat));
    wheels.push({ pivot, spin, front: sz > 0 });
  }
  // 駕駛(左座:+x 是左,因為 right=−x)——有臉:眼白+瞳孔+微笑+安全帽
  const driver = new THREE.Group(); driver.position.set(0.4, 0.84, -0.25); tilt.add(driver); hide.push(driver);   // 帽頂 1.32 ≤ 車頂 1.33
  const skin = lambert(0xf1c9a5, { emissive: 0x8a7355, emissiveIntensity: 0.45 });
  add(new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.34, 0.26), lambert(0x2b3a6b)), 0, -0.02, 0, driver);
  add(new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), skin), 0, 0.25, 0, driver);
  const helmet = add(new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8, 0, Math.PI * 2, 0, 1.75), lambert(0xffffff)), 0, 0.28, -0.01, driver);
  helmet.scale.set(1, 1, 1.05);
  for (const sx of [-1, 1]) {
    add(new THREE.Mesh(new THREE.SphereGeometry(0.036, 8, 6), lambert(0xffffff)), sx * 0.06, 0.26, 0.15, driver);
    add(new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 6), lambert(0x111111)), sx * 0.06, 0.26, 0.182, driver);
  }
  const smile = add(new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.008, 6, 10, Math.PI), lambert(0x7a3b2e)), 0, 0.19, 0.165, driver);
  smile.rotation.z = Math.PI;   // 弧開口朝上=微笑
  // 影子(靜態橢圓)
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 18), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.scale.set(1.15, 2.3, 1); shadow.position.y = 0.02; group.add(shadow);

  // 車內(只給玩家車):儀表板/方向盤/儀表/A 柱/頂梁/後視鏡/門板/座椅
  let cockpit = null;
  if (interior) {
    cockpit = new THREE.Group(); tilt.add(cockpit);
    const trim = lambert(0x2b2f38), trim2 = lambert(0x1c1f26);
    // 0907 使用者實玩「車子有點太多了,有點擋住視線」⇒ 儀表板整組壓低、方向盤與儀表縮小、頂梁後視鏡上收、A 柱變細
    add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.22, 0.55), trim), 0, 0.85, 0.72, cockpit);          // 儀表板(0.28→0.22 高、y 0.92→0.85)
    add(new THREE.Mesh(new THREE.BoxGeometry(1.52, 0.05, 0.62), trim2), 0, 0.97, 0.74, cockpit);        // 儀表台頂(1.06→0.97)
    const col = add(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.36, 8), trim2), 0.4, 0.98, 0.5, cockpit); col.rotation.x = 1.15;
    // 方向盤 pivot(向駕駛傾斜),wheel 子物件吃 rotation.z = steer(+右=順時鐘,見 _animateCar)
    const wheelPivot = new THREE.Group(); wheelPivot.position.set(0.4, 0.92, 0.36); wheelPivot.rotation.x = -0.38; cockpit.add(wheelPivot);   // y 1.0→0.92
    const wheel = new THREE.Group(); wheelPivot.add(wheel);
    wheel.add(new THREE.Mesh(new THREE.TorusGeometry(0.155, 0.022, 10, 30), lambert(0x111318)));   // 0.19→0.155(小一圈,不再佔畫面下半)
    const spokeMat = lambert(0x4a505c);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.29, 0.03, 0.03), spokeMat), 0, 0, 0, wheel);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.15, 0.03), spokeMat), 0, -0.075, 0, wheel);
    const hub = add(new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.05, 12), lambert(0xd0d4dc)), 0, 0, 0, wheel); hub.rotation.x = Math.PI / 2;
    // 儀表(不轉 group、材質雙面):+rotation.z 對駕駛是順時鐘,θ=0 指駕駛的左(+x)
    const gauge = new THREE.Group(); gauge.position.set(0.4, 1.02, 0.66); cockpit.add(gauge);   // y 1.13→1.02、半徑 0.115→0.092:不再浮在前方視線上
    gauge.add(new THREE.Mesh(new THREE.CircleGeometry(0.092, 28), new THREE.MeshBasicMaterial({ color: 0x0b0e15, side: THREE.DoubleSide })));
    gauge.add(new THREE.Mesh(new THREE.TorusGeometry(0.092, 0.007, 6, 28), lambert(0xd0d4dc)));
    for (let i = 0; i <= 8; i++) {
      const th = (330 + i * 30) * Math.PI / 180;
      const tick = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.006, 0.004), new THREE.MeshBasicMaterial({ color: i >= 7 ? 0xff5040 : 0xdde3ee, side: THREE.DoubleSide }));
      tick.position.set(Math.cos(th) * 0.076, Math.sin(th) * 0.076, -0.004); tick.rotation.z = th; gauge.add(tick);
    }
    const needlePivot = new THREE.Group(); needlePivot.position.z = -0.006; gauge.add(needlePivot);
    const needle = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.009, 0.004), new THREE.MeshBasicMaterial({ color: 0xff4a3d, side: THREE.DoubleSide }));
    needle.position.x = 0.04; needlePivot.add(needle);
    needlePivot.rotation.z = 330 * Math.PI / 180;
    // A 柱、頂梁、後視鏡、門板、座椅
    for (const sx of [-1, 1]) {
      const pillar = add(new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.6, 0.055), trim), sx * 0.76, 1.24, 0.8, cockpit); pillar.rotation.x = -0.32;   // A 柱 0.08→0.055 並外移,少擋兩側
      add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.42, 1.5), trim), sx * 0.76, 0.95, -0.25, cockpit);
      add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.5), trim2), sx * 0.4, 0.8, -0.35, cockpit);
      add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.55, 0.12), trim2), sx * 0.4, 1.1, -0.62, cockpit);
    }
    add(new THREE.Mesh(new THREE.BoxGeometry(1.56, 0.055, 0.12), trim), 0, 1.60, 0.86, cockpit);       // 擋風玻璃頂梁(1.48→1.60、變薄:上緣讓出天空)
    add(new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.06, 0.035), trim2), 0, 1.545, 0.8, cockpit);     // 後視鏡柱
    add(new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.07, 0.03), lambert(0x9fb4d0)), 0, 1.50, 0.8, cockpit); // 後視鏡(0.3→0.22 寬、上移到頂梁下)
    cockpit.userData = { wheel, wheelAxis: "z", wheelGain: 1.7, needlePivot };
  }
  return { group, tilt, wheels, hide, flame, cockpit, tailMat, paint, kind: "car", leanIn: false, anim: null };
}

/* ═══════════════════════ 🏍️ 摩托車 ═══════════════════════ */
export function makeMotoRig(hex, { interior = false } = {}, wheelRadius = 0.34) {
  const group = new THREE.Group(), tilt = new THREE.Group(); group.add(tilt);
  const paint = lambert(hex), dark = lambert(0x1f2229), chrome = lambert(0xbfc5cf);
  const skin = lambert(0xf1c9a5, { emissive: 0x8a7355, emissiveIntensity: 0.45 });
  const hide = [];
  put(box(0.22, 0.2, 1.1, dark), 0, 0.62, -0.05, tilt);                 // 車架
  put(box(0.42, 0.34, 0.5, dark), 0, 0.48, 0.05, tilt);                  // 引擎
  put(box(0.4, 0.3, 0.55, paint), 0, 0.88, 0.25, tilt);                  // 油箱(隊色)
  put(box(0.34, 0.12, 0.6, dark), 0, 0.86, -0.4, tilt);                  // 座墊
  put(box(0.3, 0.12, 0.45, paint), 0, 0.82, -0.8, tilt);                 // 尾殼
  const tailMat = new THREE.MeshLambertMaterial({ color: 0xff3b30, emissive: 0xff2a2a, emissiveIntensity: 0.35 });
  put(box(0.18, 0.08, 0.04, tailMat), 0, 0.84, -1.03, tilt);
  const exhaust = put(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.9, 10), chrome), 0.2, 0.4, -0.35, tilt); exhaust.rotation.x = Math.PI / 2;
  const flame = put(new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.7, 8), new THREE.MeshBasicMaterial({ color: 0xffa321 })), 0.2, 0.4, -1.1, tilt);
  flame.rotation.x = -Math.PI / 2; flame.visible = false;
  // 輪:前輪掛在前叉組(=轉向 pivot),後輪掛車架
  const tireGeo = new THREE.CylinderGeometry(wheelRadius, wheelRadius, 0.14, 18); tireGeo.rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.16, 12); hubGeo.rotateZ(Math.PI / 2);
  const tireMat = lambert(0x171717);
  const mkWheel = (parent, x, y, z) => { const spin = new THREE.Group(); spin.position.set(x, y, z); spin.add(new THREE.Mesh(tireGeo, tireMat)); spin.add(new THREE.Mesh(hubGeo, chrome)); parent.add(spin); return spin; };
  const rearPivot = new THREE.Group(); tilt.add(rearPivot);
  const rearSpin = mkWheel(rearPivot, 0, wheelRadius, -0.75);
  const fork = new THREE.Group(); fork.position.set(0, 0.98, 0.62); tilt.add(fork);   // pivot.rotation.y = −steer·0.5(_syncRig)
  for (const sx of [-1, 1]) { const tube = put(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.78, 8), chrome), sx * 0.09, -0.32, 0.12, fork); tube.rotation.x = 0.42; }
  const frontSpin = mkWheel(fork, 0, wheelRadius - 0.98, 0.3);            // 世界 y = wheelRadius(貼地)
  put(box(0.16, 0.14, 0.1, new THREE.MeshLambertMaterial({ color: 0xfff6d0, emissive: 0xfff2b0, emissiveIntensity: 0.9 })), 0, 0.08, 0.24, fork);   // 頭燈
  const bar = put(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.64, 8), chrome), 0, 0.12, -0.02, fork); bar.rotation.z = Math.PI / 2;
  for (const sx of [-1, 1]) put(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.12, 8), dark), sx * 0.3, 0.12, -0.02, fork).rotation.z = Math.PI / 2;
  const wheels = [{ pivot: fork, spin: frontSpin, front: true }, { pivot: rearPivot, spin: rearSpin, front: false }];
  // 騎士:前傾騎姿、腿夾車、雙手握把;頭有臉(駕駛座視角藏頭與身體,手臂留著)
  const legMat = lambert(0x2b3a6b);
  for (const sx of [-1, 1]) {
    const leg = put(box(0.14, 0.42, 0.16, legMat), sx * 0.2, 0.72, -0.05, tilt); leg.rotation.x = -0.9;
    put(box(0.12, 0.1, 0.26, dark), sx * 0.22, 0.42, 0.12, tilt);
  }
  const torso = put(box(0.36, 0.5, 0.26, paint), 0, 1.16, -0.18, tilt); torso.rotation.x = 0.55; hide.push(torso);
  for (const sx of [-1, 1]) { const arm = put(new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.62, 8), paint), sx * 0.24, 1.12, 0.22, tilt); arm.rotation.x = 1.15; arm.rotation.z = sx * 0.12; }
  // ★ 頭要接在**軀幹上緣**,不是擺在軀幹後面。軀幹前傾 0.55 rad,上緣中心 =
  //   (0, 1.16 + 0.25·cos0.55, −0.18 + 0.25·sin0.55) = (0, 1.373, −0.049)。
  //   原本寫 (0, 1.28, −0.30):比上緣還低 9cm、又往後 25cm ⇒ 頭長在背上(0908 使用者實玩回報)。
  const head = makeRiderHead(paint, skin); head.position.set(0, 1.44, -0.04); head.rotation.x = -0.15; tilt.add(head); hide.push(head);
  // 影子
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 18), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.scale.set(0.6, 1.3, 1); shadow.position.y = 0.02; group.add(shadow);
  // 駕駛座:油箱上的速度表(面向騎士)、把手由前叉組跟著轉
  let cockpit = null;
  if (interior) {
    cockpit = new THREE.Group(); tilt.add(cockpit);
    const g = makeGauge(0.09); g.group.position.set(0, 1.06, 0.34); g.group.rotation.x = -2.1; cockpit.add(g.group);
    cockpit.userData = { wheel: new THREE.Group(), wheelAxis: "z", wheelGain: 0, needlePivot: g.needlePivot };   // 把手在 fork 上(wheels[0].pivot),這裡不再轉
  }
  return { group, tilt, wheels, hide, flame, cockpit, tailMat, paint, kind: "moto", leanIn: true, anim: null };
}

/* ═══════════════════════ 🏃 跑步 ═══════════════════════ */
// 3d-figure-kit 鐵則:矩形身體(Box 不用圓筒)、長腿、臉部齊(眼白+瞳孔+微笑+耳前無髮)。
export function makeRunnerRig(hex, { interior = false } = {}) {
  const group = new THREE.Group(), tilt = new THREE.Group(); group.add(tilt);
  const paint = lambert(hex), dark = lambert(0x1f2229);
  const skin = lambert(0xf1c9a5, { emissive: 0x8a7355, emissiveIntensity: 0.45 });
  const hide = [];
  // 矩形軀幹(胸腹髖三段)
  const body = new THREE.Group(); body.position.y = 1.02; tilt.add(body);
  put(box(0.42, 0.34, 0.24, paint), 0, 0.2, 0, body);      // 胸
  put(box(0.38, 0.22, 0.22, paint), 0, -0.06, 0, body);    // 腹
  put(box(0.4, 0.18, 0.23, dark), 0, -0.24, 0, body);      // 髖(短褲)
  hide.push(body);
  const head = makeRiderHead(paint, skin, { helmet: false }); head.position.set(0, 1.47, 0); tilt.add(head); hide.push(head);   // 用兩條腿跑的人不戴安全帽
  // 長腿(大腿+小腿+腳掌),pivot=髖
  const legs = [];
  for (const sx of [-1, 1]) {
    const pivot = new THREE.Group(); pivot.position.set(sx * 0.13, 0.78, 0); tilt.add(pivot);
    put(box(0.15, 0.44, 0.16, skin), 0, -0.22, 0, pivot);
    const knee = new THREE.Group(); knee.position.y = -0.44; pivot.add(knee);
    put(box(0.13, 0.42, 0.14, skin), 0, -0.21, 0, knee);
    put(box(0.15, 0.09, 0.28, dark), 0, -0.44, 0.06, knee);
    legs.push({ pivot, knee, sx });
  }
  // 手臂(擺動)
  const arms = [];
  for (const sx of [-1, 1]) {
    const pivot = new THREE.Group(); pivot.position.set(sx * 0.26, 1.18, 0); tilt.add(pivot);
    put(new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.34, 8), skin), 0, -0.17, 0, pivot);
    const elbow = new THREE.Group(); elbow.position.y = -0.34; pivot.add(elbow);
    put(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.3, 8), skin), 0, -0.15, 0.04, elbow);
    elbow.rotation.x = -1.3;
    arms.push({ pivot, sx });
  }
  // 衝刺塵土(flame 契約)
  const flame = put(new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.7, 8), new THREE.MeshBasicMaterial({ color: 0xd9c39a, transparent: true, opacity: 0.5 })), 0, 0.25, -0.7, tilt);
  flame.rotation.x = -Math.PI / 2; flame.visible = false;
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 18), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.scale.set(0.42, 0.6, 1); shadow.position.y = 0.02; group.add(shadow);
  // 第一人稱:沒有儀表板可放 ⇒ 只留一個貼在視野下緣的小速度表(不擋路)
  let cockpit = null;
  if (interior) {
    cockpit = new THREE.Group(); tilt.add(cockpit);
    const g = makeGauge(0.075); g.group.position.set(0.26, 1.3, 0.34); g.group.rotation.x = -0.5; cockpit.add(g.group);
    cockpit.userData = { wheel: new THREE.Group(), wheelAxis: "z", wheelGain: 0, needlePivot: g.needlePivot };
  }
  // 跑步循環:腿前後擺、膝蓋彎、手臂反相、身體上下起伏(wheelRadius 0.9 ⇒ wheelSpin 當步頻)
  const anim = (car) => {
    const t = car.wheelSpin, spd = Math.abs(car.speed);
    const amp = clamp(spd / 16, 0, 0.95);
    for (const l of legs) {
      const ph = l.sx > 0 ? 0 : Math.PI;
      l.pivot.rotation.x = Math.sin(t + ph) * amp;
      l.knee.rotation.x = -Math.max(0, Math.sin(t + ph + 1.1)) * amp * 1.5;
    }
    for (const a of arms) a.pivot.rotation.x = Math.sin(t + (a.sx > 0 ? Math.PI : 0)) * amp * 0.75;
    tilt.position.y = Math.abs(Math.sin(t)) * 0.055 * Math.min(1, spd / 12);
    body.rotation.x = 0.12 + Math.min(0.22, spd / 90);   // 越快身體越前傾
  };
  return { group, tilt, wheels: [], hide, flame, cockpit, tailMat: null, paint, kind: "run", leanIn: false, anim };
}
/* ═══════════════════════ 🛸 懸浮車 ═══════════════════════ */
export function makeHoverRig(hex, { interior = false } = {}) {
  const group = new THREE.Group(), tilt = new THREE.Group(); group.add(tilt);
  const paint = lambert(hex), dark = lambert(0x1b1f2a), glow = new THREE.MeshBasicMaterial({ color: 0x59d7ff, transparent: true, opacity: 0.55 });
  const glass = new THREE.MeshLambertMaterial({ color: 0x21395c, transparent: true, opacity: 0.62 });
  const skin = lambert(0xf1c9a5, { emissive: 0x8a7355, emissiveIntensity: 0.45 });
  const hide = [];
  // 船身:前尖後寬的梭形(用兩段箱體 + 斜面),沒有輪子
  put(box(1.9, 0.34, 3.0, paint), 0, 0.86, 0, tilt);
  put(box(1.5, 0.26, 1.1, paint), 0, 1.06, 0.55, tilt);
  const nose = put(box(1.2, 0.22, 0.9, paint), 0, 0.84, 1.72, tilt); nose.rotation.x = 0.12;
  put(box(2.0, 0.16, 0.5, dark), 0, 0.72, -1.42, tilt);
  // 底部光暈(懸浮感):四片朝下的發光面 + 中央長條
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const pad = new THREE.Mesh(new THREE.CircleGeometry(0.42, 16), glow);
    pad.rotation.x = -Math.PI / 2; pad.position.set(sx * 0.72, 0.5, sz * 1.05); tilt.add(pad);
  }
  const underGlow = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 2.6), new THREE.MeshBasicMaterial({ color: 0x59d7ff, transparent: true, opacity: 0.22 }));
  underGlow.rotation.x = -Math.PI / 2; underGlow.position.y = 0.46; tilt.add(underGlow);
  // 尾部推進器(boosting 時亮 = flame 契約)
  for (const sx of [-1, 1]) {
    const ring = put(new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.06, 8, 14), dark), sx * 0.6, 0.9, -1.52, tilt);
  }
  const flame = put(new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.1, 10), new THREE.MeshBasicMaterial({ color: 0x59d7ff, transparent: true, opacity: 0.75 })), 0, 0.9, -2.0, tilt);
  flame.rotation.x = -Math.PI / 2; flame.visible = false;
  const tailMat = new THREE.MeshLambertMaterial({ color: 0xff3b30, emissive: 0xff2a2a, emissiveIntensity: 0.35 });
  for (const sx of [-1, 1]) put(box(0.3, 0.1, 0.05, tailMat), sx * 0.55, 1.02, -1.5, tilt);
  // 艙罩 + 駕駛(駕駛座視角要藏)
  const canopy = put(new THREE.Mesh(new THREE.SphereGeometry(0.62, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), glass), 0, 1.12, 0.15, tilt);
  canopy.scale.set(1.05, 0.92, 1.35); hide.push(canopy);
  const rim = put(new THREE.Mesh(new THREE.TorusGeometry(0.64, 0.035, 8, 20), dark), 0, 1.12, 0.15, tilt);
  rim.rotation.x = Math.PI / 2; rim.scale.set(1.05, 1.35, 1); hide.push(rim);
  const driver = new THREE.Group(); driver.position.set(0, 1.06, -0.05); tilt.add(driver); hide.push(driver);
  put(box(0.36, 0.32, 0.24, paint), 0, 0.02, 0, driver);
  const head = makeRiderHead(paint, skin); head.position.set(0, 0.25, 0); driver.add(head);
  // 影子
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 18), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.26, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.scale.set(1.0, 1.7, 1); shadow.position.y = 0.02; group.add(shadow);
  // 駕駛座:艙內平視顯示器(速度表)+ 操縱桿隨轉向左右擺
  let cockpit = null;
  if (interior) {
    cockpit = new THREE.Group(); tilt.add(cockpit);
    put(box(1.15, 0.16, 0.42, dark), 0, 0.98, 0.78, cockpit);
    const g = makeGauge(0.085); g.group.position.set(0.34, 1.09, 0.72); g.group.rotation.x = -0.25; cockpit.add(g.group);
    const stick = new THREE.Group(); stick.position.set(0, 0.92, 0.42); cockpit.add(stick);
    put(new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.034, 0.3, 8), dark), 0, 0.15, 0, stick);
    put(box(0.26, 0.05, 0.08, lambert(0x4a505c)), 0, 0.3, 0, stick);
    cockpit.userData = { wheel: stick, wheelAxis: "z", wheelGain: -0.55, needlePivot: g.needlePivot };
  }
  // 懸浮:船身持續上下微浮 + 側傾跟轉向(anim 契約)
  const anim = (car) => {
    const t = car.wheelSpin * 0.35 + (car.trackDist || 0) * 0.02;
    tilt.position.y = Math.sin(t * 2.1) * 0.05 + 0.04;
    underGlow.material.opacity = 0.16 + Math.min(0.18, Math.abs(car.speed) / 220);
  };
  return { group, tilt, wheels: [], hide, flame, cockpit, tailMat, paint, kind: "hover", leanIn: false, anim };
}
/* ═══════════════════════ 🐎 馬 ═══════════════════════ */
export function makeHorseRig(hex, { interior = false } = {}) {
  const group = new THREE.Group(), tilt = new THREE.Group(); group.add(tilt);
  const paint = lambert(hex);                                  // 隊色:鞍毯 + 騎士上衣 + 帽
  const coat = lambert(0x8a5a33), mane = lambert(0x3a2a1c), sock = lambert(0xe9e2d2), hoof = lambert(0x2a2622);
  const skin = lambert(0xf1c9a5, { emissive: 0x8a7355, emissiveIntensity: 0.45 });
  const hide = [];
  // 軀幹:矩形箱體(胸+臀段)+ 圓弧肌群(肩/臀/腹)—— 不用圓筒
  put(box(0.62, 0.62, 1.7, coat), 0, 1.58, 0, tilt);
  put(box(0.58, 0.5, 0.4, coat), 0, 1.62, 0.95, tilt);
  put(box(0.58, 0.5, 0.42, coat), 0, 1.6, -0.95, tilt);
  for (const side of [-1, 1]) {
    const shoulder = put(new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), coat), side * 0.22, 1.5, 0.74, tilt); shoulder.scale.set(1, 1.1, 1.35);
    const haunch = put(new THREE.Mesh(new THREE.SphereGeometry(0.23, 12, 10), coat), side * 0.19, 1.52, -0.8, tilt); haunch.scale.set(1.05, 1.15, 1.3);
  }
  const belly = put(new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 12), coat), 0, 1.4, -0.05, tilt); belly.scale.set(1.02, 0.82, 1.8);
  const withers = put(box(0.3, 0.16, 0.46, coat), 0, 1.92, 0.62, tilt); withers.rotation.x = -0.14;
  // 頸(雙節斜上)+ 頭(雙眼雙耳鼻孔)+ 鬃毛三件套
  const neckPivot = new THREE.Group(); neckPivot.position.set(0, 1.82, 1.05); tilt.add(neckPivot);
  const neckLower = put(box(0.34, 0.5, 0.42, coat), 0, 0.1, 0.1, neckPivot); neckLower.rotation.x = 0.55;
  const neckUpper = put(box(0.26, 0.46, 0.3, coat), 0, 0.42, 0.32, neckPivot); neckUpper.rotation.x = 0.85;
  const head = new THREE.Group(); head.position.set(0, 0.62, 0.5); neckPivot.add(head);
  const skull = put(box(0.26, 0.3, 0.52, coat), 0, 0, 0, head); skull.rotation.x = 0.35;
  const muzzle = put(box(0.2, 0.22, 0.3, mane), 0, -0.12, 0.34, head); muzzle.rotation.x = 0.35;
  const jaw = put(box(0.19, 0.13, 0.3, coat), 0, -0.21, 0.1, head); jaw.rotation.x = 0.35;
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff }), darkEye = new THREE.MeshBasicMaterial({ color: 0x1c1712 });
  for (const side of [-1, 1]) {
    put(new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 10), white), side * 0.14, 0.06, 0.14, head);
    put(new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 8), darkEye), side * 0.165, 0.06, 0.15, head);
    const ear = put(new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 6), coat), side * 0.09, 0.24, -0.05, head); ear.rotation.x = -0.2;
    put(new THREE.Mesh(new THREE.SphereGeometry(0.024, 8, 6), darkEye), side * 0.052, -0.175, 0.47, head);
  }
  const maneCrest = put(box(0.14, 0.88, 0.24, mane), 0, 0.36, -0.04, neckPivot); maneCrest.rotation.x = 0.7;
  const maneSide = put(box(0.06, 0.74, 0.34, mane), 0.17, 0.24, 0.08, neckPivot); maneSide.rotation.x = 0.7;
  put(box(0.16, 0.22, 0.12, mane), 0, 0.24, 0.08, head);
  // 尾
  const tail = new THREE.Group(); tail.position.set(0, 1.62, -1.14); tail.rotation.x = 0.55; tilt.add(tail);
  put(box(0.13, 0.4, 0.15, mane), 0, -0.16, 0, tail);
  const tailLower = put(box(0.09, 0.34, 0.11, mane), 0, -0.46, -0.07, tail); tailLower.rotation.x = 0.22;
  // 四腿(雙節+蹄,前腿白襪;pivot=肩/髖 y 1.35,長腿 v3)
  const mkLeg = (x, z, white) => {
    const pivot = new THREE.Group(); pivot.position.set(x, 1.35, z); tilt.add(pivot);
    put(box(0.15, 0.62, 0.15, coat), 0, -0.31, 0, pivot);
    const joint = new THREE.Group(); joint.position.y = -0.62; pivot.add(joint);
    put(new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 8), white ? sock : coat), 0, 0, 0, joint);
    put(box(0.11, 0.6, 0.11, white ? sock : coat), 0, -0.3, 0, joint);
    put(box(0.13, 0.12, 0.16, hoof), 0, -0.62, 0.02, joint);
    return { pivot, joint };
  };
  const legs = [mkLeg(-0.22, 0.72, true), mkLeg(0.22, 0.72, true), mkLeg(-0.2, -0.78, false), mkLeg(0.2, -0.78, false)];
  // 鞍毯(隊色)+ 鞍 + 肚帶
  put(box(0.72, 0.05, 0.8, paint), 0, 1.93, 0.05, tilt);
  put(box(0.44, 0.1, 0.5, lambert(0x4a2f1c)), 0, 1.98, 0.05, tilt);
  put(box(0.7, 0.68, 0.09, lambert(0x4a2f1c)), 0, 1.56, 0.12, tilt);
  // 騎士:跨鞍、雙手前伸握韁、有臉(駕駛座藏頭與身體,手臂與韁留著)
  for (const sx of [-1, 1]) {
    const thigh = put(box(0.14, 0.4, 0.15, lambert(0x2b3a6b)), sx * 0.34, 1.9, 0.18, tilt); thigh.rotation.x = -1.1; thigh.rotation.z = sx * 0.35;
    put(box(0.12, 0.42, 0.13, lambert(0x2b3a6b)), sx * 0.4, 1.58, 0.28, tilt);
    put(box(0.12, 0.1, 0.24, lambert(0x1f2229)), sx * 0.41, 1.34, 0.3, tilt);
  }
  const torso = put(box(0.36, 0.5, 0.26, paint), 0, 2.3, 0.05, tilt); torso.rotation.x = 0.18; hide.push(torso);
  for (const sx of [-1, 1]) { const arm = put(new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.5, 8), paint), sx * 0.2, 2.32, 0.3, tilt); arm.rotation.x = 1.25; }
  // 軀幹前傾 0.18 rad,上緣中心 (0, 2.546, 0.095);頭底再抬 5cm 給脖子站,脖子下端埋回軀幹裡
  const rHead = makeRiderHead(paint, skin); rHead.position.set(0, 2.63, 0.09); tilt.add(rHead); hide.push(rHead);
  // 韁繩(手→嚼口),group 隨轉向微轉(cockpit.userData.wheel)
  const reins = new THREE.Group(); reins.position.set(0, 2.2, 0.45); tilt.add(reins);
  for (const sx of [-1, 1]) {
    const rein = put(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.15, 6), lambert(0x3b2a1a)), sx * 0.12, 0.06, 0.55, reins);
    rein.rotation.x = -Math.PI / 2 + 0.1;
  }
  // 衝刺塵土(沿用 flame 契約:boosting 時顯示)
  const flame = put(new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.9, 8), new THREE.MeshBasicMaterial({ color: 0xd9c39a, transparent: true, opacity: 0.55 })), 0, 0.35, -1.6, tilt);
  flame.rotation.x = -Math.PI / 2; flame.visible = false;
  // 影子
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 18), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.scale.set(0.75, 1.6, 1); shadow.position.y = 0.02; group.add(shadow);
  let cockpit = null;
  if (interior) { cockpit = new THREE.Group(); tilt.add(cockpit); cockpit.userData = { wheel: reins, wheelAxis: "y", wheelGain: -0.25, needlePivot: null }; }
  // 奔跑循環(mount-riding-kit):四腿 sin(t+phase)·amp、身體 bob、頸點頭、尾擺;t = car.wheelSpin(wheelRadius 1.0 ⇒ 每 2π 公尺一步)
  const PH = [0, Math.PI / 2, Math.PI, Math.PI * 1.5];
  const anim = (car) => {
    const t = car.wheelSpin, spd = Math.abs(car.speed);
    const amp = clamp(spd / 14, 0, 0.62);
    for (let i = 0; i < 4; i++) {
      legs[i].pivot.rotation.x = Math.sin(t + PH[i]) * amp;
      legs[i].joint.rotation.x = Math.max(0, Math.sin(t + PH[i] + 0.9)) * amp * 0.9;
    }
    tilt.position.y = Math.abs(Math.sin(t)) * 0.06 * Math.min(1, spd / 10);
    neckPivot.rotation.x = Math.sin(t) * amp * 0.12;
    tail.rotation.x = 0.55 + Math.sin(t * 0.9) * 0.15;
  };
  return { group, tilt, wheels: [], hide, flame, cockpit, tailMat: null, paint, kind: "horse", leanIn: false, anim };
}
