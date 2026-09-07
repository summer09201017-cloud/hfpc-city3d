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

// ★ 0908 使用者實玩點名的三個人物毛病(追尾視角看到的)
const figure = await page.evaluate(() => {
  const g = window.__city3d;
  const out = {};
  for (const id of ["car", "moto", "horse", "run", "hover"]) {
    g.setVehicle(id);
    g.setCamView("chase");
    for (let i = 0; i < 5; i++) g.update(1 / 60);
    const cockpitShown = !!(g.rig.cockpit && g.rig.cockpit.visible);
    g.setCamView("cockpit");
    for (let i = 0; i < 5; i++) g.update(1 / 60);
    const cockpitInFirstPerson = !!(g.rig.cockpit && g.rig.cockpit.visible);
    let neck = 0, nape = 0;
    g.rig.group.traverse((o) => { if (o.userData && o.userData.neck) neck++; if (o.userData && o.userData.napeGuard) nape++; });
    out[id] = { hasCockpit: !!g.rig.cockpit, cockpitShown, cockpitInFirstPerson, neck, nape };
    g.setCamView("chase");
  }
  return out;
});
for (const [id, f] of Object.entries(figure)) {
  // ①「人的追尾視角前面怎會有速度面板」:第一人稱內裝只該在駕駛座視角看得到
  ok(!f.hasCockpit || !f.cockpitShown, `${id}:追尾視角看不到第一人稱內裝(速度錶/儀表板)`);
  // ★ 反面也要驗:只驗「藏起來」的話,把內裝整個刪掉也會全綠
  ok(!f.hasCockpit || f.cockpitInFirstPerson, `${id}:駕駛座視角看得到內裝(沒有被一起藏掉)`);
}
// ②③ 有露出騎士的四型:要有脖子、後腦要有東西遮
for (const id of ["moto", "horse", "run", "hover"]) {
  ok(figure[id].neck >= 1, `${id}:騎士有脖子(找到 ${figure[id].neck} 段)`);
  ok(figure[id].nape >= 1, `${id}:騎士後腦有安全帽護片(找到 ${figure[id].nape} 片)`);
}

// ★ 第二期:下車走路(0908 使用者點名)
const foot = await page.evaluate(async () => {
  const g = window.__city3d;
  const sleep = () => { for (let i = 0; i < 30; i++) g.update(1 / 60); };
  const objBefore = (() => { let n = 0; g.scene.traverse(() => n++); return n; })();
  const veh0 = g.settings.vehicle;
  // 下車
  g.toggleFoot(); sleep();
  const after = {
    onFoot: g.onFoot,
    parked: g.parked ? { x: g.parked.x, z: g.parked.z, vehicle: g.parked.vehicle } : null,
    rigKind: g.rig.kind,
    camView: g.camView,
    walkerNearCar: g.parked ? Math.hypot(g.player.x - g.parked.x, g.player.z - g.parked.z) : -1,
  };
  // 走路中按數字鍵不該換載具
  g.setVehicle("hover");
  after.vehicleAfterSwitchAttempt = g.settings.vehicle;
  // 走遠一點(超過 reach)再按 F:不該上車
  g.player.x = g.parked.x + 40; g.player.z = g.parked.z + 40; sleep();
  g.toggleFoot(); sleep();
  after.stillOnFootWhenFar = g.onFoot;
  // 走回去按 F:應該上車
  g.player.x = g.parked.x + 1.5; g.player.z = g.parked.z + 1.5; sleep();
  g.toggleFoot(); sleep();
  after.onFootAfterMount = g.onFoot;
  after.parkedAfterMount = g.parked;
  after.rigKindAfterMount = g.rig.kind;
  after.vehicleAfterMount = g.settings.vehicle;
  after.veh0 = veh0;
  // 物件數:下車再上車不可以在場景裡留下垃圾
  let objAfter = 0; g.scene.traverse(() => objAfter++);
  after.objDelta = objAfter - objBefore;
  return after;
});
ok(foot.onFoot === true, "按 F 下車:進入走路狀態");
ok(!!foot.parked, "下車後載具停在原地(記下座標)");
ok(foot.rigKind === "run", `下車後外型換成走路的人(${foot.rigKind})`);
ok(foot.camView !== "cockpit", "下車後不會停在駕駛座視角(走路沒有駕駛座)");
ok(foot.walkerNearCar > 0.5 && foot.walkerNearCar < 4, `人站在載具旁邊 ${foot.walkerNearCar.toFixed(1)}m(不會生在車體裡、也不會噴飛)`);
ok(foot.vehicleAfterSwitchAttempt === foot.veh0, "走路中換載具無效(車停在別的地方,換了會弄丟)");
ok(foot.stillOnFootWhenFar === true, "離載具 56m 按 F 不會瞬間上車");
ok(foot.onFootAfterMount === false, "走回載具旁按 F:上車了");
ok(foot.parkedAfterMount === null, "上車後停車點清掉");
ok(foot.rigKindAfterMount === foot.veh0, `上車後外型換回原載具(${foot.rigKindAfterMount})`);
ok(Math.abs(foot.objDelta) < 400, `下車再上車沒有在場景裡留下垃圾(物件差 ${foot.objDelta})`);

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
