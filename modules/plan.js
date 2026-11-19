// 行程：每天的時間軸、現在進行中、新增／編輯、地圖與導航、備案
import { doc, collection, onSnapshot, setDoc, updateDoc, deleteDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { $, $$, esc, ic, toast, copyText, localGet, localSet } from './ui.js';
import { todayIn, dayCount, tripStatus } from './places.js';
import { bookingEvents } from './book.js';

// 類型：圖示在 img/kinds/（Gemini 畫的線條圖示，用遮罩上色，顏色跟著深淺色主題）
const KINDS = {
  spot: { label: '景點／活動', group: 'stay' },
  food: { label: '吃東西', group: 'stay' },
  stay: { label: '住宿', group: 'stay' },
  shop: { label: '購物', group: 'stay' },
  move: { label: '開車', group: 'go', mode: 'driving' },
  walk: { label: '步行', group: 'go', mode: 'walking' },
  train: { label: '電車／捷運', group: 'go', mode: 'transit' },
  bus: { label: '巴士', group: 'go', mode: 'transit' },
  flight: { label: '飛機', group: 'go' }
};
// 圖示換新版時改這個號碼，手機上的舊快取就不會被拿來用
export const ICON_VER = 'line1';
const isGo = k => KINDS[k]?.group === 'go';
// 舊資料：類型是「移動」但標題寫步行，當成步行
const kindOf = x => (x.kind === 'move' && /步行|走路/.test(x.title || '') ? 'walk' : (KINDS[x.kind] ? x.kind : 'spot'));
export const kindIcon = (k, go, cls = '') => `<span class="kind ${cls} ${go ? 'go' : ''}" aria-hidden="true"><span class="kmask" style="--k:url(img/kinds/${k}.webp?v=${ICON_VER})"></span></span>`;
const kindImg = (x, cls = '') => { const k = kindOf(x); return kindIcon(k, isGo(k), cls); };
const durLabel = k => `${isGo(k) ? '車程時間' : '停留時間'}（分鐘，選填）`;
const W = ['日', '一', '二', '三', '四', '五', '六'];
const mapsSearch = q => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
const mapsDir = (q, mode = 'driving') => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}&travelmode=${mode}`;
const toMin = t => (/^\d{1,2}:\d{2}$/.test(t || '') ? +t.split(':')[0] * 60 + +t.split(':')[1] : null);
const fmtMin = m => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const durOf = x => { const a = toMin(x.start), b = toMin(x.end); return a !== null && b !== null && b >= a ? b - a : null; };

/* ───────── 日期 ───────── */
export function tripDays(t) {
  const n = dayCount(t.start, t.end), base = Date.parse(t.start + 'T00:00:00Z');
  return [...Array(n)].map((_, i) => {
    const d = new Date(base + i * 86400000);
    return { d: i + 1, date: d.toISOString().slice(0, 10), w: W[d.getUTCDay()] };
  });
}
function nowIn(tz) {
  try {
    const p = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
    return { date: todayIn(tz), min: toMin(p.replace(/^24/, '00')) };
  } catch { const d = new Date(); return { date: d.toISOString().slice(0, 10), min: d.getHours() * 60 + d.getMinutes() }; }
}
// 現在進行中／下一站
function nowMarks(items, date, tz) {
  const j = nowIn(tz); if (j.date !== date) return {};
  const list = items.filter(x => toMin(x.start) !== null);
  let now = null;
  list.forEach((x, i) => {
    const s = toMin(x.start), e = x.end ? toMin(x.end) : (list[i + 1] ? toMin(list[i + 1].start) : 24 * 60);
    if (!now && s <= j.min && j.min < e) now = x.id;
  });
  return { now, next: now ? null : (list.find(x => toMin(x.start) > j.min)?.id || null) };
}
const sortIt = (a, b) => {
  const x = toMin(a.start), y = toMin(b.start);
  if (x === null && y === null) return (a.order || 0) - (b.order || 0);
  if (x === null) return 1; if (y === null) return -1;
  return x - y || (a.order || 0) - (b.order || 0);
};

/* ───────── 調整順序 ───────── */
let reorder = null; // { tripId, day, ids }
export const isBusy = () => !!document.getElementById('sheet') || !!reorder;
export function resetPlanUI() { closeSheet(); reorder = null; }
let sortFromPlan = false; // 從行程頁按「調整順序」進來的，離開時用瀏覽器的上一頁
export function exitSort(tripId) {
  reorder = null;
  if (sortFromPlan) { sortFromPlan = false; history.back(); }
  else location.replace(`#/trip/${tripId}/plan`);
}

