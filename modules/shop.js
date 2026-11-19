// 購物清單：每個人一份自己的清單（同一趟的人都看得到，可以複製別人的項目到自己清單）
// 照片：清單只放 120px 小縮圖；800px 大圖另外存在 shopImg，點開才下載，下載過就存在手機裡（沒網路也看得到）
import { doc, collection, onSnapshot, setDoc, updateDoc, getDoc, serverTimestamp, writeBatch } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { $, $$, esc, ic, toast, localGet, localSet } from './ui.js';
import { avatarHTML } from './profile.js';
import { openSheet, closeSheet } from './plan.js';
import { addExpenseFrom, ensureMoney, clientsOf, clientDialog, rk, money, toC, evalAmt } from './money.js';
import { CUR_NAME } from './places.js';

/* ───────── 即時資料（只有打開購物清單時才訂閱）───────── */
const cache = {};
export function watchShop(ctx, tripId, onChange) {
  const c = cache[tripId] || (cache[tripId] = { list: null, unsub: null, listeners: new Set() });
  c.listeners.add(onChange);
  if (!c.unsub) c.unsub = onSnapshot(collection(ctx.S.db, 'trips', tripId, 'shop'), snap => {
    c.list = snap.docs.map(d => ({ id: d.id, ...d.data() })); c.listeners.forEach(f => f());
  }, e => { console.error(e); toast('讀取購物清單失敗：' + (e?.code || e?.message)); });
  return () => c.listeners.delete(onChange);
}
export function stopAllShop() { Object.values(cache).forEach(c => c.unsub?.()); Object.keys(cache).forEach(k => delete cache[k]); }
const write = p => p.catch(e => toast('儲存失敗：' + (e?.code || e?.message)));

/* ───────── 小工具 ───────── */
const mems = t => (t.memberUids || []).filter(u => t.members?.[u]);
const nm = (t, u) => t.members?.[u]?.nickname || '（已離開）';
const av = (t, u, size = 'xs') => avatarHTML(t.members?.[u] || { nickname: '?' }, size);
const W = ['日', '一', '二', '三', '四', '五', '六'];
function tripDays(t) {
  const out = []; if (!t.start || !t.end) return out;
  for (let d = new Date(t.start + 'T00:00:00Z'), i = 1; d <= new Date(t.end + 'T00:00:00Z') && i < 60; d.setUTCDate(d.getUTCDate() + 1), i++) out.push({ ds: d.toISOString().slice(0, 10), i });
  return out;
}
const dayText = (t, ds) => { const d = tripDays(t).find(x => x.ds === ds); return d ? `Day ${d.i}（${+ds.slice(5, 7)}/${+ds.slice(8, 10)} ${W[new Date(ds + 'T00:00:00Z').getUTCDay()]}）` : ds; };
const mapUrl = q => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
const lineTotal = x => (Number(x.budget) || 0) * (Number(x.qty) || 1);
const norm = v => String(v || '').trim().toLowerCase();
const sameItem = (a, b) => norm(a.name) === norm(b.name) && norm(a.place) === norm(b.place);

