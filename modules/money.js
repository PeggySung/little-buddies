// 記帳：每種幣別分開結算（日圓的帳用日圓還、台幣的帳用台幣還，不用匯率）
// 多人付款、各自金額、旅途中先結清、代購、退稅；有人按「已轉帳」後，那個幣別的帳目就鎖定
import { doc, collection, onSnapshot, setDoc, updateDoc, deleteDoc, serverTimestamp, runTransaction, getDocs, query, where, arrayUnion, arrayRemove } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { $, $$, esc, ic, toast, localGet, localSet, copyText, tabFrom, tabSlide, foldOut, foldIn } from './ui.js';
import { avatarHTML } from './profile.js';
import { openSheet, closeSheet, kindIcon } from './plan.js';
import { CUR_NAME, CURRENCIES, todayIn } from './places.js';

/* ───────── 幣別與金額（內部一律用「分」＝ 金額 × 100 的整數）───────── */
// 沒有小數的幣別：平均分攤時以 1 元為單位，不會出現 ¥333.34
const ZERO = new Set(['JPY', 'KRW', 'TWD', 'VND', 'IDR', 'CLP', 'ISK', 'HUF']);
const SYM = { TWD: 'NT$', JPY: '¥', KRW: '₩', CNY: 'CN¥', USD: 'US$', EUR: '€', GBP: '£', THB: '฿', HKD: 'HK$', SGD: 'S$', AUD: 'A$',
  NZD: 'NZ$', CAD: 'C$', MOP: 'MOP$', PHP: '₱', VND: '₫', MYR: 'RM', IDR: 'Rp', CHF: 'CHF ', CZK: 'Kč ', TRY: '₺' };
