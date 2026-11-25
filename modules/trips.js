// 旅程：首頁列表與足跡、開新旅程、旅程頁、邀請碼、加入旅程
import { doc, collection, query, where, onSnapshot, getDoc, getDocs, setDoc, updateDoc, deleteDoc, arrayUnion, arrayRemove,
  deleteField, writeBatch, serverTimestamp, Timestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { $, $$, esc, ic, toast, copyText, localGet, localSet, tabFrom, tabSlide, navFrom } from './ui.js';
import { avatarHTML } from './profile.js';
import { adjustForPeers } from './color.js';
import { renderPlan, watchItems, isBusy, exitSort, openSheet, closeSheet } from './plan.js';
import { renderBook, watchBookings } from './book.js';
import { renderChecklist, watchChecklist } from './checklist.js';
import { renderMoney, watchMoney } from './money.js';
import { renderShop, watchShop } from './shop.js';
import { COUNTRIES, countryBy, CURRENCIES, CUR_NAME, timeZones, todayIn, dayCount, tripStatus, STATUS_LABEL,
  fmtRange, placesText } from './places.js';

export const APP_VERSION = 'v0.6';
const OTHER = 'OT';
// 旅程裡的分頁（資訊、行程…）是同一層，左上角放回首頁的 logo；點進去的細項頁才用「上一頁」箭頭
const homeBtn = `<a class="iconbtn home-btn" href="#/" aria-label="回首頁（旅程列表）" style="margin-left:-6px"><img src="img/icon-192.png" alt="" width="32" height="32"></a>`; // 清單以外的國家
const INVITE_DAYS = 7;

/* ───────── 訂閱管理：換頁時取消上一頁的即時更新 ───────── */
let unsubs = [], inviteSubId = null;
export function cleanup() { unsubs.forEach(u => { try { u(); } catch {} }); unsubs = []; inviteSubId = null; }
// 注意：unsubs.planFor 會隨著 unsubs = [] 一起清掉

/* ───────── 旅程清單：登入後訂閱一次，一直保持即時更新 ─────────
   每個人（小夥伴、旅伴都一樣）只讀得到自己參加的旅程，足跡也只算自己的 */
let tripsUnsub = null;
export function ensureTrips(ctx, onChange) {
  const { S } = ctx;
  if (tripsUnsub && tripsUnsub.uid === S.user.uid) return;
  stopTrips();
  const q = query(collection(S.db, 'trips'), where('memberUids', 'array-contains', S.user.uid));
  const u = onSnapshot(q, snap => { S.trips = snap.docs.map(d => ({ id: d.id, ...d.data() })); onChange(); },
    e => { console.error(e); toast('讀取旅程失敗：' + (e?.code || e?.message)); });
  tripsUnsub = Object.assign(() => u(), { uid: S.user.uid });
}
export function stopTrips() { if (tripsUnsub) { tripsUnsub(); tripsUnsub = null; } }

/* ───────── 成員資料（放在旅程文件裡，同一趟的人才看得到） ───────── */
export function memberEntry(p, role) {
  return {
    nickname: p.nickname, color: p.color, colorDark: p.colorDark,
    avatarType: p.avatarType, photoURL: p.photoURL || '', avatarThumb: p.avatarThumb || '',
    coreId: p.coreId || null, driver: !!p.driver, passportName: p.passportName || '',
    role, joinedAt: Date.now()
  };
}
// 依旅程裡其他人的顏色，必要時微調自己在這趟的顏色
function withPeerColor(entry, trip, uid) {
  if (entry.coreId) return entry;
  const peers = Object.entries(trip.members || {}).filter(([k]) => k !== uid).map(([, m]) => m.color);
  const r = adjustForPeers(entry.color, entry.colorDark, peers);
  return { ...entry, color: r.color, colorDark: r.colorDark, colorAdjusted: r.adjusted };
}
// 個人檔案改了之後，同步到自己參加的每一趟旅程
export function makeSync(ctx) {
  return async () => {
    const { S } = ctx;
    const uid = S.user.uid;
    const trips = S.trips || [];
    await Promise.all(trips.filter(t => (t.memberUids || []).includes(uid)).map(t => {
      const old = t.members?.[uid] || {};
      const entry = withPeerColor({ ...memberEntry(S.profile, old.role || 'member'), joinedAt: old.joinedAt || Date.now() }, t, uid);
      return updateDoc(doc(S.db, 'trips', t.id), { [`members.${uid}`]: entry, updatedAt: serverTimestamp() });
    }));
  };
}

/* ───────── 小元件 ───────── */
/* 郵票字寬：中日韓字＝1，英數約 0.55（以字級 em 計） */
function textEm(str) {
  let u = 0;
  for (const ch of str) u += /[\u2E80-\uFFFF]/.test(ch) ? 1 : /[A-Z0-9]/.test(ch) ? 0.64 : /\s/.test(ch) ? 0.3 : 0.58;
  return u;
}
/* 地名排版：一行放得下就縮字；太長就兩行；再太長改用國名 */
function fitLabel(label, fallback) {
  const W = 0.68;                         // 郵票中間可用寬度（佔直徑比例）
  const u = textEm(label);
  if (!u) return { text: '', fs: 0.22, two: false };
  if (u * 0.22 <= W) return { text: label, fs: 0.22, two: false };
  if (u * 0.125 <= W) return { text: label, fs: +(W / u).toFixed(3), two: false };
  if (u * 0.115 <= W * 2 - 0.08) return { text: label, fs: 0.115, two: true };
  if (fallback && fallback !== label) return fitLabel(fallback, '');
  return { text: label, fs: 0.115, two: true, clip: true };
}
function stampHTML(t, size = 72, rot = -9) {
  const p = (t.places || [])[0] || {};
  const c = countryBy(p.country);
  const en = (c ? c.en : (p.countryName || '')).toUpperCase().slice(0, 22);
  const cname = (c ? c.name : p.countryName) || '';
  const L = fitLabel((p.city || cname || '').trim(), cname);
  const enFs = Math.max(0.06, Math.min(0.12, 0.62 / Math.max(1, textEm(en) * 1.12 + en.length * 0.06)));
  const ym = (t.start || '').slice(0, 7).replace('-', '.');
  return `<div class="stamp" style="--s:${size}px;transform:rotate(${rot}deg)" aria-hidden="true"><div>
    <b class="num" style="font-size:calc(var(--s) * ${enFs.toFixed(3)})">${esc(en)}</b><span class="title${L.two ? ' two' : ''}" style="font-size:calc(var(--s) * ${L.fs})">${esc(L.text)}</span><i class="num">${esc(ym)}</i></div></div>`;
}
function avatarsRow(t, max = 6) {
  const ms = Object.values(t.members || {}).sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
  const more = ms.length > max ? `<span class="av sm more">+${ms.length - max}</span>` : '';
  return `<div class="stack">${ms.slice(0, max).map(m => avatarHTML(m, 'sm')).join('')}${more}</div>`;
}
function tripCard(t, uid) {
  const st = tripStatus(t);
  const chip = st === 'done' ? '' : `<span class="chip">${STATUS_LABEL[st]}</span>`;
  const solo = (t.memberUids || []).length === 1;
  return `<a class="card trip" href="#/trip/${esc(t.id)}">
    <div class="trip-top">
      <div style="display:flex;flex-direction:column;gap:6px;min-width:0">
        <div class="title" style="font-size:19px;line-height:1.35">${esc(t.name)}</div>
        <div class="small muted brk">${esc(placesText(t.places))}</div>
        <div class="num small muted" style="font-weight:700">${fmtRange(t.start, t.end)} · ${dayCount(t.start, t.end)} 天</div>
      </div>
      ${stampHTML(t, 56, 12)}
    </div>
    <div class="dash"></div>
    <div class="row" style="justify-content:space-between">
      ${avatarsRow(t)}
      <div class="row" style="gap:6px">${solo ? '<span class="chip muted-chip">獨旅</span>' : ''}${chip}${(t.memberUids || []).includes(uid) ? '' : '<span class="chip muted-chip">沒有參加</span>'}</div>
    </div>
  </a>`;
}

/* ───────── 首頁 ───────── */
// 足跡：自己參加過、已經出發的旅程（進行中＋已結束），新的在前
function footprints(S) {
  const uid = S.user.uid;
  return (S.trips || []).filter(t => (t.memberUids || []).includes(uid) && tripStatus(t) !== 'plan')
    .sort((a, b) => b.start.localeCompare(a.start));
}
const placeCountry = p => p.country === OTHER ? (p.countryName || '其他') : (countryBy(p.country)?.name || p.country);
// 把足跡整理成：國家、地區、旅伴（每一項都記得是哪幾趟）
function fpData(S, fp) {
  const countries = new Map(), regions = new Map(), people = new Map();
  const add = (m, k, init, t) => { const x = m.get(k) || (m.set(k, { ...init, trips: [] }), m.get(k)); if (!x.trips.includes(t)) x.trips.push(t); return x; };
  fp.forEach(t => {
    (t.places || []).forEach(p => {
      const cn = placeCountry(p);
      const c = add(countries, cn, { name: cn, regions: new Set() }, t);
      const city = (p.city || '').trim();
      if (city) c.regions.add(city);
      add(regions, cn + '/' + city, { name: city || cn, country: cn, whole: !city }, t);
    });
    (t.memberUids || []).filter(u => u !== S.user.uid && t.members?.[u]).forEach(u => {
      const x = add(people, u, { uid: u }, t);
      if (!x.m) x.m = t.members[u]; // fp 新的在前：用最近一趟的頭像和暱稱
    });
  });
  return { countries: [...countries.values()], regions: [...regions.values()], people: [...people.values()].sort((a, b) => b.trips.length - a.trips.length) };
}
// 國家、地區兩個數字都打開同一個「去過的地方」明細（依國家分，裡面列地區）
const FP_TABS = [['country', '國家', 'place'], ['region', '地區', 'place'], ['trip', '趟旅程', 'trip'], ['buddy', '位旅伴', 'buddy']];
function fpStats(d, fp, on = null) {
  const n = { country: d.countries.length, region: d.regions.length, trip: fp.length, buddy: d.people.length };
  return `<div class="stats fp-stats" role="tablist" aria-label="足跡明細">${FP_TABS.map(([k, l, tab]) => `<a href="#/footprints/${tab}" role="tab" class="${on === tab ? 'on' : ''}" ${on === tab ? 'aria-selected="true"' : ''} aria-label="${n[k]} ${l}，看明細"><b class="num">${n[k]}</b><span class="tiny faint">${l}</span></a>`).join('')}</div>`;
}
const ROT = [-9, 7, -4, 10, -12, 5, -7, 12, -3];
export function renderHome(ctx) {
  const { S } = ctx;
  const uid = S.user.uid;
  const core = !!S.profile.coreId;
  const draw = () => {
    if (location.hash.replace(/^#\/?/, '') !== '') return;
    const mine = S.trips ? S.trips.filter(t => (t.memberUids || []).includes(uid)) : null;
    // 首頁只放進行中、規劃中；已結束的收進「我的足跡」
    const groups = mine ? ['now', 'plan'].map(k => [k, mine.filter(t => tripStatus(t) === k).sort((a, b) => a.start.localeCompare(b.start))]) : [];
    const doneN = mine ? mine.filter(t => tripStatus(t) === 'done').length : 0;
    const active = groups.reduce((n, [, ts]) => n + ts.length, 0);
    const fp = footprints(S);
    // 郵票最多放 4 格：3 枚以內＋「下一站」；超過就放最新 3 枚＋「+N」
    const shown = fp.length > 4 ? fp.slice(0, 3) : fp.slice(0, 4);
    const tail = fp.length > 4 ? `<div class="stamp-empty more"><b class="num">+${fp.length - 3}</b><span class="tiny">全部</span></div>`
      : fp.length < 4 ? '<div class="stamp-empty small faint">下一站</div>' : '';
    $('#main').innerHTML = `<div class="wrap">${ctx.topBar(ctx.brand)}
      <div><div class="small muted">嗨，${esc(S.profile.nickname)}</div>
        <h1 class="title" style="font-size:25px;line-height:1.35">下一趟想去哪裡粗企玩？</h1></div>
      <section class="card fp-card">
        <h2 class="title" style="font-size:17px">我的足跡</h2>
        ${fpStats(fpData(S, fp), fp)}
        <a class="stamps" href="#/footprints/trip" aria-label="打開集章冊">${shown.map((t, i) => stampHTML(t, 60, ROT[i])).join('')}${tail}</a>
      </section>
      ${core ? `<a class="btn pri full" href="#/new">${ic.plus}開新旅程</a>` : ''}
      ${!mine ? '<div class="spinner" style="margin:24px auto" role="status" aria-label="載入中"></div>'
        : active === 0 ? `<section class="card empty"><p class="small muted" style="margin:0">${doneN
          ? (core ? '目前沒有規劃中的旅程。按上面的「開新旅程」開始規劃下一趟吧！' : '目前沒有規劃中的旅程。小夥伴邀請你加入下一趟後，會出現在這裡。')
          : core ? '還沒有旅程。按上面的「開新旅程」開始規劃，再邀請小夥伴和旅伴加入。'
          : '小夥伴邀請你加入旅程後，旅程會出現在這裡。收到邀請連結就直接點開吧！'}</p></section>`
        : groups.filter(([, ts]) => ts.length).map(([k, ts]) => `<section class="sec">
            <h2 class="sec-h">${STATUS_LABEL[k]}</h2>${ts.map(t => tripCard(t, uid)).join('')}</section>`).join('')}
      ${doneN ? `<a class="card done-link" href="#/footprints/trip"><span>已結束的旅程</span><span class="small muted row" style="gap:2px">${doneN} 趟${ic.chev}</span></a>` : ''}
      <p class="tiny faint" style="text-align:center;margin:0">小夥伴粗企玩 ${APP_VERSION}</p>
    </div>`;
    ctx.bindTop();
  };
  draw();
}

/* ───────── 我的足跡：上面四個數字可以切換明細（國家、地區、集章冊、旅伴） ───────── */
const tripLine = t => `<a class="fp-trip" href="#/trip/${esc(t.id)}"><span class="ellip">${esc(t.name)}</span><span class="tiny faint num">${fmtRange(t.start, t.end)}</span></a>`;
const tripLines = ts => `<div class="fp-trips">${[...ts].sort((a, b) => b.start.localeCompare(a.start)).map(tripLine).join('')}</div>`;
export function renderFootprints(ctx, tab) {
  const { S } = ctx;
  if (!/^footprints(\/\w+)?$/.test(location.hash.replace(/^#\/?/, ''))) return;
  tab = tab === 'country' || tab === 'region' ? 'place' : ['place', 'trip', 'buddy'].includes(tab) ? tab : 'trip';
  const fp = footprints(S);
  const d = fpData(S, fp);
  let body;
  if (!S.trips) body = '<div class="spinner" style="margin:24px auto" role="status" aria-label="載入中"></div>';
  else if (!fp.length) body = '<section class="card empty"><p class="small muted" style="margin:0">還沒有足跡。出發旅行後，這裡會蓋上第一枚郵票！</p></section>';
  else if (tab === 'trip') {
    const years = [];
    fp.forEach(t => { const y = t.start.slice(0, 4); let g = years.find(x => x[0] === y); if (!g) years.push(g = [y, []]); g[1].push(t); });
    body = years.map(([y, ts]) => `<section class="sec">
        <h2 class="sec-h"><span class="num">${esc(y)}</span>・${ts.length} 趟</h2>
        <div class="stamp-book">${ts.map((t, i) => `<a class="stamp-cell" href="#/trip/${esc(t.id)}">
            ${stampHTML(t, 76, ROT[i % ROT.length])}
            <b class="small ellip">${esc(t.name)}</b>
            <span class="tiny faint num">${fmtRange(t.start, t.end)}</span>
            ${tripStatus(t) === 'now' ? `<span class="chip">${STATUS_LABEL.now}</span>` : ''}
          </a>`).join('')}</div></section>`).join('');
  } else if (tab === 'place') {
    // 一個國家一張卡片：國家去了幾趟，下面每個地區列出是哪幾趟
    body = [...d.countries].sort((a, b) => b.trips.length - a.trips.length).map(c => {
      const rs = d.regions.filter(r => r.country === c.name).sort((a, b) => b.trips.length - a.trips.length);
      return `<section class="card fp-item">
        <div class="row" style="justify-content:space-between"><h2 class="title" style="font-size:19px">${esc(c.name)}</h2>
          <span class="small muted" style="flex-shrink:0">${c.trips.length} 趟・${rs.length} 個地區</span></div>
        ${rs.map(r => `<div class="fp-region">
          <div class="row" style="justify-content:space-between;align-items:flex-start"><b class="brk">${esc(r.whole ? '（沒有填城市）' : r.name)}</b>${rs.length > 1 ? `<span class="tiny faint" style="flex-shrink:0">${r.trips.length} 趟</span>` : ''}</div>
          ${tripLines(r.trips)}</div>`).join('')}</section>`;
    }).join('');
  } else {
    body = d.people.length ? d.people.map(x => `<section class="card fp-item">
        <div class="row">${avatarHTML(x.m)}<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px">
          <b>${esc(x.m.nickname)}</b><span class="tiny faint">${x.m.coreId ? '小夥伴' : '旅伴'}・一起去了 ${x.trips.length} 趟</span></div></div>
        ${tripLines(x.trips)}</section>`).join('')
      : '<section class="card empty"><p class="small muted" style="margin:0">目前都是獨旅，還沒有跟別人一起出去過。</p></section>';
  }
  $('#main').innerHTML = `<div class="wrap">${ctx.topBar(`<a class="iconbtn" href="#/" aria-label="回首頁" style="margin-left:-10px">${ic.back}</a>`)}
    <h1 class="title" style="font-size:25px">我的足跡</h1>
    <section class="card">${fpStats(d, fp, tab)}</section>
    ${body}
  </div>`;
  ctx.bindTop();
  // 切換明細不要一直疊上一頁
  $$('.fp-stats a').forEach(a => a.addEventListener('click', e => { e.preventDefault(); location.replace(a.getAttribute('href')); }));
}

/* ───────── 開新旅程／編輯旅程 ───────── */
let form = null;
export function renderTripForm(ctx, tripId) {
  const { S } = ctx;
  const editing = tripId ? (S.trips || []).find(t => t.id === tripId) : null;
  if (tripId && !editing) { location.hash = '#/'; return; }
  if (editing && editing.ownerUid !== S.user.uid) { location.hash = `#/trip/${tripId}`; return; }
  if (!form || form.id !== (tripId || 'new')) {
    form = editing
      ? { id: tripId, name: editing.name, places: JSON.parse(JSON.stringify(editing.places)), start: editing.start, end: editing.end,
          currency: editing.currency, tz: editing.tz, settleCurrency: editing.settleCurrency || 'TWD' }
      : { id: 'new', name: '', places: [{ country: 'TW', city: '' }], start: '', end: '', currency: 'TWD', tz: 'Asia/Taipei', settleCurrency: 'TWD', autoFill: true };
  }
  const f = form;
  const tzs = timeZones();
  if (!tzs.includes(f.tz)) tzs.unshift(f.tz);
  $('#main').innerHTML = `<div class="wrap">${ctx.topBar(`<a class="iconbtn" href="${editing ? `#/trip/${esc(tripId)}` : '#/'}" aria-label="取消" style="margin-left:-10px">${ic.back}</a>`)}
    <h1 class="title" style="font-size:25px">${editing ? '編輯旅程' : '開新旅程'}</h1>
    <section class="card">
      <label class="field"><span>旅程名稱</span>
        <input class="input" id="tName" maxlength="40" value="${esc(f.name)}" placeholder="例如：小夥伴粗企玩 北海道之旅"></label>
      <div class="field"><span>目的地</span>
        ${f.places.map((p, i) => `<div class="place-row">
          <select class="input" data-pc="${i}" aria-label="第 ${i + 1} 個目的地的國家">
            ${COUNTRIES.map(c => `<option value="${c.code}" ${p.country === c.code ? 'selected' : ''}>${c.name}</option>`).join('')}
            <option value="${OTHER}" ${p.country === OTHER ? 'selected' : ''}>其他國家</option></select>
          ${p.country === OTHER ? `<input class="input" data-pn="${i}" maxlength="40" value="${esc(p.countryName || '')}" placeholder="國家" aria-label="國家名稱">` : ''}
          <input class="input" data-pcity="${i}" maxlength="100" value="${esc(p.city || '')}" placeholder="城市／地區（選填）" aria-label="第 ${i + 1} 個目的地的城市">
          ${f.places.length > 1 ? `<button type="button" class="iconbtn" data-prm="${i}" aria-label="移除這個目的地">✕</button>` : ''}
        </div>`).join('')}
        <button type="button" class="btn" id="addPlace">${ic.plus}再加一個目的地</button>
      </div>
      <div class="grid2">
        <label class="field"><span>出發日</span><input class="input" type="date" id="tStart" value="${esc(f.start)}"></label>
        <label class="field"><span>回程日</span><input class="input" type="date" id="tEnd" value="${esc(f.end)}" min="${esc(f.start)}"></label>
      </div>
      <div class="grid2">
        <label class="field"><span>當地幣別</span><select class="input" id="tCur">
          ${CURRENCIES.map(c => `<option value="${c}" ${f.currency === c ? 'selected' : ''}>${c} ${CUR_NAME[c] || ''}</option>`).join('')}</select></label>
        <label class="field"><span>結算幣別</span><select class="input" id="tSettle">
          ${CURRENCIES.map(c => `<option value="${c}" ${f.settleCurrency === c ? 'selected' : ''}>${c} ${CUR_NAME[c] || ''}</option>`).join('')}</select></label>
      </div>
      <label class="field"><span>當地時區</span><select class="input" id="tTz">
        ${tzs.map(z => `<option value="${esc(z)}" ${f.tz === z ? 'selected' : ''}>${esc(z)}</option>`).join('')}</select>
        <span class="tiny faint">行程時間都用當地時間顯示。選了國家會自動帶入，跨國旅程可以之後在行程裡每天另外設定。</span></label>
    </section>
    <p class="warn hidden" id="err" role="alert"></p>
    <button class="btn pri full" id="saveTrip">${editing ? '儲存' : '建立旅程'}</button>
    ${editing && (editing.memberUids || []).length === 1 ? '<button class="btn full danger" id="delTrip">刪除這趟旅程</button>' : ''}
  </div>`;
  ctx.bindTop();
  const sync = () => {
    f.name = $('#tName').value; f.start = $('#tStart').value; f.end = $('#tEnd').value;
    f.currency = $('#tCur').value; f.settleCurrency = $('#tSettle').value; f.tz = $('#tTz').value;
    $$('[data-pcity]').forEach(el => { f.places[+el.dataset.pcity].city = el.value; });
    $$('[data-pn]').forEach(el => { f.places[+el.dataset.pn].countryName = el.value; });
  };
  $$('[data-pc]').forEach(el => el.addEventListener('change', () => {
    sync();
    const i = +el.dataset.pc; f.places[i].country = el.value;
    const c = countryBy(el.value);
    if (i === 0 && c && !editing) { f.currency = c.cur; f.tz = c.tz; } // 第一個國家決定預設幣別和時區
    renderTripForm(ctx, tripId);
  }));
  $$('[data-prm]').forEach(el => el.addEventListener('click', () => { sync(); f.places.splice(+el.dataset.prm, 1); renderTripForm(ctx, tripId); }));
  $('#addPlace').addEventListener('click', () => { sync(); f.places.push({ country: f.places[f.places.length - 1].country, city: '' }); renderTripForm(ctx, tripId); });
  $('#tStart').addEventListener('change', () => { sync(); if (!f.end || f.end < f.start) { $('#tEnd').value = f.start; f.end = f.start; } $('#tEnd').min = f.start; });
  $('#saveTrip').addEventListener('click', async () => {
    sync();
    const err = validateTrip(f);
    if (err) { $('#err').textContent = err; $('#err').classList.remove('hidden'); return; }
    const data = { name: f.name.trim(), places: f.places.map(p => p.country === OTHER ? { country: OTHER, countryName: p.countryName.trim(), city: (p.city || '').trim() } : { country: p.country, city: (p.city || '').trim() }),
      start: f.start, end: f.end, currency: f.currency, tz: f.tz, settleCurrency: f.settleCurrency, updatedAt: serverTimestamp() };
    const b = $('#saveTrip'); b.disabled = true;
    try {
      if (editing) {
        await updateDoc(doc(S.db, 'trips', tripId), data);
        form = null; location.hash = `#/trip/${tripId}`; toast('已儲存');
      } else {
        const ref = doc(collection(S.db, 'trips'));
        await setDoc(ref, { ...data, ownerUid: S.user.uid, memberUids: [S.user.uid],
          members: { [S.user.uid]: memberEntry(S.profile, 'owner') }, createdAt: serverTimestamp() });
        form = null; location.hash = `#/trip/${ref.id}`; toast('旅程建立好了！');
      }
    } catch (e) { b.disabled = false; toast('存檔失敗：' + (e?.code || e?.message)); }
  });
  $('#delTrip')?.addEventListener('click', async () => {
    if (!confirm(`確定要刪除「${editing.name}」嗎？行程、交通住宿、清單、記帳會全部刪除，無法復原。`)) return;
    const b = $('#delTrip'); b.disabled = true; b.textContent = '刪除中…';
    try { await deleteTripAll(ctx, editing); form = null; location.hash = '#/'; toast('已刪除'); }
    catch (e) { b.disabled = false; b.textContent = '刪除這趟旅程'; toast('刪除失敗：' + (e?.code || e?.message)); }
  });
}
function validateTrip(f) {
  if (!f.name.trim()) return '請填旅程名稱';
  if (f.places.some(p => p.country === OTHER && !(p.countryName || '').trim())) return '請填「其他國家」的國家名稱';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.start) || !/^\d{4}-\d{2}-\d{2}$/.test(f.end)) return '請選出發日和回程日';
  if (f.end < f.start) return '回程日不能早於出發日';
  if (dayCount(f.start, f.end) > 90) return '旅程最長 90 天';
  return '';
}

/* ───────── 旅程頁 ───────── */
export function renderTrip(ctx, id) {
  const { S } = ctx;
  const uid = S.user.uid;
  let invites = renderTrip.cache?.id === id ? renderTrip.cache.invites : null;
  const draw = () => {
    if (!location.hash.startsWith(`#/trip/${id}`) || location.hash.endsWith('/edit')) return;
    const t = (S.trips || []).find(x => x.id === id);
    if (!t) {
      $('#main').innerHTML = `<div class="wrap">${ctx.topBar(`<a class="iconbtn" href="#/" aria-label="回首頁" style="margin-left:-10px">${ic.back}</a>`)}
        ${S.trips ? '<section class="card"><b>找不到這趟旅程</b><p class="small muted" style="margin:0">可能已經被刪除，或你不是這趟旅程的成員。</p></section>' : '<div class="spinner" style="margin:40px auto"></div>'}</div>`;
      ctx.bindTop(); return;
    }
    const owner = t.ownerUid === uid;
    const member = (t.memberUids || []).includes(uid);
    const st = tripStatus(t);
    const ms = Object.entries(t.members || {}).sort(([, a], [, b]) => (a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : (a.joinedAt || 0) - (b.joinedAt || 0)));
    const now = (() => { try { return new Intl.DateTimeFormat('zh-TW', { timeZone: t.tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()); } catch { return ''; } })();
    const active = (invites || []).filter(v => !v.disabled && v.expiresAt?.toMillis?.() > Date.now());
    const cur = active[0]; // 每趟只用一組（最新的那組）
    const base = location.origin + location.pathname;
    $('#main').innerHTML = `<div class="wrap">${ctx.topBar(member ? homeBtn : `<a class="iconbtn" href="#/" aria-label="回首頁" style="margin-left:-10px">${ic.back}</a>`)}
      <div class="trip-top">
        <div style="display:flex;flex-direction:column;gap:6px;min-width:0">
          <h1 class="title" style="font-size:23px;line-height:1.35">${esc(t.name)}</h1>
          <div class="small muted brk">${esc(placesText(t.places))}</div>
          <div class="row" style="gap:8px"><span class="num small" style="font-weight:700">${fmtRange(t.start, t.end)} · ${dayCount(t.start, t.end)} 天</span><span class="chip">${STATUS_LABEL[st]}</span></div>
        </div>
        ${stampHTML(t, 72, -9)}
      </div>
      <section class="card" style="gap:4px">
        <div class="list-row"><span class="k">當地幣別</span><span><b class="num">${esc(t.currency)}</b> ${esc(CUR_NAME[t.currency] || '')}</span></div>
        <div class="dash"></div>
        <div class="list-row"><span class="k">當地時間</span><span><b class="num">${esc(now)}</b> <span class="small faint">${esc(t.tz)}</span></span></div>
        <div class="dash"></div>
        <div class="list-row"><span class="k">結算幣別</span><span><b class="num">${esc(t.settleCurrency || 'TWD')}</b> ${esc(CUR_NAME[t.settleCurrency || 'TWD'] || '')}</span></div>
      </section>
      <section class="card">
        <div class="row" style="justify-content:space-between"><h2 class="title" style="font-size:17px">成員</h2><span class="small faint">${ms.length} 人</span></div>
        ${ms.map(([k, m]) => `<div class="row">${avatarHTML(m)}<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px">
            <b>${esc(m.nickname)}${k === uid ? '<span class="small faint">（你）</span>' : ''}</b>
            <span class="tiny faint">${[m.role === 'owner' ? '建立者' : '', m.coreId ? '小夥伴' : '旅伴', m.driver ? '會開車' : '', m.colorAdjusted ? '這趟顏色有微調' : ''].filter(Boolean).join('・')}</span>
          </div>${owner && k !== uid ? `<button type="button" class="btn sm" data-kick="${esc(k)}" aria-label="把${esc(m.nickname)}移出這趟旅程">移出</button>` : ''}</div>`).join('')}
        ${ms.length === 1 ? '<p class="tiny faint" style="margin:0">目前只有你一個人，就是獨旅。邀請旅伴加入後，記帳會自動出現分攤和結算。</p>' : ''}
      </section>
      ${owner ? `<section class="card">
        <div class="row" style="justify-content:space-between"><h2 class="title" style="font-size:17px">邀請旅伴</h2></div>
        ${invites === null ? '<div class="spinner" style="margin:8px auto"></div>' : cur ? `<div class="invite">
            <div class="row" style="justify-content:space-between;align-items:flex-end">
              <div><div class="tiny faint">邀請碼</div><div class="num code">${esc(cur.id)}</div></div>
              <div class="tiny faint" style="text-align:right">${esc(fmtDate(cur.expiresAt))} 前有效</div>
            </div>
            <div class="grid2">
              <button class="btn" data-share="${esc(cur.id)}">${ic.copy}${navigator.share ? '分享連結' : '複製連結'}</button>
              <button class="btn" id="offInvite">停用</button>
            </div></div>
          <button type="button" class="invite-more" id="newInvite">換一組新的邀請碼</button>` : `<p class="small muted" style="margin:0">產生邀請連結，傳給小夥伴或旅伴。對方點開、用 Google 登入就能加入。</p>
          <button class="btn pri full" id="newInvite">${ic.plus}產生邀請連結</button>`}
        <p class="tiny faint" style="margin:0">每趟旅程只有一組邀請碼，大家都用同一個連結加入，${INVITE_DAYS} 天後失效。不想再讓人加入就按「停用」；連結不小心傳錯人，就換一組新的，舊的會馬上失效。</p>
      </section>` : ''}
      ${owner ? `<a class="btn full" href="#/trip/${esc(id)}/edit">${ic.edit}編輯旅程</a>` : ''}
      ${member ? `<button type="button" class="btn full danger" id="leaveTrip">${ic.out}退出這趟旅程</button>` : ''}
      ${!member ? '<p class="tiny faint" style="text-align:center;margin:0">你沒有參加這趟旅程，只能看摘要。</p>' : ''}
    </div>${member ? tabBar(id, 'info') : ''}`;
    if (member) $('.wrap').classList.add('has-tabs');
    ctx.bindTop(); bindTabs();
    $('#newInvite')?.addEventListener('click', () => {
      if (cur && !confirm('換一組新的邀請碼？舊的連結會馬上失效，還沒加入的人要用新的連結。')) return;
      createInvite(ctx, t, !!cur);
    });
    $('#leaveTrip')?.addEventListener('click', () => leaveSheet(ctx, t, active));
    $$('[data-kick]').forEach(b => b.addEventListener('click', () => kickSheet(ctx, t, b.dataset.kick, active)));
    $$('[data-share]').forEach(b => b.addEventListener('click', () => shareInvite(t, b.dataset.share, base)));
    $('#offInvite')?.addEventListener('click', async () => {
      if (!confirm('停用後，這組邀請碼就不能再用來加入。確定嗎？')) return;
      try { await disableMyInvites(ctx, id); toast('已停用'); }
      catch (e) { toast('停用失敗：' + (e?.code || e?.message)); }
    });
  };
  draw();
  const t0 = (S.trips || []).find(x => x.id === id);
  if ((!t0 || t0.ownerUid === uid) && inviteSubId !== id) {
    inviteSubId = id;
    unsubs.push(onSnapshot(query(collection(S.db, 'invites'), where('createdBy', '==', uid), where('tripId', '==', id)),
      snap => { invites = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.expiresAt?.toMillis?.() || 0) - (a.expiresAt?.toMillis?.() || 0)); renderTrip.cache = { id, invites }; draw(); },
      () => { invites = []; draw(); }));
  }
}
const fmtDate = ts => { const d = ts?.toDate?.(); return d ? `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : ''; };

function newCode() {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 去掉容易看錯的 I、L、O、0、1
  const r = crypto.getRandomValues(new Uint8Array(6));
  return [...r].map(x => A[x % A.length]).join('');
}
// 每趟旅程只留一組：產生新的之前，先把自己之前產生的停用
async function createInvite(ctx, t, replacing = false) {
  const { S } = ctx;
  const code = newCode();
  try {
    await disableMyInvites(ctx, t.id);
    await setDoc(doc(S.db, 'invites', code), {
      tripId: t.id, tripName: t.name, places: t.places, start: t.start, end: t.end, tz: t.tz,
      ownerName: S.profile.nickname, createdBy: S.user.uid, disabled: false,
      createdAt: serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + INVITE_DAYS * 86400000)
    });
    toast(replacing ? '換好了，舊的連結已經失效' : '邀請連結產生好了');
  } catch (e) { toast('產生失敗：' + (e?.code || e?.message)); }
}
async function shareInvite(t, code, base) {
  const url = `${base}?join=${code}`;
  const text = `一起去粗企玩！加入「${t.name}」：`;
  if (navigator.share) { try { await navigator.share({ title: '小夥伴粗企玩', text, url }); return; } catch (e) { if (e?.name === 'AbortError') return; } }
  copyText(`${text}${url}`);
}

/* ───────── 退出旅程、移出成員、刪除旅程 ─────────
   - 一般成員：自己退出。
   - 建立者：可以把成員移出；自己要退出時，把建立者交給另一位小夥伴；
     這趟沒有其他小夥伴的話，整趟旅程直接刪除（不讓旅伴單獨占用資料庫）。 */
const TRIP_SUBS = ['items', 'checklist', 'expenses', 'shop', 'shopImg', 'clients', 'settle', 'bookings'];
const errText = e => e?.code === 'permission-denied' ? '沒有權限（Firestore 安全規則可能還沒更新）' : (e?.code || e?.message);
// 停用自己幫這趟旅程產生、還能用的邀請碼
async function disableMyInvites(ctx, tripId) {
  const { S } = ctx;
  const snap = await getDocs(query(collection(S.db, 'invites'), where('createdBy', '==', S.user.uid), where('tripId', '==', tripId)));
  const live = snap.docs.filter(d => !d.data().disabled);
  if (!live.length) return 0;
  const batch = writeBatch(S.db);
  live.forEach(d => batch.update(d.ref, { disabled: true }));
  await batch.commit();
  return live.length;
}
// 刪除整趟旅程：先刪掉底下的行程、清單、記帳…，再刪旅程本身（Firestore 不會自動刪子資料）
export async function deleteTripAll(ctx, t) {
  const { S } = ctx;
  ctx.stopTripSubs?.();
  for (const sub of TRIP_SUBS) {
    const snap = await getDocs(collection(S.db, 'trips', t.id, sub));
    for (let i = 0; i < snap.docs.length; i += 400) {
      const batch = writeBatch(S.db);
      snap.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
      await batch.commit();
    }
  }
  try { await disableMyInvites(ctx, t.id); } catch (e) { console.warn('停用邀請碼失敗', e); }
  await deleteDoc(doc(S.db, 'trips', t.id));
}
const sheetHead = title => `<div class="sheet-h"><h3 class="title">${title}</h3><button class="iconbtn" data-close aria-label="關閉">✕</button></div>`;
// 勾選框不算「填到一半」，關掉視窗時不用跳「還沒儲存」
const quietInputs = s => $$('input', s).forEach(el => ['input', 'change'].forEach(ev => el.addEventListener(ev, e => e.stopPropagation())));

function leaveSheet(ctx, t, activeInvites) {
  const { S } = ctx;
  const uid = S.user.uid;
  const owner = t.ownerUid === uid;
  const others = Object.entries(t.members || {}).filter(([k]) => k !== uid && (t.memberUids || []).includes(k));
  const heirs = others.filter(([, m]) => m.coreId);
  const lose = `退出後你就看不到「${esc(t.name)}」的行程、交通住宿、清單和記帳了${tripStatus(t) === 'plan' ? '' : '，你的足跡也會少一枚郵票'}。`;
  // ── 一般成員 ──
  if (!owner) {
    openSheet(`${sheetHead('退出這趟旅程？')}
      <p class="warn" style="margin:0">${lose}</p>
      <p class="small muted" style="margin:0">你記過的帳、新增的項目會留在旅程裡，其他人還看得到。之後想回來，要請建立者再傳一次邀請連結。</p>
      <div class="sheet-acts"><button class="btn" data-close>先不要</button><button class="btn pri danger-pri" id="lvGo">確定退出</button></div>`, s => {
      $('#lvGo', s).addEventListener('click', async () => {
        const b = $('#lvGo', s); b.disabled = true;
        try {
          ctx.stopTripSubs?.();
          await updateDoc(doc(S.db, 'trips', t.id), { memberUids: arrayRemove(uid), [`members.${uid}`]: deleteField(), updatedAt: serverTimestamp() });
          closeSheet(true); location.hash = '#/'; toast(`已退出「${t.name}」`);
        } catch (e) { b.disabled = false; toast('退出失敗：' + errText(e)); }
      });
    });
    return;
  }
  // ── 建立者，有其他小夥伴可以接手 ──
  if (heirs.length) {
    let to = heirs[0][0];
    openSheet(`${sheetHead('退出這趟旅程？')}
      <p class="small muted" style="margin:0">你是建立者，退出前要把<b>建立者</b>交給這趟的另一位小夥伴（之後由他編輯旅程、產生邀請連結、移出成員）。</p>
      <div class="field"><span id="lblHeir">交給誰</span><div class="mem-pick" role="radiogroup" aria-labelledby="lblHeir">
        ${heirs.map(([k, m]) => `<button type="button" class="mem" role="radio" data-heir="${esc(k)}" aria-pressed="${k === to}" aria-checked="${k === to}">${avatarHTML(m, 'sm')}<span>${esc(m.nickname)}</span></button>`).join('')}</div></div>
      <p class="warn" style="margin:0">${lose}${activeInvites.length ? '你產生的邀請連結也會一起停用，新的建立者可以再產生。' : ''}</p>
      <div class="sheet-acts"><button class="btn" data-close>先不要</button><button class="btn pri danger-pri" id="lvGo">交給${esc(heirs[0][1].nickname)}並退出</button></div>`, s => {
      $$('[data-heir]', s).forEach(b => b.addEventListener('click', () => {
        to = b.dataset.heir;
        $$('[data-heir]', s).forEach(x => { const on = x.dataset.heir === to; x.setAttribute('aria-pressed', String(on)); x.setAttribute('aria-checked', String(on)); });
        $('#lvGo', s).textContent = `交給${t.members[to].nickname}並退出`;
      }));
      $('#lvGo', s).addEventListener('click', async () => {
        const b = $('#lvGo', s); b.disabled = true;
        try {
          try { await disableMyInvites(ctx, t.id); } catch (e) { console.warn('停用邀請碼失敗', e); }
          ctx.stopTripSubs?.();
          await updateDoc(doc(S.db, 'trips', t.id), { ownerUid: to, memberUids: arrayRemove(uid), [`members.${uid}`]: deleteField(),
            [`members.${to}.role`]: 'owner', updatedAt: serverTimestamp() });
          closeSheet(true); location.hash = '#/'; toast(`已退出，建立者交給${t.members[to].nickname}了`);
        } catch (e) { b.disabled = false; toast('退出失敗：' + errText(e)); }
      });
    });
    return;
  }
  // ── 建立者，沒有其他小夥伴：整趟刪除 ──
  const guests = others.map(([, m]) => m.nickname);
  openSheet(`${sheetHead('退出會刪除整趟旅程')}
    <p class="warn" style="margin:0"><b>這趟旅程沒有其他小夥伴可以接手</b>，你退出後「${esc(t.name)}」會直接刪除：行程、交通住宿、清單、購物清單、記帳全部刪掉，<b>無法復原</b>。</p>
    ${guests.length ? `<p class="small muted" style="margin:0">旅伴 ${guests.map(esc).join('、')} 也會一起看不到這趟旅程。想保留的話，先邀請另一位小夥伴加入，再把建立者交給他。</p>` : ''}
    <label class="row small" style="gap:8px;align-items:flex-start"><input type="checkbox" id="lvAck" style="margin-top:3px"> 我知道整趟旅程會被刪除，無法復原</label>
    <div class="sheet-acts"><button class="btn" data-close>先不要</button><button class="btn pri danger-pri" id="lvGo" disabled>刪除旅程並退出</button></div>`, s => {
    quietInputs(s);
    $('#lvAck', s).addEventListener('change', e => { $('#lvGo', s).disabled = !e.target.checked; });
    $('#lvGo', s).addEventListener('click', async () => {
      const b = $('#lvGo', s); b.disabled = true; b.textContent = '刪除中…';
      try { await deleteTripAll(ctx, t); closeSheet(true); location.hash = '#/'; toast(`「${t.name}」已刪除`); }
      catch (e) { b.disabled = false; b.textContent = '刪除旅程並退出'; toast('刪除失敗：' + errText(e)); }
    });
  });
}

function kickSheet(ctx, t, k, activeInvites) {
  const { S } = ctx;
  const m = t.members?.[k]; if (!m) return;
  const n = activeInvites.length;
  openSheet(`${sheetHead(`把${esc(m.nickname)}移出？`)}
    <div class="row">${avatarHTML(m)}<div class="small muted" style="flex:1">${esc(m.nickname)}・${m.coreId ? '小夥伴' : '旅伴'}</div></div>
    <p class="warn" style="margin:0">移出後，${esc(m.nickname)}就看不到「${esc(t.name)}」的行程、交通住宿、清單和記帳了。</p>
    <p class="small muted" style="margin:0">他記過的帳、新增的項目會留在旅程裡；記帳裡會顯示「（已離開）」。</p>
    ${n ? `<label class="row small" style="gap:8px;align-items:flex-start"><input type="checkbox" id="kkInv" checked style="margin-top:3px"> 同時停用目前的邀請連結（不然他可以用連結再加入）</label>` : ''}
    <div class="sheet-acts"><button class="btn" data-close>先不要</button><button class="btn pri danger-pri" id="kkGo">移出</button></div>`, s => {
    quietInputs(s);
    $('#kkGo', s).addEventListener('click', async () => {
      const b = $('#kkGo', s); b.disabled = true;
      try {
        await updateDoc(doc(S.db, 'trips', t.id), { memberUids: arrayRemove(k), [`members.${k}`]: deleteField(), updatedAt: serverTimestamp() });
        if ($('#kkInv', s)?.checked) { try { await disableMyInvites(ctx, t.id); } catch (e) { console.warn('停用邀請碼失敗', e); } }
        closeSheet(); toast(`已把${m.nickname}移出`);
      } catch (e) { b.disabled = false; toast('移出失敗：' + errText(e)); }
    });
  });
}

/* ───────── 加入旅程 ───────── */
export const pendingJoin = {
  get: () => localGet('join'),
  set: c => localSet('join', c),
  clear: () => localSet('join', null)
};
export async function renderJoin(ctx, code) {
  const { S } = ctx;
  const uid = S.user.uid;
  code = (code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  const shell = inner => { $('#main').innerHTML = `<div class="wrap">${ctx.topBar(ctx.brand)}${inner}</div>`; ctx.bindTop(); };
  const fail = msg => { pendingJoin.clear(); shell(`<section class="card"><b>沒辦法加入</b><p class="small muted" style="margin:0">${esc(msg)}</p>
    <a class="btn full" href="#/">回首頁</a></section>`); };
  shell('<div class="spinner" style="margin:40px auto" role="status" aria-label="載入中"></div>');
  let inv;
  try {
    const snap = await getDoc(doc(S.db, 'invites', code));
    if (!snap.exists()) return fail('找不到這組邀請碼，請跟邀請你的人確認連結是否正確。');
    inv = snap.data();
  } catch (e) { return fail('讀取邀請失敗：' + (e?.code || e?.message)); }
  // 已經是成員就直接進去
  try {
    const ts = await getDoc(doc(S.db, 'trips', inv.tripId));
    if (ts.exists() && (ts.data().memberUids || []).includes(uid)) { pendingJoin.clear(); location.hash = `#/trip/${inv.tripId}`; return; }
  } catch {}
  if (inv.disabled) return fail('這組邀請碼已經停用了，請跟邀請你的人要新的連結。');
  if ((inv.expiresAt?.toMillis?.() || 0) < Date.now()) return fail('這組邀請碼已經過期了，請跟邀請你的人要新的連結。');
  const fake = { name: inv.tripName, places: inv.places, start: inv.start, end: inv.end };
  shell(`<div style="display:flex;flex-direction:column;align-items:center;gap:12px;text-align:center;padding-top:12px">
      ${stampHTML(fake, 96, -8)}
      <div class="small muted">${esc(inv.ownerName)} 邀請你加入</div>
      <h1 class="title" style="font-size:25px;line-height:1.35">${esc(inv.tripName)}</h1>
      <div class="small muted brk">${esc(placesText(inv.places))}</div>
      <div class="num small" style="font-weight:700">${fmtRange(inv.start, inv.end)} · ${dayCount(inv.start, inv.end)} 天</div>
    </div>
    <section class="card row" style="flex-direction:row;align-items:center">${avatarHTML(S.profile, 'lg')}
      <div class="small muted" style="flex:1">你會以「${esc(S.profile.nickname)}」的身分加入，代表色和頭像沿用你的個人檔案。</div></section>
    <button class="btn pri full" id="doJoin">加入這趟旅程</button>
    <a class="btn full" href="#/" id="noJoin">先不要</a>`);
  $('#noJoin').addEventListener('click', () => pendingJoin.clear());
  $('#doJoin').addEventListener('click', async () => {
    const b = $('#doJoin'); b.disabled = true;
    const ref = doc(S.db, 'trips', inv.tripId);
    try {
      await updateDoc(ref, { memberUids: arrayUnion(uid), [`members.${uid}`]: memberEntry(S.profile, 'member'), joinCode: code, updatedAt: serverTimestamp() });
      pendingJoin.clear();
      // 加入後才看得到其他成員：顏色太像就只在這趟微調
      const snap = await getDoc(ref);
      const t = snap.data();
      const mine = t.members[uid];
      const adj = withPeerColor(mine, t, uid);
      if (adj.colorAdjusted) await updateDoc(ref, { [`members.${uid}`]: adj, updatedAt: serverTimestamp() });
      toast('加入成功！');
      location.hash = `#/trip/${inv.tripId}`;
    } catch (e) {
      b.disabled = false;
      toast(e?.code === 'permission-denied' ? '加入失敗：邀請碼可能剛好過期或被停用了' : '加入失敗：' + (e?.code || e?.message));
    }
  });
}

/* ───────── 旅程分頁列 ───────── */
function tabBar(id, active) {
  const tabs = [['info', '資訊', `#/trip/${id}`], ['trip', '行程', `#/trip/${id}/plan`], ['ticket', '交通住宿', `#/trip/${id}/book`], ['list', '清單', `#/trip/${id}/list`], ['money', '記帳', `#/trip/${id}/money`]];
  const icon = { info: ic.info, trip: ic.tabRoute, ticket: ic.tabBag, list: ic.tabClip, money: ic.tabReceipt };
  return `<nav class="tabbar" aria-label="旅程分頁">${tabs.map(([k, l, href]) => href
    ? `<a href="${href}" class="${active === k ? 'on' : ''}" ${active === k ? 'aria-current="page"' : ''}><span class="pill">${icon[k]}</span>${l}</a>`
    : `<button type="button" class="soon" data-soon="${l}"><span class="pill">${icon[k]}</span>${l}</button>`).join('')}</nav>`;
}
function bindTabs() {
  $$('[data-soon]').forEach(b => b.addEventListener('click', () => toast(`「${b.dataset.soon}」還在製作中，下一版開放`)));
  $$('.tabbar a:not(.on)').forEach(a => a.addEventListener('click', navFrom));
}

/* ───────── 行程頁 ───────── */
export function renderTripPlan(ctx, id, sortDay = null) {
  const { S } = ctx;
  const t = (S.trips || []).find(x => x.id === id);
  const sorting = sortDay !== null;
  const back = sorting ? `<button class="iconbtn" id="sortBack" aria-label="結束調整順序，回到行程" style="margin-left:-10px">${ic.back}</button>` : homeBtn;
  if (!t || !(t.memberUids || []).includes(S.user.uid)) {
    $('#main').innerHTML = `<div class="wrap">${ctx.topBar(back)}${S.trips ? '<section class="card"><b>找不到這趟旅程</b><p class="small muted" style="margin:0">可能已經被刪除，或你不是這趟旅程的成員。</p></section>' : '<div class="spinner" style="margin:40px auto"></div>'}</div>`;
    ctx.bindTop(); return;
  }
  $('#main').innerHTML = `<div class="wrap has-tabs">${ctx.topBar(`<div class="row" style="gap:4px;min-width:0">${back}
      <div style="min-width:0"><div class="title ellip" style="font-size:17px">${esc(t.name)}</div><div class="tiny faint ellip">${esc(placesText(t.places))}</div></div></div>`)}
    <div id="planBody" style="display:flex;flex-direction:column;gap:14px"></div>
  </div>${sorting ? '' : tabBar(id, 'trip')}`;
  if (sorting) $('.wrap').classList.remove('has-tabs');
  ctx.bindTop(); bindTabs();
  $('#sortBack')?.addEventListener('click', () => exitSort(id));
  renderPlan(ctx, t, sortDay);
  if (!unsubs.planFor || unsubs.planFor !== id) {
    unsubs.planFor = id;
    const re = () => {
      if (isBusy()) return;
      const cur = (S.trips || []).find(x => x.id === id); if (!cur) return;
      const m = location.hash.match(/\/plan(?:\/sort\/(\d+))?$/);
      if (location.hash.startsWith(`#/trip/${id}/plan`) && m) renderPlan(ctx, cur, m[1] != null ? +m[1] : null);
    };
    unsubs.push(watchBookings(ctx, id, re));
    unsubs.push(watchItems(ctx, id, () => {
      if (isBusy()) return;
      const cur = (S.trips || []).find(x => x.id === id); if (!cur) return;
      const m = location.hash.match(/\/plan(?:\/sort\/(\d+))?$/);
      if (location.hash.startsWith(`#/trip/${id}/plan`) && m) renderPlan(ctx, cur, m[1] != null ? +m[1] : null);
    }));
  }
}

/* ───────── 交通住宿頁 ───────── */
export function renderTripBook(ctx, id, focusId = null) {
  const { S } = ctx;
  const t = (S.trips || []).find(x => x.id === id);
  if (!t || !(t.memberUids || []).includes(S.user.uid)) {
    $('#main').innerHTML = `<div class="wrap">${ctx.topBar(homeBtn)}${S.trips ? '<section class="card"><b>找不到這趟旅程</b><p class="small muted" style="margin:0">可能已經被刪除，或你不是這趟旅程的成員。</p></section>' : '<div class="spinner" style="margin:40px auto"></div>'}</div>`;
    ctx.bindTop(); return;
  }
  $('#main').innerHTML = `<div class="wrap has-tabs">${ctx.topBar(`<div class="row" style="gap:4px;min-width:0">${homeBtn}
      <div style="min-width:0"><div class="title ellip" style="font-size:17px">${esc(t.name)}</div><div class="tiny faint ellip">${esc(placesText(t.places))}</div></div></div>`)}
    <div id="bookBody" style="display:flex;flex-direction:column;gap:14px"></div>
  </div>${tabBar(id, 'ticket')}`;
  ctx.bindTop(); bindTabs();
  renderBook(ctx, t, focusId);
  if (unsubs.bookFor !== id) {
    unsubs.bookFor = id;
    unsubs.push(watchBookings(ctx, id, () => {
      if (isBusy() || !location.hash.startsWith(`#/trip/${id}/book`)) return;
      const cur = (S.trips || []).find(x => x.id === id); if (cur) renderBook(ctx, cur);
    }));
  }
}

/* ───────── 準備清單頁 ───────── */
export function renderTripMoney(ctx, id) {
  const { S } = ctx;
  const t = (S.trips || []).find(x => x.id === id);
  if (!t || !(t.memberUids || []).includes(S.user.uid)) {
    $('#main').innerHTML = `<div class="wrap">${ctx.topBar(homeBtn)}${S.trips ? '<section class="card"><b>找不到這趟旅程</b><p class="small muted" style="margin:0">可能已經被刪除，或你不是這趟旅程的成員。</p></section>' : '<div class="spinner" style="margin:40px auto"></div>'}</div>`;
    ctx.bindTop(); return;
  }
  $('#main').innerHTML = `<div class="wrap has-tabs has-fab">${ctx.topBar(`<div class="row" style="gap:4px;min-width:0">${homeBtn}
      <div style="min-width:0"><div class="title ellip" style="font-size:17px">${esc(t.name)}</div><div class="tiny faint ellip">${esc(placesText(t.places))}</div></div></div>`)}
    <div id="mnBody" style="display:flex;flex-direction:column;gap:14px"></div>
  </div><button type="button" class="fab hidden" id="fab" aria-label="記一筆">${ic.plus}</button>${tabBar(id, 'money')}`;
  ctx.bindTop(); bindTabs();
  renderMoney(ctx, t);
  if (unsubs.mnFor !== id) {
    unsubs.mnFor = id;
    unsubs.push(watchMoney(ctx, id, () => {
      if (isBusy() || location.hash !== `#/trip/${id}/money` || document.querySelector('#sheet')) return;
      const cur = (S.trips || []).find(x => x.id === id); if (cur) renderMoney(ctx, cur);
    }));
  }
}

export function renderTripChecklist(ctx, id) {
  const { S } = ctx;
  const t = (S.trips || []).find(x => x.id === id);
  if (!t || !(t.memberUids || []).includes(S.user.uid)) {
    $('#main').innerHTML = `<div class="wrap">${ctx.topBar(homeBtn)}${S.trips ? '<section class="card"><b>找不到這趟旅程</b><p class="small muted" style="margin:0">可能已經被刪除，或你不是這趟旅程的成員。</p></section>' : '<div class="spinner" style="margin:40px auto"></div>'}</div>`;
    ctx.bindTop(); return;
  }
  const seg = localGet('lsseg:' + id) === 'shop' ? 'shop' : 'ck';
  $('#main').innerHTML = `<div class="wrap has-tabs has-fab">${ctx.topBar(`<div class="row" style="gap:4px;min-width:0">${homeBtn}
      <div style="min-width:0"><div class="title ellip" style="font-size:17px">${esc(t.name)}</div><div class="tiny faint ellip">${esc(placesText(t.places))}</div></div></div>`)}
    <div class="ttabs" role="tablist" aria-label="清單">
      <button type="button" role="tab" data-ls="ck" aria-selected="${seg === 'ck'}">${ic.list}準備清單</button><button type="button" role="tab" data-ls="shop" aria-selected="${seg === 'shop'}">${ic.bag}購物清單</button></div>
    <div id="${seg === 'ck' ? 'ckBody' : 'shBody'}" style="display:flex;flex-direction:column;gap:14px"></div>
  </div><button type="button" class="fab hidden" id="fab" aria-label="新增">${ic.plus}</button>${tabBar(id, 'list')}`;
  ctx.bindTop(); bindTabs();
  $$('[data-ls]').forEach(b => b.addEventListener('click', () => { if (b.dataset.ls === seg) return; tabFrom(b); localSet('lsseg:' + id, b.dataset.ls); renderTripChecklist(ctx, id); window.scrollTo(0, 0); tabSlide(); }));
  const again = () => {
    if (isBusy() || location.hash !== `#/trip/${id}/list` || document.querySelector('#sheet')) return;
    const cur = (S.trips || []).find(x => x.id === id); if (!cur) return;
    if ($('#ckBody')) renderChecklist(ctx, cur); else renderShop(ctx, cur);
  };
  if (seg === 'ck') {
    renderChecklist(ctx, t);
    if (unsubs.ckFor !== id) { unsubs.ckFor = id; unsubs.push(watchChecklist(ctx, id, again)); }
  } else {
    renderShop(ctx, t);
    if (unsubs.shFor !== id) { unsubs.shFor = id; unsubs.push(watchShop(ctx, id, again)); }
  }
}