// 依新順序重算時間：第一個有時間的行程，開始時間不變；之後每個行程接在前一個結束之後，各自的停留時間不變
function recompute(list) {
  const timed = list.filter(x => toMin(x.start) !== null);
  if (!timed.length) return list.map(x => ({ ...x, nStart: x.start || '', nEnd: x.end || '' }));
  let cur = Math.min(...timed.map(x => toMin(x.start)));
  return list.map(x => {
    const d = durOf(x) ?? 0;
    const r = { ...x, nStart: fmtMin(cur), nEnd: d > 0 ? fmtMin(cur + d) : '', over: cur + d >= 24 * 60 };
    cur += d;
    return r;
  });
}
function renderReorder(ctx, t, days, day) {
  const all = cache[t.id]?.items || [];
  const byId = Object.fromEntries(all.map(x => [x.id, x]));
  reorder.ids = reorder.ids.filter(id => byId[id]);
  const rows = () => recompute(reorder.ids.map(id => byId[id]));
  const draw = () => {
    const rs = rows();
    const over = rs.some(r => r.over);
    $('#planBody').innerHTML = `
      <div class="dayhead"><h2 class="title">${day === 0 ? '備案' : `Day ${day}`}・調整順序</h2></div>
      <p class="small muted" style="margin:0">按住左邊的 ${ic.grip} 拖曳，或用右邊的箭頭上下移動。${day === 0 ? '' : '時間會自動重算：第一個行程的開始時間不變，後面依序接上，每個行程的停留時間不變。'}</p>
      <ol class="ro-list" id="roList">${rs.map((r, i) => `<li class="ro-item" data-id="${esc(r.id)}">
          <span class="ro-grip" aria-hidden="true">${ic.grip}</span>
          <span class="ro-time num">${esc(r.nStart || '—')}${r.nEnd ? `<small>${esc(r.nEnd)}</small>` : ''}</span>
          ${kindImg(r, 'sm')}
          <span class="ro-title"><b>${esc(r.title)}</b><small class="tiny faint">${esc(KINDS[kindOf(r)].label)}${durOf(r) ? `・${durOf(r)} 分` : ''}</small></span>
          <span class="ro-btns">
            <button class="iconbtn" data-up="${i}" aria-label="把「${esc(r.title)}」往上移" ${i === 0 ? 'disabled' : ''}>${ic.up}</button>
            <button class="iconbtn" data-down="${i}" aria-label="把「${esc(r.title)}」往下移" ${i === rs.length - 1 ? 'disabled' : ''}>${ic.down}</button>
          </span></li>`).join('')}</ol>
      ${over ? '<p class="warn" role="alert">重算後有行程超過午夜 24:00，請調整順序或縮短停留時間。</p>' : ''}
      <div class="grid2"><button class="btn" id="roCancel">取消</button><button class="btn pri" id="roSave" ${over ? 'disabled' : ''}>完成</button></div>`;
    bind();
  };
  const bind = () => {
    $$('[data-up]').forEach(b => b.addEventListener('click', () => { const i = +b.dataset.up; [reorder.ids[i - 1], reorder.ids[i]] = [reorder.ids[i], reorder.ids[i - 1]]; draw(); $(`[data-up="${i - 1}"]`)?.focus() || $(`[data-down="${i - 1}"]`)?.focus(); }));
    $$('[data-down]').forEach(b => b.addEventListener('click', () => { const i = +b.dataset.down; [reorder.ids[i + 1], reorder.ids[i]] = [reorder.ids[i], reorder.ids[i + 1]]; draw(); $(`[data-down="${i + 1}"]`)?.focus() || $(`[data-up="${i + 1}"]`)?.focus(); }));
    $('#roCancel').addEventListener('click', () => exitSort(t.id));
    $('#roSave').addEventListener('click', () => {
      const rs = rows();
      rs.forEach((r, i) => {
        const orig = byId[r.id];
        if (orig.start === r.nStart && orig.end === r.nEnd && orig.order === i) return;
        updateDoc(doc(ctx.S.db, 'trips', t.id, 'items', r.id), { start: r.nStart, end: r.nEnd, order: i, updatedBy: ctx.S.user.uid, updatedAt: serverTimestamp() })
          .catch(e => toast('儲存失敗：' + (e?.code || e?.message)));
        Object.assign(orig, { start: r.nStart, end: r.nEnd, order: i }); // 先更新畫面，不用等伺服器
      });
      toast('順序已更新'); exitSort(t.id);
    });
    // 拖曳（滑鼠、手指都可以）
    const list = $('#roList');
    $$('.ro-grip', list).forEach(g => g.addEventListener('pointerdown', e => {
      const li = g.closest('.ro-item'); e.preventDefault();
      // 拖曳時元素會在清單裡移動，指標捕捉會失效，所以改在整個視窗監聽
      li.classList.add('dragging');
      let lastY = e.clientY, raf = 0;
      const move = ev => {
        lastY = ev.clientY;
        const others = $$('.ro-item', list).filter(x => x !== li);
        const target = others.find(x => { const r = x.getBoundingClientRect(); return lastY < r.top + r.height / 2; });
        if (target) { if (li.nextElementSibling !== target) list.insertBefore(li, target); }
        else if (list.lastElementChild !== li) list.appendChild(li);
        // 拖到畫面邊緣時自動捲動
        cancelAnimationFrame(raf);
        const edge = () => { const dy = lastY < 90 ? -8 : lastY > innerHeight - 130 ? 8 : 0; if (dy) { scrollBy(0, dy); raf = requestAnimationFrame(edge); } };
        edge();
        // 即時預覽新的時間
        const ids = $$('.ro-item', list).map(x => x.dataset.id);
        recompute(ids.map(id => byId[id])).forEach(r => {
          const tEl = $(`.ro-item[data-id="${CSS.escape(r.id)}"] .ro-time`, list);
          if (tEl) tEl.innerHTML = `${esc(r.nStart || '—')}${r.nEnd ? `<small>${esc(r.nEnd)}</small>` : ''}`;
        });
      };
      const up = () => {
        cancelAnimationFrame(raf);
        removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
        reorder.ids = $$('.ro-item', list).map(x => x.dataset.id);
        draw();
      };
      addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
    }));
  };
  draw();
}

