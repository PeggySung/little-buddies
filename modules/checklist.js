// 準備清單：每個人都要做、指定成員、有人帶就好（認領）；分類、範本
import { doc, collection, onSnapshot, setDoc, updateDoc, deleteDoc, deleteField, serverTimestamp, writeBatch } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { $, $$, esc, ic, toast, localGet, localSet } from './ui.js';
import { avatarHTML } from './profile.js';
import { openSheet, closeSheet } from './plan.js';
import { countryBy } from './places.js';

export const SCOPES = {
  all:    { label: '每個人', hint: '每個人都要自己完成' },
  assign: { label: '指定成員', hint: '只有選到的人要完成' },
  claim:  { label: '有人帶就好', hint: '一個人認領就好，例如共用的東西' }
};
const CAT_ORDER = ['出發前要做', '證件與重要物品', '衣物與鞋子', '盥洗與個人用品', '電子產品', '自駕', '日常小物', '出發當天最後確認'];

/* ───────── 範本 ───────── */
// [分類, 項目, 範圍, 備註]；指定成員的項目匯入時先變成「有人帶就好」，再自己改
const T = (cat, items) => items.map(([text, scope = 'all', note = '']) => ({ cat, text, scope, note }));
export const TEMPLATES = {
  abroad: { label: '出國基本', desc: '護照、入境手續、網路、外幣', items: [
    ...T('出發前要做', [['確認護照效期（6 個月以上）和英文姓名'], ['旅遊保險'], ['確認信用卡海外交易功能和額度'], ['手機漫遊、eSIM 或 Wi-Fi 分享器'], ['下載離線地圖、收藏景點'], ['查天氣和航班資訊']]),
    ...T('證件與重要物品', [['護照（正本）'], ['信用卡'], ['少量當地現金'], ['旅遊保險資料和緊急聯絡方式'], ['機票、訂房資料（截圖或電子檔）']]),
    ...T('電子產品', [['手機和充電線'], ['行動電源'], ['轉接頭', 'claim'], ['耳機']]),
    ...T('出發當天最後確認', [['護照放進隨身包'], ['手機、行動電源充飽電'], ['確認航班和報到時間'], ['門窗、瓦斯、電器都關好']])
  ] },
  domestic: { label: '國內旅遊', desc: '證件、車票、住宿', items: [
    ...T('出發前要做', [['確認車票或高鐵票'], ['確認住宿入住方式'], ['查天氣']]),
    ...T('證件與重要物品', [['身分證'], ['健保卡'], ['悠遊卡或一卡通'], ['信用卡、現金']]),
    ...T('電子產品', [['手機和充電線'], ['行動電源']]),
    ...T('出發當天最後確認', [['手機、行動電源充飽電'], ['門窗、瓦斯、電器都關好']])
  ] },
  packing: { label: '行李打包', desc: '衣物、盥洗、日常小物', items: [
    ...T('衣物與鞋子', [['上衣'], ['褲子或裙子'], ['外套'], ['內衣褲、襪子'], ['睡衣'], ['好走的鞋子'], ['拖鞋'], ['摺疊傘或輕便雨衣']]),
    ...T('盥洗與個人用品', [['牙刷、牙膏'], ['洗面乳、保養品'], ['防曬乳'], ['卸妝用品'], ['個人常備藥'], ['生理用品'], ['OK 繃、暈車藥']]),
    ...T('日常小物', [['摺疊購物袋'], ['夾鏈袋、收納袋'], ['髒衣袋'], ['水壺'], ['面紙、濕紙巾'], ['太陽眼鏡'], ['旅行用電子秤', 'claim']])
  ] },
  drive: { label: '自駕', desc: '駕照、導航、還車', items: [
    ...T('證件與重要物品', [['駕照正本（要開車的人）', 'claim'], ['國際駕照或駕照譯本（要開車的人）', 'claim'], ['租車訂單', 'claim']]),
    ...T('自駕', [['手機車架', 'claim'], ['車用充電線、車充', 'claim'], ['確認車上能不能用 CarPlay／Android Auto', 'claim'], ['租車公司電話和道路救援資訊', 'claim'], ['確認保險和免責補償內容', 'claim'], ['取車時拍下車身四周和既有刮痕', 'claim'], ['確認油種、還車油量和附近加油站', 'claim'], ['確認停車場地址和收費', 'claim']])
  ] },
  beach: { label: '海邊', desc: '泳衣、防曬、防水', items: [
    ...T('衣物與鞋子', [['泳衣'], ['海灘拖鞋或溯溪鞋']]),
    ...T('日常小物', [['手機防水袋'], ['毛巾'], ['防蚊用品', 'claim'], ['保冷袋', 'claim']]),
    ...T('盥洗與個人用品', [['防水防曬乳'], ['曬後修護']])
  ] },
  snow: { label: '雪地', desc: '保暖、防滑', items: [
    ...T('衣物與鞋子', [['發熱衣褲'], ['羽絨外套'], ['毛帽、手套、圍巾'], ['防滑雪靴或冰爪'], ['毛襪']]),
    ...T('日常小物', [['暖暖包'], ['護唇膏、乳液']])
  ] }
};

