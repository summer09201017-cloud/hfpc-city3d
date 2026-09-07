// gen-voice.mjs —— 把唸稿用 edge-tts(微軟曉臻神經語音,免費)預烤成 mp3(racing3d 範式收割)。
// 產出 public/voice/<key>.mp3 + public/voice/manifest.json;runtime src/voice.js mp3 優先、缺檔=只出字幕不唸(人聲鐵則:不用 Web Speech)。
// 用法:node scripts/gen-voice.mjs(需網路;產物進 git,離線可玩)。累加式:已有的檔跳過;偶發「Stream closed」重跑補齊。
// ⚠ msedge-tts 一定要 ^2.0.7(1.3.4 每句都 Connect Error,長得像網路問題其實是端點換了)。
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { voiceKey, PHRASES } from "../src/voicePhrases.js";

// lib 會在我們複製走檔案後非同步再 unlink 一次 → 吞掉這個特定錯誤
process.on("uncaughtException", (e) => {
  if (e && e.code === "ENOENT" && e.syscall === "unlink") return;
  console.error(e);
  process.exit(1);
});

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "public", "voice");
mkdirSync(OUT, { recursive: true });
const manifestPath = join(OUT, "manifest.json");
let manifest = {};
try { manifest = JSON.parse(readFileSync(manifestPath, "utf8")); } catch { /* 第一次 */ }
const saveManifest = () => writeFileSync(manifestPath, JSON.stringify(manifest, null, 1) + "\n", "utf8");

const VOICE = "zh-TW-HsiaoChenNeural"; // 曉臻(柔和導覽腔);比賽播報那種才用 zh-TW-YunJheNeural
// ★ 都市漫遊沒有比賽,用溫和女聲導覽;賽車(racing3d)才用雲哲的轉播腔。

let made = 0, skipped = 0, failed = 0;
for (const text of PHRASES) {
  const key = voiceKey(text);
  const fp = join(OUT, `${key}.mp3`);
  if (existsSync(fp)) { manifest[key] = `voice/${key}.mp3`; saveManifest(); skipped++; continue; }
  const tmpDir = join(OUT, `_tmp_${key}`);
  try {
    const tts = new MsEdgeTTS();
    await tts.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    mkdirSync(tmpDir, { recursive: true });
    const { audioFilePath } = await tts.toFile(tmpDir, text);
    copyFileSync(audioFilePath, fp);   // copy 不 rename:留原檔給 lib 自己清
    try { tts.close && tts.close(); } catch { /* socket 已關 */ }
    manifest[key] = `voice/${key}.mp3`;
    saveManifest();                    // 逐句落盤:中途死也不丟已完成的
    made++;
    console.log("✓", text);
  } catch (err) {
    failed++;
    console.error("✗", text, String(err).slice(0, 120));
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  }
}
console.log(`done: made ${made}, skipped ${skipped}, failed ${failed}, total ${readdirSync(OUT).filter((f) => f.endsWith(".mp3")).length} mp3`);
process.exit(failed ? 1 : 0);
