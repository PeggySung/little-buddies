// 旅程：首頁列表與足跡、開新旅程、旅程頁、邀請碼、加入旅程
import { doc, collection, query, where, onSnapshot, getDoc, setDoc, updateDoc, deleteDoc, arrayUnion,
  serverTimestamp, Timestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { $, $$, esc, ic, toast, copyText, localGet, localSet } from './ui.js';
import { avatarHTML } from './profile.js';
import { adjustForPeers } from './color.js';
import { renderPlan, watchItems } from './plan.js';
import { COUNTRIES, countryBy, CURRENCIES, CUR_NAME, timeZones, todayIn, dayCount, tripStatus, STATUS_LABEL,
  fmtRange, placesText } from './places.js';

export const APP_VERSION = 'v0.3';
const OTHER = 'OT'; // 清單以外的國家
const INVITE_DAYS = 7;

/* ───────── 訂閱管理：換頁時取消上一頁的即時更新 ───────── */
let unsubs = [], inviteSubId = null;
export function cleanup() { unsubs.forEach(u => { try { u(); } catch {} }); unsubs = []; inviteSubId = null; }
// 注意：unsubs.planFor 會隨著 unsubs = [] 一起清掉

/* ───────── 旅程清單：登入後訂閱一次，一直保持即時更新 ─────────
   小夥伴讀得到所有旅程（算「我們的足跡」用），旅伴只讀得到自己參加的 */
let tripsUnsub = null;
export function ensureTrips(ctx, onChange) {
  const { S } = ctx;
  if (tripsUnsub && tripsUnsub.uid === S.user.uid) return;
  stopTrips();
  const q = S.profile.coreId ? collection(S.db, 'trips') : query(collection(S.db, 'trips'), where('memberUids', 'array-contains', S.user.uid));
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
function stampHTML(t, size = 72, rot = -9) {
  const p = (t.places || [])[0] || {};
  const c = countryBy(p.country);
  const en = c ? c.en : (p.countryName || '').toUpperCase();
  const label = p.city || (c ? c.name : p.countryName) || '';
  const ym = (t.start || '').slice(0, 7).replace('-', '.');
  return `<div class="stamp" style="--s:${size}px;transform:rotate(${rot}deg)" aria-hidden="true"><div>
    <b class="num">${esc(en.slice(0, 11))}</b><span class="title">${esc(label.slice(0, 4))}</span><i class="num">${esc(ym)}</i></div></div>`;
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
        <div class="small muted">${esc(placesText(t.places))}</div>
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
export function renderHome(ctx) {
  const { S } = ctx;
  const uid = S.user.uid;
  const core = !!S.profile.coreId;
  const draw = () => {
    if (location.hash.replace(/^#\/?/, '') !== '') return;
    const all = S.trips;
    const mine = all ? all.filter(t => (t.memberUids || []).includes(uid)) : null;
    const groups = mine ? ['now', 'plan', 'done'].map(k => [k, mine.filter(t => tripStatus(t) === k)
      .sort((a, b) => k === 'done' ? b.start.localeCompare(a.start) : a.start.localeCompare(b.start))]) : [];
    // 足跡：已經出發過的旅程（小夥伴看全部，旅伴看自己的）
    const fp = (all || []).filter(t => (core || (t.memberUids || []).includes(uid)) && tripStatus(t) !== 'plan')
      .sort((a, b) => b.start.localeCompare(a.start));
    const countries = new Set(), regions = new Set(), people = new Set();
    fp.forEach(t => { (t.places || []).forEach(p => { const k = p.country === OTHER ? p.countryName : p.country; countries.add(k); regions.add(k + '/' + (p.city || '')); });
      (t.memberUids || []).forEach(m => people.add(m)); });
    const stats = [[countries.size, '國家'], [regions.size, '地區'], [fp.length, '趟旅程'], [people.size, '位旅伴']];
    $('#main').innerHTML = `<div class="wrap">${ctx.topBar(ctx.brand)}
      <div><div class="small muted">嗨，${esc(S.profile.nickname)}</div>
        <h1 class="title" style="font-size:25px;line-height:1.35">下一趟想去哪裡粗國玩？</h1></div>
      <section class="card">
        <div class="row" style="justify-content:space-between"><h2 class="title" style="font-size:17px">${core ? '我們的足跡' : '我的足跡'}</h2></div>
        <div class="stats">${stats.map(([n, l]) => `<div><b class="num">${n}</b><span class="tiny faint">${l}</span></div>`).join('')}</div>
        <div class="stamps">${fp.slice(0, 5).map((t, i) => stampHTML(t, 70, [-9, 7, -4, 10, -12][i])).join('')}
          <div class="stamp-empty small faint">下一站</div></div>
      </section>
      ${core ? `<a class="btn pri full" href="#/new">${ic.plus}開新旅程</a>` : ''}
      ${!mine ? '<div class="spinner" style="margin:24px auto" role="status" aria-label="載入中"></div>'
        : mine.length === 0 ? `<section class="card empty"><p class="small muted" style="margin:0">${core
          ? '還沒有旅程。按上面的「開新旅程」開始規劃，再邀請小夥伴和旅伴加入。'
          : '小夥伴邀請你加入旅程後，旅程會出現在這裡。收到邀請連結就直接點開吧！'}</p></section>`
        : groups.filter(([, ts]) => ts.length).map(([k, ts]) => `<section class="sec">
            <h2 class="sec-h">${STATUS_LABEL[k]}</h2>${ts.map(t => tripCard(t, uid)).join('')}</section>`).join('')}
      <p class="tiny faint" style="text-align:center;margin:0">小夥伴粗國玩 ${APP_VERSION}</p>
    </div>`;
    ctx.bindTop();
  };
  draw();
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
      : { id: 'new', name: '', places: [{ country: 'JP', city: '' }], start: '', end: '', currency: 'JPY', tz: 'Asia/Tokyo', settleCurrency: 'TWD', autoFill: true };
  }
  const f = form;
  const tzs = timeZones();
  if (!tzs.includes(f.tz)) tzs.unshift(f.tz);
  $('#main').innerHTML = `<div class="wrap">${ctx.topBar(`<a class="iconbtn" href="${editing ? `#/trip/${esc(tripId)}` : '#/'}" aria-label="取消" style="margin-left:-10px">${ic.back}</a>`)}
    <h1 class="title" style="font-size:25px">${editing ? '編輯旅程' : '開新旅程'}</h1>
    <section class="card">
      <label class="field"><span>旅程名稱</span>
        <input class="input" id="tName" maxlength="40" value="${esc(f.name)}" placeholder="例如：小夥伴粗國玩 北海道之旅"></label>
      <div class="field"><span>目的地</span>
        ${f.places.map((p, i) => `<div class="place-row">
          <select class="input" data-pc="${i}" aria-label="第 ${i + 1} 個目的地的國家">
            ${COUNTRIES.map(c => `<option value="${c.code}" ${p.country === c.code ? 'selected' : ''}>${c.name}</option>`).join('')}
            <option value="${OTHER}" ${p.country === OTHER ? 'selected' : ''}>其他國家</option></select>
          ${p.country === OTHER ? `<input class="input" data-pn="${i}" maxlength="20" value="${esc(p.countryName || '')}" placeholder="國家" aria-label="國家名稱">` : ''}
          <input class="input" data-pcity="${i}" maxlength="20" value="${esc(p.city || '')}" placeholder="城市／地區（選填）" aria-label="第 ${i + 1} 個目的地的城市">
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
    if (!confirm(`確定要刪除「${editing.name}」嗎？刪除後無法復原。`)) return;
    try { await deleteDoc(doc(S.db, 'trips', tripId)); form = null; location.hash = '#/'; toast('已刪除'); }
    catch (e) { toast('刪除失敗：' + (e?.code || e?.message)); }
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
    const base = location.origin + location.pathname;
    $('#main').innerHTML = `<div class="wrap">${ctx.topBar(`<a class="iconbtn" href="#/" aria-label="回首頁" style="margin-left:-10px">${ic.back}</a>`)}
      <div class="trip-top">
        <div style="display:flex;flex-direction:column;gap:6px;min-width:0">
          <h1 class="title" style="font-size:23px;line-height:1.35">${esc(t.name)}</h1>
          <div class="small muted">${esc(placesText(t.places))}</div>
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
          </div></div>`).join('')}
        ${ms.length === 1 ? '<p class="tiny faint" style="margin:0">目前只有你一個人，就是獨旅。邀請旅伴加入後，記帳會自動出現分攤和結算。</p>' : ''}
      </section>
      ${owner ? `<section class="card">
        <div class="row" style="justify-content:space-between"><h2 class="title" style="font-size:17px">邀請旅伴</h2></div>
        ${invites === null ? '<div class="spinner" style="margin:8px auto"></div>' : active.length ? active.map(v => `<div class="invite">
            <div class="row" style="justify-content:space-between;align-items:flex-end">
              <div><div class="tiny faint">邀請碼</div><div class="num code">${esc(v.id)}</div></div>
              <div class="tiny faint" style="text-align:right">${esc(fmtDate(v.expiresAt))} 前有效</div>
            </div>
            <div class="grid2">
              <button class="btn" data-share="${esc(v.id)}">${ic.copy}${navigator.share ? '分享連結' : '複製連結'}</button>
              <button class="btn" data-off="${esc(v.id)}">停用</button>
            </div></div>`).join('') : '<p class="small muted" style="margin:0">產生邀請連結，傳給小夥伴或旅伴。對方點開、用 Google 登入就能加入。</p>'}
        <button class="btn ${active.length ? '' : 'pri'} full" id="newInvite">${ic.plus}${active.length ? '再產生一組' : '產生邀請連結'}</button>
        <p class="tiny faint" style="margin:0">連結 ${INVITE_DAYS} 天後失效；不想再讓人加入，按「停用」就好。</p>
      </section>` : ''}
      ${member ? `<a class="card" href="#/trip/${esc(id)}/plan" style="text-decoration:none;flex-direction:row;align-items:center;gap:14px">
        <span class="kind" aria-hidden="true">${ic.trip}</span>
        <div style="flex:1;display:flex;flex-direction:column;gap:2px"><b>行程</b><span class="small muted">每天的行程、地圖導航、備案</span></div>
        <span class="faint">${ic.chev}</span></a>` : ''}
      <section class="card">
        <div class="row" style="justify-content:space-between"><h2 class="title" style="font-size:17px">接下來會開放</h2><span class="chip">製作中</span></div>
        <p class="small muted" style="margin:0">交通住宿、準備清單、記帳會在之後的版本陸續加上。</p>
      </section>
      ${owner ? `<a class="btn full" href="#/trip/${esc(id)}/edit">${ic.edit}編輯旅程</a>` : ''}
      ${!member ? '<p class="tiny faint" style="text-align:center;margin:0">你沒有參加這趟旅程，只能看摘要。</p>' : ''}
    </div>${member ? tabBar(id, 'home') : ''}`;
    if (member) $('.wrap').classList.add('has-tabs');
    ctx.bindTop(); bindTabs();
    $('#newInvite')?.addEventListener('click', () => createInvite(ctx, t));
    $$('[data-share]').forEach(b => b.addEventListener('click', () => shareInvite(t, b.dataset.share, base)));
    $$('[data-off]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('停用後，這組邀請碼就不能再用來加入。確定嗎？')) return;
      try { await updateDoc(doc(S.db, 'invites', b.dataset.off), { disabled: true }); toast('已停用'); }
      catch (e) { toast('停用失敗：' + (e?.code || e?.message)); }
    }));
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
async function createInvite(ctx, t) {
  const { S } = ctx;
  const code = newCode();
  try {
    await setDoc(doc(S.db, 'invites', code), {
      tripId: t.id, tripName: t.name, places: t.places, start: t.start, end: t.end, tz: t.tz,
      ownerName: S.profile.nickname, createdBy: S.user.uid, disabled: false,
      createdAt: serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + INVITE_DAYS * 86400000)
    });
    toast('邀請連結產生好了');
  } catch (e) { toast('產生失敗：' + (e?.code || e?.message)); }
}
async function shareInvite(t, code, base) {
  const url = `${base}?join=${code}`;
  const text = `一起去粗國玩！加入「${t.name}」：`;
  if (navigator.share) { try { await navigator.share({ title: '小夥伴粗國玩', text, url }); return; } catch (e) { if (e?.name === 'AbortError') return; } }
  copyText(`${text}${url}`);
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
      <div class="small muted">${esc(placesText(inv.places))}</div>
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
  const tabs = [['home', '總覽', `#/trip/${id}`], ['trip', '行程', `#/trip/${id}/plan`], ['ticket', '交通住宿', ''], ['list', '清單', ''], ['money', '記帳', '']];
  return `<nav class="tabbar" aria-label="旅程分頁">${tabs.map(([k, l, href]) => href
    ? `<a href="${href}" class="${active === k ? 'on' : ''}" ${active === k ? 'aria-current="page"' : ''}><span class="pill">${ic[k]}</span>${l}</a>`
    : `<button type="button" class="soon" data-soon="${l}"><span class="pill">${ic[k]}</span>${l}</button>`).join('')}</nav>`;
}
function bindTabs() { $$('[data-soon]').forEach(b => b.addEventListener('click', () => toast(`「${b.dataset.soon}」還在製作中，下一版開放`))); }

/* ───────── 行程頁 ───────── */
export function renderTripPlan(ctx, id) {
  const { S } = ctx;
  const t = (S.trips || []).find(x => x.id === id);
  const back = `<a class="iconbtn" href="#/trip/${esc(id)}" aria-label="回旅程總覽" style="margin-left:-10px">${ic.back}</a>`;
  if (!t || !(t.memberUids || []).includes(S.user.uid)) {
    $('#main').innerHTML = `<div class="wrap">${ctx.topBar(back)}${S.trips ? '<section class="card"><b>找不到這趟旅程</b><p class="small muted" style="margin:0">可能已經被刪除，或你不是這趟旅程的成員。</p></section>' : '<div class="spinner" style="margin:40px auto"></div>'}</div>`;
    ctx.bindTop(); return;
  }
  $('#main').innerHTML = `<div class="wrap has-tabs">${ctx.topBar(`<div class="row" style="gap:4px;min-width:0">${back}
      <div style="min-width:0"><div class="title ellip" style="font-size:17px">${esc(t.name)}</div><div class="tiny faint ellip">${esc(placesText(t.places))}</div></div></div>`)}
    <div id="planBody" style="display:flex;flex-direction:column;gap:14px"></div>
  </div>${tabBar(id, 'trip')}`;
  ctx.bindTop(); bindTabs();
  renderPlan(ctx, t);
  if (!unsubs.planFor || unsubs.planFor !== id) {
    unsubs.planFor = id;
    unsubs.push(watchItems(ctx, id, () => {
      if (location.hash !== `#/trip/${id}/plan` || document.getElementById('sheet')) return;
      const cur = (S.trips || []).find(x => x.id === id); if (cur) renderPlan(ctx, cur);
    }));
  }
}
