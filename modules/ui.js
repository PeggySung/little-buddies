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
  pin: svg('<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>', 20),
  food: svg('<path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M16 21V3c-2.2 1-3.5 3.5-3.5 7v3H16"/>', 20),
  bed: svg('<path d="M3 18V7M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5"/><circle cx="7" cy="11" r="1.8"/>', 20),
  move: svg('<path d="M3.5 16.5V13l2.2-5h9.1l3.7 5h1.9a1.1 1.1 0 0 1 1.1 1.1v2.4h-2M7.6 16.5h6.8M3.5 16.5h1.4"/><circle cx="6.3" cy="16.8" r="1.9"/><circle cx="16.4" cy="16.8" r="1.9"/><path d="M9.6 8v5M5 13h13.5"/>', 20),
  info: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.6v.2"/>', 20),
  walk: svg('<circle cx="13" cy="4.5" r="1.8"/><path d="M10 21l2-6 3 3v3M9 12l2-4 4 3 3 1M11 8l-3 2v3"/>', 18),
  clock: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>', 14),
  coin: svg('<circle cx="12" cy="12" r="8.5"/><path d="M9.5 9.5h4a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3h4M12 7.5v1.5M12 15.5V17"/>', 14),
  map: svg('<path d="M9 4 3 6.5v13L9 17l6 2.5 6-2.5V4l-6 2.5z M9 4v13M15 6.5v13"/>', 16),
  nav: svg('<path d="M4 11.5 20 4l-7.5 16-2-6.5z"/>', 16),
  home: svg('<path d="M4 10.5 12 4l8 6.5V20h-5v-5.5H9V20H4z"/>', 20),
  trip: svg('<path d="M4 6.5h16M4 12h10M4 17.5h13"/>', 20),
  ticket: svg('<path d="M4 8a2 2 0 0 0 2-2h12a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H6a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4zM10 6v12"/>', 20),
  list: svg('<path d="M9 7h11M9 12h11M9 17h11M4.5 7l1 1 2-2M4.5 12l1 1 2-2M4.5 17l1 1 2-2"/>', 20),
  bag: svg('<path d="M6 8h12l-1 12H7L6 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>', 20, 2),
  chevUD: svg('<path d="M8 9l4-4 4 4M8 15l4 4 4-4"/>', 16, 2.2),
  money: svg('<path d="M4 7h16v11H4zM4 10.5h16M8 14.5h3"/>', 20),
  // 底部分頁（11/20 選定：i 資訊、路線、拉桿行李箱、打勾板夾、收據）
  tabRoute: svg('<circle cx="6" cy="18.5" r="2.2"/><circle cx="18" cy="5.5" r="2.2"/><path d="M8.2 18.5h7.3a3.25 3.25 0 0 0 0-6.5h-7a3.25 3.25 0 0 1 0-6.5h7.3"/>', 20),
  tabBag: svg('<path d="M10 6V3h4v3"/><rect x="6" y="6" width="12" height="13" rx="2.5"/><path d="M10 10v5M14 10v5"/><circle cx="8.5" cy="21" r="1"/><circle cx="15.5" cy="21" r="1"/>', 20),
  tabClip: svg('<rect x="5" y="4.5" width="14" height="16.5" rx="2.5"/><rect x="9" y="2.5" width="6" height="3.5" rx="1"/><path d="M9 13.2l2.2 2.2 4.3-4.4"/>', 20),
  tabReceipt: svg('<path d="M6 3h12v18l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4L6 21z"/><path d="M9.5 8h5M9.5 11.5h5M9.5 15h3"/>', 20),
  sort: svg('<path d="M8 4v16M4.5 7.5 8 4l3.5 3.5M16 20V4M12.5 16.5 16 20l3.5-3.5"/>', 16),
  grip: svg('<circle cx="9" cy="6" r="1.3"/><circle cx="15" cy="6" r="1.3"/><circle cx="9" cy="12" r="1.3"/><circle cx="15" cy="12" r="1.3"/><circle cx="9" cy="18" r="1.3"/><circle cx="15" cy="18" r="1.3"/>', 20),
  up: svg('<path d="M6 15l6-6 6 6"/>', 20, 2.2),
  down: svg('<path d="M6 9l6 6 6-6"/>', 20, 2.2),
  lock: svg('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>', 16, 2),
  phone: svg('<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1"/>', 16),
  // 測驗選項
  sunset: svg('<path d="M3 17h18M6.5 17a5.5 5.5 0 0 1 11 0M12 6.5V4.5M6.3 9.3 4.9 7.9M17.7 9.3l1.4-1.4M7 20.5h10"/>'),
  flower: svg('<path d="M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>'),
  cup: svg('<path d="M5 10h11v4a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5zM16 11h1.5a2.5 2.5 0 0 1 0 5H16M9 4.5c0 1.2 1 1.2 1 2.5M12.5 4.5c0 1.2 1 1.2 1 2.5"/>'),
  wave: svg('<path d="M3 9c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2c1.5 0 2.2.7 3 1.3M3 15c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2c1.5 0 2.2.7 3 1.3"/>'),
  blossom: svg('<path d="M11.25 10.89C8.5 6.24 9.41 3.26 10.56 3.21L12 4.4L13.44 3.21C14.59 3.26 15.5 6.24 12.75 10.89M13.11 11.15C16.68 7.1 19.79 7.04 20.2 8.12L19.51 9.86L21.09 10.86C21.39 11.97 18.85 13.76 13.58 12.58M13.44 13C18.39 15.15 19.41 18.09 18.51 18.81L16.64 18.69L16.18 20.5C15.21 21.13 12.73 19.26 12.22 13.88M11.78 13.88C11.27 19.26 8.79 21.13 7.82 20.5L7.36 18.69L5.49 18.81C4.59 18.09 5.61 15.15 10.56 13M10.42 12.58C5.15 13.76 2.61 11.97 2.91 10.86L4.49 9.86L3.8 8.12C4.21 7.04 7.32 7.1 10.89 11.15M12 11.7v1.2"/>'),
  door: svg('<path d="M6 21V4h12v17M4 21h16M14.5 12.5h.01"/>'),
  firework: svg('<path d="M12 9L12 3M14.12 9.88L16.45 7.55M18.36 5.64h.01M15 12L21 12M14.12 14.12L16.45 16.45M18.36 18.36h.01M12 15L12 21M9.88 14.12L7.55 16.45M5.64 18.36h.01M9 12L3 12M9.88 9.88L7.55 7.55M5.64 5.64h.01"/>', 22, 2.1),
  cloud: svg('<path d="M7 18h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.1 11.1 3.5 3.5 0 0 0 7 18z"/>'),
  pudding: svg('<path d="M10 5h4q1.4 0 1.8 1.35c.9 3 2 6.5 2.6 10.1q.3 1.55-1.15 1.55H6.75q-1.45 0-1.15-1.55c.6-3.6 1.7-7.1 2.6-10.1Q8.6 5 10 5z"/><path d="M10 5h4q1.4 0 1.8 1.35l.7 2.65q-4.5 3.4-9 0l.7-2.65Q8.6 5 10 5z" fill="currentColor"/>', 22, 2.1),
  leaf: svg('<path d="M5 19c0-8 5-14 15-14 0 10-6 15-14 15M5 19l8-8"/>'),
  sprig: svg('<path d="M12 21V4M12 7.5 9.8 5.3M12 7.5l2.2-2.2M12 11.5 9.3 8.8M12 11.5l2.7-2.7M12 15.5l-2.7-2.7M12 15.5l2.7-2.7"/>')
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