const unitOf = cur => ZERO.has(cur) ? 100 : 1;
export const toC = n => Math.round(Number(n) * 100) || 0;
const sum = o => Object.values(o).reduce((a, b) => a + b, 0);
export function money(c, cur, signed = false) {
  const dec = c % 100 === 0 ? 0 : 2;
  const s = (Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  const sign = signed ? (c > 0 ? '+' : c < 0 ? '−' : '') : c < 0 ? '−' : '';
  return sign + (SYM[cur] || cur + ' ') + s;
}
const curName = c => CUR_NAME[c] || c;
// 簡單算式：1200+850、3600/4、1,199（只接受數字、＋−×÷ 和括號）。空白＝null，看不懂＝NaN
export function evalAmt(s) {
  const t = String(s ?? '').replace(/[,，\s¥$€£₩฿₫]/g, '').replace(/＋/g, '+').replace(/[－−ー]/g, '-').replace(/[×xX＊]/g, '*').replace(/[÷／]/g, '/')
    .replace(/（/g, '(').replace(/）/g, ')').replace(/[０-９．]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  if (!t) return null;
  let i = 0;
  const num = () => { const m = /^\d+(\.\d+)?/.exec(t.slice(i)); if (!m) throw 0; i += m[0].length; return Number(m[0]); };
  const atom = () => { if (t[i] === '(') { i++; const v = add(); if (t[i] !== ')') throw 0; i++; return v; } if (t[i] === '-') { i++; return -atom(); } return num(); };
  const mul = () => { let v = atom(); while (t[i] === '*' || t[i] === '/') { const o = t[i++], b = atom(); if (o === '/' && !b) throw 0; v = o === '*' ? v * b : v / b; } return v; };
  const add = () => { let v = mul(); while (t[i] === '+' || t[i] === '-') { const o = t[i++], b = mul(); v = o === '+' ? v + b : v - b; } return v; };
  try { const v = add(); if (i !== t.length || !isFinite(v) || v < 0) return NaN; return Math.round(v * 100) / 100; } catch { return NaN; }
}

/* ───────── 分類（圖示沿用行程的線條圖示）───────── */
export const CATS = {
  food: { label: '餐飲', icon: 'food' },
  move: { label: '交通', icon: 'train' },
  stay: { label: '住宿', icon: 'stay' },
  fun: { label: '門票玩樂', icon: 'spot' },
  shop: { label: '購物', icon: 'shop' },
  other: { label: '其他', icon: null }
};
const catIcon = (k, cls = '') => CATS[k]?.icon ? kindIcon(CATS[k].icon, k === 'move', cls) : `<span class="kind ${cls} other" aria-hidden="true">${ic.coin}</span>`;

/* ───────── 成員 ───────── */
const mems = t => (t.memberUids || []).filter(u => t.members?.[u]);
const nm = (t, u) => t.members?.[u]?.nickname || '（已離開）';
const av = (t, u, size = 'xs') => avatarHTML(t.members?.[u] || { nickname: '?' }, size);
// 成員順序：旅程的成員順序，已離開的人排最後
const orderOf = (t, extra = []) => { const ms = mems(t); return [...ms, ...extra.filter(u => !ms.includes(u))]; };

/* ───────── 一筆記帳的付款與應付（單位：分）─────────
   付款：paid {成員: 金額} 是多人付款；沒有的話 payer 付全額
   應付：shares {成員: 金額} 是各自金額；沒有的話 split 平均分攤
   代購：proxy [{owner 負責人, client 委託人, name, amount}]，成本算負責人的，不分給大家 */
const mainPayer = paid => Object.keys(paid).sort((a, b) => paid[b] - paid[a])[0] || null;
// 平均分攤：以幣別的最小單位分；除不盡的零頭從付款人開始，照成員順序每人多分一單位
function evenShares(A, members, U, order) {
  const ms = order.filter(m => members.includes(m)), n = ms.length, out = {};
  if (!n) return out;
  const base = Math.floor(A / n / U) * U;
  ms.forEach(m => out[m] = base);
  let rem = A - base * n, i = 0;
  while (rem > 0) { const x = Math.min(U, rem); out[ms[i % n]] += x; rem -= x; i++; }
  return out;
}
const partsCache = new WeakMap();
export function exParts(e, t) {
  let r = partsCache.get(e); if (r) return r;
  const A = toC(e.amount), paid = {}, share = {}, byOwner = {};
  if (e.paid && Object.keys(e.paid).length) for (const [u, v] of Object.entries(e.paid)) { const c = toC(v); if (c > 0) paid[u] = c; }
  else if (e.payer) paid[e.payer] = A;
  let px = 0;
  for (const x of e.proxy || []) { const c = toC(x.amount); if (c > 0 && x.owner) { byOwner[x.owner] = (byOwner[x.owner] || 0) + c; px += c; } }
  const own = Math.max(0, A - px), mp = mainPayer(paid);
  const order = orderOf(t, [...Object.keys(paid), ...(e.split || []), ...Object.keys(e.shares || {})]);
  const payerFirst = mp ? [mp, ...order.filter(u => u !== mp)] : order;
  if (e.shares && Object.keys(e.shares).length) { for (const [u, v] of Object.entries(e.shares)) { const c = toC(v); if (c > 0) share[u] = c; } }
  else Object.assign(share, evenShares(own, e.split || [], unitOf(e.cur), payerFirst));
  // 保險：合計對不上的舊資料，差額算主要付款人（存檔時已經檢查，正常不會發生）
  const k = mp || (e.split || [])[0];
  const d1 = own - sum(share); if (d1 && k) share[k] = (share[k] || 0) + d1;
  for (const [u, v] of Object.entries(byOwner)) share[u] = (share[u] || 0) + v;
  const d2 = A - sum(paid); if (d2 && k) paid[k] = (paid[k] || 0) + d2;
  r = { A, paid, share, own, byOwner, order };
  partsCache.set(e, r); return r;
}
// 這筆單獨看的還法：欠最多的先還給多付最多的
function planTransfers(paid, share, order) {
  const net = m => (paid[m] || 0) - (share[m] || 0), ord = (a, b) => b[1] - a[1] || order.indexOf(a[0]) - order.indexOf(b[0]);
  const cr = order.filter(m => net(m) > 0).map(m => [m, net(m)]).sort(ord), db = order.filter(m => net(m) < 0).map(m => [m, -net(m)]).sort(ord);
  const out = []; let i = 0, j = 0;
  while (i < db.length && j < cr.length) {
    const x = Math.min(db[i][1], cr[j][1]); out.push({ from: db[i][0], to: cr[j][0], amt: x });
    db[i][1] -= x; cr[j][1] -= x; if (!db[i][1]) i++; if (!cr[j][1]) j++;
  }
  return out;
}
export const exTransfers = (e, t) => { const p = exParts(e, t); return planTransfers(p.paid, p.share, p.order); };
// 旅途中已經先還掉這筆的人
const settledOf = (e, t) => { const ow = exTransfers(e, t).map(x => x.from); return (e.settled || []).filter(m => ow.includes(m)); };
// 最大餘數法：total（整數）照權重分，零頭給小數最大的
function lrAlloc(total, keys, w) {
  const W = keys.reduce((n, k) => n + (w[k] || 0), 0), out = {};
  keys.forEach(k => out[k] = 0);
  if (!W || !(total > 0)) return out;
  let left = total;
  const fr = keys.map((k, i) => { const v = total * (w[k] || 0) / W, f = Math.floor(v + 1e-9); out[k] = f; left -= f; return [k, v - f, i]; });
  fr.sort((a, b) => b[1] - a[1] || a[2] - b[2]);
  for (let i = 0; i < left && i < fr.length; i++) out[fr[i][0]]++;
  return out;
}
/* 退稅：refund {actual 實際退回金額, who 誰領到, settled 已經把那份拿到的人}
   照每個人在這筆的應付比例分；錢在 who 手上，等於 who 要把每人那份還給他 */
export function exRefund(e, t) {
  const N = toC(e.refund?.actual), who = e.refund?.who;
  if (!(N > 0) || !who) return null;
  const { share, order } = exParts(e, t), keys = order.filter(m => share[m] > 0), U = unitOf(e.cur);
  const y = N % U === 0 ? lrAlloc(N / U, keys, share) : lrAlloc(N, keys, share), k = N % U === 0 ? U : 1, parts = {};
  for (const m of keys) if (y[m]) parts[m] = y[m] * k;
  const settled = (e.refund.settled || []).filter(m => m !== who && parts[m] > 0);
  return { who, N, parts, settled };
}
// 把一筆記帳加進餘額（正數＝別人要給他，負數＝他要付出去）
function addBal(bal, e, t) {
  const { paid, share } = exParts(e, t);
  for (const m of new Set([...Object.keys(paid), ...Object.keys(share)])) bal[m] = (bal[m] || 0) + (paid[m] || 0) - (share[m] || 0);
  const done = settledOf(e, t);
  if (done.length) for (const x of exTransfers(e, t)) if (done.includes(x.from)) { bal[x.from] += x.amt; bal[x.to] -= x.amt; }
  const R = exRefund(e, t);
  if (R) {
    bal[R.who] = (bal[R.who] || 0) - R.N;
    for (const [m, v] of Object.entries(R.parts)) bal[m] = (bal[m] || 0) + v;
    for (const m of R.settled) { bal[m] -= R.parts[m]; bal[R.who] += R.parts[m]; }
  }
}
export function balancesOf(list, t) {
  const bal = {};
  for (const e of list) addBal(bal, e, t);
  for (const k of Object.keys(bal)) if (!bal[k]) delete bal[k];
  return bal;
}
const balKey = bal => JSON.stringify(Object.keys(bal).sort().map(k => [k, bal[k]]));
// 旅途中已經先結清的金額（不列入最後的轉帳）
function settledAmt(e, t) {
  const d = settledOf(e, t);
  let n = d.length ? exTransfers(e, t).filter(x => d.includes(x.from)).reduce((s, x) => s + x.amt, 0) : 0;
  const R = exRefund(e, t); if (R) for (const m of R.settled) n += R.parts[m];
  return n;
}
// 最少轉帳次數：找出最多個「總和為 0」的小團體，每團 k 人只要 k−1 筆轉帳（人太多時改用簡單的配對）
export function minTransfers(bal, order) {
  const ids = order.filter(k => bal[k]).concat(Object.keys(bal).filter(k => bal[k] && !order.includes(k))), n = ids.length;
  const greedy = mem => {
    const out = [];
    for (;;) {
      const d = mem.filter(x => x.b < 0).sort((a, b) => a.b - b.b)[0], c = mem.filter(x => x.b > 0).sort((a, b) => b.b - a.b)[0];
      if (!d || !c) break;
      const amt = Math.min(-d.b, c.b); out.push({ from: d.id, to: c.id, amount: amt }); d.b += amt; c.b -= amt;
    }
    return out;
  };
  if (!n) return [];
  if (n > 14) return greedy(ids.map(id => ({ id, b: bal[id] })));
  const N = 1 << n, s = new Array(N).fill(0), dp = new Array(N).fill(-1), pick = new Array(N).fill(0);
  for (let m = 1; m < N; m++) { const low = m & -m, i = 31 - Math.clz32(low); s[m] = s[m ^ low] + bal[ids[i]]; }
  dp[0] = 0;
  for (let m = 1; m < N; m++) {
    if (s[m] !== 0) continue;
    for (let x = m; x; x = (x - 1) & m) if (s[x] === 0 && dp[m ^ x] >= 0 && dp[m ^ x] + 1 > dp[m]) { dp[m] = dp[m ^ x] + 1; pick[m] = x; }
  }
  const out = []; let m = N - 1;
  while (m) { const g = pick[m] || m; m ^= g; out.push(...greedy(ids.filter((_, i) => g >> i & 1).map(id => ({ id, b: bal[id] })))); }
  return out;
}
// 某人在這筆的「自己花的」：應付 − 代購墊款 − 退稅拿回
export function myPart(e, t, u) {
  const p = exParts(e, t), R = exRefund(e, t);
  return (p.share[u] || 0) - (p.byOwner[u] || 0) - (R?.parts[u] || 0);
}

/* ───────── 照收據逐筆填 ─────────
   rcpt {ex 收據價格未稅, rate 稅率, low 減免稅率, items [{name, price, who {成員: 份數}, px {owner, client} 代購, low 用減免稅率, noDisc 不參加折扣}]}
   1. 未稅時每行先加稅（照幣別的最小單位四捨五入）
   2. 實付 − 品項合計 ＝ 折扣（負）或服務費、稅（正），照每行金額比例分給參加的品項
   3. 每行的成本照份數分給選到的人；代購那行算負責人的
   存檔時換算成 shares／proxy，結算只看這兩個；rcpt 只給編輯畫面還原用 */
export function rcCalc(A, rc, cur) {
  const U = unitOf(cur), err = [], warn = [];
  const rows = (rc.items || []).map((x, i) => {
    const p = evalAmt(x.price), base = p == null || isNaN(p) ? NaN : toC(p);
    const r = rc.ex ? (x.low ? Number(rc.low) || 0 : Number(rc.rate) || 0) : 0;
    const taxed = isNaN(base) ? 0 : Math.round(base * (100 + r) / 100 / U) * U;
    return { ...x, i, base, taxed };
  });
  rows.forEach(x => {
    if (x.price !== '' && x.price != null && isNaN(x.base)) err.push(`第 ${x.i + 1} 行的價格看不懂`);
    else if (x.taxed > 0 && !x.px && !Object.values(x.who || {}).some(q => q > 0)) err.push(`第 ${x.i + 1} 行${x.name ? `「${x.name}」` : ''}還沒選是誰的`);
    if (x.taxed > 0 && x.px && (!x.px.owner || (!x.px.cid && !x.px.client))) err.push(`第 ${x.i + 1} 行的代購要選委託人`);
  });
  const live = rows.filter(x => x.taxed > 0), S = live.reduce((n, x) => n + x.taxed, 0);
  const D = isNaN(A) ? 0 : A - S;
  const join = live.filter(x => !x.noDisc), pool = join.length ? join : live;
  const keys = pool.map(x => x.i), w = Object.fromEntries(pool.map(x => [x.i, x.taxed]));
  const mag = Math.abs(D), k = mag % U === 0 ? U : 1, al = mag ? lrAlloc(mag / k, keys, w) : {};
  live.forEach(x => { x.cost = x.taxed + Math.sign(D) * (al[x.i] || 0) * k; x.charge = D < 0 ? x.taxed : x.cost; if (x.cost < 0) err.push(`第 ${x.i + 1} 行折完變成負的，請檢查實付或「不參加折扣」`); });
  if (live.length && !isNaN(A) && S && Math.abs(D) > S * 0.3) warn.push(D < 0 ? `品項合計比實付多 ${money(-D, cur)}，是不是多打了一行？` : `實付比品項合計多 ${money(D, cur)}，是不是漏了一行？`);
  const shares = {}, byOwner = {}, proxy = [];
  for (const x of live) {
    if (x.px) { byOwner[x.px.owner] = (byOwner[x.px.owner] || 0) + x.cost; proxy.push({ owner: x.px.owner, cid: x.px.cid || null, client: x.px.client || '', name: x.name || '', amount: x.cost / 100, charge: x.charge / 100, k: x.k || rk() }); continue; }
    const ws = Object.fromEntries(Object.entries(x.who || {}).filter(([, q]) => q > 0)), ks = Object.keys(ws);
    const kk = x.cost % U === 0 ? U : 1, y = lrAlloc(x.cost / kk, ks, ws);
    x.parts = {}; ks.forEach(u => { const v = y[u] * kk; x.parts[u] = v; shares[u] = (shares[u] || 0) + v; });
  }
  // 看起來是未稅收據：品項合計乘上 1.05～1.15 剛好接近實付
  const looksEx = !rc.ex && live.length && D > 0 && S && A / S > 1.04 && A / S < 1.16;
  return { rows, live, S, D, shares, byOwner, proxy, err, warn, looksEx };
}
const rcClean = rc => ({ ex: !!rc.ex, rate: Number(rc.rate) || 0, low: Number(rc.low) || 0,
  items: rc.items.filter(x => evalAmt(x.price) > 0).map(x => ({ k: x.k || rk(), name: x.name || '', price: evalAmt(x.price), who: x.px ? {} : Object.fromEntries(Object.entries(x.who || {}).filter(([, q]) => q > 0)),
    px: x.px ? { owner: x.px.owner, cid: x.px.cid || null, client: x.px.client || '' } : null, low: !!x.low, noDisc: !!x.noDisc })) });

/* ───────── 即時資料（只有打開記帳頁時才訂閱）───────── */
const cache = {};
export function watchMoney(ctx, tripId, onChange) {
  const c = cache[tripId] || (cache[tripId] = { list: null, settle: null, clients: null, unsubs: [], listeners: new Set() });
  c.listeners.add(onChange);
  if (!c.unsubs.length) {
    const err = e => { console.error(e); toast('讀取記帳失敗：' + (e?.code || e?.message)); };
    c.unsubs.push(onSnapshot(collection(ctx.S.db, 'trips', tripId, 'expenses'), snap => {
      c.list = snap.docs.map(d => ({ id: d.id, ...d.data() })); c.listeners.forEach(f => f());
    }, err));
    c.unsubs.push(onSnapshot(collection(ctx.S.db, 'trips', tripId, 'settle'), snap => {
      c.settle = Object.fromEntries(snap.docs.map(d => [d.id, d.data()])); c.listeners.forEach(f => f());
    }, err));
    c.unsubs.push(onSnapshot(collection(ctx.S.db, 'trips', tripId, 'clients'), snap => {
      c.clients = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant')); c.listeners.forEach(f => f());
    }, err));
  }
  return () => c.listeners.delete(onChange);
}
export function stopAllMoney() { Object.values(cache).forEach(c => c.unsubs.forEach(u => u())); Object.keys(cache).forEach(k => delete cache[k]); Object.keys(keep).forEach(k => delete keep[k]); }
const isLocked = (tripId, cur) => !!cache[tripId]?.settle?.[cur]?.locked;
const write = p => p.catch(e => toast(e?.code === 'permission-denied' ? '存不進去：這個幣別可能剛被鎖定，請重新整理' : '儲存失敗：' + (e?.code || e?.message)));

/* ───────── 畫面 ───────── */
const fold = { get: id => { try { return JSON.parse(localGet('mnfold:' + id) || '{}'); } catch { return {}; } }, set: (id, f) => localSet('mnfold:' + id, JSON.stringify(f)) };
const expDay = e => e.date || '9999-12-31';
const W = ['日', '一', '二', '三', '四', '五', '六'];
const dayLabel = ds => ds === '9999-12-31' ? '沒填日期' : `${+ds.slice(5, 7)}/${+ds.slice(8, 10)}（${W[new Date(ds + 'T00:00:00Z').getUTCDay()]}）`;

export function renderMoney(ctx, t) {
  const host = $('#mnBody'); if (!host) return;
  const c = cache[t.id];
  if (!c || c.list == null || c.settle == null || c.clients == null) { host.innerHTML = '<div class="spinner" style="margin:30px auto" role="status" aria-label="載入中"></div>'; return; }
  const me = ctx.S.user.uid, list = c.list, solo = mems(t).length <= 1;
  const hasPx = list.some(e => (e.proxy || []).length) || c.clients.length > 0;
  let tab = localGet('mntab:' + t.id) || 'list';
  void hasPx;
  if (tab === 'settle' && solo) tab = 'list';
  const tabs = [['list', '明細'], ...(solo ? [] : [['settle', '結算']]), ['proxy', '代購']];
  host.innerHTML = `<div class="dayhead"><h2 class="title">記帳</h2></div>
    ${tabs.length > 1 ? `<div class="utabs" role="tablist" aria-label="記帳分頁">${tabs.map(([k, l]) => `<button type="button" role="tab" data-mtab="${k}" aria-selected="${tab === k}">${l}</button>`).join('')}</div>` : ''}
    ${tab === 'settle' ? settleHTML(t, list, c.settle) : tab === 'proxy' ? proxyHTML(t, list, me) : listHTML(t, list, me, solo)}`;
  $$('[data-mtab]', host).forEach(b => b.addEventListener('click', () => { if (b.getAttribute('aria-selected') === 'true') return; tabFrom(b); localSet('mntab:' + t.id, b.dataset.mtab); renderMoney(ctx, t); window.scrollTo(0, 0); tabSlide(host); }));
  $$('[data-ex]', host).forEach(b => b.addEventListener('click', () => editExpense(ctx, t, list.find(e => e.id === b.dataset.ex))));
  $$('[data-mfold]', host).forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.mfold, closing = b.getAttribute('aria-expanded') === 'true';
    const f = fold.get(t.id); f[k] = closing; fold.set(t.id, f);
    const again = () => $(`[data-mfold="${CSS.escape(k)}"]`, host);
    if (closing) foldOut([b], () => { renderMoney(ctx, t); again()?.focus(); });
    else { renderMoney(ctx, t); const nb = again(); if (nb) { nb.focus(); foldIn([nb]); } }
  }));
  $$('[data-mf]', host).forEach(b => b.addEventListener('click', () => { localSet('mnf:' + t.id, b.dataset.mf); renderMoney(ctx, t); }));
  $('#mnMine', host)?.addEventListener('click', () => { localSet('mnmine:' + t.id, localGet('mnmine:' + t.id) === '1' ? null : '1'); renderMoney(ctx, t); });
  $('#mnAdd', host)?.addEventListener('click', () => editExpense(ctx, t, null));
  $$('[data-settle]', host).forEach(b => b.addEventListener('click', () => doSettle(ctx, t, b.dataset.settle, b)));
  $$('[data-paid]', host).forEach(b => b.addEventListener('click', () => setPaid(ctx, t, b.dataset.paid, b)));
  $('#pxNew', host)?.addEventListener('click', () => clientDialog(ctx, t));
  $('#pxImp', host)?.addEventListener('click', () => importClients(ctx, t));
  $$('[data-cl]', host).forEach(b => b.addEventListener('click', () => clientSheet(ctx, t, b.dataset.cl)));
  $$('[data-adopt]', host).forEach(b => b.addEventListener('click', () => {
    const [owner, name] = b.dataset.adopt.split('|');
    write(setDoc(doc(collection(ctx.S.db, 'trips', t.id, 'clients')), { name, owner, note: '', rate: null, pays: [], createdBy: ctx.S.user.uid, createdAt: serverTimestamp(), updatedBy: ctx.S.user.uid, updatedAt: serverTimestamp() }));
    toast(`已幫「${name}」建檔`);
  }));
  const fab = $('#fab');
  if (fab) { fab.classList.remove('hidden'); fab.onclick = () => editExpense(ctx, t, null); }
}

