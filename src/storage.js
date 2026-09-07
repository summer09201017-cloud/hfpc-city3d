// storage.js —— 選單偏好(載具/車色/車速檔/行人開關),localStorage 全包 try/catch。
// ★ 鍵名一定要是自己的:沿用 racing3d 的鍵,兩站將來若同網域就會互相覆蓋對方的偏好。
const KEY = "city3d-settings-v1";

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" ? obj : {};
  } catch { return {}; }
}

export function saveSettings(patch) {
  try {
    const cur = loadSettings();
    localStorage.setItem(KEY, JSON.stringify({ ...cur, ...patch }));
  } catch { /* Safari 私密模式等:靜默 */ }
}
