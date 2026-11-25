// 天氣：地點查詢、天氣預報、潮汐、日出日落、天氣背景、行程頁的天氣小卡
// 資料來源：OpenStreetMap Nominatim（地點）、Open-Meteo（天氣預報、潮汐），都免費、不用金鑰
// 天氣背景預設關閉，每支手機在「我的」頁自己打開（存在這支手機上）
import { $, esc, localGet, localSet } from './ui.js';
import { countryBy, todayIn } from './places.js';
import { openSheet } from './plan.js';

/* ───────── 背景效果設定 ───────── */
export const BG_MODES = [
  { v: 'anim', label: '動態天氣', hint: '背景依旅程當地的天氣和日出日落換色，並播放天氣動畫。' },
  { v: 'color', label: '只換色', hint: '背景只依旅程當地的日出日落和天氣換顏色，沒有動畫。' },
  { v: 'off', label: '關閉', hint: '維持原本的米色背景。' }
];
export const bgMode = () => { const v = localGet('wxbg'); return v === 'anim' || v === 'color' ? v : 'off'; };
export function setBgMode(v) { localSet('wxbg', v === 'anim' || v === 'color' ? v : null); refreshBg(true); }

/* ───────── 小工具 ───────── */
const OTHER = 'OT'; // 「其他國家」（跟 trips.js 一樣）
const pad2 = n => String(n).padStart(2, '0');
const hm = m => { m = ((Math.round(m) % 1440) + 1440) % 1440; return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`; };
const isoMin = s => (/T(\d{2}):(\d{2})/.exec(s || '') ? +RegExp.$1 * 60 + +RegExp.$2 : null);
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// localStorage 快取：{ at, v }
function cacheGet(key, maxAge) {
  try { const o = JSON.parse(localGet(key) || 'null'); if (o && Date.now() - o.at < maxAge) return o.v; } catch {}
  return undefined;
}
function cacheSet(key, v) { try { localSet(key, JSON.stringify({ at: Date.now(), v })); } catch {} }
async function getJSON(url, ms = 12000) {
  const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), ms);
  try { const r = await fetch(url, { signal: ac.signal }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); }
  finally { clearTimeout(tm); }
}
// 某個時區現在的日期和分鐘
function nowAt(tz) {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
      .formatToParts(new Date()).map(x => [x.type, x.value]));
    return { date: `${p.year}-${p.month}-${p.day}`, min: (+p.hour % 24) * 60 + +p.minute };
  } catch { const d = new Date(); return { date: d.toISOString().slice(0, 10), min: d.getHours() * 60 + d.getMinutes() }; }
}
function minAt(date, tz) { // 某個時間點在當地是幾點（分鐘）
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(date).map(x => [x.type, x.value]));
    return (+p.hour % 24) * 60 + +p.minute;
  } catch { return date.getUTCHours() * 60 + date.getUTCMinutes(); }
}

/* ───────── 日出日落（預報沒涵蓋的日期用天文公式算，誤差約一兩分鐘） ───────── */
function sunCalc(dateStr, lat, lon) {
  const rad = Math.PI / 180, J1970 = 2440588, J2000 = 2451545;
  const lw = -lon * rad, phi = lat * rad;
  const d = Date.parse(dateStr + 'T12:00:00Z') / 86400000 - 0.5 + J1970 - J2000;
  const n = Math.round(d - 0.0009 - lw / (2 * Math.PI));
  const ds = 0.0009 + lw / (2 * Math.PI) + n;
  const M = rad * (357.5291 + 0.98560028 * ds);
  const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + rad * 102.9372 + Math.PI;
  const dec = Math.asin(Math.sin(rad * 23.4397) * Math.sin(L));
  const Jnoon = J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const w = Math.acos((Math.sin(-0.833 * rad) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec)));
  if (Number.isNaN(w)) return null; // 永晝或永夜
  const Jset = Jnoon + w / (2 * Math.PI);
  const toDate = j => new Date((j + 0.5 - J1970) * 86400000);
  return { rise: toDate(Jnoon - w / (2 * Math.PI)), set: toDate(Jset) };
}

/* ───────── 天氣代碼（WMO）→ 名稱、背景種類 ───────── */
function wmo(code) {
  const c = +code;
  if (c <= 1) return { n: '晴', k: 'sunny' };
  if (c === 2) return { n: '晴時多雲', k: 'pcloud' };
  if (c === 3) return { n: '陰', k: 'cloudy' };
  if (c === 45 || c === 48) return { n: '霧', k: 'mist' };
  if (c >= 51 && c <= 57) return { n: '毛毛雨', k: 'rain', rain: 1 };
  if (c === 61 || c === 66) return { n: '小雨', k: 'rain', rain: 1 };
  if (c === 63) return { n: '雨', k: 'rain', rain: 2 };
  if (c === 65 || c === 67) return { n: '大雨', k: 'rain', rain: 3 };
  if (c >= 71 && c <= 77) return { n: c === 71 ? '小雪' : c === 75 ? '大雪' : '雪', k: 'snow' };
  if (c === 80 || c === 81) return { n: '陣雨', k: 'rain', rain: 2 };
  if (c === 82) return { n: '大陣雨', k: 'rain', rain: 3 };
  if (c === 85 || c === 86) return { n: '陣雪', k: 'snow' };
  if (c >= 95) return { n: '雷雨', k: 'storm', rain: 3 };
  return { n: '多雲', k: 'cloudy' };
}

/* ───────── 地點：指定第幾個目的地；沒指定就用第一個有填城市的（有城市用城市，沒有用國家） ───────── */
function placeOf(t, pi = null) {
  const ps = t.places || [];
  const p = (pi != null && ps[pi]) || ps.find(x => (x.city || '').trim()) || ps[0];
  if (!p) return null;
  const c = countryBy(p.country);
  const cname = p.country === OTHER ? (p.countryName || '') : (c ? c.name : '');
  const city = (p.city || '').trim();
  return { key: `${p.country}|${p.countryName || ''}|${city}`, label: city || cname, city, cname, cc: p.country === OTHER ? '' : p.country };
}
async function geo(pl) {
  const ck = 'wxgeo:' + pl.key;
  const hit = cacheGet(ck, 365 * 86400000);
  if (hit) return hit;
  const miss = cacheGet(ck + ':miss', 86400000); if (miss) return null; // 找不到的，一天內不再查
  const q = pl.city ? (pl.cc ? pl.city : `${pl.city} ${pl.cname}`) : pl.cname;
  let r = null;
  try {
    const a = await getJSON(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=zh-TW${pl.cc ? '&countrycodes=' + pl.cc.toLowerCase() : ''}&q=${encodeURIComponent(q)}`);
    if (a[0]) r = { lat: +a[0].lat, lon: +a[0].lon };
  } catch {}
  if (!r) {
    try {
      const b = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?count=1&language=zh&name=${encodeURIComponent(pl.city || pl.cname)}${pl.cc ? '&countryCode=' + pl.cc : ''}`);
      if (b.results?.[0]) r = { lat: b.results[0].latitude, lon: b.results[0].longitude };
    } catch {}
  }
  if (r) cacheSet(ck, r); else cacheSet(ck + ':miss', 1);
  return r;
}

/* ───────── 天氣預報（16 天）和潮汐（約 9 天） ───────── */
const ll = g => `latitude=${g.lat.toFixed(3)}&longitude=${g.lon.toFixed(3)}`;
async function forecast(g) {
  const ck = `wxf2:${g.lat.toFixed(2)},${g.lon.toFixed(2)}`; // wxf2：加了體感、降雨、風、紫外線
  const fresh = cacheGet(ck, 30 * 60000); if (fresh) return fresh;
  try {
    const j = await getJSON(`https://api.open-meteo.com/v1/forecast?${ll(g)}&current=weather_code,temperature_2m&daily=weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max,uv_index_max,sunrise,sunset&timezone=auto&forecast_days=16`);
    const days = {};
    const dl = j.daily || {}, at = (k, i) => (dl[k] ? dl[k][i] : null);
    (dl.time || []).forEach((d, i) => { days[d] = { code: dl.weather_code[i], max: dl.temperature_2m_max[i], min: dl.temperature_2m_min[i],
      fmax: at('apparent_temperature_max', i), fmin: at('apparent_temperature_min', i), pop: at('precipitation_probability_max', i), rain: at('precipitation_sum', i),
      wind: at('wind_speed_10m_max', i), gust: at('wind_gusts_10m_max', i), uv: at('uv_index_max', i), rise: isoMin(j.daily.sunrise[i]), set: isoMin(j.daily.sunset[i]) }; });
    const v = { tz: j.timezone, cur: j.current ? { code: j.current.weather_code, temp: j.current.temperature_2m } : null, days };
    cacheSet(ck, v); return v;
  } catch { return cacheGet(ck, 3 * 86400000) || null; } // 沒網路時，三天內的舊資料也先拿來用
}
// 空氣品質（約 5 天）：每天取 AQI、PM2.5、PM10 的最高值
async function airq(g) {
  const ck = `wxa:${g.lat.toFixed(2)},${g.lon.toFixed(2)}`;
  const fresh = cacheGet(ck, 60 * 60000); if (fresh !== undefined) return fresh;
  try {
    const j = await getJSON(`https://air-quality-api.open-meteo.com/v1/air-quality?${ll(g)}&hourly=us_aqi,pm2_5,pm10&timezone=auto&forecast_days=6`);
    const h = j.hourly || {}, days = {};
    (h.time || []).forEach((t, i) => {
      const d = t.slice(0, 10), o = days[d] || (days[d] = {});
      [['aqi', 'us_aqi'], ['pm25', 'pm2_5'], ['pm10', 'pm10']].forEach(([k, src]) => {
        const v = h[src]?.[i]; if (v != null && (o[k] == null || v > o[k])) o[k] = v;
      });
    });
    Object.keys(days).forEach(d => { if (days[d].aqi == null) delete days[d]; });
    const r = Object.keys(days).length ? days : null;
    cacheSet(ck, r); return r;
  } catch { const old = cacheGet(ck, 86400000); return old === undefined ? null : old; }
}
async function marine(g) {
  const ck = `wxm:${g.lat.toFixed(2)},${g.lon.toFixed(2)}`;
  const fresh = cacheGet(ck, 3 * 3600000); if (fresh !== undefined) return fresh;
  try {
    const j = await getJSON(`https://marine-api.open-meteo.com/v1/marine?${ll(g)}&hourly=sea_level_height_msl&timezone=auto&forecast_days=16`);
    const t = j.hourly?.time || [], v = j.hourly?.sea_level_height_msl || [];
    let s = 0; while (s < v.length && v[s] == null) s++;
    let e = v.length - 1; while (e >= s && v[e] == null) e--;
    const r = e > s + 24 ? { start: t[s], vals: v.slice(s, e + 1).map(x => (x == null ? null : Math.round(x * 100) / 100)) } : null; // 不靠海就沒有資料
    cacheSet(ck, r); return r;
  } catch { const old = cacheGet(ck, 3 * 86400000); return old === undefined ? null : old; }
}