/* ───────── 各國入境手續（以台灣護照為準）───────── */
// 規定常常變，備註都提醒出發前再到外交部領事事務局確認
const SCHENGEN = ['FR', 'DE', 'IT', 'ES', 'NL', 'AT', 'CZ', 'CH'];
const ENTRY = {
  JP: ['填 Visit Japan Web（入境、海關申報）', '截圖入境 QR Code'],
  KR: ['填韓國電子入境卡 e-Arrival', 'K-ETA 免申請到 2026/12/31，之後出發要再確認'],
  TH: ['填泰國數位入境卡 TDAC', '抵達前 3 天內填寫'],
  SG: ['填新加坡入境卡 SG Arrival Card', '抵達前 3 天內填寫'],
  MY: ['填馬來西亞數位入境卡 MDAC', '抵達前 3 天內填寫'],
  VN: ['申請越南電子簽證 e-Visa', '審核要幾天，提早申請'],
  PH: ['填菲律賓 eTravel', '抵達前 72 小時內填寫；簽證規定也要確認'],
  ID: ['申請印尼落地簽 e-VOA，填入境卡', '可以先在網路上申請'],
  HK: ['申請香港預辦入境登記', '線上申請，免費'],
  MO: ['確認澳門入境證件（台胞證或入境許可）'],
  CN: ['確認台胞證效期'],
  US: ['申請美國 ESTA', '要付費，最好出發前 3 天以上申請'],
  CA: ['申請加拿大 eTA', '要付費，最好提早申請'],
  GB: ['申請英國電子旅行許可 UK ETA', '要付費，最好提早申請'],
  AU: ['申請澳洲 ETA（用官方 App）', '要付費，最好提早申請'],
  NZ: ['申請紐西蘭 NZeTA', '要付費，最好提早申請；入境前也可以填旅客申報 NZTD'],
  TR: ['申請土耳其電子簽證 e-Visa'],
  EU: ['確認歐洲 ETIAS 旅行許可是否已經要申請', '申根區免簽，ETIAS 上路後要先線上申請']
};
const CHECK_NOTE = '出發前再確認最新規定';
export function entryItems(t) {
  const out = [], seen = new Set();
  (t.places || []).forEach(p => {
    if (!p.country || p.country === 'TW') return;
    const key = SCHENGEN.includes(p.country) ? 'EU' : p.country;
    if (seen.has(key)) return; seen.add(key);
    const name = countryBy(p.country)?.name || p.countryName || '目的地';
    const [text, note] = ENTRY[key] || [`確認${name}的入境規定和簽證`];
    out.push({ cat: '出發前要做', text, scope: 'all', note: note ? `${note}。${CHECK_NOTE}` : CHECK_NOTE });
  });
  return out;
}
function templateItems(k, t) {
  const items = TEMPLATES[k].items;
  if (k !== 'abroad') return items;
  return [items[0], ...entryItems(t), ...items.slice(1)];
}