/* ───────── 即時資料 ───────── */
const cache = {}; // tripId → { items, unsub }
export function watchItems(ctx, tripId, onChange) {
  const c = cache[tripId] || (cache[tripId] = { items: null, unsub: null, listeners: new Set() });
  c.listeners.add(onChange);
  if (!c.unsub) {
    c.unsub = onSnapshot(collection(ctx.S.db, 'trips', tripId, 'items'), snap => {
      c.items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      c.listeners.forEach(f => f());
    }, e => { console.error(e); toast('讀取行程失敗：' + (e?.code || e?.message)); });
  }
  return () => c.listeners.delete(onChange);
}
export function stopAllItems() { Object.values(cache).forEach(c => c.unsub?.()); Object.keys(cache).forEach(k => delete cache[k]); }

/* ───────── 畫面 ───────── */
export function renderPlan(ctx, t, sortDay = null) {
  const { S } = ctx;
  const days = tripDays(t);
  const key = 'day:' + t.id;
  const st = tripStatus(t);
  const today = todayIn(t.tz);
  const todayDay = days.find(d => d.date === today)?.d;
  let day = sortDay ?? localGet(key);
  day = day === null ? (todayDay || 1) : +day;
  if (day !== 0 && !days.some(d => d.d === day)) day = 1;
  const items = (cache[t.id]?.items || []).filter(x => x.day === day).sort(sortIt);
  if (sortDay !== null) {
    if (cache[t.id]?.items == null) { $('#planBody').innerHTML = '<div class="spinner" style="margin:30px auto" role="status" aria-label="載入中"></div>'; return; }
    if (!reorder || reorder.tripId !== t.id || reorder.day !== day) reorder = { tripId: t.id, day, ids: items.map(x => x.id) };
    return renderReorder(ctx, t, days, day);
  }
  reorder = null;
  const dinfo = days.find(d => d.d === day);
  const marks = dinfo ? nowMarks(items, dinfo.date, t.tz) : {};
  const evs = dinfo ? bookingEvents(t.id, dinfo.date) : [];
  const japan = (t.places || []).some(p => p.country === 'JP');
  const body = cache[t.id]?.items == null ? '<div class="spinner" style="margin:30px auto" role="status" aria-label="載入中"></div>'
    : (items.length || evs.length) ? `<div class="timeline">${[...items.map(x => ({ x })), ...evs.map(e => ({ e }))]
        .sort((a, b) => sortIt(a.x || { start: a.e.start, order: -1 }, b.x || { start: b.e.start, order: -1 }))
        .map(r => (r.x ? itemHTML(r.x, marks) : evHTML(t, r.e))).join('')}</div>`
    : `<div class="card empty"><p class="small muted" style="margin:0">${day === 0 ? '還沒有備案。可以放「有空再去」或「下雨時的替代方案」。' : '這天還沒有行程。'}</p></div>`;
  const tzNote = (() => { try { return new Intl.DateTimeFormat('zh-TW', { timeZone: t.tz, timeZoneName: 'short' }).formatToParts(new Date()).find(p => p.type === 'timeZoneName')?.value || t.tz; } catch { return t.tz; } })();
  $('#planBody').innerHTML = `
    <nav class="daybar" id="daybar" aria-label="選擇日期">
      ${days.map(d => `<button class="daychip ${st === 'now' && todayDay === d.d ? 'today' : ''}" aria-pressed="${day === d.d}" data-day="${d.d}">
        <b>Day ${d.d}</b><span>${+d.date.slice(5, 7)}/${+d.date.slice(8)}（${d.w}）</span></button>`).join('')}
      <button class="daychip" aria-pressed="${day === 0}" data-day="0"><b>備案</b><span>口袋名單</span></button>
    </nav>
    <div class="dayhead"><h2 class="title">${day === 0 ? '備案' : `Day ${day}`}</h2>
      <span class="small muted" style="flex:1">${dinfo ? `${dinfo.date.replace(/-/g, '/')}（${dinfo.w}）・當地時間 ${esc(tzNote)}` : '有空檔或天氣不好時的選擇'}</span>
      ${items.length >= 2 ? `<button class="btn sm" id="roStart">${ic.sort}調整順序</button>` : ''}</div>
    ${body}
    <button class="btn full" id="addIt">${ic.plus}新增${day === 0 ? '備案' : '行程'}</button>`;
  $('#daybar').addEventListener('click', e => {
    const b = e.target.closest('[data-day]'); if (!b) return;
    localSet(key, b.dataset.day); renderPlan(ctx, t); centerDay(true);
  });
  $('#addIt').addEventListener('click', () => editItem(ctx, t, null, day, japan));
  $('#roStart')?.addEventListener('click', () => { sortFromPlan = true; location.hash = `#/trip/${t.id}/plan/sort/${day}`; });
  $$('[data-edit]').forEach(b => b.addEventListener('click', () => editItem(ctx, t, (cache[t.id].items || []).find(x => x.id === b.dataset.edit), day, japan)));
  $$('[data-copy]').forEach(b => b.addEventListener('click', () => copyText(b.dataset.copy)));
  centerDay(false);
  if ((marks.now || marks.next) && !renderPlan.scrolled?.[t.id]) {
    renderPlan.scrolled = { ...(renderPlan.scrolled || {}), [t.id]: true };
    const el = document.getElementById('it-' + (marks.now || marks.next));
    if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 250);
  }
}
function centerDay(smooth) {
  const bar = $('#daybar'), sel = bar?.querySelector('[aria-pressed="true"]'); if (!sel) return;
  const br = bar.getBoundingClientRect(), sr = sel.getBoundingClientRect();
  bar.scrollTo({ left: bar.scrollLeft + (sr.left + sr.width / 2) - (br.left + br.width / 2), behavior: smooth ? 'smooth' : 'auto' });
}

