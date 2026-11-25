// 個人檔案：第一次登入的設定、代表色測驗、個人檔案頁、編輯
import { doc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { $, $$, esc, ic, toast, isDark } from './ui.js';
import { BG_MODES, bgMode, setBgMode } from './weather.js';
import { CORE, coreById, QUIZ, FAMILIES, quizColor, soft, isAllowedGuestColor } from './color.js';

/* ───────── 頭像與代表色 ───────── */
export const memberColor = p => (isDark() ? p.colorDark || p.color : p.color) || '#8A94A6';

export function avatarHTML(p, size = '') {
  const c = memberColor(p);
  const letter = esc((p.nickname || '?').trim().slice(0, 1));
  let src = '';
  if (p.avatarType === 'core' && p.coreId) src = coreById(p.coreId)?.avatar || '';
  else if (p.avatarType === 'upload' && (p.avatarData || p.avatarThumb)) src = p.avatarData || p.avatarThumb;
  else if (p.avatarType === 'google' && p.photoURL) src = p.photoURL;
  const img = src ? `<img src="${esc(src)}" alt="" referrerpolicy="no-referrer" data-l="${letter}" onerror="this.parentNode.textContent=this.dataset.l">` : letter;
  return `<span class="av ${size}" style="--c:${c};--cs:${soft(c, isDark())}">${img}</span>`;
}

/* ───────── 上傳頭像：裁成正方形、縮成 256px、壓到 100KB 以內 ───────── */
async function processImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const draw = n => {
      const cv = document.createElement('canvas'); cv.width = cv.height = n;
      cv.getContext('2d').drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, n, n);
      return cv;
    };
    const encode = (cv, limit) => {
      for (const q of [0.85, 0.7, 0.55, 0.4]) {
        let d = cv.toDataURL('image/webp', q);
        if (!d.startsWith('data:image/webp')) d = cv.toDataURL('image/jpeg', q); // 部分 Safari 不支援輸出 webp
        if (d.length < limit) return d;
      }
      throw new Error('圖片太大');
    };
    // 大圖給個人檔案用（100KB 內），小圖放進旅程成員資料（12KB 內）
    return { data: encode(draw(256), 100 * 1024 * 1.37), thumb: encode(draw(96), 12000) };
  } finally { URL.revokeObjectURL(url); }
}

