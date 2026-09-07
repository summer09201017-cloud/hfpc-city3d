// age.js —— 年齡三檔(kid-age-modes 契約)。
// ★ 兩個問題分開治:幼幼要的是「上手」(開慢、追尾看得清、自動唸玩法給不識字的孩子),
//   青少要的是「耐玩」(開快、駕駛座第一人稱)。
// ★ 跨關共用偏好鍵 hfpc-age-pref(kinder | kids | teen):在別站選過,這站直接沿用。
// ★ 唸玩法用預烤 mp3(voice.js),**不用 Web Speech**(全系列人聲鐵則)。

export const AGE = {
  kinder: {
    id: "kinder", label: "幼幼", emoji: "🧸", sub: "不識字也能玩・開最慢・自動唸玩法",
    speed: "kids", camView: "chase", speakHowto: true,
  },
  kids: {
    id: "kids", label: "兒童", emoji: "🙂", sub: "一般玩法・快一點・追尾視角",
    speed: "child", camView: "chase", speakHowto: false,
  },
  teen: {
    id: "teen", label: "青少", emoji: "🧑", sub: "開最快・駕駛座第一人稱",
    speed: "normal", camView: "cockpit", speakHowto: false,
  },
};
export const AGE_IDS = Object.keys(AGE);
const KEY = "hfpc-age-pref";

export function getAge(id) { return AGE[id] || AGE.kids; }

/** 讀跨關偏好;讀不到(私密模式/沒選過)一律回 kids。 */
export function getAgePref() {
  try {
    const v = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    return AGE_IDS.includes(v) ? v : "kids";
  } catch { return "kids"; }
}

/** 寫回跨關偏好;寫不進去就算了(Safari 私密模式靜默)。 */
export function setAgePref(id) {
  if (!AGE_IDS.includes(id)) return;
  try { if (typeof localStorage !== "undefined") localStorage.setItem(KEY, id); } catch { /* 靜默 */ }
}

/** 目前設定剛好等於哪一檔(都不等於就回 null,三顆鈕都不亮)。 */
export function matchAge(settings, camView) {
  for (const a of Object.values(AGE)) {
    if (a.speed === settings.speed && a.camView === camView) return a.id;
  }
  return null;
}