// 每趟旅程的天氣資料（記在記憶體裡，畫面重畫時不用再等）
// 一趟旅程可能有好幾個地區，每個地區分開記
const memo = new Map();
function tripWx(t, pi = null) {
  const pl = placeOf(t, pi);
  if (!pl) return { state: 'none' };
  const mk = t.id + '|' + pl.key;
  let m = memo.get(mk);
  if (!m || (m.data && Date.now() - m.at > 30 * 60000 && !m.p)) {
    m = m || { key: pl.key, pl };
    m.p = (async () => {
      const g = await geo(pl);
      if (!g) { m.data = { pl, g: null }; m.at = Date.now(); return m.data; }
      const [f, mr, aq] = await Promise.all([forecast(g), marine(g), airq(g)]);
      m.data = { pl, g, f, m: mr, a: aq }; m.at = Date.now(); return m.data;
    })().catch(() => { m.data = { pl, g: null }; m.at = Date.now(); return m.data; }).finally(() => { m.p = null; });
    memo.set(mk, m);
  }
  return m;
}

/* ───────── 某一天的日出日落、潮汐 ───────── */
function sunOf(d, date, tz) {
  const fd = d.f?.days?.[date];
  if (fd && fd.rise != null && fd.set != null) return { rise: fd.rise, set: fd.set };
  if (!d.g) return null;
  const s = sunCalc(date, d.g.lat, d.g.lon);
  return s ? { rise: minAt(s.rise, tz), set: minAt(s.set, tz) } : null;
}
function tidesOf(mr, date) {
  if (!mr) return null;
  const base = Date.parse(mr.start.slice(0, 10) + 'T00:00:00Z'), h0 = isoMin(mr.start) / 60;
  const off = Math.round((Date.parse(date + 'T00:00:00Z') - base) / 3600000 - h0); // 這天 00:00 在陣列裡的位置
  const v = mr.vals;
  if (off < 0 || off + 24 >= v.length) return null;
  const curve = [];
  for (let h = 0; h <= 24; h++) { const x = v[off + h]; if (x == null) return null; curve.push(x); }
  // 轉折點：比前後都高（低），用拋物線補到分鐘
  const ext = [];
  for (let i = Math.max(1, off - 1); i <= Math.min(v.length - 2, off + 25); i++) {
    const a = v[i - 1], b = v[i], c = v[i + 1]; if (a == null || b == null || c == null) continue;
    const hi = b > a && b >= c, lo = b < a && b <= c; if (!hi && !lo) continue;
    const den = a - 2 * b + c, dx = den ? 0.5 * (a - c) / den : 0;
    const at = (i - off + dx) * 60; if (at < 0 || at >= 1440) continue;
    ext.push({ t: at, h: b - 0.25 * (a - c) * dx, hi });
  }
  return { curve, ext };
}
const tideAt = (curve, m) => { const h = Math.max(0, Math.min(24, m / 60)), i = Math.min(23, Math.floor(h)), f = h - i; return curve[i] + (curve[i + 1] - curve[i]) * f; };