/* ───────── 即時資料 ───────── */
const cache = {};
export function watchChecklist(ctx, tripId, onChange) {
  const c = cache[tripId] || (cache[tripId] = { list: null, unsub: null, listeners: new Set() });
  c.listeners.add(onChange);
  if (!c.unsub) {
    c.unsub = onSnapshot(collection(ctx.S.db, 'trips', tripId, 'checklist'), snap => {
      c.list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      c.listeners.forEach(f => f());
    }, e => { console.error(e); toast('讀取清單失敗：' + (e?.code || e?.message)); });
  }
  return () => c.listeners.delete(onChange);
}
export function stopAllChecklist() { Object.values(cache).forEach(c => c.unsub?.()); Object.keys(cache).forEach(k => delete cache[k]); }

/* ───────── 誰要做、誰做完了 ───────── */
function people(t, x) {
  const ms = (t.memberUids || []).filter(u => t.members?.[u]);
  if (x.scope === 'assign') return (x.who || []).filter(u => ms.includes(u));
  if (x.scope === 'claim') return x.claimBy && ms.includes(x.claimBy) ? [x.claimBy] : [];
  return ms;
}
const isDone = (x, u) => !!x.done?.[u];
function itemDone(t, x) {
  const ps = people(t, x);
  return ps.length > 0 && ps.every(u => isDone(x, u));
}
function mine(t, x, me) {
  if (x.scope === 'claim') return !x.claimBy || x.claimBy === me;
  return people(t, x).includes(me);
}

