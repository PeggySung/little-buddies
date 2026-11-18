// 國家清單：選了國家就自動帶入幣別和時區（都可以再改）
export const COUNTRIES = [
  { code: 'JP', name: '日本', en: 'JAPAN', cur: 'JPY', tz: 'Asia/Tokyo' },
  { code: 'KR', name: '韓國', en: 'KOREA', cur: 'KRW', tz: 'Asia/Seoul' },
  { code: 'TH', name: '泰國', en: 'THAILAND', cur: 'THB', tz: 'Asia/Bangkok' },
  { code: 'VN', name: '越南', en: 'VIETNAM', cur: 'VND', tz: 'Asia/Ho_Chi_Minh' },
  { code: 'SG', name: '新加坡', en: 'SINGAPORE', cur: 'SGD', tz: 'Asia/Singapore' },
  { code: 'MY', name: '馬來西亞', en: 'MALAYSIA', cur: 'MYR', tz: 'Asia/Kuala_Lumpur' },
  { code: 'PH', name: '菲律賓', en: 'PHILIPPINES', cur: 'PHP', tz: 'Asia/Manila' },
  { code: 'ID', name: '印尼', en: 'INDONESIA', cur: 'IDR', tz: 'Asia/Makassar' },
  { code: 'HK', name: '香港', en: 'HONG KONG', cur: 'HKD', tz: 'Asia/Hong_Kong' },
  { code: 'MO', name: '澳門', en: 'MACAU', cur: 'MOP', tz: 'Asia/Macau' },
  { code: 'CN', name: '中國', en: 'CHINA', cur: 'CNY', tz: 'Asia/Shanghai' },
  { code: 'TW', name: '台灣', en: 'TAIWAN', cur: 'TWD', tz: 'Asia/Taipei' },
  { code: 'US', name: '美國', en: 'USA', cur: 'USD', tz: 'America/Los_Angeles' },
  { code: 'CA', name: '加拿大', en: 'CANADA', cur: 'CAD', tz: 'America/Vancouver' },
  { code: 'GB', name: '英國', en: 'UK', cur: 'GBP', tz: 'Europe/London' },
  { code: 'FR', name: '法國', en: 'FRANCE', cur: 'EUR', tz: 'Europe/Paris' },
  { code: 'DE', name: '德國', en: 'GERMANY', cur: 'EUR', tz: 'Europe/Berlin' },
  { code: 'IT', name: '義大利', en: 'ITALY', cur: 'EUR', tz: 'Europe/Rome' },
  { code: 'ES', name: '西班牙', en: 'SPAIN', cur: 'EUR', tz: 'Europe/Madrid' },
  { code: 'NL', name: '荷蘭', en: 'NETHERLANDS', cur: 'EUR', tz: 'Europe/Amsterdam' },
  { code: 'AT', name: '奧地利', en: 'AUSTRIA', cur: 'EUR', tz: 'Europe/Vienna' },
  { code: 'CZ', name: '捷克', en: 'CZECHIA', cur: 'CZK', tz: 'Europe/Prague' },
  { code: 'CH', name: '瑞士', en: 'SWITZERLAND', cur: 'CHF', tz: 'Europe/Zurich' },
  { code: 'TR', name: '土耳其', en: 'TÜRKIYE', cur: 'TRY', tz: 'Europe/Istanbul' },
  { code: 'AU', name: '澳洲', en: 'AUSTRALIA', cur: 'AUD', tz: 'Australia/Sydney' },
  { code: 'NZ', name: '紐西蘭', en: 'NEW ZEALAND', cur: 'NZD', tz: 'Pacific/Auckland' }
];
export const countryBy = code => COUNTRIES.find(c => c.code === code);

export const CURRENCIES = [...new Set(['TWD', ...COUNTRIES.map(c => c.cur)])];
export const CUR_NAME = { TWD: '新台幣', JPY: '日圓', KRW: '韓元', THB: '泰銖', VND: '越南盾', SGD: '新加坡幣', MYR: '馬幣', PHP: '菲律賓披索',
  IDR: '印尼盾', HKD: '港幣', MOP: '澳門幣', CNY: '人民幣', USD: '美元', CAD: '加幣', GBP: '英鎊', EUR: '歐元', CZK: '捷克克朗',
  CHF: '瑞士法郎', TRY: '土耳其里拉', AUD: '澳幣', NZD: '紐幣' };

// 時區清單：瀏覽器支援就列出全部，不支援就用國家清單裡的
export function timeZones() {
  try { if (Intl.supportedValuesOf) return Intl.supportedValuesOf('timeZone'); } catch {}
  return [...new Set(COUNTRIES.map(c => c.tz))];
}

/* ───────── 日期 ───────── */
// 某個時區的「今天」（YYYY-MM-DD）
export function todayIn(tz) {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
  catch { return new Date().toISOString().slice(0, 10); }
}
export function dayCount(start, end) {
  const a = Date.parse(start + 'T00:00:00Z'), b = Date.parse(end + 'T00:00:00Z');
  return Math.round((b - a) / 86400000) + 1;
}
// 規劃中／旅行中／已結束（依旅程當地日期）
export function tripStatus(t) {
  const today = todayIn(t.tz);
  if (today < t.start) return 'plan';
  if (today > t.end) return 'done';
  return 'now';
}
export const STATUS_LABEL = { plan: '規劃中', now: '旅行中', done: '已結束' };
export function fmtRange(start, end) {
  const [y1, m1, d1] = start.split('-'), [y2, m2, d2] = end.split('-');
  return `${y1}/${+m1}/${+d1} – ${y1 === y2 ? '' : y2 + '/'}${+m2}/${+d2}`;
}
export function placesText(places) {
  return (places || []).map(p => {
    const c = countryBy(p.country);
    const cn = c ? c.name : (p.countryName || p.country);
    return p.city ? `${cn}・${p.city}` : cn;
  }).join('、');
}