/* ───────── 行程頁：天氣小卡 ───────── */
let openFor = null; // 展開中的旅程 id（重畫時保持展開）
// 天氣小圖示（線條，跟 app 其他圖示同一種粗細）
const WX_SVG = {
  sunny: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>',
  pcloud: '<path d="M9 4.5v1.2M4.2 9.3h1.2M5.6 5.9l.9.9M12.4 5.9l-.9.9"/><path d="M6.6 11.6A3 3 0 1 1 11.8 8.6"/><path d="M8 19h9a3.5 3.5 0 0 0 .4-7 5 5 0 0 0-9.6 1.4A2.8 2.8 0 0 0 8 19z"/>',
  cloudy: '<path d="M7 18.5h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.1 11.6 3.5 3.5 0 0 0 7 18.5z"/>',
  rain: '<path d="M7 14.5h10a3.5 3.5 0 0 0 .4-7A5.5 5.5 0 0 0 6.6 8.6 3 3 0 0 0 7 14.5z"/><path d="M8.5 17.5l-1 2.5M12.5 17.5l-1 2.5M16.5 17.5l-1 2.5"/>',
  storm: '<path d="M7 14.5h10a3.5 3.5 0 0 0 .4-7A5.5 5.5 0 0 0 6.6 8.6 3 3 0 0 0 7 14.5z"/><path d="M12.5 15.5l-2 3h3l-2 3"/>',
  snow: '<path d="M7 14.5h10a3.5 3.5 0 0 0 .4-7A5.5 5.5 0 0 0 6.6 8.6 3 3 0 0 0 7 14.5z"/><path d="M8.5 18v.01M12 19.5v.01M15.5 18v.01M10 21v.01M14 21v.01"/>',
  mist: '<path d="M4 9h12M6 13h14M4 17h11"/>',
  sunrise: '<path d="M3 17.5h18M7 17.5a5 5 0 0 1 10 0M12 4.5v4M9.5 7 12 4.5 14.5 7"/>'
};
const wxIcon = k => `<svg class="wxi" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${WX_SVG[k] || WX_SVG.cloudy}</svg>`;
const chevron = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 4.5l3 3 3-3"/></svg>';
export function mountDayWx(t, dinfo) {
  const row = $('#wxRow'); if (!row || !dinfo) return;
  const m = tripWx(t, dinfo.pi);
  const draw = () => {
    if (!row.isConnected) return;
    const d = m.data, pl = m.pl || placeOf(t, dinfo.pi);
    if (!pl) { row.innerHTML = ''; return; }
    // 跟 Day 1 同一行的灰色小字：天氣圖示＋天氣＋高低溫；旅程有好幾個地區時，前面加上這天的地區
    const where = dinfo.multi ? `${esc(pl.label)}・` : '';
    if (!d) { row.innerHTML = `<span class="wxchip off"><span class="wxinfo">${where}天氣讀取中…</span></span>`; return; }
    if (!d.g) { row.innerHTML = `<span class="wxchip off" title="找不到「${esc(pl.label)}」的位置"><span class="wxinfo">${where}看不到天氣</span></span>`; return; }
    const fd = d.f?.days?.[dinfo.date], w = fd ? wmo(fd.code) : null;
    const txt = where + (w ? `${esc(w.n)} <span class="num">${Math.round(fd.max)}°</span>/<span class="num">${Math.round(fd.min)}°</span>`
      : (d.f ? '日出日落' : '天氣暫時讀不到'));
    const open = openFor === t.id;
    row.innerHTML = `<button class="wxchip" id="wxBtn" aria-expanded="${open}" aria-controls="wxCard" title="${esc(pl.label)}的天氣">${wxIcon(w ? w.k : 'sunrise')}<span class="wxinfo">${txt}</span>${chevron}</button>`;
    $('#wxBtn').addEventListener('click', () => { openFor = openFor === t.id ? null : t.id; draw(); });
    const card = $('#wxCard');
    card.hidden = !open;
    if (open) {
      // 最上面一行：這天用哪個地點＋右邊「?」說明
      card.innerHTML = `<div class="wxtop"><span>${ic_pin}${esc(pl.label)}<small>${dinfo.auto ? '依這天的行程判斷' : dinfo.multi ? '預設地點' : ''}</small></span>
        <button type="button" class="wxhelp" id="wxHelp" aria-label="天氣資料說明">?</button></div>` + cardHTML(d, dinfo.date, t.tz);
      $('#wxHelp').addEventListener('click', () => helpSheet(t, dinfo, d, pl));
    }
  };
  draw();
  if (m.p) m.p.then(draw);
}
const ic_pin = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>';

