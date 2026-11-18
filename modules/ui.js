// 共用小工具：選取元素、跳脫文字、圖示、提示訊息、深淺色主題、手機本機設定

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// localStorage 在部分瀏覽器（無痕、內嵌瀏覽器）會丟錯，一律包起來
export function localGet(k) { try { return localStorage.getItem('lb:' + k); } catch { return null; } }
export function localSet(k, v) { try { v == null ? localStorage.removeItem('lb:' + k) : localStorage.setItem('lb:' + k, v); } catch {} }

/* ───────── 圖示（線條 SVG） ───────── */
const svg = (d, w = 22, sw = 1.9) => `<svg width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const ic = {
  sun: svg('<circle cx="12" cy="12" r="4.5"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>'),
  moon: svg('<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>'),
  back: svg('<path d="M15 6l-6 6 6 6"/>', 24, 2),
  chev: svg('<path d="M9 6l6 6-6 6"/>', 18, 2),
  plus: svg('<path d="M12 5v14M5 12h14"/>', 22, 2.2),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 16, 3),
  edit: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>', 18),
  out: svg('<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>', 18),
  car: svg('<path d="M5 16V11l2-5h10l2 5v5M3 16h18M7 19.5v-3M17 19.5v-3"/><circle cx="7.5" cy="13" r=".8"/><circle cx="16.5" cy="13" r=".8"/>', 18),
  passport: svg('<rect x="5" y="3" width="14" height="18" rx="2"/><circle cx="12" cy="10" r="3"/><path d="M9 16.5h6"/>', 18),
  image: svg('<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M20.5 16l-5-5-8 8.5"/>', 18),
  google: '<svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>',
  copy: svg('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>', 18),
  // 測驗選項
  sunset: svg('<path d="M3 17h18M6.5 17a5.5 5.5 0 0 1 11 0M12 6.5V4.5M6.3 9.3 4.9 7.9M17.7 9.3l1.4-1.4M7 20.5h10"/>'),
  flower: svg('<path d="M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>'),
  cup: svg('<path d="M5 10h11v4a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5zM16 11h1.5a2.5 2.5 0 0 1 0 5H16M9 4.5c0 1.2 1 1.2 1 2.5M12.5 4.5c0 1.2 1 1.2 1 2.5"/>'),
  wave: svg('<path d="M3 9c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2c1.5 0 2.2.7 3 1.3M3 15c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2c1.5 0 2.2.7 3 1.3"/>'),
  blossom: svg('<path d="M12 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM12 10.5C10.5 8 11 5 12 4c1 1 1.5 4 0 6.5M13.5 12c2.5-1.5 5.5-1 6.5 0-1 1-4 1.5-6.5 0M12 13.5c1.5 2.5 1 5.5 0 6.5-1-1-1.5-4 0-6.5M10.5 12C8 13.5 5 13 4 12c1-1 4-1.5 6.5 0"/>'),
  door: svg('<path d="M6 21V4h12v17M4 21h16M14.5 12.5h.01"/>')
};

/* ───────── 提示訊息 ───────── */
let toastTimer;
export function toast(msg) {
  let el = $('#toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

/* ───────── 深淺色主題 ───────── */
// 預設跟著手機設定；按右上角切換後，記在這支手機上
const mq = matchMedia('(prefers-color-scheme: dark)');
export function currentTheme() {
  const saved = localGet('theme');
  return saved === 'dark' || saved === 'light' ? saved : (mq.matches ? 'dark' : 'light');
}
export const isDark = () => currentTheme() === 'dark';
export function applyTheme() {
  const t = currentTheme();
  document.documentElement.dataset.theme = t;
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.content = t === 'dark' ? '#121821' : '#F7F4EC';
}
export function toggleTheme() { localSet('theme', isDark() ? 'light' : 'dark'); applyTheme(); }
mq.addEventListener?.('change', () => { if (!localGet('theme')) applyTheme(); });

export async function copyText(t) {
  try { await navigator.clipboard.writeText(t); toast('已複製'); }
  catch { prompt('請手動複製：', t); }
}
