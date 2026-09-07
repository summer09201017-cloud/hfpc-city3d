# hfpc-city3d —— 3D 都市漫遊(開車・騎馬・跑步都行)

線上:https://hfpc-city3d.summer09201017.workers.dev
平台:Cloudflare Workers 靜態資產(`wrangler deploy --name hfpc-city3d --assets dist`)。**不要**回 Netlify / Vercel。

## 這一站是什麼(以及不是什麼)

使用者 2026-09-07 拍板的一句話決定了整個架構:

> **「要能開上人行道、能穿越廣場,但撞不傷人。」**

所以:

- **沒有比賽**。沒有倒數、沒有圈數、沒有名次、沒有結算。phase 只有 `menu | driving`。
- **沒有賽道中線**。車在 xz 平面完全自由移動。收割自 racing3d 的 `vehicle.js` 已經把
  里程 / 左右偏移 / 圈數 / 逆向 / 中線整套**拿掉**,不要再加回來。
- **地面只決定快慢,不擋路**。`SURFACES` 每一種的 `speedMul` 都 > 0,沒有一種是牆。
  真正擋路的只有建築物,而且撞到只是推開 + 掉速,不翻車不爆炸。
- **行人撞不傷**。九公尺內先閃開,真的碰到只是被推開 + 車掉速。不倒地、不流血、不消失。

## 分層(哪一層可以在 node 直測)

| 檔 | 管什麼 | node 測得到? |
|---|---|---|
| `src/city.js` | 街廓格網、地面材質、建築、行人、城界緩衝帶 | ✅ 零依賴 THREE |
| `src/vehicle.js` | 車體物理(`stepCar` 純函數) | ✅ |
| `src/vehicles.js` | 五種載具參數包 | ✅ |
| `src/commentary.js` | 事件 → 唸哪一句 | ✅ |
| `src/game.js` | THREE 場景、鏡頭、HUD 資料 | ❌ 要瀏覽器 |
| `src/main.js` | DOM、輸入、音效、人聲、打點 | ❌ 要瀏覽器 |

## 幾何(改 `CITY` 之前先看這段)

一格的跨距 `g = block + road`(60 + 16 = 76)。**街廓本體佔前 60、街道佔後 16**。

- `blockCenter(c,r)` = 街廓正中央,在格內偏移 `block/2 = 30`。
  ⚠ 寫成 `g*(c+0.5)` 會整個偏 `road/2 = 8`:行人的生成圈會落到馬路上,建築也會往路中間擠。
- `roadCenter(c,r)` = 該格右側/下側那條街的中心線,格內偏移 `block + road/2 = 68`。
- 地面畫面要跟 `surfaceAt` 說同一件事:城界(w×h 方形)以內鋪柏油、以外是草地。
  用圓環當草原會出現「看起來是路、判定是草地」的那一圈。

## 踩過的地雷(別再踩)

1. **`driftReward` 漏搬**。放開手煞就丟例外,而瀏覽器驗收從不按手煞 —— 41/41 全綠也藏得住。
   ⇒ 純函數層一定要有 node 測試,不能只靠 Playwright。
2. **越野型會開到天邊**。馬 / 跑步 / 懸浮車草地零減速,沒有城界緩衝帶就一路開到 x=795。
   現在 `EDGE = { margin: 26, stick: 2.6 }`:城外愈開愈黏,超過 margin 夾住並發 `edge` 事件。
3. **同一格的建築不可以重疊**。重疊會做出凹角,`resolveBuilding` 把車推出 A 正好推進 B,車卡死。
   產生時最多試 8 次、兩棟之間留 `gap = 3.2`;`resolveBuilding` 也會連推 4 次收斂。
4. **`nearestRoadPoint` 要夾在城內**。不夾的話車卡在邊緣時會被「救」到城外草地上。
5. **行人離家太遠會先被 leash 拉回**。測「撞到人」時把**車開到人那裡**,不要把人搬到車前面 —— 
   不然量到的「人有動」是 leash 拉的,不是被撞的。
6. **量地面速度要用跑步機**(每幀把車放回原點)。直開四秒就開出那一格了,量到的是隔壁地面。
7. **驗收腳本自己會製造 404**。`page.evaluate` 裡 `await import("./src/city.js")` 在打包後的 dist 沒這個路徑,
   `.catch()` 吞掉例外但網路 404 照樣進 console。錯誤攔截要攔 `response`(有網址),不要只看 console 那句沒網址的。

## 出貨前

```bash
npm test            # 42 項:city 17 + drive 17 + voice 8
npm run build
npm run check:local # 41 項真瀏覽器驗收(playwright-core + 系統 Edge)
node ~/.claude/skills/game-must-haves/scripts/check-must-haves.mjs .
npx wrangler deploy --name hfpc-city3d --assets dist --compatibility-date 2026-07-01
```

殼層(`index.html` / `public/manifest.webmanifest` / `public/icon.svg` / `public/sw.js`)有改就 bump
`public/sw.js` 的 `CACHE`。

## 人聲

預烤 mp3(`public/voice/`,微軟曉臻神經語音,`npm run voice` 累加式重烤)。
**沒有 Web Speech fallback** —— 沒烤過的句子就不唸,只出字幕。
加句子:寫進 `src/voicePhrases.js` 的 `PHRASES` → `npm run voice` → mp3 與 manifest 進 git。
`test/voice.test.mjs` 會三方對賬(commentary ↔ 詞庫 ↔ 真的烤出來的檔)。