function itemHTML(x, marks) {
  const s = toMin(x.start), e = toMin(x.end);
  const mins = s !== null && e !== null && e > s ? e - s : null;
  const isNow = marks.now === x.id, isNext = marks.next === x.id;
  const flag = isNow ? '<span class="chip">現在進行中</span>' : isNext ? '<span class="chip">下一站</span>' : '';
  const notes = (x.note || '').split('\n').map(l => l.trim()).filter(Boolean);
  const kk = kindOf(x), mode = KINDS[kk].mode;
  const mc = x.mapcode ? `<button class="btn sm" data-copy="${esc(x.mapcode)}">${ic.copy}Mapcode ${esc(x.mapcode)}</button>` : '';
  const editBtn = `<button class="iconbtn" data-edit="${esc(x.id)}" aria-label="編輯「${esc(x.title)}」">${ic.edit}</button>`;
  if (isGo(kk)) {
    return `<div class="it move ${isNow ? 'now' : ''}" id="it-${esc(x.id)}">
      <div class="t num">${esc(x.start || '')}</div>
      <div class="it-card mv">
        <div class="row" style="align-items:flex-start;gap:10px">
          ${kindImg(x, 'sm')}
          <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px">
            <div class="row" style="gap:8px;flex-wrap:wrap"><b style="font-size:14px">${esc(x.title)}</b>${mins ? `<span class="tiny faint num">${mins} 分</span>` : ''}${flag}</div>
            ${notes.map(n => `<span class="tiny muted">${esc(n)}</span>`).join('')}
          </div>${editBtn}
        </div>
        ${(x.map && mode) || mc ? `<div class="acts">${x.map && mode ? `<a class="btn sm pri" href="${mapsDir(x.map, mode)}" target="_blank" rel="noopener">${ic.nav}導航</a>` : ''}${mc}</div>` : ''}
      </div></div>`;
  }
  return `<div class="it ${isNow ? 'now' : ''}" id="it-${esc(x.id)}">
    <div class="t"><span class="num">${esc(x.start || '—')}</span>${x.end ? `<small class="num">${esc(x.end)}</small>` : ''}</div>
    <div class="it-card">
      <div class="row" style="align-items:flex-start;gap:10px">
        ${kindImg(x)}
        <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:4px">
          <div class="row" style="gap:8px;flex-wrap:wrap"><b style="font-size:15.5px">${esc(x.title)}</b>${flag}</div>
          ${mins || x.price ? `<div class="row tiny muted" style="gap:10px">${mins ? `<span>${ic.clock}<span class="num">${mins}</span> 分</span>` : ''}${x.price ? `<span>${ic.coin}${esc(x.price)}</span>` : ''}</div>` : ''}
        </div>${editBtn}
      </div>
      ${notes.length ? `<div class="notes">${notes.map(n => `<p>${esc(n)}</p>`).join('')}</div>` : ''}
      ${x.map || mc ? `<div class="acts">${x.map ? `<a class="btn sm" href="${mapsSearch(x.map)}" target="_blank" rel="noopener">${ic.map}地圖</a><a class="btn sm pri" href="${mapsDir(x.map)}" target="_blank" rel="noopener">${ic.nav}導航</a>` : ''}${mc}</div>` : ''}
    </div></div>`;
}

