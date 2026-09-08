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
| `src/city.js` | 街廓格網、地面材質、建築、行人、城界緩衝帶、隧道、街邊擺設、今日路線 | ✅ 零依賴 THREE |
| `src/age.js` | 年齡三檔 + 跨站偏好 `hfpc-age-pref` | ✅ |
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

## 第二期(0908)加了什麼

- **地圖 9×9**(684m 見方,81 街區)。廣場 5、公園 5、隧道 3,全部散開。
- **下車走路**(F):走路**不是第六種載具**,是「暫時離開載具」的狀態。載具停在原地、
  小地圖標黃色 P,走回 4.5m 內按 F 上車。走路的快慢不吃難度檔(`WALK_CFG` 固定 2.6 m/s)。
- **隧道**:`CITY.tunnels` 那幾格,格中央一條南北向通道是 road,兩側牆進 `buildings`(會擋)。
- **街邊生活**:`buildStreetProps()` 產生路邊攤與露天座,**只擺人行道、不擋路**。
- **道路細化**:緣石、斑馬線、停止線、雙黃線、路燈、紅綠燈,全部 `InstancedMesh`。
- **今日路線**:`dailyRoute(todayKey())` 每天五站,場上一根金色光柱指著下一站。
- **髮型**:`makeHair` / `makeHelmet`(rigs.js export),騎士、90 個路人、露天座客人共用同一支。
  改造型只改那一支;五條頭頸鐵則見 skill `figure-head-neck-rules`。
- **手機首頁斷言**:驗收會在 844×390 / 390×844 兩個尺寸、簡歷收合與全展開四種組合下,
  量卡片上緣不可為負、捲到底「出發」要整顆在視窗內。首頁只會越加越長,這道守門別拿掉。

## 效能:這座城的三條線

1. **`InstancedMesh` 是必需品,不是優化**。斑馬線/路燈/紅綠燈這種「同一個小物擺幾百次」的東西
   逐個建 Mesh 會做出約 5800 個物件、掉到 31 fps。
2. **距離裁切**(`CULL`):街景與行人超過半徑就整個 Group `visible=false`。
   建築刻意**不裁** —— 遠處的樓是天際線,裁掉會看到城市憑空消失。
3. 量幀率不要用感覺:包一層 `game.update` 數幀,跑四秒除一除就知道。

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
8. **人物三鐵則**(0908 使用者實玩逐條點名,`rigs.js` 的 `makeRiderHead`):
   ①**脖子**要有,而且加完要**看得到** —— 第一版整截被頭球包住,`head.position` 各抬高 3~5cm 才露得出來。
   ②**後腦**要遮 —— `SphereGeometry(r,w,h,0,2π,0,1.55)` 只蓋到赤道,後腦整片裸著膚色球。
   ③頭要接在**軀幹上緣**:軀幹前傾 θ 時上緣 = `(0, cy + h/2·cosθ, cz + h/2·sinθ)`。照抄座標會做出「頭長在背上」。
   ④第一人稱內裝(`rig.cockpit`)只該在駕駛座視角可見,漏管就會浮在外部視角的人物身上。
   ⑤站姿不能用「坐姿整個抬高」湊 —— 那會做出懸空盤腿的攤販老闆。
9. **自動駕駛要沿著馬路走**。原本是正弦蛇行,建築變多之後四秒必撞進街廓卡死。
   取正前方 25m 最近的馬路中心當目標即可。
10. **測試之間要把場面歸位**。隧道那段把車丟到城市另一角,害下一段「人站在載具旁多遠」量到 0.2m
   (人被建築推走了)—— 看起來像下車邏輯壞了,其實是上一段留下的狀態。
11. **會吃隨機的測試要先把隨機關掉**。隧道那條驗收本機 0 次撞牆、線上穩定 3 次,
   因為路上會隨機撞到行人 ⇒ 車偏了才擦牆。測隧道就把行人關掉。
12. **`.visible` 一律 `!!(…)`**。`A && B` 在 A 是 falsy 時回傳 A 本身,而 three 的 `projectObject`
   只跳過**嚴格 false** ⇒ `undefined` 會照畫。這條有 hook 守著(`visible-strict-guard`)。

## 出貨前

```bash
npm test            # 56 項:city 29 + drive 19 + voice 8
npm run build
npm run check:local # 97 項真瀏覽器驗收(playwright-core + 系統 Edge)
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