function listHTML(t, list, me, solo) {
  if (!list.length) return `<div class="card empty"><p class="small muted" style="margin:0">還沒有任何記帳。${solo ? '獨旅也可以記，方便看自己花了多少。' : '誰先付錢、要分給哪些人，記下來最後一鍵結算。'}</p>
    <button class="btn pri full" id="mnAdd">${ic.plus}記第一筆</button></div>`;
  // 我的花費：每種幣別一行
  const curs = [...new Set(list.map(e => e.cur))].sort((a, b) => (a === t.currency ? -1 : b === t.currency ? 1 : a.localeCompare(b)));
  const sumCard = `<section class="card" style="gap:10px">
    <div class="row" style="justify-content:space-between"><b>${solo ? '花費' : '我的花費'}</b><span class="tiny faint">只算自己的份，不含代購${solo ? '' : '和別人的'}</span></div>
    ${curs.map(cur => {
      const xs = list.filter(e => e.cur === cur), mine = xs.reduce((s, e) => s + myPart(e, t, me), 0), tot = xs.reduce((s, e) => s + toC(e.amount), 0);
      return `<div class="mn-sum"><span class="cur-badge">${esc(cur)}</span><b class="num">${money(mine, cur)}</b>${solo ? '' : `<span class="tiny faint num">全團 ${money(tot, cur)}</span>`}</div>`;
    }).join('')}
  </section>`;
  const f = curs.includes(localGet('mnf:' + t.id)) ? localGet('mnf:' + t.id) : 'all', mineOnly = !solo && localGet('mnmine:' + t.id) === '1';
  const filters = curs.length > 1 || !solo ? `<div class="mn-filter">
      ${curs.length > 1 ? [['all', '全部'], ...curs.map(c => [c, curName(c)])].map(([k, l]) => `<button type="button" class="pillbtn" data-mf="${esc(k)}" aria-pressed="${f === k}">${esc(l)}</button>`).join('') : ''}
      ${solo ? '' : `<button type="button" class="pillbtn" id="mnMine" aria-pressed="${mineOnly}">只看跟我有關</button>`}
    </div>` : '';
  const xs = list.filter(e => (f === 'all' || e.cur === f) && (!mineOnly || (() => { const p = exParts(e, t); return p.paid[me] || p.share[me]; })()))
    .sort((a, b) => expDay(b).localeCompare(expDay(a)) || (b.createdAt?.seconds || 9e12) - (a.createdAt?.seconds || 9e12));
  const days = [...new Set(xs.map(expDay))], fd = fold.get(t.id);
  const groups = days.map(ds => {
    const g = xs.filter(e => expDay(e) === ds), open = !fd[ds];
    const tot = {}; g.forEach(e => tot[e.cur] = (tot[e.cur] || 0) + toC(e.amount));
    return `<section class="sec"><h3 style="margin:0"><button type="button" class="sec-h fold" data-mfold="${esc(ds)}" aria-expanded="${open}">
        <span>${dayLabel(ds)} <span class="faint">${g.length} 筆・${Object.entries(tot).map(([c, v]) => money(v, c)).join('＋')}</span></span>${ic.down}</button></h3>
      ${open ? `<div class="ck-list">${g.map(e => rowHTML(t, e, me, solo)).join('')}</div>` : ''}</section>`;
  }).join('');
  return sumCard + filters + (groups || '<div class="card empty"><p class="small muted" style="margin:0">沒有符合的記帳</p></div>');
}

function rowHTML(t, e, me, solo) {
  const p = exParts(e, t), payers = Object.keys(p.paid), split = Object.keys(p.share).filter(u => (p.share[u] || 0) - (p.byOwner[u] || 0) > 0);
  const mine = myPart(e, t, me), locked = isLocked(t.id, e.cur);
  const tags = [e.rcpt ? '逐筆' : '', (e.proxy || []).length ? '代購' : '', e.refund?.actual ? '退稅' : '', settledAmt(e, t) ? '已先結清' : ''].filter(Boolean);
  return `<button type="button" class="mn-row" data-ex="${esc(e.id)}" aria-label="${esc(e.name)} ${money(p.A, e.cur)}，編輯">
    ${catIcon(e.cat, 'sm')}
    <span class="mn-main"><span class="mn-name">${esc(e.name)}</span>
      ${solo ? '' : `<span class="tiny muted row" style="gap:4px;flex-wrap:wrap"><span class="stack">${payers.map(u => av(t, u)).join('')}</span>${payers.length > 1 ? `${payers.length} 人付` : `${esc(nm(t, payers[0]))} 付`}・${split.length} 人分${tags.map(x => `<span class="tag">${x}</span>`).join('')}${locked ? `<span class="tag">${ic.lock || ''}鎖定</span>` : ''}</span>`}
      ${solo && tags.length ? `<span class="tiny muted">${tags.join('・')}</span>` : ''}</span>
    <span class="mn-amt"><b class="num">${money(p.A, e.cur)}</b>${!solo && mine ? `<span class="tiny num ${mine > 0 ? '' : 'faint'}">我 ${money(mine, e.cur)}</span>` : ''}</span>
  </button>`;
}

/* ───────── 結算 ───────── */
function settleHTML(t, list, settle) {
  const curs = [...new Set([...list.map(e => e.cur), ...Object.keys(settle)])];
  if (!curs.length) return '<div class="card empty"><p class="small muted" style="margin:0">還沒有記帳，記了之後這裡會算出誰要給誰多少。</p></div>';
  return `<p class="tiny faint" style="margin:0">每種幣別分開結算：日圓的帳用日圓還、台幣的帳用台幣還，不用換匯率。</p>` + curs.map(cur => {
    const xs = list.filter(e => e.cur === cur), st = settle[cur], locked = !!st?.locked;
    const bal = balancesOf(xs, t), order = orderOf(t, Object.keys(bal)), fresh = st && balKey(st.bal || {}) === balKey(bal);
    const total = xs.reduce((s, e) => s + toC(e.amount), 0), done = xs.reduce((s, e) => s + settledAmt(e, t), 0);
    let res;
    if (!Object.keys(bal).length && !st) res = `<p class="small" style="margin:0;color:var(--ok)">大家剛好打平，不用轉帳 🎉</p>`;
    else if (!st || (!fresh && !locked)) res = `<p class="small muted" style="margin:0">${st ? '結算後記帳有變動，請重新結算。' : '按下結算，算出最少次數的轉帳。'}</p>
      <button class="btn pri full" data-settle="${esc(cur)}">${ic.coin}結算${esc(curName(cur))}</button>`;
    else if (!st.transfers.length) res = `<p class="small" style="margin:0;color:var(--ok)">大家剛好打平，不用轉帳 🎉</p>`;
    else res = `<div class="tr-list">${st.transfers.map((x, i) => `<div class="tr ${x.paid ? 'paid' : ''}">
        <span class="tr-flow">${av(t, x.from, 'sm')}<span class="small">${esc(nm(t, x.from))}</span><span aria-label="給" class="faint">→</span>${av(t, x.to, 'sm')}<span class="small">${esc(nm(t, x.to))}</span></span>
        <b class="num">${money(x.amount, cur)}</b>
        <button type="button" class="pillbtn" data-paid="${esc(cur)}:${i}" aria-pressed="${!!x.paid}">${x.paid ? '✓ 已轉帳' : '已轉帳？'}</button></div>`).join('')}</div>
      ${!fresh ? '<p class="tiny" style="margin:0;color:var(--danger)">結算之後記帳金額有變動（可能是離線時改的），請先把「已轉帳」都取消再重新結算。</p>' : ''}
      ${locked ? `<div class="lock-note">${ic.lock || ''}<span>已經有人轉帳，${esc(curName(cur))}帳目鎖定中：不能新增、刪除記帳或改金額，品名、分類、日期、備註可以改。把「已轉帳」全部取消就會解鎖。</span></div>`
        : `<button class="btn" data-settle="${esc(cur)}">重新結算</button>`}`;
    return `<section class="card" style="gap:12px">
      <div class="row" style="justify-content:space-between"><b><span class="cur-badge">${esc(cur)}</span> ${esc(curName(cur))}</b>${locked ? '<span class="chip">鎖定中</span>' : ''}</div>
      <div class="small muted">共 ${xs.length} 筆・總支出 <b class="num" style="color:var(--ink)">${money(total, cur)}</b>${done ? `<br><span class="tiny">其中 <span class="num">${money(done, cur)}</span> 已在旅途中先結清，不列入下方的轉帳</span>` : ''}</div>
      <div class="bal-grid">${order.filter(u => mems(t).includes(u) || bal[u]).map(u => `<div>${av(t, u, 'sm')}<span class="tiny ellip">${esc(nm(t, u))}</span>
        <span class="num small ${bal[u] > 0 ? 'pos' : bal[u] < 0 ? 'neg' : 'faint'}">${bal[u] ? money(bal[u], cur, true) : '±0'}</span></div>`).join('')}</div>
      <p class="tiny faint" style="margin:0;text-align:center">＋ 別人要給他・− 他要付出去</p>
      ${res}</section>`;
  }).join('');
}
async function doSettle(ctx, t, cur, btn) {
  if (!navigator.onLine) { toast('結算需要網路，連上後再按一次'); return; }
  btn.disabled = true;
  const xs = (cache[t.id]?.list || []).filter(e => e.cur === cur), bal = balancesOf(xs, t);
  const tr = minTransfers(bal, orderOf(t, Object.keys(bal)));
  const ref = doc(ctx.S.db, 'trips', t.id, 'settle', cur);
  try {
    await runTransaction(ctx.S.db, async tx => {
      const s = await tx.get(ref);
      if (s.exists() && s.data().locked) throw new Error('locked');
      tx.set(ref, { cur, transfers: tr.map(x => ({ ...x, paid: false, paidBy: null, paidAt: null })), bal, count: xs.length, locked: false, by: ctx.S.user.uid, at: serverTimestamp() });
    });
    toast('結算完成');
  } catch (e) { toast(e.message === 'locked' ? '已經有人轉帳，帳目鎖定中' : '結算失敗：' + (e?.code || e?.message)); btn.disabled = false; }
}
async function setPaid(ctx, t, key, btn) {
  if (!navigator.onLine) { toast('需要網路，連上後再按一次'); return; }
  const [cur, i] = key.split(':'), st = cache[t.id]?.settle?.[cur], x = st?.transfers?.[+i]; if (!x) return;
  const val = !x.paid, paidN = st.transfers.filter(y => y.paid).length;
  const msg = val ? `${nm(t, x.from)} → ${nm(t, x.to)}　${money(x.amount, cur)}\n標記為已轉帳？${paidN ? '' : `\n\n標記後${curName(cur)}帳目會鎖定：不能新增、刪除記帳，也不能改金額。`}`
    : `取消「${nm(t, x.from)} → ${nm(t, x.to)}」的已轉帳？${paidN === 1 ? `\n\n這是最後一筆已轉帳，取消後${curName(cur)}帳目會解鎖。` : ''}`;
  if (!confirm(msg)) return;
  btn.disabled = true;
  const ref = doc(ctx.S.db, 'trips', t.id, 'settle', cur);
  try {
    await runTransaction(ctx.S.db, async tx => {
      const s = await tx.get(ref); if (!s.exists()) throw new Error('gone');
      const trs = s.data().transfers.map(y => ({ ...y }));
      trs[+i] = { ...trs[+i], paid: val, paidBy: val ? ctx.S.user.uid : null, paidAt: val ? Date.now() : null };
      tx.update(ref, { transfers: trs, locked: trs.some(y => y.paid), by: ctx.S.user.uid });
    });
  } catch (e) { toast(e.message === 'gone' ? '結算結果已被清除，請重新整理' : '更新失敗：' + (e?.code || e?.message)); btn.disabled = false; }
}