/* ───────── 表單（第一次設定、編輯共用） ───────── */
function formHTML(f, core, user) {
  const avOpts = [
    ...(core ? [['core', '角色頭像']] : []),
    ...(user.photoURL ? [['google', 'Google 頭像']] : []),
    ['upload', '自己上傳']
  ];
  return `
  <label class="field"><span>暱稱</span>
    <input class="input" id="fNick" maxlength="20" autocomplete="nickname" value="${esc(f.nickname)}" placeholder="大家怎麼叫你">
  </label>
  <label class="field"><span>護照英文名（選填）</span>
    <input class="input" id="fPass" maxlength="40" autocapitalize="characters" autocomplete="off" value="${esc(f.passportName)}" placeholder="和護照上一樣，例如 WANG XIAOMING">
    <span class="tiny faint">訂機票、住宿時方便大家核對；只有一起出遊的人看得到</span>
  </label>
  <div class="field"><span id="lblDrive">會開車嗎？</span>
    <div class="seg" role="group" aria-labelledby="lblDrive">
      <button type="button" data-drive="1" aria-pressed="${f.driver === true}">${ic.car}會開車</button>
      <button type="button" data-drive="0" aria-pressed="${f.driver === false}">不開車</button>
    </div>
  </div>
  <div class="field"><span id="lblAv">頭像</span>
    <div class="seg" role="group" aria-labelledby="lblAv">
      ${avOpts.map(([v, t]) => `<button type="button" data-av="${v}" aria-pressed="${f.avatarType === v && (v !== 'upload' || !!f.avatarData)}">${v === 'upload' && f.avatarData ? '換一張' : t}</button>`).join('')}
    ${!user.photoURL && !core && f.avatarType !== 'upload' ? '<span class="tiny faint">你的 Google 帳號沒有大頭貼，先用暱稱第一個字當頭像</span>' : ''}
    </div>
    <input type="file" id="fFile" accept="image/*" class="hidden">
  </div>`;
}
function bindForm(f, onChange) {
  $('#fNick').addEventListener('input', e => { f.nickname = e.target.value; });
  $('#fPass').addEventListener('input', e => { f.passportName = e.target.value.toUpperCase(); });
  $$('[data-drive]').forEach(b => b.addEventListener('click', () => { f.driver = b.dataset.drive === '1'; onChange(); }));
  $$('[data-av]').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.av === 'upload') return $('#fFile').click();
    f.avatarType = b.dataset.av; onChange();
  }));
  $('#fFile').addEventListener('change', async e => {
    const file = e.target.files?.[0]; if (!file) return;
    try { const r = await processImage(file); f.avatarData = r.data; f.avatarThumb = r.thumb; f.avatarType = 'upload'; onChange(); }
    catch { toast('這張圖片沒辦法使用，請換一張'); }
  });
}
function validate(f) {
  f.nickname = (f.nickname || '').trim();
  f.passportName = (f.passportName || '').trim().replace(/\s+/g, ' ');
  if (!f.nickname) return '請填暱稱';
  if (f.passportName && !/^[A-Z][A-Z ,.'-]*$/.test(f.passportName)) return '護照英文名只能有英文字母和空格';
  if (f.driver == null) return '請選擇會不會開車';
  return '';
}

/* ───────── 存檔 ───────── */
async function saveProfile(ctx, data, isNew) {
  const { S } = ctx;
  const payload = {
    ...data,
    email: S.user.email || '',
    photoURL: S.user.photoURL || '',
    updatedAt: serverTimestamp(),
    ...(isNew ? { createdAt: serverTimestamp() } : {})
  };
  if (payload.avatarType !== 'upload') { payload.avatarData = ''; payload.avatarThumb = ''; }
  // 旅伴第一次建立個人檔案時要附上邀請碼，安全規則會檢查邀請碼有效（擋掉沒被邀請的陌生帳號）
  if (isNew && !S.coreId) payload.inviteCode = ctx.inviteCode?.() || '';
  await setDoc(doc(S.db, 'users', S.user.uid), payload, { merge: true });
  ctx.setProfile({ ...(S.profile || {}), ...payload, id: S.user.uid });
  if (!isNew) ctx.afterProfileSave?.().catch(e => console.warn('同步旅程成員資料失敗', e));
}

/* ───────── 第一次登入 ───────── */
let ob = null;
export function renderOnboarding(ctx) {
  const { S } = ctx;
  // 沒有邀請碼的陌生帳號：不能建立個人檔案
  if (!S.coreId && !ctx.inviteCode?.()) {
    $('#main').innerHTML = `<div class="wrap">${ctx.topBar(ctx.brand)}
      <section class="card"><b>需要小夥伴的邀請</b>
        <p class="small muted" style="margin:0">小夥伴粗企玩只開放受邀的旅伴使用。請點小夥伴傳給你的邀請連結，再用這個 Google 帳號登入。</p>
        <p class="tiny faint" style="margin:0">目前登入：${esc(S.user.email || '')}</p>
        <button class="btn full" id="logout">${ic.out}登出，換一個帳號</button></section></div>`;
    ctx.bindTop();
    $('#logout').addEventListener('click', () => ctx.signOut());
    return;
  }
  if (!ob || ob.uid !== S.user.uid) {
    const c = coreById(S.coreId);
    ob = {
      uid: S.user.uid, step: 'form', qi: 0, answers: [], tweak: 0,
      f: { nickname: c ? c.name : (S.user.displayName || '').slice(0, 20), passportName: '', driver: c ? c.driver : null,
        avatarType: c ? 'core' : 'google', avatarData: '', avatarThumb: '' }
    };
  }
  if (ob.step === 'quiz') return renderQuiz(ctx, ob, () => { ob.step = 'result'; renderOnboarding(ctx); }, () => { ob.step = 'form'; renderOnboarding(ctx); });
  if (ob.step === 'result') return renderResult(ctx, ob, async res => {
    await saveProfile(ctx, { ...ob.f, ...res }, true);
    ob = null; toast('個人檔案建立好了！'); ctx.afterOnboard();
  });
  renderOnboardForm(ctx);
}

function previewProfile(S, f, extra = {}) {
  const c = coreById(S.coreId);
  return { nickname: f.nickname || '？', avatarType: f.avatarType, avatarData: f.avatarData, photoURL: S.user.photoURL,
    coreId: S.coreId, color: c?.color || '#8A94A6', colorDark: c?.colorDark || '#A0A8B4', ...extra };
}

function renderOnboardForm(ctx) {
  const { S } = ctx;
  const c = coreById(S.coreId);
  const f = ob.f;
  $('#main').innerHTML = `<div class="wrap">${ctx.topBar(ctx.brand)}
    <div class="row" style="gap:16px">
      ${avatarHTML(previewProfile(S, f), 'xl')}
      <div style="display:flex;flex-direction:column;gap:6px">
        <h1 class="title" style="font-size:24px;line-height:1.3">${c ? `歡迎回來，${esc(c.name)}！` : '歡迎加入小夥伴粗企玩'}</h1>
        <p class="small muted" style="margin:0">${c ? '你的代表色和頭像沿用沖繩之旅的設定。' : '先建立個人檔案，接著做個小測驗，找出你的代表色。'}</p>
      </div>
    </div>
    <section class="card">${formHTML(f, !!c, S.user)}</section>
    <p class="warn hidden" id="err" role="alert"></p>
    <button class="btn pri full" id="next">${c ? '完成' : '下一步：找出我的代表色'}</button>
    <button class="btn full" id="logout">${ic.out}登出，換一個帳號</button>
  </div>`;
  ctx.bindTop();
  bindForm(f, () => renderOnboardForm(ctx));
  $('#logout').addEventListener('click', () => { ob = null; ctx.signOut(); });
  $('#next').addEventListener('click', async () => {
    const err = validate(f);
    if (err) { $('#err').textContent = err; $('#err').classList.remove('hidden'); return; }
    if (!c) { ob.step = 'quiz'; ob.qi = 0; return renderOnboarding(ctx); }
    const btn = $('#next'); btn.disabled = true;
    try {
      await saveProfile(ctx, { ...f, coreId: c.id, color: c.color, colorDark: c.colorDark, colorName: `${c.name}的代表色`, colorDesc: '' }, true);
      ob = null; toast('歡迎回來！'); ctx.afterOnboard();
    } catch (e) { btn.disabled = false; toast('存檔失敗：' + (e?.code || e?.message)); }
  });
}

/* ───────── 測驗 ───────── */
function renderQuiz(ctx, st, onDone, onBackOut) {
  const q = QUIZ[st.qi];
  const sel = st.answers[st.qi];
  const fam = st.qi === 0;
  const optColor = o => {
    if (!fam) return null;
    const r = quizColor([QUIZ[0].options.indexOf(o), 1, 1, 1, 1]);
    return isDark() ? r.colorDark : r.color;
  };
  $('#main').innerHTML = `<div class="wrap" style="min-height:100dvh">
    <header class="top">
      <button class="iconbtn" id="qBack" aria-label="上一步" style="margin-left:-10px">${ic.back}</button>
      <div class="progress" aria-hidden="true">${QUIZ.map((_, i) => `<i class="${i <= st.qi ? 'on' : ''}"></i>`).join('')}</div>
      <span class="num muted" style="font-size:14px">${st.qi + 1} / ${QUIZ.length}</span>
    </header>
    <div><div class="small faint">找出你的代表色</div>
      <h1 class="title" style="font-size:25px;line-height:1.35">${esc(q.q)}</h1></div>
    <div role="radiogroup" aria-label="選一個最像你的答案" style="display:flex;flex-direction:column;gap:10px">
      ${q.options.map((o, i) => {
        const c = optColor(o);
        return `<button class="opt" role="radio" aria-checked="${sel === i}" data-i="${i}" ${c ? `style="--oc:${c};--ot:${soft(c, isDark())}"` : ''}>
          ${fam ? `<span class="oi">${ic[o.icon]}</span>` : ''}
          <span style="flex:1">${esc(o.t)}</span><span class="tick">${ic.check}</span></button>`;
      }).join('')}
    </div>
    <div style="margin-top:auto;display:flex;flex-direction:column;gap:10px">
      <button class="btn pri full" id="qNext" ${sel == null ? 'disabled' : ''}>${st.qi === QUIZ.length - 1 ? '看結果' : '下一題'}</button>
      <p class="tiny faint" style="text-align:center;margin:0">你的代表色會避開小夥伴們的顏色</p>
    </div>
  </div>`;
  $$('.opt').forEach(b => b.addEventListener('click', () => { st.answers[st.qi] = +b.dataset.i; renderQuiz(ctx, st, onDone, onBackOut); }));
  $('#qBack').addEventListener('click', () => { if (st.qi === 0) onBackOut(); else { st.qi--; renderQuiz(ctx, st, onDone, onBackOut); } });
  $('#qNext').addEventListener('click', () => {
    if (st.answers[st.qi] == null) return;
    if (st.qi < QUIZ.length - 1) { st.qi++; renderQuiz(ctx, st, onDone, onBackOut); window.scrollTo(0, 0); }
    else { st.tweak = 0; onDone(); }
  });
}

function renderResult(ctx, st, onSave, saveLabel = '就用這個顏色') {
  const { S } = ctx;
  const r = quizColor(st.answers, st.tweak);
  const res = { color: r.color, colorDark: r.colorDark, colorName: r.name, colorDesc: r.desc, quiz: { answers: st.answers, tweak: st.tweak } };
  const prof = { ...previewProfile(S, st.f || S.profile || {}), ...(S.profile || {}), ...(st.f || {}), ...res, coreId: null };
  const steps = Math.round(st.tweak / 0.02);
  $('#main').innerHTML = `<div class="wrap">
    <header class="top"><button class="iconbtn" id="rBack" aria-label="回到上一題" style="margin-left:-10px">${ic.back}</button><span></span></header>
    <div style="display:flex;flex-direction:column;align-items:center;gap:14px;text-align:center">
      ${avatarHTML(prof, 'xl')}
      <div class="small faint">你的代表色是</div>
      <h1 class="title" style="font-size:30px">${esc(r.name)}</h1>
      <p class="muted" style="margin:0;line-height:1.6">${esc(r.desc)}</p>
    </div>
    <section class="card">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="field"><div class="swatch" style="background:${r.color}"></div><span class="tiny faint">淺色模式 <span class="num">${r.color}</span></span></div>
        <div class="field"><div class="swatch" style="background:${r.colorDark}"></div><span class="tiny faint">夜間模式 <span class="num">${r.colorDark}</span></span></div>
      </div>
      <label class="field"><span>想亮一點或暗一點？</span>
        <input type="range" id="tw" min="-3" max="3" step="1" value="${steps}" aria-valuetext="${steps === 0 ? '原本的明暗' : steps > 0 ? '亮 ' + steps + ' 階' : '暗 ' + -steps + ' 階'}">
      </label>
      ${r.adjusted ? '<p class="tiny faint" style="margin:0">為了和小夥伴們的顏色分得開，已經自動微調過。</p>' : ''}
    </section>
    <p class="warn hidden" id="err" role="alert"></p>
    <button class="btn pri full" id="save">${esc(saveLabel)}</button>
    <button class="btn full" id="redo">重新測驗</button>
  </div>`;
  $('#tw').addEventListener('change', e => { st.tweak = +e.target.value * 0.02; renderResult(ctx, st, onSave, saveLabel); });
  $('#rBack').addEventListener('click', () => { st.qi = QUIZ.length - 1; st.step = 'quiz'; renderAgain(); });
  $('#redo').addEventListener('click', () => { st.qi = 0; st.answers = []; st.tweak = 0; st.step = 'quiz'; renderAgain(); });
  function renderAgain() { st.onAgain ? st.onAgain() : renderOnboarding(ctx); }
  $('#save').addEventListener('click', async () => {
    if (!isAllowedGuestColor(res.color)) { $('#err').textContent = '這個顏色太像小夥伴的代表色了，請微調明暗或重新測驗。'; $('#err').classList.remove('hidden'); return; }
    const b = $('#save'); b.disabled = true;
    try { await onSave(res); }
    catch (e) { b.disabled = false; toast(e?.code === 'permission-denied' && !ctx.S.coreId && !ctx.S.profile ? '存檔失敗：邀請碼可能已經過期或停用，請跟小夥伴要新的邀請連結' : '存檔失敗：' + (e?.code || e?.message)); }
  });
}

/* ───────── 旅伴重做測驗 ───────── */
let redo = null;
export function renderQuizRedo(ctx) {
  if (!redo) redo = { step: 'quiz', qi: 0, answers: [], tweak: 0 };
  redo.onAgain = () => renderQuizRedo(ctx);
  if (redo.step === 'quiz') return renderQuiz(ctx, redo, () => { redo.step = 'result'; renderQuizRedo(ctx); }, () => { redo = null; location.hash = '#/me'; });
  renderResult(ctx, redo, async res => {
    await saveProfile(ctx, res, false);
    redo = null; location.hash = '#/me'; toast('代表色更新好了');
  }, '換成這個顏色');
}

/* ───────── 個人檔案頁 ───────── */
export function renderProfile(ctx) {
  const p = ctx.S.profile;
  const core = !!p.coreId;
  $('#main').innerHTML = `<div class="wrap">${ctx.topBar(`<a class="iconbtn" href="#/" aria-label="回首頁" style="margin-left:-10px">${ic.back}</a>`)}
    <div style="display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center">
      ${avatarHTML(p, 'xl')}
      <h1 class="title" style="font-size:26px">${esc(p.nickname)}</h1>
      <span class="chip" style="background:${soft(memberColor(p), isDark())};color:var(--ink)"><i aria-hidden="true" style="width:10px;height:10px;border-radius:50%;background:${memberColor(p)}"></i>${esc(p.colorName || '')}</span>
      ${p.colorDesc ? `<p class="small muted" style="margin:0">${esc(p.colorDesc)}</p>` : ''}
    </div>
    <section class="card" style="gap:4px">
      <div class="list-row"><span class="k">${ic.passport}護照英文名</span><span class="num" style="font-weight:700">${esc(p.passportName || '未填')}</span></div>
      <div class="dash"></div>
      <div class="list-row"><span class="k">${ic.car}開車</span><span>${p.driver ? '會開車' : '不開車'}</span></div>
      <div class="dash"></div>
      <div class="list-row"><span class="k">${ic.image}身分</span><span>${core ? '小夥伴（可以開旅程）' : '旅伴'}</span></div>
    </section>
    <section class="card" style="gap:10px">
      <div class="list-row"><span class="k">${ic.sun}背景天氣動畫</span><span class="tiny faint">只影響這支手機</span></div>
      <div class="seg3" id="wxMode" role="group" aria-label="背景天氣動畫">${BG_MODES.map(m => `<button type="button" data-v="${m.v}" aria-pressed="${bgMode() === m.v}">${m.label}</button>`).join('')}</div>
      <p class="tiny faint" id="wxHint" style="margin:0">${BG_MODES.find(m => m.v === bgMode()).hint}</p>
    </section>
    <a class="btn full" href="#/me/edit">${ic.edit}編輯個人檔案</a>
    ${core ? '' : `<a class="btn full" href="#/me/color">重做代表色測驗</a>`}
    ${p.coreId === 'qi' ? `<a class="btn full" href="https://console.firebase.google.com/project/fir-app-e6f7f/firestore" target="_blank" rel="noopener">查看資料庫用量（Firebase 後台）</a>
      <p class="tiny faint" style="margin:-8px 0 0;text-align:center">打開後點上方的「用量」分頁。目前是免費方案，用量超過上限只會暫停到隔天，不會收費。</p>` : ''}
    <button class="btn full danger" id="logout">${ic.out}登出</button>
    <p class="tiny faint" style="text-align:center;margin:0">${esc(ctx.S.user.email || '')}</p>
  </div>`;
  ctx.bindTop();
  $('#logout').addEventListener('click', () => ctx.signOut());
  $('#wxMode').addEventListener('click', e => {
    const b = e.target.closest('button[data-v]'); if (!b) return;
    setBgMode(b.dataset.v);
    $$('#wxMode button').forEach(x => x.setAttribute('aria-pressed', x === b));
    $('#wxHint').textContent = BG_MODES.find(m => m.v === b.dataset.v).hint;
    toast(b.dataset.v === 'off' ? '已關閉背景天氣動畫' : '已開啟，打開任一趟旅程就看得到');
  });
}

/* ───────── 編輯個人檔案 ───────── */
let ed = null;
export function renderEdit(ctx) {
  const { S } = ctx;
  const p = S.profile;
  if (!ed || ed.uid !== S.user.uid) ed = { uid: S.user.uid, f: { nickname: p.nickname, passportName: p.passportName || '', driver: !!p.driver, avatarType: p.avatarType, avatarData: p.avatarData || '', avatarThumb: p.avatarThumb || '' } };
  const f = ed.f;
  $('#main').innerHTML = `<div class="wrap">${ctx.topBar(`<a class="iconbtn" href="#/me" aria-label="取消編輯" style="margin-left:-10px">${ic.back}</a>`)}
    <div class="row" style="gap:16px">${avatarHTML({ ...p, ...f }, 'xl')}<h1 class="title" style="font-size:24px">編輯個人檔案</h1></div>
    <section class="card">${formHTML(f, !!p.coreId, S.user)}</section>
    <p class="warn hidden" id="err" role="alert"></p>
    <button class="btn pri full" id="save">儲存</button>
  </div>`;
  ctx.bindTop();
  bindForm(f, () => renderEdit(ctx));
  $('#save').addEventListener('click', async () => {
    const err = validate(f);
    if (err) { $('#err').textContent = err; $('#err').classList.remove('hidden'); return; }
    const b = $('#save'); b.disabled = true;
    try { await saveProfile(ctx, { ...f }, false); ed = null; location.hash = '#/me'; toast('已儲存'); }
    catch (e) { b.disabled = false; toast('存檔失敗：' + (e?.code || e?.message)); }
  });
}

export { FAMILIES };