/* ───────── 「?」天氣資料說明 ───────── */
// 快取是什麼時候抓的（顯示「上次更新」）
function cacheAt(key) { try { const o = JSON.parse(localGet(key) || 'null'); return o?.at || null; } catch { return null; } }
const agoText = at => {
  if (!at) return '';
  const min = Math.round((Date.now() - at) / 60000);
  return min < 1 ? '剛剛更新' : min < 60 ? `${min} 分鐘前更新` : min < 1440 ? `${Math.round(min / 60)} 小時前更新` : `${Math.round(min / 1440)} 天前更新`;
};
function helpSheet(t, dinfo, d, pl) {
  const date = dinfo.date, tz = d.f?.tz || t.tz;
  const ahead = Math.round((Date.parse(date + 'T00:00:00Z') - Date.parse(todayIn(tz) + 'T00:00:00Z')) / 86400000); // 這天離今天幾天
  const k = d.g ? `${d.g.lat.toFixed(2)},${d.g.lon.toFixed(2)}` : '';
  const fd = d.f?.days?.[date], aq = d.a?.[date], td = tidesOf(d.m, date);
  const past = ahead < 0;
  const fNote = fd ? '有' : past ? '已經過去的日子沒有預報' : ahead > 15 ? `還沒有：出發前 16 天內才有（這天還有 ${ahead} 天）` : '暫時讀不到';
  const aNote = aq ? '有' : past ? '已經過去的日子沒有' : ahead > 5 ? `還沒有：今天起 6 天內才有（這天還有 ${ahead} 天）` : '這個地點暫時沒有資料';
  const tNote = td ? '有' : !d.m ? `沒有：${esc(pl.label)}離海太遠（用城市中心點來看），只有靠海的地點才有潮汐` : past ? '已經過去的日子沒有' : `還沒有：大約今天起 9 天內才有（這天還有 ${ahead} 天）`;
  const rows = [
    ['天氣預報', '天氣、高低溫、體感、降雨、風、紫外線', '出發前 16 天內', '每 30 分鐘', fNote, cacheAt('wxf2:' + k)],
    ['空氣品質', 'AQI、PM2.5、PM10', '今天起 6 天內', '每 1 小時', aNote, cacheAt('wxa:' + k)],
    ['潮汐', '滿潮、乾潮時間和高度', '今天起約 9 天內，只有靠海的地點', '每 3 小時', tNote, cacheAt('wxm:' + k)],
    ['日出日落', '日出、日落時間', '任何日期都有', '用位置直接算，不用上網', '有', null]
  ];
  const places = (t.places || []).map(p => (p.city || '').trim()).filter(Boolean);
  openSheet(`<div class="sheet-h"><h3 class="title">天氣資料說明</h3><button class="iconbtn" data-close aria-label="關閉">✕</button></div>
    <section class="wxhelp-sec">
      <h4>這天用的地點：${esc(pl.label)}</h4>
      <p>${dinfo.auto ? '這天的行程或交通住宿裡有出現這個地區的名字，所以用它。' : dinfo.multi ? '這天的行程裡還看不出在哪個地區，先用旅程的第一個地區。' : '這趟旅程只有一個地區。'}</p>
      ${dinfo.multi ? `<p class="tiny faint">怎麼判斷：旅程有好幾個地區（${places.map(esc).join('、')}）時，看這天的行程（名稱、地點、備註）和交通住宿（含當晚住的地方）裡，哪個地區的名字出現最多次就用哪個；一樣多時以當晚住的地方為準；都沒有出現就用第一個地區。</p>` : ''}
    </section>
    <section class="wxhelp-sec">
      <h4>${+date.slice(5, 7)}/${+date.slice(8)} 有哪些資料</h4>
      <div class="wxhelp-list">${rows.map(([n, what, when, every, note, at]) => `<div class="${note === '有' ? 'ok' : ''}">
        <div class="row" style="justify-content:space-between;gap:8px"><b>${n}</b><span class="tiny ${note === '有' ? 'okt' : 'faint'}">${note === '有' ? '✓ 有' : '—'}</span></div>
        <span class="tiny faint">${what}</span>
        ${note !== '有' ? `<span class="tiny">${note}</span>` : ''}
        <span class="tiny faint">什麼時候有：${when}・更新：${every}${at ? `（${agoText(at)}）` : ''}</span></div>`).join('')}</div>
      <p class="tiny faint">沒有網路時，會先用之前抓到的資料（天氣、潮汐 3 天內，空氣品質 1 天內）。地點的位置查到一次會記住。資料來源：Open-Meteo（天氣、空氣品質、潮汐）、OpenStreetMap（地點）。</p>
    </section>`);
}
// 風：用最大陣風（km/h）分級，強風以上標出來
function windInfo(gust) {
  if (gust == null) return null;
  const g = Math.round(gust);
  if (g < 20) return { t: '微風', g };
  if (g < 39) return { t: '有點風', g };
  if (g < 62) return { t: '強風', g, warn: 1 };
  return { t: '狂風，注意安全', g, warn: 1 };
}
const uvLevel = u => (u < 3 ? '低' : u < 6 ? '中' : u < 8 ? '高' : u < 11 ? '過量' : '危險');
// 空氣品質指數（美國 AQI 分級，台灣環境部的 AQI 也是同一套級距）
const aqiLevel = a => (a <= 50 ? '良好' : a <= 100 ? '普通' : a <= 150 ? '對敏感族群不健康' : a <= 200 ? '不健康' : a <= 300 ? '非常不健康' : '危害');
function statsHTML(fd, aq) {
  const n = v => Math.round(v);
  const items = [];
  if (fd.fmax != null && fd.fmin != null) items.push(['體感溫度', `<span class="num">${n(fd.fmax)}°</span>/<span class="num">${n(fd.fmin)}°</span>`]);
  if (fd.pop != null) items.push(['降雨機率', `<span class="num">${n(fd.pop)}%</span>${fd.rain >= 0.5 ? `<small>約 ${fd.rain >= 10 ? n(fd.rain) : fd.rain.toFixed(1)} mm</small>` : ''}`]);
  const w = windInfo(fd.gust);
  if (w) items.push(['風', `${w.t}<small>陣風 <span class="num">${w.g}</span> km/h</small>`, w.warn]);
  if (fd.uv != null) items.push(['紫外線', `<span class="num">${Math.round(fd.uv)}</span> ${uvLevel(fd.uv)}`, fd.uv >= 8]);
  // 空氣品質自己佔一整行，四個格子維持偶數
  if (aq?.aqi != null) items.push(['空氣品質', `AQI <span class="num">${n(aq.aqi)}</span> ${aqiLevel(aq.aqi)}${aq.pm25 != null ? `<small>PM2.5 <span class="num">${n(aq.pm25)}</span>${aq.pm10 != null ? `・PM10 <span class="num">${n(aq.pm10)}</span>` : ''} μg/m³（當天最高）</small>` : ''}`, aq.aqi > 100, true]);
  if (!items.length) return '';
  return `<h3>天氣<small>${esc(wmo(fd.code).n)}・<span class="num">${n(fd.max)}°</span>/<span class="num">${n(fd.min)}°</span></small></h3>
    <div class="wxstats">${items.map(([k, v, warn, wide]) => `<div class="${warn ? 'warn' : ''}${wide ? ' wide' : ''}"><span>${k}</span><b>${v}</b></div>`).join('')}</div>`;
}
function cardHTML(d, date, tripTz) {
  const tz = d.f?.tz || tripTz, now = nowAt(tz), isToday = now.date === date;
  const sun = sunOf(d, date, tz);
  const fd = d.f?.days?.[date];
  let h = fd ? statsHTML(fd, d.a?.[date]) : '';
  if (sun) {
    const W = 300, SH = 58, base = 54, x = m => m / 1440 * W;
    const sx = x(sun.rise), ex = x(sun.set), cx = (sx + ex) / 2, r = (ex - sx) / 2, ry = r * .72;
    const len = sun.set - sun.rise;
    let mark = '', sub = `白天 ${Math.floor(len / 60)} 小時 ${len % 60} 分`;
    if (isToday) {
      const up = now.min >= sun.rise && now.min <= sun.set;
      const f = Math.min(1, Math.max(0, (now.min - sun.rise) / len)), a = Math.PI * (1 - f);
      const px = up ? cx + r * Math.cos(a) : (now.min < sun.rise ? sx : ex), py = up ? base - ry * Math.sin(a) : base;
      mark = `<path d="M${sx.toFixed(1)} ${base} A${r.toFixed(1)} ${ry.toFixed(1)} 0 0 1 ${px.toFixed(1)} ${py.toFixed(1)}" fill="none" stroke="var(--acc)" stroke-width="3" stroke-linecap="round"/>
        <circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="8" fill="${up ? 'var(--acc)' : 'var(--sunk)'}" stroke="var(--card)" stroke-width="3"/>`;
      sub = up ? '太陽還在天上' : (now.min < sun.rise ? '還沒日出' : '已經日落');
    }
    h += `${h ? '<hr>' : ''}<h3>日出日落<small>${sub}</small></h3>
      <div><svg viewBox="0 0 ${W} ${SH}" role="img" aria-label="日出 ${hm(sun.rise)}，日落 ${hm(sun.set)}">
        <line x1="0" y1="${base}" x2="${W}" y2="${base}" stroke="var(--line2)" stroke-width="1.5"/>
        <path d="M${sx.toFixed(1)} ${base} A${r.toFixed(1)} ${ry.toFixed(1)} 0 0 1 ${ex.toFixed(1)} ${base}" fill="none" stroke="var(--acc)" stroke-width="2" stroke-dasharray="4 5"/>${mark}
      </svg>
      <div class="lbls"><span>日出 <span class="num">${hm(sun.rise)}</span></span>${isToday ? `<span>現在 <span class="num">${hm(now.min)}</span></span>` : ''}<span>日落 <span class="num">${hm(sun.set)}</span></span></div></div>`;
  }
  const td = tidesOf(d.m, date);
  if (td) {
    const W = 300, H = 78, x = m => m / 1440 * W;
    const mn = Math.min(...td.curve) - .1, mx = Math.max(...td.curve) + .1, y = v => 8 + (mx - v) / (mx - mn) * (H - 26);
    const pts = td.curve.map((v, i) => `${x(i * 60).toFixed(1)} ${y(v).toFixed(1)}`);
    const line = 'M' + pts.join(' L');
    const nowMark = isToday ? `<line x1="${x(now.min).toFixed(1)}" y1="2" x2="${x(now.min).toFixed(1)}" y2="${H - 12}" stroke="var(--ink2)" stroke-width="1.5" stroke-dasharray="3 3"/>
      <circle cx="${x(now.min).toFixed(1)}" cy="${y(tideAt(td.curve, now.min)).toFixed(1)}" r="5" fill="var(--card)" stroke="var(--ink)" stroke-width="2"/>` : '';
    const trend = isToday ? (tideAt(td.curve, now.min + 30) > tideAt(td.curve, now.min) ? '正在漲潮' : '正在退潮') : '';
    h += `${h ? '<hr>' : ''}<h3>潮汐<small>${trend}</small></h3>
      <div><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="潮汐曲線">
        <path d="${line} L${W} ${H - 12} L0 ${H - 12}Z" fill="color-mix(in srgb,#6F9FD0 22%,transparent)"/>
        <path d="${line}" fill="none" stroke="#5E8DBF" stroke-width="2.2" stroke-linejoin="round"/>${nowMark}
        ${td.ext.map(p => `<circle cx="${x(p.t).toFixed(1)}" cy="${y(p.h).toFixed(1)}" r="3.5" fill="#5E8DBF"/>`).join('')}
        <text x="0" y="${H}" font-size="10" fill="var(--ink3)">0</text><text x="${W / 2}" y="${H}" font-size="10" fill="var(--ink3)" text-anchor="middle">12</text><text x="${W}" y="${H}" font-size="10" fill="var(--ink3)" text-anchor="end">24</text>
      </svg></div>
      <div class="tides">${td.ext.map(p => `<div class="${p.hi ? 'hi' : ''}">${p.hi ? '滿潮' : '乾潮'}<b class="num">${hm(p.t)}</b>${p.h.toFixed(1)} m</div>`).join('')}</div>
      <p class="tiny faint" style="margin:0">潮高是相對於平均海平面的高度。潮汐是模型預測值，只適合安排行程參考，不適合用來判斷航行或安全。</p>`;
  }
  return h || '<p class="small muted" style="margin:0">這天沒有日出日落和潮汐資料。</p>';
}