// 交通住宿自動帶進來的卡片（不能在這裡編輯，點了跳到交通住宿）
function evHTML(t, e) {
  return `<a class="it ev" href="#/trip/${esc(t.id)}/book/${esc(e.bid)}" aria-label="${esc(e.title)}，到交通住宿查看">
    <div class="t"><span class="num">${esc(e.start || '—')}</span>${e.end ? `<small class="num">${esc(e.end)}</small>` : ''}</div>
    <div class="it-card ev-card">
      <div class="row" style="align-items:center;gap:10px">${kindIcon(e.icon, e.go, 'sm')}
        <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px"><b style="font-size:14.5px">${esc(e.title)}</b>${e.sub ? `<span class="tiny muted ellip">${esc(e.sub)}</span>` : ''}</div>
        <span class="chip muted-chip">交通住宿</span></div>
    </div></a>`;
}

/* ───────── 底部彈出視窗 ───────── */
export function openSheet(html, onOpen) {
  closeSheet();
  const bg = document.createElement('div');
  bg.className = 'sheet-bg'; bg.id = 'sheet';
  bg.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(bg);
  document.body.style.overflow = 'hidden';
  // 點外面灰色區域不會關掉（避免填到一半誤觸）；按 ✕ 或 Esc 才關，有改過內容會先確認
  let dirty = false;
  bg.addEventListener('input', () => { dirty = true; });
  bg.addEventListener('change', () => { dirty = true; });
  const tryClose = () => { if (!dirty || confirm('還沒儲存，確定要關掉嗎？')) closeSheet(); };
  bg.addEventListener('click', e => { if (e.target.closest('[data-close]')) tryClose(); });
  bg.addEventListener('keydown', e => { if (e.key === 'Escape') tryClose(); });
  onOpen?.(bg.firstElementChild);
  bg.querySelector('input,textarea,select')?.focus({ preventScroll: true });
}
export function closeSheet() { $('#sheet')?.remove(); document.body.style.overflow = ''; }