/* ───────── 24 小時制時間欄位 ─────────
   <time-24 id="x" value="14:30">：點了跳出 app 自己畫的時間選擇（左邊選時 00–23、右邊選分 00–59），
   不用手機內建的下拉選單（Android 每次打開長得不一樣），也不會跑出上午／下午。
   用法和 <input type="time"> 一樣：.value、input／change 事件。 */
const pad2 = n => String(n).padStart(2, '0');
class Time24 extends HTMLElement {
  connectedCallback() {
    if (this._ready) return; this._ready = true;
    this._label = this.getAttribute('aria-label') || '時間';
    this._v = '';
    this.innerHTML = '<button type="button" class="t24-btn"></button>';
    this._btn = this.firstElementChild;
    this.value = this.getAttribute('value') || '';
    this._btn.addEventListener('click', () => this._open());
  }
  _sync() {
    this.classList.toggle('empty', !this._v);
    this._btn.textContent = this._v || '--:--';
    this._btn.setAttribute('aria-label', `${this._label}：${this._v || '未選'}，點一下選時間`);
  }
  get value() { return this._ready ? this._v : this.getAttribute('value') || ''; }
  set value(v) {
    const m = /^(\d{1,2}):(\d{2})/.exec(v || '');
    const s = m && +m[1] < 24 ? `${pad2(+m[1])}:${pad2(Math.min(59, +m[2]))}` : '';
    if (!this._ready) { this.setAttribute('value', s); return; }
    this._v = s; this._sync();
  }
  focus() { this._btn?.focus(); }
  _open() {
    let [h, m] = this._v ? this._v.split(':') : ['', ''];
    const col = (key, n, cur, name) => `<div class="t24-col" role="listbox" aria-label="${name}" data-col="${key}">${Array.from({ length: n }, (_, i) => pad2(i))
      .map(x => `<button type="button" role="option" data-v="${x}" aria-selected="${x === cur}">${x}</button>`).join('')}</div>`;
    const bg = document.createElement('div');
    bg.className = 'dlg-bg t24-bg';
    bg.innerHTML = `<div class="dlg t24-dlg" role="dialog" aria-modal="true" aria-label="${esc(this._label)}">
      <div class="t24-head"><b>${esc(this._label)}</b><span class="t24-now num"></span></div>
      <div class="t24-cols"><div><span class="tiny faint">時</span>${col('h', 24, h, '時')}</div><span class="t24-colon" aria-hidden="true">:</span><div><span class="tiny faint">分</span>${col('m', 60, m, '分')}</div></div>
      <div class="t24-acts"><button type="button" class="btn" data-act="clear">清除</button><button type="button" class="btn pri" data-act="ok">完成</button></div></div>`;
    document.body.appendChild(bg);
    const now = bg.querySelector('.t24-now');
    const show = () => { now.textContent = h ? `${h}:${m || '00'}` : '--:--'; };
    const pick = (key, v) => {
      if (key === 'h') { h = v; if (!m) m = '00'; } else { m = v; if (!h) h = '00'; }
      bg.querySelectorAll('[data-col] [data-v]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.v === (b.parentNode.dataset.col === 'h' ? h : m))));
      show();
    };
    // 打開時把選到的（沒選就用 09 點、00 分）捲到中間
    const center = (key, v) => { const c = bg.querySelector(`[data-col="${key}"]`), b = c.querySelector(`[data-v="${v}"]`); if (b) c.scrollTop = b.offsetTop - c.offsetTop - (c.clientHeight - b.offsetHeight) / 2; };
    center('h', h || '09'); center('m', m || '00'); show();
    const close = () => { bg.remove(); this._btn.focus({ preventScroll: true }); };
    const commit = v => {
      close();
      if (v === this._v) return;
      this._v = v; this._sync();
      this.dispatchEvent(new Event('input', { bubbles: true })); this.dispatchEvent(new Event('change', { bubbles: true }));
    };
    bg.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) { if (e.target === bg) close(); return; }
      if (b.dataset.v) pick(b.parentNode.dataset.col, b.dataset.v);
      else if (b.dataset.act === 'clear') commit('');
      else if (b.dataset.act === 'ok') commit(h ? `${h}:${m || '00'}` : this._v);
    });
    bg.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
    (bg.querySelector('[data-col="h"] [aria-selected="true"]') || bg.querySelector('[data-act="ok"]')).focus({ preventScroll: true });
  }
}
if (!customElements.get('time-24')) customElements.define('time-24', Time24);