/* ───────── 天氣背景 ───────── */
let bgTrip = null, bgTimer = null, bgKey = '';
let libs = null, anims = null, decoAnim = null, decoKey = '', fallC = null, fallKey = '';
// 雪花：取自 jochang 下雪動畫裡的同一顆雪花，全畫面下雪和右上角圖示風格一致
const FLAKE = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 22 25" width="44" height="50"><path d="M18.98 8.60 C19.96 8.03 20.29 6.75 19.73 5.75 C19.73 5.75 19.73 5.75 19.73 5.75 C19.16 4.75 17.91 4.41 16.93 4.99 C16.93 4.99 12.80 7.43 12.80 7.43 C12.64 7.52 12.45 7.52 12.29 7.43 C12.13 7.33 12.03 7.16 12.03 6.97 C12.03 6.97 12.03 2.09 12.03 2.09 C12.03 0.94 11.12 0.00 9.99 0.00 C9.99 0.00 9.99 0.00 9.99 0.00 C8.86 0.00 7.94 0.94 7.94 2.09 C7.94 2.09 7.94 6.97 7.94 6.97 C7.94 7.16 7.85 7.33 7.69 7.43 C7.53 7.52 7.33 7.52 7.18 7.43 C7.18 7.43 3.04 4.99 3.04 4.99 C2.07 4.43 0.84 4.77 0.27 5.75 C0.27 5.75 0.27 5.75 0.27 5.75 C-0.29 6.75 0.04 8.03 1.02 8.60 C1.02 8.60 5.16 11.05 5.16 11.05 C5.32 11.14 5.42 11.31 5.42 11.50 C5.42 11.69 5.32 11.86 5.16 11.95 C5.16 11.95 1.02 14.40 1.02 14.40 C0.04 14.97 -0.29 16.25 0.27 17.25 C0.27 17.25 0.27 17.25 0.27 17.25 C0.84 18.25 2.09 18.59 3.07 18.01 C3.07 18.01 7.20 15.57 7.20 15.57 C7.36 15.48 7.55 15.48 7.71 15.57 C7.87 15.67 7.97 15.84 7.97 16.03 C7.97 16.03 7.97 20.91 7.97 20.91 C7.97 22.06 8.88 23.00 10.01 23.00 C10.01 23.00 10.01 23.00 10.01 23.00 C11.14 23.00 12.06 22.06 12.06 20.91 C12.06 20.91 12.06 16.03 12.06 16.03 C12.06 15.84 12.15 15.67 12.31 15.57 C12.47 15.48 12.67 15.48 12.82 15.57 C12.82 15.57 16.96 18.01 16.96 18.01 C17.93 18.57 19.16 18.23 19.73 17.25 C19.73 17.25 19.73 17.25 19.73 17.25 C20.29 16.25 19.96 14.97 18.98 14.40 C18.98 14.40 14.84 11.95 14.84 11.95 C14.68 11.86 14.58 11.69 14.58 11.50 C14.58 11.31 14.68 11.14 14.84 11.05 C14.84 11.05 18.98 8.60 18.98 8.60Z" fill="#ADE8FF" stroke="#8CCBEA" stroke-width=".8"/></svg>');

