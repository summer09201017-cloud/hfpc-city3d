// voice.js —— 人聲播報 runtime:mp3(雲哲神經語音預烤,public/voice/)優先;缺檔=靜默、只出字幕。
// ★ 人聲鐵律:沒有 Web Speech fallback。音效開關(setVoiceEnabled)同步靜音人聲。
import { voiceKey } from "./voicePhrases.js";

let manifest = null;
let current = null;
let enabled = true;

export async function primeVoice() {
  if (manifest) return manifest;
  try {
    const res = await fetch("./voice/manifest.json");
    manifest = res.ok ? await res.json() : {};
  } catch { manifest = {}; }
  return manifest;
}

export function setVoiceEnabled(v) {
  enabled = !!v;
  if (!enabled && current) { try { current.pause(); } catch { /* ignore */ } current = null; }
}

/** 唸一句固定唸稿;沒烤過的句子=不唸(字幕由呼叫端顯示)。回傳有沒有真的播。 */
export function speakLine(text) {
  if (!enabled || !text || !manifest) return false;
  const path = manifest[voiceKey(text)];
  if (!path) return false;
  try {
    if (current) current.pause();
    current = new Audio("./" + path);
    current.volume = 0.95;
    current.play().catch(() => {});
    return true;
  } catch { return false; }
}