/* ───────── 分頁切換動畫 ─────────
   畫面是整段重畫的，所以點分頁時先記住舊的選取位置（tabFrom），
   重畫完再讓底塊／底線從舊位置滑到新位置、內容淡入上浮（tabSlide）。
   只有自己點分頁才會動，資料同步造成的重畫不會動。 */
const tabMem = new Map();
export function tabFrom(btn) {
  const list = btn.closest('[role="tablist"]'), cur = list && list.querySelector('[aria-selected="true"]');
  if (cur) tabMem.set(list.getAttribute('aria-label'), { r: cur.getBoundingClientRect(), sl: list.scrollLeft });
}
export function tabSlide(root = document) {
  root.querySelectorAll('[role="tablist"]').forEach(list => {
    const key = list.getAttribute('aria-label'), m = tabMem.get(key); if (!m) return;
    tabMem.delete(key);
    list.scrollLeft = m.sl;
    const cur = list.querySelector('[aria-selected="true"]'); if (!cur) return;
    const r = cur.getBoundingClientRect(), dx = m.r.left - r.left;
    if (Math.abs(dx) < 1) return;
    cur.style.setProperty('--tx', dx + 'px');
    cur.style.setProperty('--ts', r.width ? m.r.width / r.width : 1);
    cur.classList.add('slid');
    let n = list.nextElementSibling;
    while (n) { n.classList.add('tab-in'); n = n.nextElementSibling; }
  });
}

