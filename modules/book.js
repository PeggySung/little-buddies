// 交通住宿：航班、火車／巴士、住宿、租車
import { doc, collection, onSnapshot, setDoc, updateDoc, deleteDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { $, $$, esc, ic, toast, copyText } from './ui.js';
import { avatarHTML } from './profile.js';
import { kindIcon, openSheet, closeSheet } from './plan.js';
import { timeZones } from './places.js';

export const TYPES = {
  flight:  { label: '航班', icon: 'flight', go: true },
  transit: { label: '火車／巴士', icon: 'train', go: true },
  stay:    { label: '住宿', icon: 'stay', go: false },
  rental:  { label: '租車', icon: 'move', go: true }
};
const W = ['日', '一', '二', '三', '四', '五', '六'];
const mapsSearch = q => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
const mapsDir = (q, mode = 'driving') => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}&travelmode=${mode}`;
const safeUrl = u => (/^https?:\/\//i.test(u || '') ? u : '');
const md = d => (d ? `${+d.slice(5, 7)}/${+d.slice(8)}（${W[new Date(d + 'T00:00:00Z').getUTCDay()]}）` : '');
const typeIcon = b => kindIcon(b.type === 'transit' ? (b.mode === 'bus' ? 'bus' : 'train') : TYPES[b.type].icon, TYPES[b.type].go);

/* ───────── 時區換算：算飛行時間用 ───────── */
function tzOffsetMin(tz, utcMs) {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(new Date(utcMs)).map(x => [x.type, x.value]));
    return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - utcMs) / 60000;
  } catch { return 0; }
}
function zonedMs(date, time, tz) {
  if (!date || !time) return null;
  const guess = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), +time.slice(0, 2), +time.slice(3, 5));
  return guess - tzOffsetMin(tz, guess - tzOffsetMin(tz, guess) * 60000) * 60000;
}
function flightMinutes(b) {
  const a = zonedMs(b.depDate, b.depTime, b.depTz), z = zonedMs(b.arrDate || b.depDate, b.arrTime, b.arrTz);
  return a != null && z != null && z > a ? Math.round((z - a) / 60000) : null;
}
const hm = m => `${Math.floor(m / 60) ? Math.floor(m / 60) + ' 小時 ' : ''}${m % 60 ? (m % 60) + ' 分' : ''}`.trim();
// 火車巴士的車程：用出發、抵達時間算（抵達比出發早就當作隔天到；有填抵達日期就照日期算）
function transitMinutes(b) {
  const t = v => (/^\d{1,2}:\d{2}$/.test(v || '') ? +v.split(':')[0] * 60 + +v.split(':')[1] : null);
  const a = t(b.depTime), z = t(b.arrTime);
  if (a == null || z == null) return null;
  const days = b.arrDate && b.depDate ? Math.max(0, Math.round((Date.parse(b.arrDate) - Date.parse(b.depDate)) / 86400000)) : z < a ? 1 : 0;
  const m = z + days * 1440 - a;
  return m > 0 && m < 3 * 1440 ? m : null;
}
// 路線中段：一串小圓點加一個小箭頭，下面是時間
const CHEV = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
const routeMid = mins => `<div class="mid"><div class="trk" aria-hidden="true"><span class="dots"></span><span class="chev">${CHEV}</span></div>${mins ? `<span class="tiny faint">${esc(hm(mins))}</span>` : ''}</div>`;
function nights(a, b) { if (!a || !b) return null; const n = Math.round((Date.parse(b) - Date.parse(a)) / 86400000); return n > 0 ? n : null; }

// 排序用的開始時間
const startKey = b => ({ flight: (b.depDate || '') + (b.depTime || ''), transit: (b.depDate || '') + (b.depTime || ''),
  stay: (b.inDate || '') + (b.inTime || ''), rental: (b.pickDate || '') + (b.pickTime || '') }[b.type] || '');
const startDate = b => ({ flight: b.depDate, transit: b.depDate, stay: b.inDate, rental: b.pickDate }[b.type] || '');

/* ───────── 即時資料 ───────── */
const cache = {};
export function watchBookings(ctx, tripId, onChange) {
  const c = cache[tripId] || (cache[tripId] = { list: null, unsub: null, listeners: new Set() });
  c.listeners.add(onChange);
  if (!c.unsub) {
    c.unsub = onSnapshot(collection(ctx.S.db, 'trips', tripId, 'bookings'), snap => {
      c.list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      c.listeners.forEach(f => f());
    }, e => { console.error(e); toast('讀取交通住宿失敗：' + (e?.code || e?.message)); });
  }
  return () => c.listeners.delete(onChange);
}
export function stopAllBookings() { Object.values(cache).forEach(c => c.unsub?.()); Object.keys(cache).forEach(k => delete cache[k]); }

/* ───────── 給行程頁用：某一天的交通住宿事件 ───────── */
export function bookingEvents(tripId, date) {
  const out = [];
  (cache[tripId]?.list || []).forEach(b => {
    const ev = (start, end, title, sub, icon, go) => out.push({ id: `bk-${b.id}-${out.length}`, bid: b.id, start: start || '', end: end || '', title, sub, icon, go });
    if (b.type === 'flight') {
      const no = [b.airline, b.no].filter(Boolean).join(' ');
      if (b.depDate === date) ev(b.depTime, (b.arrDate || b.depDate) === date ? b.arrTime : '', `起飛 ${no}`.trim(), `${b.from || ''} → ${b.to || ''}${b.depTerm ? `・${b.depTerm}` : ''}`, 'flight', true);
      if ((b.arrDate || '') && b.arrDate !== b.depDate && b.arrDate === date) ev(b.arrTime, '', `抵達 ${no}`.trim(), `${b.from || ''} → ${b.to || ''}${b.arrTerm ? `・${b.arrTerm}` : ''}`, 'flight', true);
    } else if (b.type === 'transit') {
      const icon = b.mode === 'bus' ? 'bus' : 'train';
      if (b.depDate === date) ev(b.depTime, (b.arrDate || b.depDate) === date ? b.arrTime : '', `${b.no || (b.mode === 'bus' ? '巴士' : '火車')} 出發`, `${b.from || ''} → ${b.to || ''}`, icon, true);
    } else if (b.type === 'stay') {
      if (b.inDate === date) ev(b.inTime, '', `入住 ${b.name || ''}`.trim(), b.address || '', 'stay', false);
      if (b.outDate === date) ev(b.outTime, '', `退房 ${b.name || ''}`.trim(), b.address || '', 'stay', false);
    } else if (b.type === 'rental') {
      if (b.pickDate === date) ev(b.pickTime, '', `取車 ${b.company || ''}`.trim(), b.pickPlace || '', 'move', true);
      if (b.retDate === date) ev(b.retTime, '', `還車 ${b.company || ''}`.trim(), b.retPlace || '', 'move', true);
    }
  });
  return out;
}

// 給天氣判斷地區用：某一天交通住宿裡的文字；stays 是當晚住的地方（入住日 ≤ 這天 < 退房日）
export function dayTexts(tripId, date) {
  const texts = bookingEvents(tripId, date).map(e => `${e.title} ${e.sub}`);
  const stays = (cache[tripId]?.list || []).filter(b => b.type === 'stay' && b.inDate && b.inDate <= date && (!b.outDate || date < b.outDate))
    .map(b => `${b.name || ''} ${b.address || ''}`);
  return { texts: [...texts, ...stays], stays };
}

/* ───────── 列表 ───────── */
export function renderBook(ctx, t, focusId) {
  const list = cache[t.id]?.list;
  const host = $('#bookBody'); if (!host) return;
  if (list == null) { host.innerHTML = '<div class="spinner" style="margin:30px auto" role="status" aria-label="載入中"></div>'; return; }
  const sorted = [...list].sort((a, b) => startKey(a).localeCompare(startKey(b)));
  const groups = [];
  sorted.forEach(b => { const d = startDate(b) || ''; const g = groups.find(x => x.d === d); g ? g.items.push(b) : groups.push({ d, items: [b] }); });
  host.innerHTML = `
    <div class="dayhead"><h2 class="title">交通住宿</h2><span class="small muted" style="flex:1">航班、火車巴士、住宿、租車都放這裡</span></div>
    ${list.length ? groups.map(g => `<section class="sec"><h3 class="sec-h">${g.d ? esc(md(g.d)) : '未填日期'}</h3>${g.items.map(b => cardHTML(t, b)).join('')}</section>`).join('')
      : '<div class="card empty"><p class="small muted" style="margin:0">還沒有交通住宿。按下面的按鈕新增航班、住宿或租車，日期和時間也會自動出現在每天的行程裡。</p></div>'}
    <button class="btn full" id="addBk">${ic.plus}新增交通住宿</button>`;
  $('#addBk').addEventListener('click', () => chooseType(ctx, t));
  $$('[data-bedit]', host).forEach(b => b.addEventListener('click', () => editBooking(ctx, t, list.find(x => x.id === b.dataset.bedit))));
  $$('[data-copy]', host).forEach(b => b.addEventListener('click', () => copyText(b.dataset.copy)));
  if (focusId) {
    const el = document.getElementById('bk-' + focusId);
    if (el) { el.classList.add('flash'); setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100); }
  }
}

function membersRow(t, b) {
  const ids = (b.members && b.members.length ? b.members : t.memberUids || []).filter(u => t.members?.[u]);
  if (!ids.length) return '';
  return `<div class="stack">${ids.slice(0, 8).map(u => avatarHTML(t.members[u], 'sm')).join('')}</div>`;
}
function commonBottom(t, b) {
  const notes = (b.note || '').split('\n').map(l => l.trim()).filter(Boolean);
  const link = safeUrl(b.link);
  const meta = `${b.confirm ? `<button class="btn sm" data-copy="${esc(b.confirm)}" aria-label="複製訂位代號 ${esc(b.confirm)}">${ic.copy}<span class="num">${esc(b.confirm)}</span></button>` : ''}
        ${link ? `<a class="btn sm" href="${esc(link)}" target="_blank" rel="noopener">${ic.ticket}訂單</a>` : ''}
        ${b.price ? `<span class="small muted bk-price">${ic.coin}${esc(b.price)}</span>` : ''}`.trim();
  const mem = membersRow(t, b);
  // 底部一排：旅伴頭像靠左，訂位代號、訂單、金額靠右（編輯按鈕在卡片右上角）
  return `${notes.length ? `<div class="bk-notes">${notes.map(n => `<p>${esc(n)}</p>`).join('')}</div>` : ''}
    ${mem || meta ? `<div class="bk-foot">${mem}${meta ? `<div class="bk-meta">${meta}</div>` : ''}</div>` : ''}`;
}
// 卡片標題列：類型圖示＋名稱＋小字，右上角是編輯按鈕
function bkHead(b, title, sub) {
  return `<div class="bk-head">${typeIcon(b)}<div class="bk-title"><b>${title}</b>${sub ? `<div class="tiny faint">${sub}</div>` : ''}</div>
    <button class="iconbtn bk-edit" data-bedit="${esc(b.id)}" aria-label="編輯">${ic.edit}</button></div>`;
}
// 入住／退房、取車／還車：上面一行小字（入住・日期），下面大字是時間；兩格中間一個小箭頭
const ARROW = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6"/></svg>';
function ioBox(label, date, time, place) {
  return `<div class="bk-pt">
      <span class="bk-dl"><span>${label}</span>${time ? `<span class="num">${esc(md(date))}</span>` : ''}</span>
      ${time ? `<b class="bk-tm num">${esc(time)}</b>` : `<b class="bk-dt num">${esc(md(date))}</b>`}
      ${place ? `<span class="tiny muted">${esc(place)}</span>` : ''}</div>`;
}
const ioRow = (a, z) => `<div class="bk-io">${a}<span class="bk-arr">${ARROW}</span>${z}</div>`;
function outOfTrip(t, b) {
  return ['depDate', 'arrDate', 'inDate', 'outDate', 'pickDate', 'retDate'].some(k => b[k] && (b[k] < t.start || b[k] > t.end));
}
function cardHTML(t, b) {
  const html = cardInner(t, b);
  return outOfTrip(t, b) ? html.replace('</article>', `<p class="warn" style="margin:0">日期不在旅程期間（${esc(md(t.start))} – ${esc(md(t.end))}）內，請編輯修正。</p></article>`) : html;
}
function cardInner(t, b) {
  if (b.type === 'flight') {
    const mins = flightMinutes(b);
    const nextDay = b.arrDate && b.depDate && b.arrDate > b.depDate ? `<sup>+${nights(b.depDate, b.arrDate)}</sup>` : '';
    return `<article class="card bk pass" id="bk-${esc(b.id)}">
      ${bkHead(b, esc([b.airline, b.no].filter(Boolean).join(' ') || '航班'), `${esc(md(b.depDate))}${b.seats ? `・座位 ${esc(b.seats)}` : ''}`)}
      <div class="route">
        <div class="end"><div class="code num">${esc(b.from || '—')}</div><div class="tiny muted">${esc(b.fromName || '')}${b.depTerm ? `・${esc(b.depTerm)}` : ''}</div><div class="tm num">${esc(b.depTime || '')}</div></div>
        ${routeMid(mins)}
        <div class="end" style="text-align:right"><div class="code num">${esc(b.to || '—')}</div><div class="tiny muted">${esc(b.toName || '')}${b.arrTerm ? `・${esc(b.arrTerm)}` : ''}</div><div class="tm num">${esc(b.arrTime || '')}${nextDay}</div></div>
      </div>
      <p class="bk-tz">時間皆為當地時間</p>
      ${commonBottom(t, b)}</article>`;
  }
  if (b.type === 'transit') {
    return `<article class="card bk" id="bk-${esc(b.id)}">
      ${bkHead(b, esc(b.no || (b.mode === 'bus' ? '巴士' : '火車')), `${esc(md(b.depDate))}${b.seats ? `・座位 ${esc(b.seats)}` : ''}`)}
      <div class="route">
        <div class="end"><div class="code sm">${esc(b.from || '—')}</div><div class="tm num">${esc(b.depTime || '')}</div></div>
        ${routeMid(transitMinutes(b))}
        <div class="end" style="text-align:right"><div class="code sm">${esc(b.to || '—')}</div><div class="tm num">${esc(b.arrTime || '')}</div></div>
      </div>
      ${commonBottom(t, b)}</article>`;
  }
  if (b.type === 'stay') {
    const n = nights(b.inDate, b.outDate);
    return `<article class="card bk" id="bk-${esc(b.id)}">
      ${bkHead(b, esc(b.name || '住宿'), n ? `${n} 晚` : '')}
      ${ioRow(ioBox('入住', b.inDate, b.inTime), ioBox('退房', b.outDate, b.outTime))}
      ${b.address ? `<div class="small muted">${esc(b.address)}</div><div class="row" style="gap:8px"><a class="btn sm" href="${mapsSearch(b.address)}" target="_blank" rel="noopener">${ic.map}地圖</a><a class="btn sm pri" href="${mapsDir(b.address)}" target="_blank" rel="noopener">${ic.nav}導航</a>${b.phone ? `<a class="btn sm" href="tel:${esc(b.phone.replace(/[^\d+]/g, ''))}">${ic.phone}電話</a>` : ''}</div>` : b.phone ? `<a class="btn sm" href="tel:${esc(b.phone.replace(/[^\d+]/g, ''))}">${ic.phone}電話</a>` : ''}
      ${commonBottom(t, b)}</article>`;
  }
  // rental
  return `<article class="card bk" id="bk-${esc(b.id)}">
    ${bkHead(b, esc(b.company || '租車'), b.car ? esc(b.car) : '')}
    ${ioRow(ioBox('取車', b.pickDate, b.pickTime, b.pickPlace), ioBox('還車', b.retDate, b.retTime, b.retPlace))}
    ${b.pickPlace || b.phone ? `<div class="row" style="gap:8px;flex-wrap:wrap">${b.pickPlace ? `<a class="btn sm pri" href="${mapsDir(b.pickPlace)}" target="_blank" rel="noopener">${ic.nav}導航到取車點</a>` : ''}${b.retPlace && b.retPlace !== b.pickPlace ? `<a class="btn sm" href="${mapsDir(b.retPlace)}" target="_blank" rel="noopener">${ic.nav}還車點</a>` : ''}${b.phone ? `<a class="btn sm" href="tel:${esc(b.phone.replace(/[^\d+]/g, ''))}">${ic.phone}電話</a>` : ''}</div>` : ''}
    ${commonBottom(t, b)}</article>`;
}

/* ───────── 新增：先選類型 ───────── */
function chooseType(ctx, t) {
  openSheet(`<div class="sheet-h"><h3 class="title">新增交通住宿</h3><button class="iconbtn" data-close aria-label="關閉">✕</button></div>
    <div class="grid2">${Object.entries(TYPES).map(([k, v]) => `<button class="btn type-btn" data-type="${k}">${kindIcon(k === 'transit' ? 'train' : v.icon, v.go)}<span>${v.label}</span></button>`).join('')}</div>`, s => {
    $$('[data-type]', s).forEach(b => b.addEventListener('click', () => editBooking(ctx, t, null, b.dataset.type)));
  });
}

/* ───────── 新增／編輯表單 ───────── */
const F = (id, label, val, attrs = '') => `<label class="field"><span>${label}</span><input class="input" id="${id}" value="${esc(val || '')}" ${attrs}></label>`;
let RANGE = { min: '', max: '' }; // 目前編輯中旅程的日期範圍
const D = (id, label, val) => F(id, label, val, `type="date" min="${RANGE.min}" max="${RANGE.max}"`);
const T = (id, label, val) => `<div class="field"><span>${label}</span><time-24 class="input t24" id="${id}" value="${esc(val || '')}" aria-label="${label}"></time-24></div>`;

function editBooking(ctx, t, b, type) {
  const { S } = ctx;
  const isNew = !b;
  type = b ? b.type : type;
  RANGE = { min: t.start, max: t.end };
  if (!b) {
    // 預設日期：住宿、租車是整趟；第一班飛機是出發日，之後的是回程日
    const hasFlight = (cache[t.id]?.list || []).some(x => x.type === 'flight');
    const d0 = type === 'flight' && hasFlight ? t.end : t.start;
    b = { type, members: [...(t.memberUids || [])], depTz: hasFlight && type === 'flight' ? t.tz : 'Asia/Taipei', arrTz: hasFlight && type === 'flight' ? 'Asia/Taipei' : t.tz, mode: 'train',
      depDate: d0, arrDate: d0, inDate: t.start, outDate: t.end, pickDate: t.start, retDate: t.end };
  }
  const tzs = timeZones();
  const tzSel = (id, label, val) => `<label class="field"><span>${label}</span><select class="input" id="${id}">${[...new Set([val, ...tzs])].filter(Boolean).map(z => `<option ${z === val ? 'selected' : ''}>${esc(z)}</option>`).join('')}</select></label>`;
  let body = '';
  if (type === 'flight') body = `
    <div class="grid2">${F('bAirline', '航空公司', b.airline, 'maxlength="40" placeholder="例如 華航"')}${F('bNo', '航班編號', b.no, 'maxlength="12" placeholder="例如 CI120" autocapitalize="characters"')}</div>
    <div class="grid2">${F('bFrom', '出發機場代碼', b.from, 'maxlength="4" placeholder="TPE" autocapitalize="characters"')}${F('bTo', '抵達機場代碼', b.to, 'maxlength="4" placeholder="OKA" autocapitalize="characters"')}</div>
    <div class="grid2">${F('bFromName', '出發城市（選填）', b.fromName, 'maxlength="40" placeholder="桃園"')}${F('bToName', '抵達城市（選填）', b.toName, 'maxlength="40" placeholder="那霸"')}</div>
    <div class="grid2">${D('bDepDate', '起飛日期', b.depDate)}${T('bDepTime', '起飛時間（當地）', b.depTime)}</div>
    <div class="grid2">${D('bArrDate', '抵達日期', b.arrDate)}${T('bArrTime', '抵達時間（當地）', b.arrTime)}</div>
    <div class="grid2">${tzSel('bDepTz', '出發地時區', b.depTz)}${tzSel('bArrTz', '抵達地時區', b.arrTz)}</div>
    <p class="tiny faint" style="margin:-4px 2px 0">填了時區就會自動算出飛行時間。</p>
    <div class="grid2">${F('bDepTerm', '出發航廈（選填）', b.depTerm, 'maxlength="20" placeholder="第一航廈"')}${F('bArrTerm', '抵達航廈（選填）', b.arrTerm, 'maxlength="20" placeholder="國際線"')}</div>
    ${F('bSeats', '座位（選填）', b.seats, 'maxlength="80" placeholder="例如 阿柒 23A、阿琁 23B"')}`;
  if (type === 'transit') body = `
    <div class="field"><span id="lblMode">交通工具</span><div class="seg" role="group" aria-labelledby="lblMode">
      <button type="button" data-mode="train" aria-pressed="${b.mode !== 'bus'}">火車／捷運</button><button type="button" data-mode="bus" aria-pressed="${b.mode === 'bus'}">巴士</button></div></div>
    ${F('bNo', '車次／路線（選填）', b.no, 'maxlength="30" placeholder="例如 新幹線 のぞみ 15 號"')}
    <div class="grid2">${F('bFrom', '出發站', b.from, 'maxlength="60"')}${F('bTo', '抵達站', b.to, 'maxlength="60"')}</div>
    <div class="grid2">${D('bDepDate', '出發日期', b.depDate)}${T('bDepTime', '出發時間', b.depTime)}</div>
    <div class="grid2">${D('bArrDate', '抵達日期（選填）', b.arrDate)}${T('bArrTime', '抵達時間（選填）', b.arrTime)}</div>
    ${F('bSeats', '座位（選填）', b.seats, 'maxlength="80" placeholder="例如 7 號車 12A–12D"')}`;
  if (type === 'stay') body = `
    ${F('bName', '住宿名稱', b.name, 'maxlength="60"')}
    ${F('bAddress', '地址或 Google Maps 地點', b.address, 'maxlength="200" placeholder="填了會出現地圖、導航按鈕"')}
    <div class="grid2">${D('bInDate', '入住日期', b.inDate)}${T('bInTime', '入住時間（選填）', b.inTime)}</div>
    <div class="grid2">${D('bOutDate', '退房日期', b.outDate)}${T('bOutTime', '退房時間（選填）', b.outTime)}</div>
    ${F('bPhone', '電話（選填）', b.phone, 'type="tel" maxlength="30"')}`;
  if (type === 'rental') body = `
    <div class="grid2">${F('bCompany', '租車公司', b.company, 'maxlength="40"')}${F('bCar', '車款（選填）', b.car, 'maxlength="40"')}</div>
    ${F('bPickPlace', '取車地點', b.pickPlace, 'maxlength="200" placeholder="營業所名稱或地址"')}
    <div class="grid2">${D('bPickDate', '取車日期', b.pickDate)}${T('bPickTime', '取車時間', b.pickTime)}</div>
    ${F('bRetPlace', '還車地點（選填，和取車不同時）', b.retPlace, 'maxlength="200"')}
    <div class="grid2">${D('bRetDate', '還車日期', b.retDate)}${T('bRetTime', '還車時間', b.retTime)}</div>
    ${F('bPhone', '電話（選填）', b.phone, 'type="tel" maxlength="30"')}`;
  const ms = (t.memberUids || []).filter(u => t.members?.[u]);
  const sel = new Set(b.members && b.members.length ? b.members : ms);
  openSheet(`<div class="sheet-h"><h3 class="title">${isNew ? '新增' : '編輯'}${TYPES[type].label}</h3><button class="iconbtn" data-close aria-label="關閉">✕</button></div>
    ${body}
    <p class="tiny faint" style="margin:-4px 2px 0">日期只能選這趟旅程的 ${esc(md(t.start))} – ${esc(md(t.end))}。</p>
    ${F('bConfirm', '訂位代號（選填）', b.confirm, 'maxlength="40" autocapitalize="characters"')}
    ${F('bLink', '訂單連結（選填）', b.link, 'type="url" maxlength="500" placeholder="https://…"')}
    ${F('bPrice', '金額（參考，選填）', b.price, 'maxlength="40"')}
    <label class="field"><span>備註（一行一點）</span><textarea class="input" id="bNote" rows="3" maxlength="2000">${esc(b.note || '')}</textarea></label>
    ${ms.length > 1 ? `<div class="field"><span id="lblMem">誰會用到</span><div class="mem-pick" role="group" aria-labelledby="lblMem">${ms.map(u => `<button type="button" class="mem" data-mem="${esc(u)}" aria-pressed="${sel.has(u)}">${avatarHTML(t.members[u], 'sm')}<span>${esc(t.members[u].nickname)}</span></button>`).join('')}</div></div>` : ''}
    <div class="sheet-acts">${isNew ? '' : '<button class="btn danger" id="bDel">刪除</button>'}<button class="btn pri" id="bSave">儲存</button></div>`, s => {
    let mode = b.mode || 'train';
    $$('[data-mode]', s).forEach(x => x.addEventListener('click', () => { mode = x.dataset.mode; $$('[data-mode]', s).forEach(y => y.setAttribute('aria-pressed', String(y === x))); }));
    $$('[data-mem]', s).forEach(x => x.addEventListener('click', () => { const u = x.dataset.mem; sel.has(u) ? sel.delete(u) : sel.add(u); x.setAttribute('aria-pressed', String(sel.has(u))); }));
    // 填了起飛（出發／入住／取車）日期，順便帶入抵達（退房／還車）日期
    [['#bDepDate', '#bArrDate'], ['#bPickDate', '#bRetDate']].forEach(([a, z]) => $(a, s)?.addEventListener('change', () => { if ($(z, s) && !$(z, s).value) $(z, s).value = $(a, s).value; }));
    $('#bSave', s).addEventListener('click', () => {
      const v = id => ($(id, s)?.value || '').trim();
      const up = id => v(id).toUpperCase();
      // 必填的沒填：跳出提示、把畫面捲到那一格
      const need = (id, msg) => { toast(msg); const el = $(id, s); el?.focus(); el?.scrollIntoView({ block: 'center', behavior: 'smooth' }); };
      let data = { type, confirm: v('#bConfirm'), link: v('#bLink'), price: v('#bPrice'), note: ($('#bNote', s).value || '').replace(/\r/g, '').trim(),
        members: ms.length > 1 ? [...sel] : ms, updatedBy: S.user.uid, updatedAt: serverTimestamp() };
      if (data.link && !safeUrl(data.link)) { toast('訂單連結要用 https:// 開頭'); return; }
      // 日期要在旅程期間內（有些瀏覽器手動輸入時不會擋）
      const outside = $$('input[type="date"]', s).find(el => el.value && (el.value < t.start || el.value > t.end));
      if (outside) { toast(`日期要在旅程期間內（${md(t.start)} – ${md(t.end)}）`); outside.focus(); return; }
      if (type === 'flight') {
        data = { ...data, airline: v('#bAirline'), no: up('#bNo'), from: up('#bFrom'), to: up('#bTo'), fromName: v('#bFromName'), toName: v('#bToName'),
          depDate: v('#bDepDate'), depTime: v('#bDepTime'), arrDate: v('#bArrDate'), arrTime: v('#bArrTime'), depTz: v('#bDepTz'), arrTz: v('#bArrTz'),
          depTerm: v('#bDepTerm'), arrTerm: v('#bArrTerm'), seats: v('#bSeats') };
        if (!data.from && !data.fromName) return need('#bFrom', '請填出發機場代碼或出發城市');
        if (!data.to && !data.toName) return need('#bTo', '請填抵達機場代碼或抵達城市');
        if (!data.depDate) return need('#bDepDate', '請填起飛日期');
        if (data.arrDate && data.arrDate < data.depDate) { toast('抵達日期不能早於起飛日期'); return; }
      } else if (type === 'transit') {
        data = { ...data, mode, no: v('#bNo'), from: v('#bFrom'), to: v('#bTo'), depDate: v('#bDepDate'), depTime: v('#bDepTime'), arrDate: v('#bArrDate'), arrTime: v('#bArrTime'), seats: v('#bSeats') };
        if (!data.from) return need('#bFrom', '請填出發站');
        if (!data.to) return need('#bTo', '請填抵達站');
        if (!data.depDate) return need('#bDepDate', '請填出發日期');
      } else if (type === 'stay') {
        data = { ...data, name: v('#bName'), address: v('#bAddress'), inDate: v('#bInDate'), inTime: v('#bInTime'), outDate: v('#bOutDate'), outTime: v('#bOutTime'), phone: v('#bPhone') };
        if (!data.name) return need('#bName', '請填住宿名稱');
        if (!data.inDate || !data.outDate) { toast('請填入住和退房日期'); return; }
        if (data.outDate < data.inDate) { toast('退房日期不能早於入住日期'); return; }
      } else {
        data = { ...data, company: v('#bCompany'), car: v('#bCar'), pickPlace: v('#bPickPlace'), pickDate: v('#bPickDate'), pickTime: v('#bPickTime'),
          retPlace: v('#bRetPlace'), retDate: v('#bRetDate'), retTime: v('#bRetTime'), phone: v('#bPhone') };
        if (!data.company && !data.pickPlace) return need('#bCompany', '請填租車公司或取車地點');
        if (!data.pickDate || !data.retDate) { toast('請填取車和還車日期'); return; }
        if (data.retDate < data.pickDate) { toast('還車日期不能早於取車日期'); return; }
      }
      const p = isNew
        ? setDoc(doc(collection(S.db, 'trips', t.id, 'bookings')), { ...data, createdBy: S.user.uid, createdAt: serverTimestamp() })
        : setDoc(doc(S.db, 'trips', t.id, 'bookings', b.id), { ...data, createdBy: b.createdBy || S.user.uid, createdAt: b.createdAt || serverTimestamp() });
      p.catch(e => toast('儲存失敗：' + (e?.code || e?.message)));
      closeSheet(); toast(navigator.onLine ? '已儲存' : '已儲存，恢復連線後會自動同步');
      refresh(ctx, t);
    });
    $('#bDel', s)?.addEventListener('click', () => {
      if (!confirm('刪除這筆交通住宿？')) return;
      deleteDoc(doc(S.db, 'trips', t.id, 'bookings', b.id)).catch(e => toast('刪除失敗：' + (e?.code || e?.message)));
      closeSheet(); toast('已刪除');
      refresh(ctx, t);
    });
  });
}
// 彈出視窗關掉後，用最新資料重畫列表（沒網路時也看得到剛存的內容）
function refresh(ctx, t) { setTimeout(() => { if (location.hash.startsWith(`#/trip/${t.id}/book`)) renderBook(ctx, (ctx.S.trips || []).find(x => x.id === t.id) || t); }, 0); }