/* ───────── 照片 ───────── */
async function shrink(file, max, limit) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const cv = document.createElement('canvas'); cv.width = Math.round(img.naturalWidth * k); cv.height = Math.round(img.naturalHeight * k);
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    for (const q of [0.8, 0.65, 0.5, 0.38]) {
      let d = cv.toDataURL('image/webp', q);
      if (!d.startsWith('data:image/webp')) d = cv.toDataURL('image/jpeg', q);
      if (d.length < limit) return d;
    }
    throw new Error('圖片太大');
  } finally { URL.revokeObjectURL(url); }
}
const IMG_CACHE = 'lb-shop-img';
const imgKey = id => new URL('__shopimg/' + encodeURIComponent(id), location.href).href;
async function imgCacheGet(id) { try { const r = await (await caches.open(IMG_CACHE)).match(imgKey(id)); return r ? await r.text() : null; } catch { return null; } }
async function imgCachePut(id, data) { try { await (await caches.open(IMG_CACHE)).put(imgKey(id), new Response(data, { headers: { 'content-type': 'text/plain' } })); } catch {} }
async function imgCacheHas(id) { try { return !!(await (await caches.open(IMG_CACHE)).match(imgKey(id))); } catch { return false; } }
async function imgLoad(ctx, t, id) {
  const hit = await imgCacheGet(id); if (hit) return hit;
  try { const d = await getDoc(doc(ctx.S.db, 'trips', t.id, 'shopImg', id)); const v = d.exists() ? d.data().data : null; if (v) imgCachePut(id, v); return v; } catch { return null; }
}
function showImg(ctx, t, x) {
  openSheet(`<div class="sheet-h"><h3 class="title">${esc(x.name)}</h3><button class="iconbtn" data-close aria-label="關閉">✕</button></div>
    <div class="sh-big"><img src="${esc(x.thumb)}" alt="${esc(x.name)}" id="shBig"></div><p class="tiny faint" id="shBigNote" style="margin:0;text-align:center">載入大圖中…</p>`, async s => {
    const v = await imgLoad(ctx, t, x.imgId);
    if (!s.isConnected) return;
    if (v) { $('#shBig', s).src = v; $('#shBigNote', s).remove(); } else $('#shBigNote', s).textContent = '大圖還沒下載到這支手機，連上網路後再打開一次。';
  });
}

