// voice.test.mjs —— 人聲三方對賬:commentary(誰會被唸)↔ voicePhrases(詞庫)↔ public/voice(真的烤過的 mp3)。
// ★ 為什麼要這支:speakLine 找不到 mp3 是**靜默**的,畫面照樣有字幕、瀏覽器驗收照樣全綠 ——
//   少烤一句在真機上就是「這句永遠不出聲」,只有這種對賬抓得到。
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PHRASES, HOWTO, voiceKey } from "../src/voicePhrases.js";
import { allLines, lineFor, COOLDOWN, missingFromPhrases } from "../src/commentary.js";

let pass = 0;
const test = (name, fn) => { fn(); pass++; console.log("  ✓", name); };
const VOICE_DIR = fileURLToPath(new URL("../public/voice/", import.meta.url));
const manifest = JSON.parse(readFileSync(VOICE_DIR + "manifest.json", "utf8"));

test("詞庫沒有重覆句(重覆=烤兩次同一個 key,浪費也易混淆)", () => {
  const seen = new Set();
  for (const t of PHRASES) {
    assert.ok(!seen.has(t), `詞庫重覆:「${t}」`);
    seen.add(t);
  }
  assert.ok(PHRASES.length >= 10, `詞庫只有 ${PHRASES.length} 句,太少`);
});

test("★ commentary 會唸的每一句都在詞庫裡", () => {
  const miss = missingFromPhrases();
  assert.deepEqual(miss, [], `這些句子 commentary 會唸、詞庫卻沒有(永遠不會出聲):\n  ${miss.join("\n  ")}`);
});

test("★ 詞庫的每一句都真的烤成 mp3 了(manifest 有、檔案也在)", () => {
  for (const t of PHRASES) {
    const key = voiceKey(t);
    assert.ok(manifest[key], `「${t}」沒進 manifest —— 這句永遠不會出聲`);
    assert.ok(existsSync(VOICE_DIR + key + ".mp3"), `「${t}」的 mp3 檔不見了(${key}.mp3)`);
  }
});

test("mp3 不是空檔(烤壞會留下 0 byte)", () => {
  for (const t of PHRASES) {
    const fp = VOICE_DIR + voiceKey(t) + ".mp3";
    assert.ok(readFileSync(fp).length > 800, `${t} 的 mp3 太小,應該是烤壞了`);
  }
});

test("manifest 沒有多餘的孤兒條目(詞庫刪句卻忘了清)", () => {
  const want = new Set(PHRASES.map(voiceKey));
  for (const key of Object.keys(manifest)) {
    assert.ok(want.has(key), `manifest 有 ${key},詞庫裡卻找不到對應的句子`);
  }
});

test("幼幼檔自動唸的「怎麼玩」有烤,而且真的講得完整", () => {
  assert.ok(PHRASES.includes(HOWTO), "HOWTO 沒放進詞庫");
  assert.ok(manifest[voiceKey(HOWTO)], "HOWTO 沒烤成 mp3");
  for (const key of ["油門", "轉彎", "人行道", "廣場", "視角", "載具"]) {
    assert.ok(HOWTO.includes(key), `玩法唸稿沒講到「${key}」,不識字的孩子會漏掉這件事`);
  }
});

test("每種事件都有對應的唸稿(或明確地不唸)", () => {
  assert.equal(lineFor("begin", {}), "出發!想去哪就去哪。");
  for (const to of ["walk", "plaza", "grass", "road"]) {
    assert.ok(lineFor("surface", { to }), `換到 ${to} 沒有唸稿`);
  }
  for (const id of ["car", "moto", "horse", "run", "hover"]) {
    assert.ok(lineFor("vehicle", { id }), `換成 ${id} 沒有唸稿`);
  }
  assert.equal(lineFor("bump", { speed: 2 }), "", "輕輕擦到也唸就太吵了");
  assert.ok(lineFor("bump", { speed: 20 }), "撞得夠用力應該要唸");
  assert.equal(lineFor("blocks", { blocks: 3, total: 36 }), "", "還沒到里程碑就不該唸");
  assert.ok(lineFor("blocks", { blocks: 10, total: 36 }));
  assert.ok(lineFor("blocks", { blocks: 36, total: 36 }));
  assert.equal(lineFor("沒這種事件", {}), "", "不認得的事件要安靜,不能丟例外");
});

test("會反覆觸發的事件都有冷卻(不然壓著人行道邊緣會唸個不停)", () => {
  for (const type of ["surface", "ped", "bump", "edge"]) {
    assert.ok(COOLDOWN[type] >= 4, `${type} 的冷卻只有 ${COOLDOWN[type]} 秒,太吵`);
  }
  assert.equal(COOLDOWN.vehicle, 0, "換載具是使用者自己按的,每次都該回應");
});

console.log(`voice.test: ${pass} 項全過`);
