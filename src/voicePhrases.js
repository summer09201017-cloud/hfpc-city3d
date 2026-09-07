// voicePhrases.js —— 都市漫遊的固定唸稿 + voiceKey;烤製(scripts/gen-voice.mjs)與 runtime(voice.js)共用。
// ★ 人聲鐵律(baked-voice-commentary):一律預烤 mp3 神經人聲,**絕不用 Web Speech 機器聲**;
//   沒烤過的句子就不唸(只出字幕),不會用機器聲頂替。
// ★ 加句子的流程:寫進 PHRASES → node scripts/gen-voice.mjs → mp3 與 manifest 進 git。
export function voiceKey(text) {
  let h = 0x811c9dc5;
  const s = String(text).replace(/\s+/g, "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/* 幼幼檔一進場自動唸的「怎麼玩」(給還不識字的孩子;其他檔按 🔊 才唸)。 */
export const HOWTO = "怎麼玩:上下鍵是油門和煞車,左右鍵轉彎。人行道、廣場、公園都可以開上去,只是會慢一點。路上的人會自己閃開,撞到也不會受傷。按 V 換視角,按數字鍵一到五換載具。想去哪就去哪!";

export const PHRASES = [
  HOWTO,
  "出發!想去哪就去哪。",
  "開上人行道了,慢一點喔。",
  "穿過廣場囉。",
  "到公園了,草地上會慢很多。",
  "回到馬路上了。",
  "碰到人了,他沒事,慢一點喔。",
  "撞到建築物了,退一點再走。",
  "卡住了,幫你放回路上。",
  "漂亮的甩尾!送你一段加速。",
  "到城外了,掉頭回市區吧。",
  "換成賽車。",
  "換成摩托車。",
  "換成馬。",
  "換成跑步。",
  "換成懸浮車。",
  "逛過十個街區了,很會探險!",
  "整座城都逛遍了,太厲害了!",
];