/* ───────── 委託人（每趟旅程一份；和成員結算無關）─────────
   trips/{id}/clients/{cid}：{name, owner 負責收錢的成員, note, rate 代購匯率（1 當地幣 ＝ ? 結算幣）, pays 收款紀錄}
   代購項目（expense.proxy[]）用 cid 對到委託人；舊資料沒有 cid 的，照「名字＋負責人」對 */
export const clientsOf = t => cache[t.id]?.clients || [];
export const rk = () => Math.random().toString(36).slice(2, 8);
const pxKey = (e, x, i) => `${e.id}:${x.k || '#' + i}`;
const matchClient = (cs, x) => x.cid ? cs.find(c => c.id === x.cid) : cs.find(c => c.name === x.client && c.owner === x.owner);
// 某位委託人的代購項目（照付款日期）、未收／已收
function clientState(t, list, c) {
  const cs = clientsOf(t), all = [];
  for (const e of list) (e.proxy || []).forEach((x, i) => { if (toC(x.amount) > 0 && matchClient(cs, x)?.id === c.id) all.push({ key: pxKey(e, x, i), e, x, amt: toC(x.charge ?? x.amount) }); });
  all.sort((a, b) => expDay(a.e).localeCompare(expDay(b.e)));
  const pays = Array.isArray(c.pays) ? c.pays : [], paidKeys = new Set(pays.flatMap(p => p.keys || []));
  return { all, pays, unpaid: all.filter(i => !paidKeys.has(i.key)), paid: all.filter(i => paidKeys.has(i.key)) };
}
// 要收多少：各幣別合計；有代購匯率時，當地幣換成結算幣（合計後無條件進位一次）
function dueOf(t, items, c) {
  const tot = {}; items.forEach(i => tot[i.e.cur] = (tot[i.e.cur] || 0) + i.amt);
  const rate = Number(c?.rate), local = t.currency, settle = t.settleCurrency;
  let conv = null;
  if (rate > 0 && local !== settle && tot[local]) { const U = unitOf(settle); conv = Math.ceil(tot[local] * rate / U - 1e-9) * U + (tot[settle] || 0); }
  const text = Object.entries(tot).map(([cur, v]) => money(v, cur)).join('＋') || money(0, local);
  return { tot, conv, text: text + (conv != null ? `（≈ ${money(conv, settle)}）` : ''), short: conv != null ? money(conv, settle) : text };
}
const canRate = t => t.currency && t.settleCurrency && t.currency !== t.settleCurrency;

// 疊在彈出視窗上面的小視窗（新增委託人時不會關掉正在填的記帳）
function openDialog(html, onOpen) {
  const bg = document.createElement('div');
  bg.className = 'dlg-bg';
  bg.innerHTML = `<div class="dlg" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(bg);
  const close = () => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { bg.remove(); return; }
    bg.classList.add('out'); setTimeout(() => bg.remove(), 200);
  };
  bg.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close(); bg.dispatchEvent(new Event('cancel')); } });
  onOpen(bg.firstElementChild, close, bg);
  bg.querySelector('input,select,textarea,button')?.focus();
  return close;
}
// 新增／編輯委託人。回傳 Promise<委託人 id 或 null>
export function clientDialog(ctx, t, c = null, ownerDef = null) {
  const { S } = ctx, me = S.user.uid, ms = mems(t);
  let owner = c?.owner || ownerDef || me;
  return new Promise(res => {
    openDialog(`<h3 class="title" style="font-size:18px">${c ? '編輯委託人' : '新增委託人'}</h3>
      <label class="field"><span>名稱</span><input class="input" id="dName" maxlength="40" value="${esc(c?.name || '')}" placeholder="例如：媽媽、同事小美"></label>
      ${ms.length > 1 ? `<div class="field"><span>誰負責向他收錢</span><div class="mem-pick" id="dOwn">${ms.map(u => `<button type="button" class="mem" data-own="${esc(u)}" aria-pressed="${owner === u}">${av(t, u, 'sm')}<span>${esc(nm(t, u))}</span></button>`).join('')}</div></div>` : ''}
      <label class="field"><span>備註（選填）</span><input class="input" id="dNote" maxlength="200" value="${esc(c?.note || '')}" placeholder="LINE 名稱、怎麼付款…"></label>
      ${canRate(t) ? `<label class="field"><span>代購匯率（選填）</span><div class="row" style="gap:8px"><span class="small nowrap">1 ${esc(t.currency)} ＝</span><input class="input num" id="dRate" inputmode="decimal" value="${c?.rate ? esc(String(c.rate)) : esc(localGet('pxrate:' + t.id) || '')}" placeholder="例如 0.218"><span class="small">${esc(t.settleCurrency)}</span></div>
        <span class="tiny faint">有填的話，向他收錢時會換算成${esc(curName(t.settleCurrency))}（合計後無條件進位）</span></label>` : ''}
      <p class="small" id="dErr" style="margin:0;color:var(--danger)"></p>
      <div class="sheet-acts" style="position:static"><button class="btn" id="dNo">取消</button><button class="btn pri" id="dOk">${c ? '儲存' : '新增'}</button></div>`, (d, close, bg) => {
      let done = false;
      const finish = v => { if (done) return; done = true; close(); res(v); };
      bg.addEventListener('cancel', () => finish(null));
      $$('[data-own]', d).forEach(b => b.addEventListener('click', () => { owner = b.dataset.own; $$('[data-own]', d).forEach(y => y.setAttribute('aria-pressed', String(y === b))); }));
      $('#dNo', d).addEventListener('click', () => finish(null));
      $('#dOk', d).addEventListener('click', () => {
        const name = $('#dName', d).value.trim(); if (!name) { $('#dErr', d).textContent = '請填名稱'; return; }
        if (clientsOf(t).some(x => x.name === name && x.owner === owner && x.id !== c?.id)) { $('#dErr', d).textContent = `${nm(t, owner)} 已經有一位叫「${name}」的委託人`; return; }
        const rv = $('#dRate', d)?.value.trim(), rate = rv ? Number(rv.replace(/[,，\s]/g, '')) : null;
        if (rv && !(rate > 0 && rate < 100000)) { $('#dErr', d).textContent = '匯率看不懂'; return; }
        if (rate) localSet('pxrate:' + t.id, String(rate));
        const data = { name, owner, note: $('#dNote', d).value.trim(), rate: rate || null, updatedBy: me, updatedAt: serverTimestamp() };
        const ref = c ? doc(S.db, 'trips', t.id, 'clients', c.id) : doc(collection(S.db, 'trips', t.id, 'clients'));
        write(c ? updateDoc(ref, data) : setDoc(ref, { ...data, pays: [], createdBy: me, createdAt: serverTimestamp() }));
        // 先放進畫面用的清單，選單馬上看得到
        const cc = cache[t.id]; if (cc && !c) cc.clients = [...(cc.clients || []), { id: ref.id, ...data, pays: [] }];
        finish(ref.id);
      });
    });
  });
}
// 從自己以前旅程的委託人帶入（只讀自己負責的）
async function importClients(ctx, t) {
  const { S } = ctx, me = S.user.uid;
  const others = (S.trips || []).filter(x => x.id !== t.id && (x.memberUids || []).includes(me));
  if (!others.length) { toast('還沒有其他旅程'); return; }
  toast('讀取以前的委託人…');
  const have = new Set(clientsOf(t).filter(c => c.owner === me).map(c => c.name)), found = new Map();
  try {
    for (const tr of others) {
      const qs = await getDocs(query(collection(S.db, 'trips', tr.id, 'clients'), where('owner', '==', me)));
      qs.docs.forEach(d => { const v = d.data(); if (!have.has(v.name) && !found.has(v.name)) found.set(v.name, { ...v, from: tr.name }); });
    }
  } catch (e) { toast('讀取失敗：' + (e?.code || e?.message)); return; }
  if (!found.size) { toast('以前的旅程沒有其他委託人可以帶入'); return; }
  const arr = [...found.values()];
  openDialog(`<h3 class="title" style="font-size:18px">從以前的旅程帶入</h3>
    <p class="tiny faint" style="margin:0">只列出你負責的委託人。帶入後由你負責收錢${canRate(t) ? '，匯率要重新確認' : ''}。</p>
    <div class="imp-list">${arr.map((c, i) => `<label class="imp"><input type="checkbox" data-imp="${i}" checked><span><b>${esc(c.name)}</b><span class="tiny faint">${esc(c.from)}${c.note ? '・' + esc(c.note) : ''}</span></span></label>`).join('')}</div>
    <div class="sheet-acts" style="position:static"><button class="btn" id="iNo">取消</button><button class="btn pri" id="iOk">帶入</button></div>`, (d, close) => {
    $('#iNo', d).addEventListener('click', close);
    $('#iOk', d).addEventListener('click', () => {
      const pick = $$('[data-imp]', d).filter(x => x.checked).map(x => arr[+x.dataset.imp]);
      pick.forEach(c => write(setDoc(doc(collection(S.db, 'trips', t.id, 'clients')), { name: c.name, owner: me, note: c.note || '', rate: null, pays: [], createdBy: me, createdAt: serverTimestamp(), updatedBy: me, updatedAt: serverTimestamp() })));
      close(); toast(pick.length ? `帶入了 ${pick.length} 位委託人` : '沒有選任何人');
    });
  });
}
// 委託人明細：未收（可以勾選記錄收款）、收款紀錄、對帳
function clientSheet(ctx, t, cid) {
  const { S } = ctx, me = S.user.uid;
  const paint = s => {
    const c = clientsOf(t).find(x => x.id === cid); if (!c) { closeSheet(); return; }
    const list = cache[t.id]?.list || [], st = clientState(t, list, c), sel = new Set(st.unpaid.map(i => i.key));
    const line = i => `${i.e.date ? dayLabel(i.e.date) + ' ' : ''}${i.x.name || i.e.name}　${money(i.amt, i.e.cur)}`;
    const copyTxt = () => `${c.name} 的代購（${t.name}）\n` + st.unpaid.map(line).join('\n') + `\n合計 ${dueOf(t, st.unpaid, c).text}${Number(c.rate) > 0 && canRate(t) ? `\n（匯率 1 ${t.currency} ＝ ${c.rate} ${t.settleCurrency}）` : ''}`;
    s.innerHTML = `<div class="sheet-h"><h3 class="title">${esc(c.name)}</h3><button class="iconbtn" data-close aria-label="關閉">✕</button></div>
      <div class="small muted cl-meta">${av(t, c.owner, 'xs')} ${esc(nm(t, c.owner))} 負責收錢${c.note ? `・${esc(c.note)}` : ''}
        ${canRate(t) ? `・${Number(c.rate) > 0 ? `匯率 1 ${esc(t.currency)} ＝ ${esc(String(c.rate))} ${esc(t.settleCurrency)}` : '沒設匯率'}` : ''}
        <button type="button" class="linkbtn" id="cEdit">編輯</button></div>
      <section class="card" style="gap:10px">
        <div class="row" style="justify-content:space-between;gap:8px"><b>${st.unpaid.length ? '還沒收' : st.all.length ? '都收齊了 🎉' : '還沒有代購'}</b>${st.unpaid.length ? `<b class="num" style="text-align:right">${dueOf(t, st.unpaid, c).text}</b>` : ''}</div>
        ${st.unpaid.length ? `<div class="px-items">${st.unpaid.map(i => `<label class="px-item"><input type="checkbox" data-pk="${esc(i.key)}" checked>
          <span class="tiny faint">${i.e.date ? dayLabel(i.e.date) : ''}</span><span class="small">${esc(i.x.name || i.e.name)}</span><span class="num small">${money(i.amt, i.e.cur)}</span></label>`).join('')}</div>
          <div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn pri" id="cPay" style="flex:1">記錄收款</button><button class="btn" id="cCopy">${ic.copy}複製對帳</button></div>
          <span class="tiny faint" id="cSel"></span>` : st.all.length ? '' : '<p class="small muted" style="margin:0">記帳時在代購選這位委託人，就會出現在這裡。</p>'}
      </section>
      ${st.pays.length ? `<section class="card" style="gap:10px"><b>收款紀錄</b>${st.pays.slice().sort((a, b) => b.at - a.at).map(p => {
        const its = st.all.filter(i => (p.keys || []).includes(i.key));
        return `<div class="pay"><div class="row" style="justify-content:space-between;gap:8px"><span class="small"><b class="num">${esc(p.text || '')}</b></span><button type="button" class="linkbtn" data-unpay="${esc(p.id)}" style="color:var(--danger)">取消</button></div>
          <span class="tiny faint">${new Date(p.at).toLocaleDateString('zh-TW')}・${esc(nm(t, p.by))} 記錄・${its.length} 件${(p.keys || []).length > its.length ? `（${(p.keys || []).length - its.length} 件的記帳已刪除）` : ''}</span>
          <span class="tiny muted">${its.map(i => esc(i.x.name || i.e.name)).join('、')}</span></div>`;
      }).join('')}</section>` : ''}
      ${!st.all.length ? `<button class="btn danger" id="cDel">刪除這位委託人</button>` : ''}`;
    const selLine = () => { const its = st.unpaid.filter(i => sel.has(i.key)); const el = $('#cSel', s); if (el) el.textContent = `勾選 ${its.length} 件，共 ${dueOf(t, its, c).text}`; $('#cPay', s) && ($('#cPay', s).disabled = !its.length); };
    selLine();
    $$('[data-pk]', s).forEach(x => x.addEventListener('change', () => { x.checked ? sel.add(x.dataset.pk) : sel.delete(x.dataset.pk); selLine(); }));
    $('#cEdit', s).addEventListener('click', () => clientDialog(ctx, t, c).then(() => setTimeout(() => paint(s), 50)));
    $('#cCopy', s)?.addEventListener('click', () => copyText(copyTxt()).then(() => toast('已複製對帳內容')));
    $('#cPay', s)?.addEventListener('click', () => {
      const its = st.unpaid.filter(i => sel.has(i.key)); if (!its.length) return;
      const d = dueOf(t, its, c);
      if (!confirm(`記錄 ${c.name} 付了 ${d.text}？`)) return;
      const p = { id: rk(), at: Date.now(), by: me, keys: its.map(i => i.key), text: d.short };
      write(updateDoc(doc(S.db, 'trips', t.id, 'clients', c.id), { pays: arrayUnion(p), updatedBy: me, updatedAt: serverTimestamp() }));
      const cc = clientsOf(t).find(x => x.id === c.id); if (cc) cc.pays = [...(cc.pays || []), p];
      toast('已記錄收款'); paint(s);
    });
    $$('[data-unpay]', s).forEach(b => b.addEventListener('click', () => {
      const p = st.pays.find(x => x.id === b.dataset.unpay); if (!p || !confirm('取消這筆收款紀錄？那些代購會回到「還沒收」。')) return;
      write(updateDoc(doc(S.db, 'trips', t.id, 'clients', c.id), { pays: arrayRemove(p), updatedBy: me, updatedAt: serverTimestamp() }));
      const cc = clientsOf(t).find(x => x.id === c.id); if (cc) cc.pays = (cc.pays || []).filter(x => x.id !== p.id);
      paint(s);
    }));
    $('#cDel', s)?.addEventListener('click', () => { if (!confirm(`刪除委託人「${c.name}」？`)) return; write(deleteDoc(doc(S.db, 'trips', t.id, 'clients', c.id))); const cc = cache[t.id]; if (cc) cc.clients = cc.clients.filter(x => x.id !== c.id); closeSheet(); toast('已刪除'); });
  };
  openSheet('', s => paint(s));
}

/* ───────── 代購分頁：依負責人列出委託人 ───────── */
function proxyHTML(t, list, me) {
  const cs = clientsOf(t), ms = mems(t);
  // 還沒建檔的名字（舊資料手打的）
  const loose = new Map();
  for (const e of list) (e.proxy || []).forEach(x => { if (toC(x.amount) > 0 && !matchClient(cs, x)) { const k = `${x.owner}|${x.client || ''}`; loose.set(k, { owner: x.owner, name: x.client || '', n: (loose.get(k)?.n || 0) + 1 }); } });
  const owners = orderOf(t, [...cs.map(c => c.owner), ...[...loose.values()].map(l => l.owner)]).filter(u => ms.includes(u) || cs.some(c => c.owner === u));
  const head = `<p class="tiny faint" style="margin:0">幫不在這趟的朋友買的東西。成本算在負責人身上，不分給大家；負責人自己向委託人收錢。</p>
    <div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn pri" id="pxNew" style="flex:1">${ic.plus}新增委託人</button><button class="btn" id="pxImp">從以前的旅程帶入</button></div>`;
  if (!cs.length && !loose.size) return head + '<div class="card empty"><p class="small muted" style="margin:0">還沒有委託人。先新增，記帳時就能直接選。</p></div>';
  return head + owners.map(u => {
    const mine = cs.filter(c => c.owner === u), lo = [...loose.values()].filter(l => l.owner === u);
    if (!mine.length && !lo.length) return '';
    const sts = mine.map(c => ({ c, st: clientState(t, list, c) }));
    return `<section class="card" style="gap:10px"><div class="row">${av(t, u, 'sm')}<b>${esc(nm(t, u))} 負責</b></div>
      ${sts.map(({ c, st }) => `<button type="button" class="cl-row" data-cl="${esc(c.id)}">
        <span class="mn-main"><span class="mn-name">${esc(c.name)}</span><span class="tiny faint">${st.all.length} 件${st.paid.length ? `・已收 ${st.paid.length} 件` : ''}${c.note ? `・${esc(c.note)}` : ''}</span></span>
        <span class="mn-amt">${st.unpaid.length ? `<b class="num">${esc(dueOf(t, st.unpaid, c).short)}</b><span class="tiny faint">還沒收</span>` : st.all.length ? '<span class="tag">✓ 收齊</span>' : '<span class="tiny faint">還沒有代購</span>'}</span></button>`).join('')}
      ${lo.map(l => `<div class="cl-row loose"><span class="mn-main"><span class="mn-name">${esc(l.name || '（沒填委託人）')}</span><span class="tiny faint">${l.n} 件・還沒建檔</span></span>
        ${l.name ? `<button type="button" class="pillbtn" data-adopt="${esc(u)}|${esc(l.name)}">建檔</button>` : ''}</div>`).join('')}
    </section>`;
  }).join('');
}

