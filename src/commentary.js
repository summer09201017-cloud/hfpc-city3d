// commentary.js —— 事件 → 該唸哪一句(純函數,node 可直測)。
// ★ 這裡回傳的每一句都必須在 voicePhrases.js 的 PHRASES 裡、而且烤過 mp3
//   (test/voice.test.mjs 逐句對賬;沒烤過的句子 voice.js 會靜默,不會用機器聲頂替)。
// ★ COOLDOWN:同一句在幾秒內不重覆唸 —— 不然一路壓過人行道邊緣會唸個不停。
import { PHRASES } from "./voicePhrases.js";

export const COOLDOWN = {
  surface: 12,   // 換地面(人行道/廣場/公園/回馬路)
  ped: 8,        // 碰到行人
  bump: 10,      // 撞建築
  rescue: 4,     // 卡住救援
  drift: 6,      // 甩尾獎勵
  edge: 15,      // 開到城外
  vehicle: 0,    // 換載具:每次都唸(是使用者自己按的)
  blocks: 0,     // 里程碑:本來就只會發生一次
};

const SURFACE_LINE = {
  walk: "開上人行道了,慢一點喔。",
  plaza: "穿過廣場囉。",
  grass: "到公園了,草地上會慢很多。",
  road: "回到馬路上了。",
};
const VEHICLE_LINE = {
  car: "換成賽車。",
  moto: "換成摩托車。",
  horse: "換成馬。",
  run: "換成跑步。",
  hover: "換成懸浮車。",
};

/**
 * 事件 → 唸稿(沒有對應的句子就回空字串,呼叫端不唸也不出字幕)。
 * type: surface | ped | bump | rescue | drift | edge | vehicle | blocks | begin
 */
export function lineFor(type, d = {}) {
  if (type === "begin") return "出發!想去哪就去哪。";
  if (type === "surface") return SURFACE_LINE[d.to] || "";
  if (type === "ped") return "碰到人了,他沒事,慢一點喔。";
  if (type === "bump") return (d.speed || 0) > 8 ? "撞到建築物了,退一點再走。" : "";
  if (type === "rescue") return "卡住了,幫你放回路上。";
  if (type === "drift") return "漂亮的甩尾!送你一段加速。";
  if (type === "edge") return "到城外了,掉頭回市區吧。";
  if (type === "vehicle") return VEHICLE_LINE[d.id] || "";
  if (type === "blocks") {
    if (d.blocks >= d.total) return "整座城都逛遍了,太厲害了!";
    if (d.blocks === 10) return "逛過十個街區了,很會探險!";
  }
  return "";
}

/** 這支模組會用到的所有句子(測試拿去跟 PHRASES / manifest 對賬)。 */
export function allLines() {
  return [
    "出發!想去哪就去哪。",
    ...Object.values(SURFACE_LINE),
    "碰到人了,他沒事,慢一點喔。",
    "撞到建築物了,退一點再走。",
    "卡住了,幫你放回路上。",
    "漂亮的甩尾!送你一段加速。",
    "到城外了,掉頭回市區吧。",
    ...Object.values(VEHICLE_LINE),
    "逛過十個街區了,很會探險!",
    "整座城都逛遍了,太厲害了!",
  ];
}

/** 唸稿有沒有全部都在詞庫裡(烤製與 runtime 的單一真相)。 */
export function missingFromPhrases() {
  const have = new Set(PHRASES);
  return allLines().filter((t) => !have.has(t));
}
