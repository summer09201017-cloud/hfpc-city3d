// confetti.js —— 零相依過關彩帶(win-confetti 範式原樣收割)。celebrate() 放一陣紙花從上灑落,自己清乾淨。
// 尊重 prefers-reduced-motion(會暈的孩子:直接 no-op);canvas pointer-events:none 不擋按鈕;
// ★ 有結算卡就用 origin:'top'(center 會在卡片正中央聚成一團蓋住成績——0901 紙牌桌實錘)。
const COLORS = ["#ffd479", "#ff7a59", "#5ec5c5", "#7ec850", "#b18cff", "#ff9ec4", "#ffffff"];

export function celebrate(opts = {}) {
  const { count = 140, duration = 2200, origin = "top", spread = 1, zIndex = 9999 } = opts;
  if (typeof document === "undefined") return () => {};
  const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) return () => {};

  const cv = document.createElement("canvas");
  cv.setAttribute("data-confetti", "1");
  cv.style.cssText = `position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:${zIndex}`;
  document.body.appendChild(cv);
  const ctx = cv.getContext("2d");
  let dpr = Math.min(devicePixelRatio || 1, 2);
  const resize = () => { dpr = Math.min(devicePixelRatio || 1, 2); cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; };
  resize(); addEventListener("resize", resize);

  const W = () => innerWidth, H = () => innerHeight;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const parts = [];
  function spawn() {
    const fromCenter = origin === "center";
    const x = fromCenter ? W() / 2 : rnd(0, W());
    const y = fromCenter ? H() / 2 : rnd(-40, -10);
    const ang = fromCenter ? rnd(0, Math.PI * 2) : rnd(Math.PI * 0.35, Math.PI * 0.65);
    const spd = fromCenter ? rnd(4, 10) : rnd(2, 5);
    parts.push({
      x, y,
      vx: Math.cos(ang) * spd * spread * (fromCenter ? 1 : rnd(-1, 1)),
      vy: fromCenter ? Math.sin(ang) * spd : spd,
      w: rnd(6, 11), h: rnd(8, 15),
      rot: rnd(0, Math.PI * 2), vr: rnd(-0.25, 0.25),
      color: COLORS[(Math.random() * COLORS.length) | 0],
      sway: rnd(0, Math.PI * 2),
    });
  }

  const t0 = performance.now();
  let raf = 0, alive = true;
  function frame(now) {
    if (!alive) return;
    const elapsed = now - t0;
    if (elapsed < duration) for (let i = 0; i < count / 26; i++) spawn();
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.save(); ctx.scale(dpr, dpr);
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.vy += 0.12;
      p.sway += 0.05;
      p.x += p.vx + Math.sin(p.sway) * 0.6;
      p.y += p.vy;
      p.rot += p.vr;
      p.vx *= 0.99;
      if (p.y > H() + 20) { parts.splice(i, 1); continue; }
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    ctx.restore();
    if (elapsed >= duration && parts.length === 0) return cleanup();
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  function cleanup() {
    alive = false;
    cancelAnimationFrame(raf);
    removeEventListener("resize", resize);
    cv.remove();
  }
  return cleanup;
}