/* ───────── 記一筆／編輯 ───────── */
function editExpense(ctx, t, e, pre = null) {
  const { S } = ctx, me = S.user.uid, isNew = !e, ms = mems(t), solo = ms.length <= 1;
  const curOpts = [...new Set([t.currency, t.settleCurrency, e?.cur].filter(Boolean))];
  let cur = e?.cur || pre?.cur || localGet('mncur:' + t.id) || t.currency || 'TWD';
  const locked0 = !isNew && isLocked(t.id, e.cur);
  const amtStr = v => v == null ? '' : String(v);
  // 付款人、分攤
  let payers = e ? (e.paid && Object.keys(e.paid).length ? Object.keys(e.paid) : [e.payer]).filter(Boolean) : [me];
  if (solo) payers = [me];
  const paidIn = {}; if (e?.paid) for (const [u, v] of Object.entries(e.paid)) paidIn[u] = amtStr(v);
  let split = e ? (e.shares && Object.keys(e.shares).length ? Object.keys(e.shares) : [...(e.split || [])]) : pre?.split ? [...pre.split] : [...ms];
  let custom = !!(e?.shares && Object.keys(e.shares).length) && !e?.rcpt;
  const shareIn = {}; if (custom) for (const [u, v] of Object.entries(e.shares)) shareIn[u] = amtStr(v);
  // 照收據逐筆填：有 rcpt 的舊記帳直接打開
  let rc = pre?.rc ? { ...pre.rc, items: pre.rc.items.map(x => ({ ...x })) } : e?.rcpt ? { ex: !!e.rcpt.ex, rate: e.rcpt.rate ?? 10, low: e.rcpt.low ?? 8, items: e.rcpt.items.map(x => ({ ...x, k: x.k || rk(), price: amtStr(x.price), who: { ...(x.who || {}) }, px: x.px ? { ...x.px, cid: x.px.cid || matchClient(clientsOf(t), x.px)?.id || null } : null })) } : null;
  let proxy = rc ? [] : (e?.proxy || []).map(x => ({ ...x, k: x.k || rk(), cid: x.cid || matchClient(clientsOf(t), x)?.id || null, amount: amtStr(x.amount) }));
  let refund = e?.refund ? { actual: amtStr(e.refund.actual), who: e.refund.who, settled: [...(e.refund.settled || [])] } : null;
  let settled = [...(e?.settled || [])];
  let cat = e?.cat || pre?.cat || (isNew ? localGet('mncat:' + t.id) : '') || 'food';
  const moreOpen = !!(proxy.length || refund || settled.length || e?.note);
  const memBtn = (attr, u, on) => `<button type="button" class="mem" data-${attr}="${esc(u)}" aria-pressed="${on}">${av(t, u, 'sm')}<span>${esc(nm(t, u))}</span></button>`;
  const allPeople = orderOf(t, [...payers, ...split]);

  openSheet(`<div class="sheet-h"><h3 class="title">${isNew ? '記一筆' : '編輯記帳'}</h3><button class="iconbtn" data-close aria-label="關閉">✕</button></div>
    <div id="eLock"></div>
    <div class="field"><span id="lblCur">幣別</span><div class="seg" role="group" aria-labelledby="lblCur" id="eCurSeg" style="grid-template-columns:repeat(${curOpts.length}, minmax(0, 1fr)) auto">
      ${curOpts.map(c => `<button type="button" data-cur="${esc(c)}" aria-pressed="${c === cur}">${esc(curName(c))}</button>`).join('')}
      <select class="input ${curOpts.includes(cur) ? '' : 'on'}" id="eCurOther" aria-label="其他幣別"><option value="">其他</option>${CURRENCIES.filter(c => !curOpts.includes(c)).map(c => `<option value="${c}" ${c === cur ? 'selected' : ''} title="${esc(curName(c))}">${c}</option>`).join('')}</select>
    </div></div>
    <label class="field"><span>品名</span><input class="input" id="eName" maxlength="100" value="${esc(e?.name || pre?.name || '')}" placeholder="例如：燒肉晚餐、唐吉訶德"></label>
    <label class="field"><span>總額（實付）</span><input class="input big num" id="eAmt" inputmode="decimal" autocomplete="off" value="${esc(amtStr(e?.amount ?? pre?.amount))}" placeholder="0">
      <span class="tiny faint" id="eAmtHint">可以直接打算式，例如 1200+850</span></label>
    <div class="field"><span id="lblCat">分類</span><div class="cat-pick" role="group" aria-labelledby="lblCat">
      ${Object.entries(CATS).map(([k, v]) => `<button type="button" class="cat" data-cat="${k}" aria-pressed="${cat === k}">${catIcon(k, 'xs')}<span>${v.label}</span></button>`).join('')}</div></div>
    <label class="field"><span>付款日期</span><input class="input" type="date" id="eDate" value="${esc(e?.date || todayIn(t.tz))}"></label>
    ${solo ? '' : `<div class="field"><span>誰先付錢 <span class="tiny faint">（可以選多位）</span></span><div class="mem-pick" id="ePayers">${allPeople.filter(u => ms.includes(u) || payers.includes(u)).map(u => memBtn('payer', u, payers.includes(u))).join('')}</div><div id="ePaidBox"></div></div>
    <div class="field" id="eSplitWrap"><span>分給誰</span><div class="mem-pick" id="eSplit">${allPeople.filter(u => ms.includes(u) || split.includes(u)).map(u => memBtn('split', u, split.includes(u))).join('')}</div>
      <div id="eShareBox"></div></div>`}
    <div id="eRcWrap"></div>
    <button type="button" class="itgo" id="eRcToggle"></button>
    <details class="more" ${moreOpen ? 'open' : ''}><summary>代購、退稅${solo ? '' : '、這筆怎麼還'}、備註</summary>
      <div class="more-body">
        <div class="field" id="ePxWrap"><span>代購 <span class="tiny faint">（幫不在這趟的朋友買）</span></span><div id="ePx"></div>
          <button type="button" class="btn" id="ePxAdd">${ic.plus}加一件代購</button></div>
        <div class="field"><label class="row" style="gap:8px"><input type="checkbox" id="eRf" ${refund ? 'checked' : ''}> <span>這筆有退稅（實際退回的金額）</span></label><div id="eRfBox"></div></div>
        ${solo ? '' : '<div class="field" id="eHowWrap"><span>這筆怎麼還</span><div id="eHow"></div></div>'}
        <label class="field"><span>備註（選填）</span><textarea class="input" id="eNote" rows="2" maxlength="500">${esc(e?.note || '')}</textarea></label>
      </div></details>
    <p class="small" id="eErr" style="margin:0;color:var(--danger)"></p>
    <div class="sheet-acts">${isNew || locked0 ? '' : '<button class="btn danger" id="eDel">刪除</button>'}<button class="btn pri" id="eSave">儲存</button></div>`, s => {
    const A = () => { const v = evalAmt($('#eAmt', s).value); return v == null || isNaN(v) ? NaN : toC(v); };
    const lockedNow = () => locked0 || isLocked(t.id, cur);
    const U = () => unitOf(cur);
    const pxTotal = () => rc ? 0 : proxy.reduce((n, x) => n + toC(evalAmt(x.amount) || 0), 0);
    const rcNow = () => rc ? rcCalc(A(), rc, cur) : null;
    // 依目前畫面組出一筆暫時的記帳（拿來算平均、怎麼還）
    const draft = () => {
      const d = { cur, amount: (A() || 0) / 100, split: [...split] };
      if (payers.length > 1) d.paid = Object.fromEntries(payers.map(u => [u, evalAmt(paidIn[u]) || 0])); else d.payer = payers[0];
      const R = rcNow();
      if (R) {
        d.shares = Object.fromEntries(Object.entries(R.shares).map(([u, v]) => [u, v / 100]));
        d.split = orderOf(t, Object.keys(R.shares)).filter(u => R.shares[u] > 0);
        d.proxy = R.proxy;
      } else {
        if (custom) d.shares = Object.fromEntries(split.map(u => [u, evalAmt(shareIn[u]) || 0]));
        d.proxy = proxy.filter(x => (x.owner || solo) && evalAmt(x.amount) > 0).map(x => ({ owner: solo ? me : x.owner, cid: x.cid || null, client: x.client || '', name: x.name || '', amount: evalAmt(x.amount), k: x.k || rk() }));
      }
      if (refund && evalAmt(refund.actual) > 0 && refund.who) d.refund = { actual: evalAmt(refund.actual), who: refund.who, settled: refund.settled };
      d.settled = settled; return d;
    };
    const paintLock = () => {
      const L = lockedNow();
      $('#eLock', s).innerHTML = L ? `<div class="lock-note">${ic.lock}<span>${esc(curName(cur))}帳目鎖定中（已經有人轉帳）：${isNew ? '不能新增這個幣別的記帳。' : '只能改品名、分類、日期和備註。'}</span></div>` : '';
      $$('#eAmt, [data-cur], #eCurOther, [data-payer], [data-split], #ePxAdd, #eRf, #eShareBox input, #eShareBox button, #ePaidBox input, #ePx input, #ePx select, #ePx button, #eRfBox input, #eRfBox select, [data-set], #eRcWrap input, #eRcWrap button, #eRcWrap select, #eRcToggle', s).forEach(x => { x.disabled = L; });
    };
    const paintAmtHint = () => {
      const raw = $('#eAmt', s).value, v = evalAmt(raw);
      $('#eAmtHint', s).textContent = v == null ? '可以直接打算式，例如 1200+850' : isNaN(v) ? '看不懂這個金額' : /[+\-*/×÷＋－]/.test(raw.replace(/^-/, '')) ? `＝ ${money(toC(v), cur)}` : money(toC(v), cur);
      $('#eAmtHint', s).style.color = v != null && isNaN(v) ? 'var(--danger)' : '';
    };
    // 輸入框重畫後把游標放回原位
    const keepFocus = (box, sel, fn) => { const a = document.activeElement, key = a && box.contains(a) ? sel(a) : null, pos = a?.selectionStart; fn(); if (key) { const n = $(key, box); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch {} } } };
    const paintPaid = () => {
      const box = $('#ePaidBox', s); if (!box) return;
      if (payers.length < 2) { box.innerHTML = ''; return; }
      const tot = payers.reduce((n, u) => n + toC(evalAmt(paidIn[u]) || 0), 0), a = A();
      box.innerHTML = `<div class="amt-grid">${payers.map(u => `<label class="amt-row">${av(t, u, 'xs')}<span class="small">${esc(nm(t, u))} 付了</span>
        <input class="input num" data-pin="${esc(u)}" inputmode="decimal" value="${esc(paidIn[u] || '')}" placeholder="0"></label>`).join('')}</div>
        <span class="tiny" id="ePaidSum"></span>`;
      const sumLine = () => { const tot2 = payers.reduce((n, u) => n + toC(evalAmt(paidIn[u]) || 0), 0), a2 = A(), el = $('#ePaidSum', box);
        el.textContent = `合計 ${money(tot2, cur)}${!isNaN(a2) && tot2 !== a2 ? `，和總額差 ${money(a2 - tot2, cur)}` : ''}`; el.style.color = isNaN(a2) || tot2 === a2 ? 'var(--ink3)' : 'var(--danger)'; };
      sumLine();
      $$('[data-pin]', box).forEach(i => i.addEventListener('input', () => { paidIn[i.dataset.pin] = i.value; sumLine(); paintHow(); }));
      void tot; void a;
    };
    const paintShare = () => {
      const box = $('#eShareBox', s); if (!box) return;
      $('#eSplitWrap', s).classList.toggle('hidden', !!rc);
      if (rc) { box.innerHTML = ''; return; }
      const a = A(), own = isNaN(a) ? NaN : a - pxTotal();
      if (!split.length) { box.innerHTML = '<span class="tiny" style="color:var(--danger)">至少選一個人</span>'; return; }
      if (!custom) {
        const ev = isNaN(own) ? null : evenShares(Math.max(0, own), split, U(), orderOf(t, split));
        const vals = ev ? [...new Set(Object.values(ev))] : [];
        box.innerHTML = `<div class="row" style="justify-content:space-between;gap:8px"><span class="tiny muted">${ev ? (vals.length === 1 ? `每人 ${money(vals[0], cur)}` : `每人約 ${money(Math.min(...vals), cur)}（零頭 ${money(Math.max(...vals) - Math.min(...vals), cur)} 算付款人）`) : '填了總額就會算出每人多少'}${pxTotal() ? '・已扣掉代購' : ''}</span>
          <button type="button" class="linkbtn" id="eCustom">各自金額</button></div>`;
        $('#eCustom', box).addEventListener('click', () => {
          custom = true; const ev2 = isNaN(own) ? {} : evenShares(Math.max(0, own), split, U(), orderOf(t, split));
          split.forEach(u => shareIn[u] = ev2[u] != null ? String(ev2[u] / 100) : ''); paintShare(); paintHow();
        });
      } else {
        box.innerHTML = `<div class="amt-grid">${orderOf(t, split).filter(u => split.includes(u)).map(u => `<label class="amt-row">${av(t, u, 'xs')}<span class="small">${esc(nm(t, u))}</span>
          <input class="input num" data-sin="${esc(u)}" inputmode="decimal" value="${esc(shareIn[u] || '')}" placeholder="0"></label>`).join('')}</div>
          <div class="row" style="justify-content:space-between;gap:8px"><span class="tiny" id="eShareSum"></span><button type="button" class="linkbtn" id="eEven">改回平均</button></div>`;
        const sumLine = () => { const a2 = A(), own2 = isNaN(a2) ? NaN : a2 - pxTotal(), tot = split.reduce((n, u) => n + toC(evalAmt(shareIn[u]) || 0), 0), el = $('#eShareSum', box);
          el.textContent = `合計 ${money(tot, cur)}${!isNaN(own2) && tot !== own2 ? `，${pxTotal() ? '扣掉代購後' : '和總額'}差 ${money(own2 - tot, cur)}` : ''}`; el.style.color = isNaN(own2) || tot === own2 ? 'var(--ink3)' : 'var(--danger)'; };
        sumLine();
        $$('[data-sin]', box).forEach(i => i.addEventListener('input', () => { shareIn[i.dataset.sin] = i.value; sumLine(); paintHow(); }));
        $('#eEven', box).addEventListener('click', () => { custom = false; paintShare(); paintHow(); });
      }
    };
    // 委託人選單：依負責人分組；最後一項新增
    const cliSel = (attrs, o, cls = 'input') => {
      const cs = clientsOf(t), v = o.cid || (o.client ? '__legacy' : '');
      return `<select class="${cls}${v ? '' : ' empty'}" ${attrs} aria-label="委託人"><option value="" ${v ? '' : 'selected'}>選委託人…</option>
        ${ms.map(u => { const g = cs.filter(c => c.owner === u); return g.length ? `<optgroup label="${esc(nm(t, u))} 負責">${g.map(c => `<option value="${esc(c.id)}" ${v === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</optgroup>` : ''; }).join('')}
        ${v === '__legacy' ? `<option value="__legacy" selected>${esc(o.client)}（還沒建檔）</option>` : ''}
        <option value="__new">＋ 新增委託人</option></select>`;
    };
    const pickClient = (o, val, done) => {
      const set = c => { o.cid = c.id; o.client = c.name; o.owner = c.owner; };
      if (val === '__new') { clientDialog(ctx, t, null, payers[0] || me).then(id => { const c = id && clientsOf(t).find(x => x.id === id); if (c) set(c); done(); }); return; }
      if (val === '__legacy') return;
      if (!val) { o.cid = null; o.client = ''; done(); return; }
      const c = clientsOf(t).find(x => x.id === val); if (c) set(c); done();
    };
    const paintPx = () => {
      const box = $('#ePx', s);
      $('#ePxWrap', s).classList.toggle('hidden', !!rc);
      if (rc) return;
      box.innerHTML = proxy.map((x, i) => `<div class="px-line">
        <div class="grid2"><label class="field"><span class="tiny">委託人</span>${cliSel(`data-pxc="${i}"`, x)}</label>
          <label class="field"><span class="tiny">金額</span><input class="input num" data-px="${i}" data-k="amount" inputmode="decimal" value="${esc(x.amount || '')}" placeholder="0"></label></div>
        <label class="field"><span class="tiny">品名（選填）</span><input class="input" data-px="${i}" data-k="name" maxlength="60" value="${esc(x.name || '')}"></label>
        <div class="row" style="justify-content:space-between">${!solo && (x.cid || x.client) ? `<span class="tiny faint row" style="gap:4px">${av(t, x.owner)}${esc(nm(t, x.owner))} 負責收錢</span>` : '<span></span>'}
          <button type="button" class="linkbtn" data-pxdel="${i}">移除這件</button></div></div>`).join('')
        + (proxy.length ? `<span class="tiny faint" id="ePxSum"></span>` : '');
      const sumLine = () => { const el = $('#ePxSum', box); if (el) el.textContent = `代購合計 ${money(pxTotal(), cur)}，${solo ? '不算在自己的花費裡。' : '算在負責人身上，剩下的才分給大家。'}`; };
      sumLine();
      $$('[data-px]', box).forEach(i => i.addEventListener(i.tagName === 'SELECT' ? 'change' : 'input', () => {
        proxy[+i.dataset.px][i.dataset.k] = i.value;
        if (i.dataset.k === 'amount') { sumLine(); paintShare(); paintHow(); }
      }));
      $$('[data-pxdel]', box).forEach(b => b.addEventListener('click', () => { proxy.splice(+b.dataset.pxdel, 1); paintPx(); paintShare(); paintHow(); paintLock(); }));
      $$('[data-pxc]', box).forEach(sel => sel.addEventListener('change', () => pickClient(proxy[+sel.dataset.pxc], sel.value, () => { paintPx(); paintShare(); paintHow(); paintLock(); $(`[data-pxc="${sel.dataset.pxc}"]`, box)?.focus(); })));
    };
    /* ── 照收據逐筆填 ── */
    const newLine = () => { const prev = rc.items[rc.items.length - 1]; return { k: rk(), name: '', price: '', who: prev && !prev.px ? { ...prev.who } : solo ? { [me]: 1 } : {}, px: prev?.px ? { ...prev.px } : null, low: false, noDisc: false }; };
    const paintRc = () => {
      const box = $('#eRcWrap', s), tg = $('#eRcToggle', s);
      tg.innerHTML = rc ? '改回不分品項' : `🧾 照收據逐筆填<span class="tiny">一張收據很多人買、有代購時用：每行點一下是誰的，折扣和稅自動照比例分</span>`;
      tg.classList.toggle('on', !!rc);
      if (!rc) { box.innerHTML = ''; return; }
      const people = ms;
      box.innerHTML = `<section class="rc">
        <div class="row" style="justify-content:space-between;gap:8px;flex-wrap:wrap"><b>🧾 收據品項</b>
          <label class="row tiny" style="gap:6px"><input type="checkbox" id="rcEx" ${rc.ex ? 'checked' : ''}> 收據價格是未稅</label></div>
        <p class="tiny faint rc-hint">上面的總額填收據最下面的<b>實付</b>。實付比品項合計少的部分就是<b>優惠券／折扣</b>，會照比例分給每行（代購的委託人還是付含稅價）。</p>
        ${rc.ex ? `<div class="row tiny" style="gap:8px;flex-wrap:wrap">稅率 <input class="input num rc-rate" id="rcRate" inputmode="decimal" value="${esc(String(rc.rate))}" aria-label="稅率">%　減免稅率 <input class="input num rc-rate" id="rcLow" inputmode="decimal" value="${esc(String(rc.low))}" aria-label="減免稅率">%<span class="faint">（例如日本食品 8%）</span></div>` : ''}
        <div class="rc-lines">${rc.items.map((x, i) => {
          const multi = !x.px && Object.keys(x.who || {}).filter(u => x.who[u] > 0).length > 1;
          return `<div class="rc-line" data-li="${i}">
            <div class="rc-top"><span class="rc-no">${i + 1}</span>
              <input class="input num rc-price" data-ri="${i}" data-k="price" inputmode="decimal" value="${esc(x.price)}" placeholder="價格" aria-label="第 ${i + 1} 行價格">
              <input class="input rc-name" data-ri="${i}" data-k="name" maxlength="60" value="${esc(x.name || '')}" placeholder="品名（選填）" aria-label="第 ${i + 1} 行品名">
              <button type="button" class="iconbtn" data-rmore="${i}" aria-label="第 ${i + 1} 行更多設定" aria-expanded="${!!x.open}">⋯</button></div>
            <div class="rc-who">${people.map(u => `<button type="button" class="rc-chip" data-rw="${i}:${esc(u)}" aria-pressed="${!x.px && x.who?.[u] > 0}" style="--c:${esc(t.members[u].color || '#999')}">${av(t, u, 'xs')}${esc(nm(t, u))}</button>`).join('')}
              <button type="button" class="rc-chip" data-rpx="${i}" aria-pressed="${!!x.px}">🛍️ 代購</button>${x.px ? cliSel(`data-rcl="${i}"`, x.px, 'input chipsel') : ''}</div>
            ${multi ? `<div class="rc-qty"><span class="tiny faint">幾份</span>${Object.keys(x.who).filter(u => x.who[u] > 0).map(u => `<label class="tiny row" style="gap:4px">${esc(nm(t, u))}<input class="input num" data-rq="${i}:${esc(u)}" inputmode="numeric" value="${x.who[u]}" aria-label="${esc(nm(t, u))} 幾份"></label>`).join('')}</div>` : ''}
            ${x.open ? `<div class="rc-opts">${rc.ex ? `<label class="row tiny" style="gap:6px"><input type="checkbox" data-rflag="${i}:low" ${x.low ? 'checked' : ''}> 用減免稅率（${esc(String(rc.low))}%）</label>` : ''}
              <label class="row tiny" style="gap:6px"><input type="checkbox" data-rflag="${i}:noDisc" ${x.noDisc ? 'checked' : ''}> 不參加折扣（優惠券沒折到這件）</label>
              <button type="button" class="linkbtn" data-rdel="${i}" style="align-self:flex-start;color:var(--danger)">刪除這行</button></div>` : ''}
            <span class="tiny faint rc-cost" data-rcost="${i}"></span></div>`;
        }).join('')}</div>
        <button type="button" class="btn" id="rcAdd">${ic.plus}加一行</button>
        <div id="rcSum"></div></section>`;
      const upd = (i, k, v) => { rc.items[i][k] = v; };
      $$('[data-rcl]', box).forEach(sel => sel.addEventListener('change', () => pickClient(rc.items[+sel.dataset.rcl].px, sel.value, () => { paintRc(); $(`[data-rcl="${sel.dataset.rcl}"]`, box)?.focus(); })));
      $$('[data-ri]', box).forEach(el => el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => { upd(+el.dataset.ri, el.dataset.k, el.value); paintRcSum(); }));
      $$('[data-rw]', box).forEach(b => b.addEventListener('click', () => {
        const [i, u] = b.dataset.rw.split(':'), x = rc.items[+i];
        if (x.px) { x.px = null; x.who = {}; }
        x.who = { ...(x.who || {}) }; if (x.who[u] > 0) delete x.who[u]; else x.who[u] = 1;
        keepFocus(box, () => null, paintRc); $(`[data-rw="${CSS.escape(b.dataset.rw)}"]`, box)?.focus();
      }));
      $$('[data-rpx]', box).forEach(b => b.addEventListener('click', () => {
        const x = rc.items[+b.dataset.rpx];
        x.px = x.px ? null : { owner: payers[0] || me, cid: null, client: '' }; if (x.px) x.who = {};
        paintRc(); $(`[data-rpx="${b.dataset.rpx}"]`, box)?.focus();
      }));
      $$('[data-rq]', box).forEach(el => el.addEventListener('input', () => { const [i, u] = el.dataset.rq.split(':'); const q = Math.max(0, Math.round(Number(el.value) || 0)); rc.items[+i].who[u] = q || 1; paintRcSum(); }));
      $$('[data-rmore]', box).forEach(b => b.addEventListener('click', () => { const x = rc.items[+b.dataset.rmore]; x.open = !x.open; paintRc(); $(`[data-rmore="${b.dataset.rmore}"]`, box)?.focus(); }));
      $$('[data-rflag]', box).forEach(c => c.addEventListener('change', () => { const [i, k] = c.dataset.rflag.split(':'); rc.items[+i][k] = c.checked; paintRcSum(); }));
      $$('[data-rdel]', box).forEach(b => b.addEventListener('click', () => { rc.items.splice(+b.dataset.rdel, 1); if (!rc.items.length) rc.items.push(newLine()); paintRc(); }));
      $('#rcAdd', box).addEventListener('click', () => { rc.items.push(newLine()); paintRc(); const n = $$('.rc-price', box).pop(); n?.focus(); });
      $('#rcEx', box).addEventListener('change', ev => { rc.ex = ev.target.checked; paintRc(); });
      $('#rcRate', box)?.addEventListener('input', ev => { rc.rate = ev.target.value; paintRcSum(); });
      $('#rcLow', box)?.addEventListener('input', ev => { rc.low = ev.target.value; paintRcSum(); });
      paintRcSum(); paintLock();
    };
    const paintRcSum = () => {
      const box = $('#rcSum', s); if (!box || !rc) return;
      const R = rcNow(), a = A();
      for (const x of R.rows) {
        const el = $(`[data-rcost="${x.i}"]`, s); if (!el) continue;
        const l = R.live.find(y => y.i === x.i);
        el.textContent = !l ? '' : l.px ? `→ ${money(l.cost, cur)}（${nm(t, l.px.owner)} 的代購${l.px.client ? `・${l.px.client}` : ''}）${l.charge !== l.cost ? `・向委託人收 ${money(l.charge, cur)}（含稅價，不扣優惠券）` : ''}`
          : l.parts && Object.keys(l.parts).length ? `→ ${money(l.cost, cur)}${Object.keys(l.parts).length > 1 ? `：${Object.entries(l.parts).map(([u, v]) => `${nm(t, u)} ${money(v, cur)}`).join('、')}` : ''}` : '';
      }
      const people = orderOf(t, [...Object.keys(R.shares), ...Object.keys(R.byOwner)]).filter(u => R.shares[u] || R.byOwner[u]);
      box.innerHTML = `<div class="rc-sum">
        <div class="row tiny muted" style="justify-content:space-between"><span>品項合計${rc.ex ? '（含稅）' : ''}</span><span class="num">${money(R.S, cur)}</span></div>
        <div class="row tiny muted" style="justify-content:space-between"><span>${R.D > 0 ? '服務費、稅等' : '優惠券／折扣'}（照比例分給每行）</span><span class="num">${isNaN(a) || !R.D ? '沒有' : money(R.D, cur, true)}</span></div>
        <div class="row tiny" style="justify-content:space-between"><b>實付</b><b class="num">${isNaN(a) ? '—' : money(a, cur)}</b></div>
        ${people.map(u => `<div class="row small" style="justify-content:space-between;gap:8px"><span class="row" style="gap:6px">${av(t, u, 'xs')}${esc(nm(t, u))}</span>
          <span class="num">${R.shares[u] ? money(R.shares[u], cur) : ''}${R.byOwner[u] ? `<span class="tiny faint">${R.shares[u] ? '＋' : ''}代購 ${money(R.byOwner[u], cur)}</span>` : ''}</span></div>`).join('')}
        ${R.looksEx ? `<div class="lock-note"><span>品項合計乘上 ${Math.round(a / R.S * 100) - 100}% 左右剛好是實付，收據可能是<b>未稅價</b>。<button type="button" class="linkbtn" id="rcToEx">改成未稅</button></span></div>` : ''}
        ${[...R.err, ...R.warn].map(m => `<p class="tiny" style="margin:0;color:var(--danger)">⚠ ${esc(m)}</p>`).join('')}
      </div>`;
      $('#rcToEx', box)?.addEventListener('click', () => { rc.ex = true; paintRc(); });
      paintHow();
    };
    const paintRf = () => {
      const box = $('#eRfBox', s);
      if (!refund) { box.innerHTML = ''; return; }
      box.innerHTML = `<div class="grid2"><label class="field"><span class="tiny">實際退回</span><input class="input num" id="eRfAmt" inputmode="decimal" value="${esc(refund.actual || '')}" placeholder="0"></label>
        ${solo ? '' : `<label class="field"><span class="tiny">誰領到</span><select class="input" id="eRfWho">${ms.map(u => `<option value="${esc(u)}" ${refund.who === u ? 'selected' : ''}>${esc(nm(t, u))}</option>`).join('')}</select></label>`}</div>
        <span class="tiny faint">${solo ? '會從這筆的花費扣掉。' : '照每個人在這筆的金額比例退給大家（代購那份退給負責人），錢在領到的人手上。'}</span>`;
      $('#eRfAmt', box).addEventListener('input', ev => { refund.actual = ev.target.value; paintHow(); });
      $('#eRfWho', box)?.addEventListener('change', ev => { refund.who = ev.target.value; paintHow(); });
    };
    const paintHow = () => {
      const box = $('#eHow', s); if (!box) return;
      const a = A(), d = draft();
      if (isNaN(a) || !a || !payers.length || (!rc && !split.length)) { box.innerHTML = '<span class="tiny faint">填好總額、付款人和分攤後，這裡會列出這筆誰要還誰。</span>'; return; }
      const fake = { ...d };
      const trs = exTransfers(fake, t), R = exRefund(fake, t);
      settled = settled.filter(u => trs.some(x => x.from === u));
      if (refund) refund.settled = (refund.settled || []).filter(u => R && R.parts[u] > 0 && u !== R.who);
      const lines = [...trs.map(x => ({ k: 'net', u: x.from, to: x.to, amt: x.amt, done: settled.includes(x.from) })),
        ...(R ? Object.entries(R.parts).filter(([u]) => u !== R.who).map(([u, v]) => ({ k: 'rf', u, from: R.who, amt: v, done: refund.settled.includes(u) })) : [])];
      box.innerHTML = lines.length ? `<div class="tr-list">${lines.map(l => `<div class="tr ${l.done ? 'paid' : ''}">
          <span class="tr-flow">${l.k === 'rf' ? `${av(t, l.from)}<span class="tiny">${esc(nm(t, l.from))}</span>→${av(t, l.u)}<span class="tiny">${esc(nm(t, l.u))}</span><span class="tag">退稅</span>`
            : `${av(t, l.u)}<span class="tiny">${esc(nm(t, l.u))}</span>→${av(t, l.to)}<span class="tiny">${esc(nm(t, l.to))}</span>`}</span>
          <b class="num small">${money(l.amt, cur)}</b>
          <button type="button" class="pillbtn" data-set="${l.k}:${esc(l.u)}" aria-pressed="${l.done}">${l.done ? '✓ 已結清' : '已結清？'}</button></div>`).join('')}</div>
          <span class="tiny faint">旅途中已經當場還掉的，按「已結清」，最後結算就不會再算這筆。</span>`
        : '<span class="tiny faint">這筆不用還錢（付錢的人就是分攤的人）。</span>';
      $$('[data-set]', box).forEach(b => b.addEventListener('click', () => {
        const [k, u] = b.dataset.set.split(':');
        if (k === 'net') settled = settled.includes(u) ? settled.filter(x => x !== u) : [...settled, u];
        else refund.settled = refund.settled.includes(u) ? refund.settled.filter(x => x !== u) : [...refund.settled, u];
        paintHow();
      }));
      paintLock();
    };
    const all = () => { paintAmtHint(); paintPaid(); paintShare(); paintRcSum(); paintHow(); paintLock(); };
    // 幣別
    const setCur = c => { cur = c; $$('[data-cur]', s).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.cur === c))); $('#eCurOther', s).value = curOpts.includes(c) ? '' : c; $('#eCurOther', s).classList.toggle('on', !curOpts.includes(c)); all(); };
    $$('[data-cur]', s).forEach(b => b.addEventListener('click', () => setCur(b.dataset.cur)));
    $('#eCurOther', s).addEventListener('change', ev => { if (ev.target.value) setCur(ev.target.value); else setCur(curOpts[0]); });
    $('#eAmt', s).addEventListener('input', () => { paintAmtHint(); paintShare(); paintRcSum(); $('#ePaidSum', s) && paintPaid(); paintHow(); });
    $$('[data-cat]', s).forEach(b => b.addEventListener('click', () => { cat = b.dataset.cat; $$('[data-cat]', s).forEach(y => y.setAttribute('aria-pressed', String(y === b))); }));
    $$('[data-payer]', s).forEach(b => b.addEventListener('click', () => {
      const u = b.dataset.payer;
      if (payers.includes(u)) { if (payers.length === 1) { toast('至少要有一位付款人'); return; } payers = payers.filter(x => x !== u); }
      else payers = orderOf(t, [...payers, u]).filter(x => x === u || payers.includes(x));
      $$('[data-payer]', s).forEach(y => y.setAttribute('aria-pressed', String(payers.includes(y.dataset.payer))));
      all();
    }));
    $$('[data-split]', s).forEach(b => b.addEventListener('click', () => {
      const u = b.dataset.split;
      split = split.includes(u) ? split.filter(x => x !== u) : orderOf(t, [...split, u]).filter(x => x === u || split.includes(x));
      if (custom && !split.includes(u)) delete shareIn[u];
      $$('[data-split]', s).forEach(y => y.setAttribute('aria-pressed', String(split.includes(y.dataset.split))));
      paintShare(); paintHow();
    }));
    $('#ePxAdd', s).addEventListener('click', () => { proxy.push({ k: rk(), owner: payers[0] || me, cid: null, client: '', name: '', amount: '' }); paintPx(); paintLock(); $$('[data-pxc]', $('#ePx', s)).pop()?.focus(); });
    $('#eRf', s).addEventListener('change', ev => { refund = ev.target.checked ? { actual: '', who: payers[0] || me, settled: [] } : null; paintRf(); paintHow(); paintLock(); });
    $('#eRcToggle', s).addEventListener('click', () => {
      if (rc) {
        if (rc.items.some(x => x.price) && !confirm('改回不分品項？逐筆填的內容會清掉。')) return;
        rc = null;
      } else {
        // 一般代購移進收據，當作各自一行
        rc = { ex: false, rate: cur === 'JPY' ? 10 : 10, low: cur === 'JPY' ? 8 : 5, items: proxy.filter(x => evalAmt(x.amount) > 0).map(x => ({ k: x.k || rk(), name: x.name || '', price: x.amount, who: {}, px: { owner: solo ? me : x.owner, cid: x.cid || null, client: x.client || '' }, low: false, noDisc: false })) };
        proxy = []; custom = false;
        rc.items.push({ k: rk(), name: '', price: '', who: solo ? { [me]: 1 } : {}, px: null, low: false, noDisc: false });
      }
      paintRc(); paintPx(); paintShare(); paintHow(); paintLock();
      if (rc) $('.rc-price', s)?.focus();
    });
    paintPx(); paintRf(); paintRc(); all();
    if (isNew && !pre) setTimeout(() => $('#eName', s).focus(), 50);
    if (pre?.hint) $('#eErr', s).insertAdjacentHTML('beforebegin', `<p class="tiny faint" style="margin:0">${esc(pre.hint)}</p>`);

    $('#eSave', s).addEventListener('click', () => {
      const err = m => { $('#eErr', s).textContent = m; toast(m); };
      const name = $('#eName', s).value.trim(); if (!name) return err('請填品名');
      const date = $('#eDate', s).value;
      const note = $('#eNote', s).value.replace(/\r/g, '').trim();
      const stamp = { updatedBy: me, updatedAt: serverTimestamp() };
      // 鎖定中：只改不影響金額的欄位
      if (lockedNow()) {
        if (isNew) return err(`${curName(cur)}帳目鎖定中，不能新增`);
        write(updateDoc(doc(S.db, 'trips', t.id, 'expenses', e.id), { name, cat, date, note, ...stamp }));
        closeSheet(); toast('已儲存'); return;
      }
      const a = A(); if (isNaN(a) || a <= 0) return err('請填總額');
      if (a > 1e13) return err('金額太大了');
      const d = draft();
      if (payers.length > 1) { const tot = payers.reduce((n, u) => n + toC(evalAmt(paidIn[u]) || 0), 0); if (tot !== a) return err(`每人付的合計 ${money(tot, cur)}，和總額 ${money(a, cur)} 不一樣`); }
      if (rc) {
        const R = rcNow();
        if (!R.live.length) return err('收據至少要有一行有價格');
        if (R.err.length) return err(R.err[0]);
        d.rcpt = rcClean(rc);
      } else {
        if (!solo && !split.length) return err('「分給誰」至少選一個人');
        if (proxy.some(x => evalAmt(x.amount) > 0 && !x.cid && !x.client)) return err('代購要選委託人');
        if (pxTotal() > a) return err('代購金額比總額還多');
        if (custom) { const tot = split.reduce((n, u) => n + toC(evalAmt(shareIn[u]) || 0), 0); if (tot !== a - pxTotal()) return err(`每人分攤的合計 ${money(tot, cur)}，應該是 ${money(a - pxTotal(), cur)}`); }
      }
      if (solo) { d.payer = me; delete d.paid; if (!rc) { d.split = [me]; delete d.shares; } d.settled = []; if (d.refund) d.refund.who = me; }
      if (refund && !(evalAmt(refund.actual) > 0)) return err('請填實際退回的金額，或取消勾選退稅');
      if (d.refund && toC(d.refund.actual) > a) return err('退稅金額比總額還多');
      const data = { cur, amount: a / 100, name, cat, date, note, split: d.split, settled: d.settled || [], ...stamp };
      if (d.paid) data.paid = d.paid; else data.payer = d.payer;
      if (d.shares && Object.keys(d.shares).length) data.shares = d.shares;
      if (d.proxy.length) data.proxy = d.proxy;
      if (d.refund) data.refund = d.refund;
      if (d.rcpt) data.rcpt = d.rcpt;
      localSet('mncur:' + t.id, cur); localSet('mncat:' + t.id, cat);
      const ref = isNew ? doc(collection(S.db, 'trips', t.id, 'expenses')) : doc(S.db, 'trips', t.id, 'expenses', e.id);
      // 整筆覆蓋（改成一位付款人／平均分攤時，舊的多人付款、各自金額、收據欄位會一起消失）
      write(setDoc(ref, { ...data, createdBy: e?.createdBy || me, createdAt: e?.createdAt || serverTimestamp() }));
      if (isNew) pre?.onSaved?.(ref.id);
      closeSheet(); toast(navigator.onLine ? '已儲存' : '已儲存，恢復連線後會自動同步');
    });
    $('#eDel', s)?.addEventListener('click', () => {
      if (lockedNow()) { toast(`${curName(cur)}帳目鎖定中，不能刪除`); return; }
      if (!confirm(`刪除「${e.name}」？`)) return;
      write(deleteDoc(doc(S.db, 'trips', t.id, 'expenses', e.id)));
      closeSheet(); toast('已刪除');
    });
  });
}

/* ───────── 給其他頁面用：確保記帳資料已載入（購物清單選委託人、已買後記一筆）───────── */
const keep = {};
export function ensureMoney(ctx, t) {
  if (!keep[t.id]) keep[t.id] = watchMoney(ctx, t.id, () => {});
  return new Promise(res => {
    let n = 0;
    const tick = () => { const c = cache[t.id]; if ((c && c.list != null && c.settle != null && c.clients != null) || n++ > 40) res(); else setTimeout(tick, 100); };
    tick();
  });
}
export async function addExpenseFrom(ctx, t, pre) { await ensureMoney(ctx, t); editExpense(ctx, t, null, pre); }