/* ───────── 畫面 ───────── */
export function renderChecklist(ctx, t) {
  const host = $('#ckBody'); if (!host) return;
  const list = cache[t.id]?.list;
  if (list == null) { host.innerHTML = '<div class="spinner" style="margin:30px auto" role="status" aria-label="載入中"></div>'; return; }
  const me = ctx.S.user.uid;
  const view = localGet('ckview:' + t.id) || 'mine';
  const myItems = list.filter(x => mine(t, x, me));
  const myDone = myItems.filter(x => (x.scope === 'claim' ? x.claimBy === me && isDone(x, me) : isDone(x, me))).length;
  const shown = (view === 'mine' ? myItems : list);
  const cats = [...new Set(shown.map(x => x.cat || '其他'))].sort((a, b) => {
    const ia = CAT_ORDER.indexOf(a), ib = CAT_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  const fold = readFold(t.id);
  const catAll = c => shown.filter(x => (x.cat || '其他') === c).every(x => itemDone(t, x));
  const pct = myItems.length ? Math.round(myDone / myItems.length * 100) : 0;
  const bar = (p, label) => `<div class="bar" role="progressbar" aria-valuenow="${p}" aria-valuemin="0" aria-valuemax="100" aria-label="${esc(label)}"><i style="width:${p}%"></i></div>`;
  const seg = `<div class="seg" role="group" aria-label="顯示">
      <button type="button" data-view="mine" aria-pressed="${view === 'mine'}">我的（${myItems.length}）</button>
      <button type="button" data-view="all" aria-pressed="${view === 'all'}">全部・團隊（${list.length}）</button>
    </div>`;
  const mineCard = `<section class="card" style="gap:8px">
      <div class="row" style="justify-content:space-between"><b>我的進度</b><span class="num">${myDone} / ${myItems.length}</span></div>
      ${bar(pct, '我的進度')}
      <span class="tiny faint">只列出你要準備的項目，和還沒人認領的共用物品</span>
    </section>`;
  host.innerHTML = `
    <div class="dayhead"><h2 class="title">準備清單</h2></div>
    ${list.length ? seg + (view === 'mine' ? mineCard : teamCard(t, list, me, bar)) : ''}
    ${cats.length > 1 ? `<button type="button" class="linkbtn fold-all" id="ckFoldAll">${cats.every(c => isFolded(fold, c, catAll(c))) ? '全部展開' : '全部收合'}</button>` : ''}
    ${!list.length ? `<div class="card empty"><p class="small muted" style="margin:0">還沒有清單。可以從範本一次加入常用項目，再刪掉不需要的，或自己一項一項新增。</p>
        <button class="btn pri full" id="ckTpl">從範本加入</button></div>`
      : !shown.length ? '<div class="card empty"><p class="small muted" style="margin:0">你目前沒有要準備的項目。</p></div>'
      : cats.map(c => {
        const xs = shown.filter(x => (x.cat || '其他') === c).sort((a, b) => (a.order || 0) - (b.order || 0));
        const n = xs.filter(x => itemDone(t, x)).length;
        const open = !isFolded(fold, c, n === xs.length);
        return `<section class="sec"><h3 style="margin:0"><button type="button" class="sec-h fold" data-fold="${esc(c)}" aria-expanded="${open}">
            <span>${esc(c)} <span class="${n === xs.length ? 'ok' : 'faint'}">${n}/${xs.length}${n === xs.length ? ' ✓' : ''}</span></span>${ic.down}</button></h3>
          ${open ? `<div class="ck-list">${xs.map(x => rowHTML(t, x, me)).join('')}</div>` : ''}</section>`;
      }).join('')}
    ${list.length ? `<div class="grid2"><button class="btn" id="ckTpl">從範本加入</button><button class="btn" id="ckAdd">${ic.plus}新增項目</button></div>`
      : `<button class="btn full" id="ckAdd">${ic.plus}自己新增項目</button>`}`;
  $$('[data-view]', host).forEach(b => b.addEventListener('click', () => { localSet('ckview:' + t.id, b.dataset.view); renderChecklist(ctx, t); }));
  $$('[data-fold]', host).forEach(b => b.addEventListener('click', () => {
    fold[b.dataset.fold] = b.getAttribute('aria-expanded') === 'true'; // true＝收起來
    saveFold(t.id, fold); renderChecklist(ctx, t);
    $(`[data-fold="${CSS.escape(b.dataset.fold)}"]`, host)?.focus();
  }));
  $('#ckFoldAll', host)?.addEventListener('click', e => {
    const close = e.currentTarget.textContent === '全部收合';
    cats.forEach(c => { fold[c] = close; }); saveFold(t.id, fold); renderChecklist(ctx, t);
  });
  $('#ckAdd', host)?.addEventListener('click', () => editItem(ctx, t, null));
  $('#ckTpl', host)?.addEventListener('click', () => chooseTemplates(ctx, t));
  $$('[data-tick]', host).forEach(b => b.addEventListener('click', () => {
    const x = list.find(i => i.id === b.dataset.tick); if (!x) return;
    const on = !isDone(x, me);
    const data = { [`done.${me}`]: on ? true : deleteField(), updatedBy: me, updatedAt: serverTimestamp() };
    if (x.scope === 'claim' && !x.claimBy) data.claimBy = me; // 直接打勾＝我來帶
    write(updateDoc(doc(ctx.S.db, 'trips', t.id, 'checklist', x.id), data));
    x.done = { ...(x.done || {}) }; on ? (x.done[me] = true) : delete x.done[me]; if (data.claimBy) x.claimBy = me;
    renderChecklist(ctx, t);
  }));
  $$('[data-claim]', host).forEach(b => b.addEventListener('click', () => {
    const x = list.find(i => i.id === b.dataset.claim); if (!x) return;
    const take = x.claimBy !== me;
    write(updateDoc(doc(ctx.S.db, 'trips', t.id, 'checklist', x.id), { claimBy: take ? me : null, done: {}, updatedBy: me, updatedAt: serverTimestamp() }));
    x.claimBy = take ? me : null; x.done = {};
    toast(take ? '你負責帶這個' : '已取消認領');
    renderChecklist(ctx, t);
  }));
  $$('[data-cedit]', host).forEach(b => b.addEventListener('click', () => editItem(ctx, t, list.find(i => i.id === b.dataset.cedit))));
}
/* 分類收合：記在這台裝置；沒動過的分類，全部完成就自動收起來 */
function readFold(id) { try { return JSON.parse(localGet('ckfold:' + id) || '{}'); } catch { return {}; } }
function saveFold(id, f) { localSet('ckfold:' + id, JSON.stringify(f)); }
const isFolded = (f, c, allDone) => c in f ? !!f[c] : allDone;
function teamCard(t, list, me, bar) {
  const ms = (t.memberUids || []).filter(u => t.members?.[u]);
  const doneAll = list.filter(x => itemDone(t, x)).length;
  const pAll = list.length ? Math.round(doneAll / list.length * 100) : 0;
  const rows = ms.map(u => {
    const xs = list.filter(x => people(t, x).includes(u));
    const d = xs.filter(x => isDone(x, u)).length;
    const p = xs.length ? Math.round(d / xs.length * 100) : 0;
    const m = t.members[u];
    return `<div class="tm-row">${avatarHTML(m, 'sm')}
      <div class="tm-main"><div class="row" style="justify-content:space-between"><span class="small">${esc(m.nickname)}${u === me ? '<span class="faint">（你）</span>' : ''}</span>
        <span class="num small">${xs.length ? `${d} / ${xs.length}` : '—'}</span></div>${bar(p, m.nickname + ' 的進度')}</div></div>`;
  }).join('');
  const unclaimed = list.filter(x => x.scope === 'claim' && !x.claimBy).length;
  return `<section class="card" style="gap:12px">
    <div class="row" style="justify-content:space-between"><b>團隊進度</b><span class="num">${doneAll} / ${list.length} 項完成</span></div>
    ${bar(pAll, '團隊進度')}
    <div class="tm-list">${rows}</div>
    ${unclaimed ? `<span class="tiny muted">還有 ${unclaimed} 項共用物品沒人認領</span>` : ''}
  </section>`;
}
const write = p => p.catch(e => toast('儲存失敗：' + (e?.code || e?.message)));

function rowHTML(t, x, me) {
  const ps = people(t, x);
  const done = itemDone(t, x);
  const minePart = x.scope === 'claim' ? x.claimBy === me || !x.claimBy : ps.includes(me);
  const myOn = isDone(x, me);
  const who = x.scope === 'claim'
    ? (x.claimBy ? `<span class="tiny muted row" style="gap:4px">${avatarHTML(t.members[x.claimBy] || {}, 'xs')}${esc(t.members[x.claimBy]?.nickname || '')} 負責帶</span>`
      : '<span class="tiny faint">還沒有人認領</span>')
    : `<div class="stack ck-who">${ps.map(u => `<span class="${isDone(x, u) ? '' : 'undone'}" title="${esc(t.members[u]?.nickname || '')}${isDone(x, u) ? ' 已完成' : ' 未完成'}">${avatarHTML(t.members[u] || {}, 'xs')}</span>`).join('')}</div>`;
  return `<div class="ck ${done ? 'done' : ''}">
    ${minePart ? `<button class="ck-box" data-tick="${esc(x.id)}" role="checkbox" aria-checked="${myOn}" aria-label="${esc(x.text)}${x.scope === 'claim' && !x.claimBy ? '（打勾＝我來帶）' : ''}">${myOn ? ic.check : ''}</button>`
      : `<span class="ck-box ro" aria-hidden="true">${done ? ic.check : ''}</span>`}
    <div class="ck-main">
      <span class="ck-text">${esc(x.text)}</span>
      ${x.note ? `<span class="tiny muted">${esc(x.note)}</span>` : ''}
      <div class="row" style="gap:8px;flex-wrap:wrap">${who}
        ${x.scope === 'claim' ? `<button class="linkbtn" data-claim="${esc(x.id)}">${x.claimBy === me ? '取消認領' : x.claimBy ? '換我帶' : '我來帶'}</button>` : ''}
        ${x.scope === 'assign' ? '<span class="tiny faint">指定</span>' : ''}</div>
    </div>
    <button class="iconbtn" data-cedit="${esc(x.id)}" aria-label="編輯「${esc(x.text)}」">${ic.edit}</button>
  </div>`;
}

/* ───────── 新增／編輯 ───────── */
function editItem(ctx, t, x) {
  const { S } = ctx;
  const isNew = !x;
  const list = cache[t.id]?.list || [];
  const cats = [...new Set([...CAT_ORDER, ...list.map(i => i.cat).filter(Boolean)])];
  x = x || { text: '', note: '', cat: localGet('ckcat:' + t.id) || '出發前要做', scope: 'all', who: [], claimBy: null, done: {} };
  const ms = (t.memberUids || []).filter(u => t.members?.[u]);
  const who = new Set(x.who || []);
  let scope = x.scope || 'all';
  openSheet(`<div class="sheet-h"><h3 class="title">${isNew ? '新增項目' : '編輯項目'}</h3><button class="iconbtn" data-close aria-label="關閉">✕</button></div>
    <label class="field"><span>項目</span><input class="input" id="cText" maxlength="200" value="${esc(x.text)}" placeholder="例如：護照、訂餐廳、轉接頭"></label>
    <label class="field"><span>分類</span><select class="input" id="cCat">${cats.map(c => `<option ${c === (x.cat || '') ? 'selected' : ''}>${esc(c)}</option>`).join('')}<option value="__new">＋ 新分類…</option></select></label>
    <label class="field hidden" id="cNewWrap"><span>新分類名稱</span><input class="input" id="cNew" maxlength="20"></label>
    ${ms.length > 1 ? `<div class="field"><span id="lblScope">誰要做</span><div class="seg" role="group" aria-labelledby="lblScope">
      ${Object.entries(SCOPES).map(([k, v]) => `<button type="button" data-scope="${k}" aria-pressed="${scope === k}">${v.label}</button>`).join('')}</div>
      <span class="tiny faint" id="cScopeHint">${SCOPES[scope].hint}</span></div>
      <div class="field ${scope === 'assign' ? '' : 'hidden'}" id="cWhoWrap"><span id="lblWho">指定誰</span><div class="mem-pick" role="group" aria-labelledby="lblWho">
        ${ms.map(u => `<button type="button" class="mem" data-who="${esc(u)}" aria-pressed="${who.has(u)}">${avatarHTML(t.members[u], 'sm')}<span>${esc(t.members[u].nickname)}</span></button>`).join('')}</div></div>` : ''}
    <label class="field"><span>備註（選填）</span><input class="input" id="cNote" maxlength="200" value="${esc(x.note || '')}"></label>
    <div class="sheet-acts">${isNew ? '' : '<button class="btn danger" id="cDel">刪除</button>'}<button class="btn pri" id="cSave">儲存</button></div>`, s => {
    $('#cCat', s).addEventListener('change', e => $('#cNewWrap', s).classList.toggle('hidden', e.target.value !== '__new'));
    $$('[data-scope]', s).forEach(b => b.addEventListener('click', () => {
      scope = b.dataset.scope;
      $$('[data-scope]', s).forEach(y => y.setAttribute('aria-pressed', String(y === b)));
      $('#cScopeHint', s).textContent = SCOPES[scope].hint;
      $('#cWhoWrap', s).classList.toggle('hidden', scope !== 'assign');
    }));
    $$('[data-who]', s).forEach(b => b.addEventListener('click', () => { const u = b.dataset.who; who.has(u) ? who.delete(u) : who.add(u); b.setAttribute('aria-pressed', String(who.has(u))); }));
    $('#cSave', s).addEventListener('click', () => {
      const text = $('#cText', s).value.trim(); if (!text) { toast('請填項目'); return; }
      let cat = $('#cCat', s).value; if (cat === '__new') { cat = $('#cNew', s).value.trim(); if (!cat) { toast('請填新分類名稱'); return; } }
      if (ms.length <= 1) scope = 'all';
      if (scope === 'assign' && !who.size) { toast('請選要指定的成員'); return; }
      localSet('ckcat:' + t.id, cat);
      const data = { text, cat, note: $('#cNote', s).value.trim(), scope, who: scope === 'assign' ? [...who] : [],
        updatedBy: S.user.uid, updatedAt: serverTimestamp() };
      if (isNew) write(setDoc(doc(collection(S.db, 'trips', t.id, 'checklist')), { ...data, claimBy: null, done: {}, order: Date.now(), createdBy: S.user.uid, createdAt: serverTimestamp() }));
      else {
        // 換了「誰要做」，原本的完成狀態和認領就清掉，避免對不上
        const reset = scope !== x.scope ? { claimBy: null, done: {} } : {};
        write(updateDoc(doc(S.db, 'trips', t.id, 'checklist', x.id), { ...data, ...reset }));
      }
      closeSheet(); toast(navigator.onLine ? '已儲存' : '已儲存，恢復連線後會自動同步');
      setTimeout(() => renderChecklist(ctx, t), 0);
    });
    $('#cDel', s)?.addEventListener('click', () => {
      if (!confirm(`刪除「${x.text}」？`)) return;
      write(deleteDoc(doc(S.db, 'trips', t.id, 'checklist', x.id)));
      closeSheet(); toast('已刪除');
    });
  });
}

/* ───────── 從範本加入 ───────── */
function chooseTemplates(ctx, t) {
  const { S } = ctx;
  const list = cache[t.id]?.list || [];
  const have = new Set(list.map(i => i.text));
  const abroad = (t.places || []).some(p => p.country !== 'TW');
  const pick = new Set(abroad ? ['abroad', 'packing'] : ['domestic', 'packing']);
  openSheet(`<div class="sheet-h"><h3 class="title">從範本加入</h3><button class="iconbtn" data-close aria-label="關閉">✕</button></div>
    <p class="small muted" style="margin:0">可以複選。已經有的項目不會重複加入，加入後可以再編輯或刪除。</p>
    <div class="tpl-list">${Object.entries(TEMPLATES).map(([k, v]) => {
      const n = templateItems(k, t).filter(i => !have.has(i.text)).length;
      return `<button type="button" class="tpl" data-tpl="${k}" aria-pressed="${pick.has(k)}" ${n ? '' : 'disabled'}>
        <b>${v.label}</b><span class="tiny muted">${v.desc}</span><span class="tiny faint">${n ? `${n} 項` : '都已加入'}</span></button>`;
    }).join('')}</div>
    <div class="sheet-acts"><button class="btn pri" id="tAdd">加入</button></div>`, s => {
    $$('[data-tpl]', s).forEach(b => b.addEventListener('click', () => { const k = b.dataset.tpl; pick.has(k) ? pick.delete(k) : pick.add(k); b.setAttribute('aria-pressed', String(pick.has(k))); }));
    $('#tAdd', s).addEventListener('click', () => {
      const seen = new Set(have);
      const items = [];
      [...pick].forEach(k => templateItems(k, t).forEach(i => { if (!seen.has(i.text)) { seen.add(i.text); items.push(i); } }));
      if (!items.length) { toast('沒有新的項目可以加入'); return; }
      const solo = (t.memberUids || []).length <= 1;
      const batch = writeBatch(S.db);
      const base = Date.now();
      items.forEach((i, n) => batch.set(doc(collection(S.db, 'trips', t.id, 'checklist')), {
        text: i.text, cat: i.cat, note: i.note || '', scope: solo ? 'all' : i.scope, who: [], claimBy: null, done: {},
        order: base + n, createdBy: S.user.uid, createdAt: serverTimestamp(), updatedBy: S.user.uid, updatedAt: serverTimestamp()
      }));
      write(batch.commit());
      closeSheet(); toast(`加入了 ${items.length} 項`);
      setTimeout(() => renderChecklist(ctx, t), 0);
    });
  });
}