function layer() {
  let el = $('#wxbg');
  if (!el) {
    el = document.createElement('div'); el.id = 'wxbg'; el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<div class="wb-sky"><i class="p-dawn"></i><i class="p-day"></i><i class="p-dusk"></i><i class="p-night"></i></div><div class="wb-tint"></div><div class="wb-fog"></div><div class="wb-deco"></div><div class="wb-fall"></div><div class="wb-flash"></div>';
    document.body.prepend(el);
  }
  return el;
}
const loadScript = src => new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = no; document.head.appendChild(s); });
function loadLibs() {
  if (!libs) libs = (async () => {
    await Promise.all([loadScript('lib/lottie_svg.min.js'), loadScript('lib/tsparticles.slim.min.js')]);
    await window.loadSlim(window.tsParticles);
    anims = await (await fetch('img/weather/anims.json')).json();
  })().catch(e => { libs = null; throw e; });
  return libs;
}
// 旅程頁打開時呼叫，離開旅程頁時傳 null
export function setWxTrip(t) { bgTrip = t || null; refreshBg(); }
export function refreshBg(force = false) {
  const mode = bgMode();
  const on = mode !== 'off' && bgTrip;
  document.documentElement.classList.toggle('wxbg', !!on);
  if (!on) { stopAnim(); clearInterval(bgTimer); bgTimer = null; bgKey = ''; return; }
  if (!bgTimer) bgTimer = setInterval(() => applyBg(), 5 * 60000);
  if (force) bgKey = '';
  applyBg();
}
function stopAnim() {
  if (decoAnim) { decoAnim.destroy(); decoAnim = null; } decoKey = '';
  if (fallC) { fallC.destroy(); fallC = null; } fallKey = '';
  const el = $('#wxbg'); if (el) el.className = '';
}
// 旅行中的今天在哪個地區（行程頁算好告訴這裡），背景天氣跟著用
const todayPlace = new Map();
export function setTodayPlace(t, pi) {
  if (todayPlace.get(t.id) === pi) return;
  todayPlace.set(t.id, pi);
  if (bgTrip?.id === t.id) { bgKey = ''; applyBg(); }
}
function applyBg() {
  const t = bgTrip; if (!t) return;
  const m = tripWx(t, todayPlace.get(t.id) ?? null);
  const go = () => {
    if (bgTrip !== t || bgMode() === 'off') return;
    const d = m.data; const el = layer();
    const tz = d?.f?.tz || t.tz, now = nowAt(tz);
    const sun = d ? sunOf(d, now.date, tz) : null;
    let ph = 'day';
    if (sun) ph = now.min < sun.rise - 40 || now.min > sun.set + 40 ? 'night' : now.min < sun.rise + 40 ? 'dawn' : now.min > sun.set - 40 ? 'dusk' : 'day';
    else if (now.min < 360 || now.min >= 1140) ph = 'night';
    const code = d?.f?.cur?.code ?? d?.f?.days?.[now.date]?.code;
    const w = code != null ? wmo(code) : { k: 'sunny' };
    const anim = bgMode() === 'anim' && !reduceMotion();
    const dark = document.documentElement.dataset.theme === 'dark';
    const key = [ph, w.k, w.rain || 0, anim, dark].join('|');
    if (key === bgKey) return; bgKey = key;
    el.className = `ph-${ph} wx-${w.k}${anim ? ' anim' : ''}`;
    el.querySelectorAll('.wb-sky i').forEach(i => i.classList.toggle('on', i.classList.contains('p-' + ph)));
    if (!anim) { stopAnim(); el.className = `ph-${ph} wx-${w.k}`; return; }
    loadLibs().then(() => {
      if (bgTrip !== t || bgKey !== key) return;
      const night = ph === 'night';
      const dk = { sunny: night ? 'night' : 'sunny', pcloud: night ? 'cnight' : 'pcloud', cloudy: 'cloudy', rain: night ? 'rnight' : 'shower', storm: 'storm', snow: 'snow', mist: 'mist' }[w.k];
      if (dk !== decoKey) {
        if (decoAnim) decoAnim.destroy();
        decoKey = dk;
        decoAnim = window.lottie.loadAnimation({ container: el.querySelector('.wb-deco'), renderer: 'svg', loop: true, autoplay: !document.hidden, animationData: JSON.parse(JSON.stringify(anims[dk])) });
      }
      setFall(el, w.k === 'snow' ? 'snow' : w.rain ? 'rain' + w.rain : '', night || dark);
    }).catch(() => {});
  };
  if (m.data) go(); else if (m.p) m.p.then(go); else go();
}
async function setFall(el, kind, light) {
  const key = kind + (light ? 'L' : '');
  if (key === fallKey) return; fallKey = key;
  if (fallC) { fallC.destroy(); fallC = null; }
  if (!kind) return;
  const col = light ? '#A9C3E0' : '#6F8FB3', lv = +kind.slice(4) || 0;
  const opt = kind === 'snow'
    ? { particles: { number: { value: 46 }, shape: { type: 'image', options: { image: { src: FLAKE, width: 44, height: 50 } } },
        opacity: { value: { min: .75, max: 1 } }, size: { value: { min: 4, max: 9 } },
        rotate: { value: { min: 0, max: 360 }, direction: 'random', animation: { enable: true, speed: 6 } },
        wobble: { enable: true, distance: 12, speed: { min: -4, max: 4 } },
        move: { enable: true, direction: 'bottom', speed: { min: .8, max: 2 }, straight: false, outModes: { default: 'out' } } } }
    : { particles: { number: { value: [0, 70, 110, 160][lv] }, color: { value: col }, shape: { type: 'line' }, stroke: { width: 1.4, color: { value: col } },
        opacity: { value: { min: .25, max: .6 } }, size: { value: { min: 7, max: 14 } }, rotate: { value: 100, animation: { enable: false } },
        move: { enable: true, direction: 'bottom', angle: { value: 8, offset: -6 }, speed: { min: lv === 3 ? 26 : 18, max: lv === 3 ? 36 : 26 }, straight: true, outModes: { default: 'out' } } } };
  const c = await window.tsParticles.load({ id: 'wxfall', element: el.querySelector('.wb-fall'), options: { fullScreen: { enable: false }, fpsLimit: 60, detectRetina: true, ...opt } });
  if (fallKey === key) fallC = c; else c?.destroy();
}
// 切到背景時暫停，省電
document.addEventListener('visibilitychange', () => {
  const h = document.hidden;
  if (decoAnim) h ? decoAnim.pause() : decoAnim.play();
  if (fallC) h ? fallC.pause() : fallC.play();
  if (!h && bgTrip) applyBg();
});
