// 小夥伴粗國玩：登入、路由、首頁
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache,
  doc, getDoc, getDocFromServer } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';
import { $, esc, ic, applyTheme, toggleTheme, isDark, copyText } from './modules/ui.js';
import { CORE } from './modules/color.js';
import { renderOnboarding, renderProfile, renderEdit, renderQuizRedo, avatarHTML } from './modules/profile.js';

const VERSION = 'v0.1';
applyTheme();

/* ───────── Firebase ───────── */
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
let db;
try { db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }); }
catch { db = initializeFirestore(app, { localCache: memoryLocalCache() }); }

// 共用狀態：目前登入者、個人檔案、是不是核心成員
const S = { user: null, profile: null, coreId: null, db, auth };

/* ───────── 判斷是不是核心成員 ─────────
   安全規則只讓核心成員讀得到自己的 coreSeats/{代號}（文件不需要存在）。
   依序試讀四個位置，讀得到的那個就是自己；全部被拒絕就是旅伴。 */
async function detectCore() {
  for (const c of CORE) {
    try { await getDocFromServer(doc(db, 'coreSeats', c.id)); return c.id; }
    catch (e) { if (e?.code !== 'permission-denied') throw e; }
  }
  return null;
}

/* ───────── 畫面：登入前 ───────── */
function inAppBrowser() {
  const ua = navigator.userAgent || '';
  if (/\bLine\//i.test(ua)) return 'LINE';
  if (/FBAN|FBAV|FB_IAB|Messenger/i.test(ua)) return 'Facebook';
  if (/Instagram/i.test(ua)) return 'Instagram';
  if (/MicroMessenger/i.test(ua)) return '微信';
  return null;
}
const gateHead = () => `<img class="logo" src="img/icon-512.png" alt="小夥伴粗國玩 LITTLE BUDDIES 圖示">
  <div><h1>小夥伴粗國玩</h1><div class="en">LITTLE BUDDIES</div></div>`;

function showLogin(errText = '') {
  const iab = inAppBrowser();
  let body;
  if (iab) {
    const ext = new URL(location.href); ext.searchParams.set('openExternalBrowser', '1');
    body = `<div class="card"><b>請改用 Chrome 或 Safari 開啟</b>
      <p class="small muted" style="margin:0">你現在在 ${esc(iab)} 的內建瀏覽器裡，Google 不允許在這裡登入。</p>
      ${iab === 'LINE' ? `<a class="btn pri full" href="${esc(ext.href)}">用外部瀏覽器開啟</a>` : `<p class="small muted" style="margin:0">請點右上角「⋯」，選「在瀏覽器中開啟」。</p>`}
      <button class="btn full" id="copyUrl">${ic.copy}複製網址</button></div>`;
  } else {
    body = `<button class="gbtn" id="loginBtn">${ic.google}用 Google 帳號登入</button>
      ${errText ? `<p class="warn">${esc(errText)}</p>` : ''}
      <p class="tiny faint" style="margin:0">旅伴請用小夥伴邀請你時的 Google 帳號登入</p>`;
  }
  $('#main').innerHTML = `<div class="gate">${gateHead()}${body}</div>`;
  $('#copyUrl')?.addEventListener('click', () => copyText(location.href.split('?')[0]));
  $('#loginBtn')?.addEventListener('click', async () => {
    try {
      const p = new GoogleAuthProvider(); p.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, p);
    } catch (e) {
      if (e?.code === 'auth/popup-closed-by-user' || e?.code === 'auth/cancelled-popup-request') return;
      const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
      showLogin(standalone ? '從主畫面開啟時登入失敗。請改用 Chrome 或 Safari 直接開網址登入。' : '登入失敗：' + (e?.code || e?.message || e));
    }
  });
}
function showMessage(title, text, withLogout = false) {
  $('#main').innerHTML = `<div class="gate">${gateHead()}<div class="card"><b>${esc(title)}</b>
    <p class="small muted" style="margin:0">${esc(text)}</p>
    ${withLogout ? '<button class="btn full" id="out">登出</button>' : '<button class="btn full" id="reload">重新整理</button>'}</div></div>`;
  $('#out')?.addEventListener('click', () => signOut(auth));
  $('#reload')?.addEventListener('click', () => location.reload());
}

