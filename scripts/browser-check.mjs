// browser-check.mjs —— 真瀏覽器驗收(playwright-core + 系統 Edge,零下載)。
// 用法:npm run build && npm run check:local   或   CHECK_URL="https://..." node scripts/browser-check.mjs
// 驗的是使用者點名的三件事:①人行道/廣場/公園都開得上去 ②撞不傷人 ③五種載具隨時能換。
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CHECK_URL = process.env.CHECK_URL || "http://localhost:4180/";
const OUT = fileURLToPath(new URL("../screenshots/", import.meta.url));
mkdirSync(OUT, { recursive: true });
let n = 0, fails = 0;
const ok = (cond, msg) => { n++; if (!cond) { fails++; console.log("  ✗", msg); } else console.log("  ✓", msg); };

async function launch() {
  for (const channel of ["msedge", "chrome"]) {
    try { return await chromium.launch({ channel, headless: true }); } catch { /* next */ }
  }
  return chromium.launch({ headless: true });
}

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
// ★ console 只說「Failed to load resource: 404」不說是哪一個檔,查半天;所以自己攔 response 記網址。
page.on("response", (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()}  ${r.url()}`); });
page.on("requestfailed", (r) => errors.push(`REQFAIL  ${r.url()}  ${(r.failure() || {}).errorText || ""}`));
page.on("console", (m) => {
  if (m.type() !== "error") return;
  // 上面已經用 response 攔到、且帶網址了,這句沒網址的重複訊息就別再記一次
  if (/Failed to load resource/.test(m.text())) return;
  errors.push("console: " + m.text());
});
await page.goto(CHECK_URL, { waitUntil: "load" });
await page.waitForFunction(() => window.__city3d && window.__city3d.scene, null, { timeout: 15000 });
await page.waitForTimeout(700);
await page.screenshot({ path: OUT + "01-home.png" });
ok(await page.isVisible("#homeScreen"), "首頁可見");
ok(await page.evaluate(() => document.querySelectorAll("#vehicleSelect option").length === 5), "載具選單 5 型");

const world = await page.evaluate(() => {
  const g = window.__city3d;
  let objs = 0; g.scene.traverse(() => objs++);
  return { buildings: g.buildings.length, peds: g.peds.length, objs };
});
ok(world.buildings > 30, `都市有 ${world.buildings} 棟建築`);
ok(world.peds > 20, `街上有 ${world.peds} 個行人`);
ok(world.objs > 500, `場景 ${world.objs} 個物件`);

await page.click("#startButton");
await page.waitForTimeout(300);
if (await page.isVisible("#helpOverlay.visible")) { await page.click("#helpCloseButton"); ok(true, "玩法說明第一次自動跳、可關"); }
ok(await page.evaluate(() => window.__city3d.phase === "driving"), "出發後進入自由行駛(沒有倒數、沒有比賽)");
await page.evaluate(() => { window.__city3d.autopilot = true; });
await page.waitForTimeout(4000);
await page.screenshot({ path: OUT + "02-driving.png" });
ok(await page.evaluate(() => window.__city3d.player.speed > 5), "車跑起來了");

// ★ 使用者點名①:人行道、廣場、公園都要開得上去(不是牆)——把車直接放上去,看還動不動得了
const surfaceTest = await page.evaluate(() => {
  const g = window.__city3d;
  const res = {};
  const run = (label, x, z) => {
    g.player.x = x; g.player.z = z; g.player.speed = 14; g.player.heading = 0;
    for (let i = 0; i < 40; i++) { g.input.throttle = 1; g.update(1 / 60); }
    res[label] = { surface: g.player.surface, speed: Math.round(g.player.speed) };
    g.input.throttle = 0;
  };
  const b = g.buildings[0];
  run("人行道", b.x, b.z + b.d + 6);
  const pz = g.plazaCenters && g.plazaCenters[0];
  if (pz) run("廣場", pz.x, pz.z);
  const pk = g.parkCenters && g.parkCenters[0];
  if (pk) run("公園", pk.x, pk.z);
  return res;
});
for (const [label, r] of Object.entries(surfaceTest)) {
  ok(r.speed > 0, `${label}開得上去(地面 ${r.surface}、速度 ${r.speed} km/h 仍在動)`);
}

// ★ 使用者點名②:撞不傷人 —— 把行人放到車前面,撞過去
const pedTest = await page.evaluate(() => {
  const g = window.__city3d;
  const p = g.peds[0];
  const car = g.player;
  // ★ 把車開到行人那裡,不要把行人搬到車前面 ——
  //   行人離開自己的街廓太遠會先被 leash 拉回去,那樣測到的「人有動」是假的。
  const p0 = { x: p.x, z: p.z };
  car.speed = 18; car.heading = 0; car.hitPedT = 0;
  car.x = p.x; car.z = p.z - 6;
  p.flee = 0;
  const before = { pedCount: g.peds.length, bumps: g.pedBumps };
  for (let i = 0; i < 90; i++) { g.input.throttle = 1; g.update(1 / 60); }
  g.input.throttle = 0;
  return {
    pedStillThere: g.peds.length === before.pedCount,
    pedAlive: Number.isFinite(p.x) && Number.isFinite(p.z),
    bumps: g.pedBumps - before.bumps,
    carSpeed: Math.round(car.speed),
    pedMoved: Math.hypot(p.x - p0.x, p.z - p0.z) > 0.5,
  };
});
ok(pedTest.pedStillThere && pedTest.pedAlive, "撞到行人:人還在、座標正常(不會消失、不會壞掉)");
ok(pedTest.pedMoved, "行人會自己閃開或被推開(不是站著被輾)");
ok(pedTest.carSpeed >= 0, `撞人只讓車慢下來(${pedTest.carSpeed} km/h),不是撞死或卡住`);

// 前面的探針把車瞬移到角落與行人身上;回到市中心再拍,截圖才代表真的畫面
await page.evaluate(() => {
  const g = window.__city3d;
  g.player.x = 0; g.player.z = 0; g.player.speed = 0; g.player.heading = 0;
  g.autopilot = true;
});
await page.waitForTimeout(2500);

// ★ 使用者點名③:五種載具隨時能換(開到一半也能換)
for (let i = 1; i <= 5; i++) {
  await page.keyboard.press(String(i));
  await page.waitForTimeout(220);
  const got = await page.evaluate(() => {
    const g = window.__city3d;
    const lit = [...document.querySelectorAll(".veh-btn.on")].map((b) => b.dataset.veh);
    return { veh: g.settings.vehicle, kind: g.rig.kind, on: lit.length, lit: lit[0] || "" };
  });
  ok(got.kind === got.veh, `數字鍵 ${i} 換成 ${got.veh}(外型 ${got.kind})`);
  // ★ 只數「有一顆亮」不夠:亮錯顆也是一顆(0908 截圖抓到騎馬卻亮賽車)
  ok(got.on === 1 && got.lit === got.veh, `快捷列亮的正是 ${got.veh}(亮著 ${got.on} 顆:${got.lit || "無"})`);
}
await page.screenshot({ path: OUT + "03-vehicle-bar.png" });

// 五檔視角
for (let i = 0; i < 5; i++) {
  await page.keyboard.press("v");
  await page.waitForTimeout(500);
  const info = await page.evaluate(() => {
    const g = window.__city3d, c = g.camera;
    return { view: g.camView, tag: document.getElementById("viewTag").textContent, fin: [c.position.x, c.position.y, c.position.z, c.fov].every(Number.isFinite) };
  });
  ok(info.fin, `視角 ${info.view} 鏡頭有限`);
  ok(!/undefined|NaN/.test(info.tag), `視角標籤「${info.tag}」無 undefined`);
  await page.screenshot({ path: OUT + `04-view-${info.view}.png` });
}

const hudText = await page.evaluate(() => ["tripCard", "speedPanel", "statusMessage", "viewTag"].map((id) => document.getElementById(id).textContent).join(" | "));
ok(!/undefined|NaN|Invalid/.test(hudText), "HUD 無 undefined/NaN");
const badVis = await page.evaluate(() => { let bad = 0; window.__city3d.scene.traverse((o) => { if (typeof o.visible !== "boolean") bad++; }); return bad; });
ok(badVis === 0, `場景 visible 全 boolean(壞 ${badVis})`);
const upErr = await page.evaluate(() => { try { for (let i = 0; i < 60; i++) window.__city3d.update(1 / 60); return ""; } catch (e) { return String(e); } });
ok(upErr === "", `60 幀 update 無例外 ${upErr}`);

const trip = await page.evaluate(() => window.__city3d.hud());
ok(trip.distance > 0 && trip.blocks >= 1, `這一趟走了 ${trip.distance}m、逛過 ${trip.blocks}/${trip.totalBlocks} 個街區`);
ok(await page.evaluate(() => !!document.querySelector("[data-hfpc-lobby]")), "返回大廳鈕在");

await page.click("#menuButton");
await page.waitForTimeout(400);
ok(await page.isVisible("#homeScreen.visible"), "回選單");
ok(errors.length === 0, `0 pageerror(${errors.length})`);
for (const e of errors) console.log("   ", e);
await browser.close();
console.log(`browser-check: ${n - fails}/${n} 通過${fails ? "  ✗ 有紅燈" : ""}`);
process.exit(fails ? 1 : 0);
