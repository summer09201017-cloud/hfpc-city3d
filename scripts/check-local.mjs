// check-local.mjs —— 一鍵:起 vite preview(4180)→ 等它活 → 跑 browser-check → 關掉。
import { spawn } from "node:child_process";
const PORT = process.env.PORT || 4180;
const preview = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], { stdio: "ignore", shell: true });
const url = `http://localhost:${PORT}/`;
let up = false;
for (let i = 0; i < 80 && !up; i++) {
  try { const r = await fetch(url); up = r.ok; } catch { await new Promise((r) => setTimeout(r, 250)); }
}
if (!up) { console.error("preview 沒起來"); preview.kill(); process.exit(2); }
const check = spawn(process.execPath, ["scripts/browser-check.mjs"], { stdio: "inherit", env: { ...process.env, CHECK_URL: url } });
check.on("exit", (code) => {
  // shell:true 起的 preview 要連子行程一起關(Windows 用 taskkill /T)
  if (process.platform === "win32") spawn("taskkill", ["/pid", String(preview.pid), "/T", "/F"], { stdio: "ignore" });
  else preview.kill();
  setTimeout(() => process.exit(code ?? 1), 300);
});