/* ───────── 首頁 ───────── */
function topBar(left) {
  const p = S.profile;
  return `<header class="top">${left}
    <div class="row" style="gap:2px">
      <button class="iconbtn" id="themeBtn" aria-label="${isDark() ? '切換成淺色模式' : '切換成夜間模式'}">${isDark() ? ic.sun : ic.moon}</button>
      ${p ? `<a class="iconbtn" href="#/me" aria-label="我的個人檔案">${avatarHTML(p, 'sm')}</a>` : ''}
    </div></header>`;
}
function bindTop() {
  $('#themeBtn')?.addEventListener('click', () => { toggleTheme(); render(); });
}
const brand = `<a class="brand" href="#/"><img src="img/icon-192.png" alt=""><span>小夥伴粗國玩</span></a>`;

function renderHome() {
  const p = S.profile;
  const core = !!p.coreId;
  $('#main').innerHTML = `<div class="wrap">${topBar(brand)}
    <div><div class="small muted">嗨，${esc(p.nickname)}</div>
      <h1 class="title" style="font-size:25px;line-height:1.35">下一趟想去哪裡粗國玩？</h1></div>
    <section class="card">
      <div class="row" style="justify-content:space-between">
        <h2 class="title" style="font-size:17px">旅程</h2><span class="chip">製作中</span>
      </div>
      <p class="small muted" style="margin:0">${core
        ? '開旅程、邀請旅伴、行程、記帳會在下一版陸續開放。現在可以先把個人檔案設定好。'
        : '小夥伴邀請你加入旅程後，旅程會出現在這裡。現在可以先把個人檔案設定好。'}</p>
      ${core ? `<button class="btn pri full" disabled>${ic.plus}開新旅程（下一版開放）</button>` : ''}
    </section>
    <a class="card" href="#/me" style="text-decoration:none;flex-direction:row;align-items:center;gap:14px">
      ${avatarHTML(p, 'lg')}
      <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:4px">
        <b style="font-size:16px">${esc(p.nickname)}</b>
        <span class="small muted">${esc(p.colorName || '')}${core ? '・小夥伴' : '・旅伴'}</span>
      </div>
      <span class="faint">${ic.chev}</span>
    </a>
    <p class="tiny faint" style="text-align:center;margin:0">小夥伴粗國玩 ${VERSION}</p>
  </div>`;
  bindTop();
}

/* ───────── 路由 ───────── */
function render() {
  if (!S.user) return;
  if (!S.profile) return renderOnboarding(ctx);
  const route = location.hash.replace(/^#\/?/, '');
  if (route === 'me') return renderProfile(ctx);
  if (route === 'me/edit') return renderEdit(ctx);
  if (route === 'me/color' && !S.profile.coreId) return renderQuizRedo(ctx);
  renderHome();
}
const ctx = { S, render, topBar, bindTop, brand, signOut: () => signOut(auth), setProfile: p => { S.profile = p; } };
window.addEventListener('hashchange', render);

/* ───────── 登入狀態 ───────── */
onAuthStateChanged(auth, async user => {
  S.user = user; S.profile = null; S.coreId = null;
  if (!user) return showLogin();
  $('#main').innerHTML = '<div class="gate"><div class="spinner" role="status" aria-label="載入中"></div></div>';
  try {
    const snap = await getDoc(doc(db, 'users', user.uid));
    if (snap.exists()) {
      S.profile = { id: user.uid, ...snap.data() };
      S.coreId = S.profile.coreId || null;
    } else {
      if (!navigator.onLine) return showMessage('第一次登入需要網路', '連上網路後再重新整理一次，之後沒有訊號也能打開。');
      S.coreId = await detectCore();
    }
    render();
  } catch (e) {
    console.error(e);
    if (e?.code === 'permission-denied') return showMessage('沒有權限', 'Firestore 安全規則可能還沒發布。請確認後再重新整理。', true);
    if (e?.code === 'unavailable') return showMessage('連不上伺服器', '請確認網路後重新整理。');
    showMessage('出了點問題', String(e?.code || e?.message || e), true);
  }
});

/* ───────── 離線快取 ───────── */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