/* 底部旅程分頁換頁：點的時候記住舊的淡黃底塊位置（navFrom），
   新頁畫好後讓底塊滑過來、圖示輕輕彈一下，中間內容淡入上浮（navSlide）。
   上面的標題列不動。 */
let navMem = null;
export function navFrom() {
  const on = document.querySelector('.tabbar .on .pill');
  navMem = on ? on.getBoundingClientRect() : null;
}
export function navSlide() {
  const m = navMem; navMem = null;
  const pill = m && document.querySelector('.tabbar .on .pill');
  const dx = pill ? m.left - pill.getBoundingClientRect().left : 0;
  // 不是點底部頁籤（例如從首頁點進旅程、新增旅行、回首頁）：整頁淡入上浮
  if (Math.abs(dx) < 1) { document.querySelector('#main > .wrap')?.classList.add('tab-in'); return; }
  pill.style.setProperty('--tx', dx + 'px');
  pill.classList.add('slid');
  document.querySelectorAll('#main .wrap > :not(header.top)').forEach(el => el.classList.add('tab-in'));
}

/* ───────── 分類收合／展開動畫 ─────────
   收合：先把清單高度縮到 0、箭頭轉過去，動畫跑完才重畫。
   展開：重畫後新的清單從 0 長到原本的高度、淡入，箭頭轉回來。 */
const noMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const gapOf = el => parseFloat(getComputedStyle(el.parentElement).rowGap) || 0;
export function foldOut(btns, done) {
  const lists = btns.map(b => { b.setAttribute('aria-expanded', 'false'); return b.closest('.sec')?.querySelector('.ck-list'); }).filter(Boolean);
  if (!lists.length || noMotion()) return done();
  let left = lists.length;
  lists.forEach(l => {
    l.style.overflow = 'hidden';
    l.animate([{ height: l.offsetHeight + 'px', opacity: 1, marginTop: '0px' }, { height: '0px', opacity: 0, marginTop: -gapOf(l) + 'px' }],
      { duration: 220, easing: 'cubic-bezier(.4,0,.6,1)', fill: 'forwards' }).finished.then(() => { if (!--left) done(); }, () => { if (!--left) done(); });
  });
}
export function foldIn(btns) {
  if (noMotion()) return;
  btns.forEach(b => {
    b.querySelector('svg')?.animate([{ transform: 'rotate(-90deg)' }, { transform: 'none' }], { duration: 200, easing: 'ease-out' });
    const l = b.closest('.sec')?.querySelector('.ck-list'); if (!l) return;
    l.style.overflow = 'hidden';
    l.animate([{ height: '0px', opacity: 0, marginTop: -gapOf(l) + 'px' }, { height: l.offsetHeight + 'px', opacity: 1, marginTop: '0px' }],
      { duration: 260, easing: 'cubic-bezier(.2,.8,.25,1)' }).finished.then(() => { l.style.overflow = ''; }, () => {});
  });
}

/* ───────── 進度條順滑增減 ─────────
   畫面整段重畫時進度條是新的元素，CSS 的 transition 不會動；
   這裡記住每條進度條上次的百分比，重畫後從舊的長度滑到新的長度。 */
const barMem = new Map();
export function animateBars(root, scope) {
  root.querySelectorAll('.bar[role="progressbar"]').forEach(b => {
    const k = scope + '|' + b.getAttribute('aria-label'), now = +b.getAttribute('aria-valuenow'), prev = barMem.get(k);
    barMem.set(k, now);
    const i = b.firstElementChild;
    if (prev == null || prev === now || !i || noMotion()) return;
    i.animate([{ width: prev + '%' }, { width: now + '%' }], { duration: 450, easing: 'cubic-bezier(.2,.8,.25,1)' });
  });
}