function editItem(ctx, t, x, day, japan) {
  const { S } = ctx;
  const isNew = !x;
  if (!x) {
    // 當天已經有行程：開始時間預設接在最後一筆之後
    const prev = (cache[t.id]?.items || []).filter(i => i.day === day && toMin(i.start) !== null).sort(sortIt).pop();
    x = { day, start: prev ? (prev.end || prev.start) : '', end: '', title: '', kind: 'spot', note: '', price: '', map: '', mapcode: '' };
  }
  const days = tripDays(t);
  const who = x.updatedBy ? (t.members?.[x.updatedBy]?.nickname || '已離開的成員') : '';
  const when = x.updatedAt?.toDate ? x.updatedAt.toDate() : null;
  openSheet(`<div class="sheet-h"><h3 class="title">${isNew ? '新增行程' : '編輯行程'}</h3><button class="iconbtn" data-close aria-label="關閉">✕</button></div>
    <label class="field"><span>行程項目</span><input class="input" id="fTitle" value="${esc(x.title)}" maxlength="200" placeholder="例如：美術館、拉麵、搭電車到市區"></label>
    <div class="grid2">
      <label class="field"><span>哪一天</span><select class="input" id="fDay">
        ${days.map(d => `<option value="${d.d}" ${x.day === d.d ? 'selected' : ''}>Day ${d.d}（${+d.date.slice(5, 7)}/${+d.date.slice(8)}）</option>`).join('')}
        <option value="0" ${x.day === 0 ? 'selected' : ''}>備案</option></select></label>
      <label class="field"><span>類型</span><select class="input" id="fKind">
        <optgroup label="停留">${Object.entries(KINDS).filter(([, v]) => v.group === 'stay').map(([k, v]) => `<option value="${k}" ${kindOf(x) === k ? 'selected' : ''}>${v.label}</option>`).join('')}</optgroup>
        <optgroup label="交通">${Object.entries(KINDS).filter(([, v]) => v.group === 'go').map(([k, v]) => `<option value="${k}" ${kindOf(x) === k ? 'selected' : ''}>${v.label}</option>`).join('')}</optgroup></select></label>
    </div>
    <div class="grid2">
      <div class="field"><span>開始</span><time-24 class="input t24" id="fStart" value="${esc(x.start)}" aria-label="開始"></time-24></div>
      <div class="field"><span>結束（選填）</span><time-24 class="input t24" id="fEnd" value="${esc(x.end)}" aria-label="結束"></time-24></div>
    </div>
    <div class="field"><label for="fDur" id="fDurLbl">${durLabel(kindOf(x))}</label>
      <div class="dur-row"><input class="input" type="number" inputmode="numeric" min="0" max="1440" step="5" id="fDur" value="${durOf(x) ?? ''}" placeholder="例如 60">
        <div class="dur-chips" role="group" aria-label="快速選擇分鐘">${[15, 30, 60, 90, 120].map(m => `<button type="button" class="btn sm" data-dur="${m}">${m}</button>`).join('')}</div></div>
    </div>
    <p class="tiny" id="fMins" style="margin:-4px 2px 0;min-height:1em"></p>
    <label class="field"><span>備註（一行一點）</span><textarea class="input" id="fNote" rows="3" maxlength="2000">${esc(x.note)}</textarea></label>
    <label class="field"><span>金額（參考，選填）</span><input class="input" id="fPrice" value="${esc(x.price)}" maxlength="40" placeholder="例如 ¥2,000／人"></label>
    <label class="field"><span>Google Maps 地點（店名或地址）</span><input class="input" id="fMap" value="${esc(x.map)}" maxlength="200" placeholder="填了就會出現「地圖」「導航」按鈕"></label>
    <a class="tiny" id="fMapTest" href="#" target="_blank" rel="noopener" style="margin-top:-4px">在 Google Maps 檢查這個地點 ›</a>
    ${japan || x.mapcode ? `<label class="field"><span>Mapcode（日本自駕導航用，選填）</span><input class="input" id="fMc" value="${esc(x.mapcode)}" maxlength="30" inputmode="numeric" placeholder="例如 553 075 797*77"></label>` : ''}
    ${!isNew && who ? `<p class="tiny faint" style="margin:0">最後修改：${esc(who)}${when ? `・${when.getMonth() + 1}/${when.getDate()} ${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}` : ''}</p>` : ''}
    <div class="sheet-acts">${isNew ? '' : '<button class="btn danger" id="fDel">刪除</button>'}<button class="btn pri" id="fSave">儲存</button></div>`, s => {
    const fS = $('#fStart', s), fE = $('#fEnd', s), fD = $('#fDur', s);
    const upd = () => {
      const a = toMin(fS.value), b = toMin(fE.value);
      const bad = b !== null && (a === null || b < a), mm = $('#fMins', s);
      mm.textContent = bad ? (a === null ? '有結束時間時，請先填開始時間' : '結束時間不能早於開始時間')
        : a !== null && b !== null && b > a ? `${fmtMin(a)} – ${fmtMin(b)}，共 ${b - a} 分鐘` : fD.value && a === null ? '填了開始時間，就會自動算出結束時間' : '';
      mm.style.color = bad ? 'var(--danger)' : 'var(--ink3)';
      $$('[data-dur]', s).forEach(c => c.setAttribute('aria-pressed', String(+c.dataset.dur === +fD.value)));
      const q = $('#fMap', s).value.trim();
      $('#fMapTest', s).href = q ? mapsSearch(q) : '#';
      $('#fMapTest', s).classList.toggle('hidden', !q);
    };
    // 開始＋分鐘 → 自動算結束；改結束 → 自動算分鐘
    const fromDur = () => {
      const a = toMin(fS.value), d = parseInt(fD.value, 10);
      if (a !== null && d >= 0) fE.value = fmtMin(Math.min(a + d, 23 * 60 + 59));
    };
    fS.addEventListener('input', () => { if (fD.value !== '') fromDur(); upd(); });
    fD.addEventListener('input', () => { if (fD.value === '') fE.value = ''; else fromDur(); upd(); });
    fE.addEventListener('input', () => { const a = toMin(fS.value), b = toMin(fE.value); fD.value = a !== null && b !== null && b >= a ? b - a : ''; upd(); });
    $$('[data-dur]', s).forEach(c => c.addEventListener('click', () => { fD.value = c.dataset.dur; fromDur(); upd(); }));
    $('#fKind', s).addEventListener('change', e => { $('#fDurLbl', s).textContent = durLabel(e.target.value); });
    $('#fMap', s).addEventListener('input', upd); upd();
    $('#fSave', s).addEventListener('click', () => {
      const v = id => ($(id, s)?.value || '').trim();
      const title = v('#fTitle'); if (!title) { toast('請填寫行程項目'); return; }
      const sm = toMin(v('#fStart')), em = toMin(v('#fEnd'));
      if (em !== null && (sm === null || em < sm)) { toast(sm === null ? '有結束時間時，請先填開始時間' : '結束時間不能早於開始時間'); return; }
      const data = { day: +v('#fDay'), start: v('#fStart'), end: v('#fEnd'), title, kind: v('#fKind'), note: $('#fNote', s).value.replace(/\r/g, '').trim(),
        price: v('#fPrice'), map: v('#fMap'), mapcode: v('#fMc'), updatedBy: S.user.uid, updatedAt: serverTimestamp() };
      // 不等伺服器回應：沒網路時先存在手機上，恢復連線後自動同步
      const p = isNew
        ? setDoc(doc(collection(S.db, 'trips', t.id, 'items')), { ...data, order: Date.now(), createdBy: S.user.uid, createdAt: serverTimestamp() })
        : updateDoc(doc(S.db, 'trips', t.id, 'items', x.id), data);
      p.catch(e => toast('儲存失敗：' + (e?.code || e?.message)));
      closeSheet(); localSet('day:' + t.id, String(data.day));
      toast(navigator.onLine ? '已儲存' : '已儲存，恢復連線後會自動同步');
      renderPlan(ctx, t);
    });
    $('#fDel', s)?.addEventListener('click', () => {
      if (!confirm(`刪除「${x.title}」？`)) return;
      deleteDoc(doc(S.db, 'trips', t.id, 'items', x.id)).catch(e => toast('刪除失敗：' + (e?.code || e?.message)));
      closeSheet(); toast('已刪除');
    });
  });
}
