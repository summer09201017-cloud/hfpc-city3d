// 📲 簡易 SW(baseball3d 家族範式):全部 network-first、斷網退 cache。
// ★ 殼層(index.html / manifest / icon / sw 自己)有改就 bump 這個號碼(static-pwa-ship 鐵則)。
const CACHE = "city3d-v1a";  // v1a 2026-09-08:人物修正(安全帽/脖子/頭位置/內裝可見性)
self.addEventListener("install", () => { self.skipWaiting(); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
});
self.addEventListener("message", (e) => {
  if (e && e.data === "GET_VERSION" && e.source) e.source.postMessage({ type: "SW_VERSION", v: CACHE });
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req)),
  );
});