/* ───────── 畫面 ───────── */
export function renderShop(ctx, t) {
  const host = $('#shBody'); if (!host) return;
  const c = cache[t.id];
  if (!c || c.list == null) { host.innerHTML = '<div class="spinner" style="margin:30px auto" role="status" aria-label="載入中"></div>'; return; }
  const me = ctx.S.user.uid, ms = mems(t);
  const who = ms.includes(localGet('shwho:' + t.id)) ? localGet('shwho:' + t.id) : me, mine = who === me;
  const items = c.list.filter(x => x.owner === who).sort((a, b) => (!!a.bought - !!b.bought) || (a.day || '9').localeCompare(b.day || '9') || (a.order || 0) - (b.order || 0));
  const myList = c.list.filter(x => x.owner === me), have = x => myList.some(m => sameItem(m, x));
  const copyable = mine ? [] : items.filter(x => !have(x));
  const cur = t.currency;
  const totAll = items.reduce((n, x) => n + lineTotal(x), 0), totLeft = items.filter(x => !x.bought).reduce((n, x) => n + lineTotal(x), 0);
  const bar = ms.length > 1 ? `<div class="utabs who" role="tablist" aria-label="看誰的清單">${ms.map(u => `<button type="button" role="tab" data-shw="${esc(u)}" aria-selected="${u === who}">${av(t, u, 'xs')}${esc(u === me ? '我的' : nm(t, u))}<span class="n">${c.list.filter(x => x.owner === u).length}</span></button>`).join('')}</div>` : '';
  host.innerHTML = `${bar}
    ${mine ? '' : `<p class="tiny faint" style="margin:0">這是 ${esc(nm(t, who))} 的清單，只能看；想買一樣的可以複製到自己的清單。</p>`}
    ${!mine && copyable.length ? `<button class="btn" id="shCopyAll">${ic.copy}把 ${copyable.length} 項複製到我的清單</button>` : ''}
    ${items.length ? `<section class="card sh-card">${items.map(x => rowHTML(t, x, mine, have)).join('')}
      ${totAll ? `<div class="sh-tot"><span>預算合計 <b class="num">${money(toC(totAll), cur)}</b></span><span>還沒買 <b class="num">${money(toC(totLeft), cur)}</b></span></div>` : ''}</section>
      <button type="button" class="linkbtn" id="shOff" hidden></button>`
    : `<div class="card empty"><p class="small muted" style="margin:0">${mine ? '還沒有想買的東西。按右下角＋新增，可以拍照、記店名和預算，幫朋友代購的也可以直接標好委託人。' : `${esc(nm(t, who))} 還沒有列清單`}</p></div>`}`;
  $$('[data-shw]', host).forEach(b => b.addEventListener('click', () => { localSet('shwho:' + t.id, b.dataset.shw); renderShop(ctx, t); }));
  $$('[data-buy]', host).forEach(b => b.addEventListener('click', () => toggleBought(ctx, t, c.list.find(x => x.id === b.dataset.buy))));
  $$('[data-shed]', host).forEach(b => b.addEventListener('click', () => editShop(ctx, t, c.list.find(x => x.id === b.dataset.shed))));
  $$('[data-shimg]', host).forEach(b => b.addEventListener('click', () => showImg(ctx, t, c.list.find(x => x.id === b.dataset.shimg))));
  $$('[data-shcopy]', host).forEach(b => b.addEventListener('click', () => { const x = c.list.find(i => i.id === b.dataset.shcopy); copyToMine(ctx, t, [x], who); toast(`已把「${x.name}」複製到我的清單`); }));
  $('#shCopyAll', host)?.addEventListener('click', () => { if (!confirm(`把 ${nm(t, who)} 清單裡、你還沒有的 ${copyable.length} 項，都加進你的清單？`)) return; copyToMine(ctx, t, copyable, who); toast(`已複製 ${copyable.length} 項`); });
  offlineHint(ctx, t, items);
  const fab = $('#fab');
  if (fab) { fab.classList.toggle('hidden', !mine); fab.setAttribute('aria-label', '新增想買的東西'); fab.onclick = () => editShop(ctx, t, null); }
}
function rowHTML(t, x, mine, have) {
  const chips = [x.day ? `<span class="chip">${esc(dayText(t, x.day))}</span>` : '', Number(x.qty) > 1 ? `<span class="chip">× <span class="num">${esc(String(x.qty))}</span></span>` : '',
    Number(x.budget) > 0 ? `<span class="chip">預算 <span class="num">${money(toC(lineTotal(x)), x.cur || t.currency)}</span></span>` : '',
    x.cname ? `<span class="chip px">🛍️ 代購：${esc(x.cname)}</span>` : '', x.food ? '<span class="chip">食品</span>' : '',
    x.fromWho && x.fromWho !== x.owner ? `<span class="chip">來自 ${esc(nm(t, x.fromWho))}</span>` : ''].filter(Boolean).join('');
  return `<div class="sh-row ${x.bought ? 'done' : ''}">
    <button type="button" class="ck-box" role="checkbox" aria-checked="${!!x.bought}" aria-label="${esc(x.name)} 已買" data-buy="${esc(x.id)}" ${mine ? '' : 'disabled'}>${x.bought ? ic.check : ''}</button>
    <${mine ? 'button type="button"' : 'div'} class="sh-main" ${mine ? `data-shed="${esc(x.id)}" aria-label="編輯 ${esc(x.name)}"` : ''}>
      <span class="sh-name">${esc(x.name)}</span>
      ${chips ? `<span class="sh-chips">${chips}</span>` : ''}
      ${x.place ? `<span class="tiny muted">📍 ${esc(x.place)}</span>` : ''}
      ${x.note ? `<span class="tiny faint">${esc(x.note)}</span>` : ''}
    </${mine ? 'button' : 'div'}>
    <span class="sh-acts">${x.thumb && x.imgId ? `<button type="button" class="sh-th" data-shimg="${esc(x.id)}" aria-label="看「${esc(x.name)}」的照片"><img src="${esc(x.thumb)}" alt=""></button>` : ''}
      ${x.place ? `<a class="iconbtn" href="${mapUrl(x.place)}" target="_blank" rel="noopener" aria-label="在地圖上找 ${esc(x.place)}">${ic.map}</a>` : ''}
      ${!mine ? (have(x) ? '<span class="tiny faint">已在我的清單</span>' : `<button type="button" class="pillbtn" data-shcopy="${esc(x.id)}">複製</button>`) : ''}</span>
  </div>`;
}
function copyToMine(ctx, t, list, from) {
  const me = ctx.S.user.uid, b = writeBatch(ctx.S.db), now = Date.now();
  list.forEach((x, i) => b.set(doc(collection(ctx.S.db, 'trips', t.id, 'shop')), {
    owner: me, name: x.name, qty: x.qty ?? null, budget: x.budget ?? null, cur: x.cur || t.currency, place: x.place || '', day: x.day || '', note: x.note || '',
    cid: null, cname: '', food: !!x.food, bought: false, expenseId: null, fromWho: from, order: now + i,
    thumb: x.thumb || null, imgId: x.imgId || null, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  write(b.commit());
}
// 清單下方：還沒存到手機的照片，出發前在有 Wi-Fi 的地方按一次
async function offlineHint(ctx, t, items) {
  const btn = $('#shOff'); if (!btn) return;
  const ids = [...new Set(items.filter(x => !x.bought && x.imgId && x.thumb).map(x => x.imgId))];
  if (!ids.length) return;
  const need = []; for (const id of ids) if (!(await imgCacheHas(id))) need.push(id);
  if (!need.length || !btn.isConnected) return;
  btn.hidden = false;
  btn.textContent = `把還沒買的 ${need.length} 張照片存到手機（約 ${Math.max(0.1, Math.round(need.length * 0.09 * 10) / 10)} MB），在店裡沒網路也看得到`;
  btn.onclick = async () => {
    if (!navigator.onLine) { toast('需要網路才能下載照片'); return; }
    btn.disabled = true; let n = 0, fail = 0;
    for (const id of need) { (await imgLoad(ctx, t, id)) ? n++ : fail++; btn.textContent = `下載中… ${n + fail}/${need.length}`; }
    btn.hidden = true; toast(fail ? `存好 ${n} 張，${fail} 張沒下載成功` : `${n} 張照片都存到手機了`);
  };
}
// 勾已買：問要不要順便記一筆（帶入品名、預算×數量；有委託人的直接帶成照收據逐筆填的代購）
async function toggleBought(ctx, t, x) {
  if (!x) return;
  const val = !x.bought;
  x.bought = val; renderShop(ctx, t);
  write(updateDoc(doc(ctx.S.db, 'trips', t.id, 'shop', x.id), { bought: val, updatedAt: serverTimestamp() }));
  if (!val || x.expenseId) return;
  const amt = lineTotal(x) || '', qty = Number(x.qty) || 1, me = ctx.S.user.uid;
  if (!confirm(`「${x.name}」已買好，要順便記一筆帳嗎？\n\n會帶入品名${amt ? `和預算金額 ${money(toC(amt), x.cur || t.currency)}` : ''}，分攤預設只有你自己，存檔前都可以改。`)) return;
  const name = qty > 1 ? `${x.name} ×${qty}` : x.name;
  let rc = null;
  if (x.cid) {
    await ensureMoney(ctx, t);
    const c = clientsOf(t).find(k => k.id === x.cid);
    if (c) rc = { ex: false, rate: 10, low: 8, items: [{ k: rk(), name, price: amt ? String(amt) : '', who: {}, px: { owner: c.owner, cid: c.id, client: c.name }, low: !!x.food, noDisc: false }] };
  }
  addExpenseFrom(ctx, t, { name: x.name, cur: x.cur || t.currency, amount: amt || null, cat: 'shop', split: [me], rc,
    hint: rc ? '已從購物清單帶入代購項目，價格先用預算，請照收據改。' : '已從購物清單帶入，金額先用預算，請照收據改。',
    onSaved: id => write(updateDoc(doc(ctx.S.db, 'trips', t.id, 'shop', x.id), { expenseId: id, updatedAt: serverTimestamp() })) });
}

/* ───────── 新增／編輯 ───────── */
async function editShop(ctx, t, x) {
  const { S } = ctx, me = S.user.uid, isNew = !x, days = tripDays(t), solo = mems(t).length <= 1;
  await ensureMoney(ctx, t); // 要用委託人清單
  let cid = x?.cid || null, cname = x?.cname || '';
  let photo = x?.thumb && x?.imgId ? { thumb: x.thumb, imgId: x.imgId, keep: true } : null;
  const cliOpts = () => {
    const cs = clientsOf(t);
    return `<option value="">不是代購</option>${mems(t).map(u => { const g = cs.filter(c => c.owner === u); return g.length ? `<optgroup label="${esc(nm(t, u))} 負責">${g.map(c => `<option value="${esc(c.id)}" ${cid === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</optgroup>` : ''; }).join('')}
      ${cid && !cs.some(c => c.id === cid) ? `<option value="${esc(cid)}" selected>${esc(cname)}</option>` : ''}<option value="__new">＋ 新增委託人</option>`;
  };
  openSheet(`<div class="sheet-h"><h3 class="title">${isNew ? '新增想買的東西' : '編輯'}</h3><button class="iconbtn" data-close aria-label="關閉">✕</button></div>
    <div class="field"><span>照片（選填）</span><div class="sh-photo" id="sPhoto"></div><input type="file" accept="image/*" id="sFile" hidden></div>
    <label class="field"><span>品名</span><input class="input" id="sName" maxlength="100" value="${esc(x?.name || '')}" placeholder="例如：合利他命 EX Plus"></label>
    <div class="grid2"><label class="field"><span>數量</span><input class="input num" id="sQty" inputmode="numeric" value="${esc(x?.qty ?? '')}" placeholder="1"></label>
      <label class="field"><span>單價預算（${esc(CUR_NAME[t.currency] || t.currency)}）</span><input class="input num" id="sBud" inputmode="decimal" value="${esc(x?.budget ?? '')}" placeholder="0"></label></div>
    <label class="field"><span>地點／店名（選填）</span><input class="input" id="sPlace" maxlength="100" value="${esc(x?.place || '')}" placeholder="例如：唐吉訶德 國際通店"></label>
    ${days.length ? `<label class="field"><span>哪一天買（選填）</span><select class="input" id="sDay"><option value="">不限</option>${days.map(d => `<option value="${d.ds}" ${x?.day === d.ds ? 'selected' : ''}>${esc(dayText(t, d.ds))}</option>`).join('')}</select></label>` : ''}
    <label class="field"><span>代購給（選填）</span><select class="input" id="sCli">${cliOpts()}</select>
      <span class="tiny faint">${solo ? '' : '選了委託人，勾已買記帳時會自動帶成代購。'}</span></label>
    ${t.currency === 'JPY' ? `<label class="row small" style="gap:8px"><input type="checkbox" id="sFood" ${x?.food ? 'checked' : ''}> 食品、飲料（日本消費稅 8%）</label>` : ''}
    <label class="field"><span>備註（選填）</span><input class="input" id="sNote" maxlength="200" value="${esc(x?.note || '')}"></label>
    ${x?.expenseId ? '<p class="tiny faint" style="margin:0">這項已經記過帳了。</p>' : ''}
    <p class="small" id="sErr" style="margin:0;color:var(--danger)"></p>
    <div class="sheet-acts">${isNew ? '' : '<button class="btn danger" id="sDel">刪除</button>'}<button class="btn pri" id="sSave">儲存</button></div>`, s => {
    const paintPhoto = () => {
      $('#sPhoto', s).innerHTML = photo ? `<img src="${esc(photo.thumb)}" alt="照片預覽"><div class="row" style="gap:8px"><button type="button" class="btn" id="sPick">換一張</button><button type="button" class="linkbtn" id="sRm" style="color:var(--danger)">移除</button></div>`
        : `<button type="button" class="itgo" id="sPick">📷 拍照或選照片<span class="tiny">商品包裝、網路截圖都可以，到店裡直接給店員看</span></button>`;
      $('#sPick', s).addEventListener('click', () => $('#sFile', s).click());
      $('#sRm', s)?.addEventListener('click', () => { photo = null; paintPhoto(); });
    };
    paintPhoto();
    $('#sFile', s).addEventListener('change', async ev => {
      const f = ev.target.files?.[0]; ev.target.value = ''; if (!f) return;
      try { photo = { big: await shrink(f, 800, 700000), thumb: await shrink(f, 160, 14000) }; paintPhoto(); }
      catch { toast('這張照片處理不了，換一張試試'); }
    });
    $('#sCli', s).addEventListener('change', async ev => {
      const v = ev.target.value;
      if (v === '__new') { const id = await clientDialog(ctx, t, null, me); if (id) { cid = id; cname = clientsOf(t).find(c => c.id === id)?.name || ''; } ev.target.innerHTML = cliOpts(); return; }
      cid = v || null; cname = v ? clientsOf(t).find(c => c.id === v)?.name || '' : '';
    });
    if (isNew) setTimeout(() => $('#sName', s).focus(), 50);
    $('#sSave', s).addEventListener('click', () => {
      const err = m => { $('#sErr', s).textContent = m; toast(m); };
      const name = $('#sName', s).value.trim(); if (!name) return err('請填品名');
      const qv = $('#sQty', s).value.trim(), qty = qv ? Math.round(Number(qv)) : null; if (qv && !(qty > 0 && qty < 10000)) return err('數量看不懂');
      const bv = $('#sBud', s).value.trim(), budget = bv ? evalAmt(bv) : null; if (bv && !(budget > 0)) return err('預算看不懂');
      const ref = isNew ? doc(collection(S.db, 'trips', t.id, 'shop')) : doc(S.db, 'trips', t.id, 'shop', x.id);
      const b = writeBatch(S.db);
      let thumb = photo?.thumb || null, imgId = photo?.imgId || null;
      if (photo && !photo.keep) { imgId = `${me}_${rk()}${rk()}`; b.set(doc(S.db, 'trips', t.id, 'shopImg', imgId), { owner: me, data: photo.big }); imgCachePut(imgId, photo.big); }
      // 換照片或移除時：自己的舊大圖、沒有其他清單在用，就刪掉
      const old = x?.imgId;
      if (old && old !== imgId && old.startsWith(me + '_') && !(cache[t.id]?.list || []).some(i => i.id !== x.id && i.imgId === old)) b.delete(doc(S.db, 'trips', t.id, 'shopImg', old));
      b.set(ref, { owner: me, name, qty, budget, cur: x?.cur || t.currency, place: $('#sPlace', s).value.trim(), day: $('#sDay', s)?.value || '', note: $('#sNote', s).value.trim(),
        cid, cname, food: !!$('#sFood', s)?.checked, bought: !!x?.bought, expenseId: x?.expenseId || null, fromWho: x?.fromWho || null, order: x?.order || Date.now(),
        thumb, imgId, createdAt: x?.createdAt || serverTimestamp(), updatedAt: serverTimestamp() });
      write(b.commit()); closeSheet(); toast('已儲存');
    });
    $('#sDel', s)?.addEventListener('click', () => {
      if (!confirm(`刪除「${x.name}」？`)) return;
      const b = writeBatch(S.db); b.delete(doc(S.db, 'trips', t.id, 'shop', x.id));
      const old = x.imgId; if (old && old.startsWith(me + '_') && !(cache[t.id]?.list || []).some(i => i.id !== x.id && i.imgId === old)) b.delete(doc(S.db, 'trips', t.id, 'shopImg', old));
      write(b.commit()); closeSheet(); toast('已刪除');
    });
  });
}
