// 代表色：OKLCH 色彩計算、核心成員保留色、旅伴代表色測驗
// OKLCH 的 L（明亮度 0–1）、C（彩度）、h（色相 0–360）比 RGB 更接近人眼感覺，撞色判斷比較準

/* ───────── 色彩轉換 ───────── */
const toLin = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGam = c => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function hexToOklab(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = toLin(((n >> 16) & 255) / 255), g = toLin(((n >> 8) & 255) / 255), b = toLin((n & 255) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
  ];
}
export function hexToOklch(hex) {
  const [L, a, b] = hexToOklab(hex);
  return { L, C: Math.hypot(a, b), h: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360 };
}
function oklchToRgbRaw(L, C, h) {
  const a = C * Math.cos((h * Math.PI) / 180), b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
  ];
}
const inGamut = rgb => rgb.every(v => v >= -0.0005 && v <= 1.0005);
// 超出螢幕能顯示的範圍時，降低彩度直到顯示得出來（色相和明亮度不變）
export function oklchToHex(L, C, h) {
  let c = C, rgb = oklchToRgbRaw(L, c, h);
  while (!inGamut(rgb) && c > 0) { c = Math.max(0, c - 0.005); rgb = oklchToRgbRaw(L, c, h); }
  return '#' + rgb.map(v => Math.round(Math.min(1, Math.max(0, toGam(Math.min(1, Math.max(0, v))))) * 255)
    .toString(16).padStart(2, '0')).join('').toUpperCase();
}
export function deltaE(hex1, hex2) {
  const a = hexToOklab(hex1), b = hexToOklab(hex2);
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
const hueDist = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* ───────── 核心成員（保留色，別人不能用） ───────── */
export const CORE = [
  { id: 'qi',   name: '阿柒', color: '#E74C3C', colorDark: '#FF7B6E', driver: true,  avatar: 'img/avatars/qi.webp' },
  { id: 'xuan', name: '阿琁', color: '#3B82F6', colorDark: '#6FA8FF', driver: false, avatar: 'img/avatars/xuan.webp' },
  { id: 'yun',  name: '阿筠', color: '#10B981', colorDark: '#38D39F', driver: true,  avatar: 'img/avatars/yun.webp' },
  { id: 'yue',  name: '鈅寧', color: '#8B5CF6', colorDark: '#B39CFF', driver: false, avatar: 'img/avatars/yue.webp' },
  { id: 'zhen', name: '阿蓁', color: '#ED8712', colorDark: '#FEB06F', driver: false, avatar: 'img/avatars/zhen.webp' }
];
export const coreById = id => CORE.find(c => c.id === id);
const MIN_DE_CORE = 0.10; // 和核心色的色差至少 0.10（肉眼分得出來就好，色相可以靠近）
export const MIN_DE_PEER = 0.08; // 同一趟旅伴之間至少 0.08（旅程功能用）

/* ───────── 旅伴色系 ───────── */
export const FAMILIES = {
  orange:   { name: '焦糖橘',   L: 0.56, C: 0.15, h: 50,  Lmax: 0.60 }, // 比阿蓁深很多，才分得開
  yellow:   { name: '向日葵黃', L: 0.80, C: 0.16, h: 98,  Lmin: 0.74, Lmax: 0.82 }, // 黃色要夠亮才不會變土黃
  matcha:   { name: '抹茶綠',   L: 0.62, C: 0.16, h: 128 },
  mint:     { name: '薄荷綠',   L: 0.78, C: 0.11, h: 172, Lmax: 0.82 },
  lake:     { name: '湖水青',   L: 0.62, C: 0.12, h: 205 },
  sky:      { name: '晴空藍',   L: 0.74, C: 0.12, h: 236, Lmax: 0.80 },
  lavender: { name: '薰衣草紫', L: 0.74, C: 0.11, h: 305, Lmax: 0.80 },
  berry:    { name: '莓果紫紅', L: 0.58, C: 0.20, h: 338 },
  sakura:   { name: '櫻花粉',   L: 0.74, C: 0.13, h: 358 },
  earth:    { name: '大地棕',   L: 0.55, C: 0.05, h: 60, neutral: true }
};
// 色系繞色環一圈；可以靠近小夥伴的色相，只要色差夠大、肉眼分得出來（MIN_DE_CORE）
// 同一趟旅程真的太像時，會自動只在那趟微調明暗；還是不滿意可以到「我的」重做測驗

/* ───────── 測驗題目 ───────── */
// 第 1 題決定色系；第 2～5 題各調一個方向：色相（色溫）、彩度、明亮度、深淺對比
export const QUIZ = [
  { q: '旅途中最讓你心動的瞬間是？', key: 'family', options: [
    { t: '在巷子裡的甜點店，挖一口剛烤好的焦糖布丁', v: 'orange', icon: 'pudding' },
    { t: '夏天正午，走進一整片向日葵花田', v: 'yellow', icon: 'flower' },
    { t: '躲進老街小店，點一杯濃濃的抹茶', v: 'matcha', icon: 'cup' },
    { t: '清晨走進森林步道，空氣涼涼的', v: 'mint', icon: 'leaf' },
    { t: '浮潛時看見透明到見底的海水', v: 'lake', icon: 'wave' },
    { t: '躺在草地上，看一整片沒有雲的藍天', v: 'sky', icon: 'cloud' },
    { t: '在紫色的薰衣草花田裡慢慢散步', v: 'lavender', icon: 'sprig' },
    { t: '夏夜的河邊，看煙火一朵一朵炸開', v: 'berry', icon: 'firework' },
    { t: '春天在櫻花樹下野餐', v: 'sakura', icon: 'blossom' },
    { t: '推開木頭門，走進有咖啡香的老咖啡館', v: 'earth', icon: 'door' }
  ] },
  { q: '到一個新城市，你第一件事會做什麼？', key: 'first', options: [
    { t: '先找在地小吃攤', dh: 12, desc: '走到哪都要先找在地小吃的人' },
    { t: '找間咖啡廳坐坐，慢慢感受', dh: 5, desc: '喜歡找個角落慢慢感受城市的人' },
    { t: '直接衝景點拍照', dh: -5, desc: '一下車就準備好相機的行動派' },
    { t: '先回飯店躺平充電', dh: -12, desc: '懂得先充好電再出發的人' }
  ] },
  { q: '你的行程通常長什麼樣子？', key: 'plan', options: [
    { t: '排滿滿，一分鐘都不浪費', dC: 0.035 },
    { t: '排一半，留點空檔給驚喜', dC: 0 },
    { t: '完全隨興，走到哪算哪', dC: -0.03 }
  ] },
  { q: '看日出和逛夜市只能選一個？', key: 'time', options: [
    { t: '一定要看日出', dL: 0.06, prefix: '清晨' },
    { t: '兩個都想要，不要逼我', dL: 0, prefix: '午後' },
    { t: '夜市才是旅行的靈魂', dL: -0.07, prefix: '夜晚' }
  ] },
  { q: '你的行李通常是？', key: 'bag', options: [
    { t: '一個背包走天下', dL: 0.03, dC: -0.02 },
    { t: '一個登機箱剛剛好', dL: 0, dC: 0 },
    { t: '兩個大行李箱都還不夠', dL: -0.03, dC: 0.02 }
  ] }
];

const L_RANGE = [0.50, 0.76]; // 淺色主題用的明亮度範圍（太亮在米白底上看不清楚）

// 依答案算出顏色（answers：每題選的 index；tweak：結果頁滑桿的明暗微調）
export function quizColor(answers, tweak = 0) {
  const fam = FAMILIES[QUIZ[0].options[answers[0]].v];
  const o = i => QUIZ[i].options[answers[i]] || {};
  const cScale = fam.neutral ? 0.4 : 1;
  const L = Math.max(fam.Lmin || 0, fam.L + (o(3).dL || 0) + (o(4).dL || 0)) + tweak;
  const C = fam.C + ((o(2).dC || 0) + (o(4).dC || 0)) * cScale;
  const h = fam.h + (o(1).dh || 0) * (fam.neutral ? 0.5 : 1);
  const res = finalizeColor(L, C, h, !!fam.neutral, fam.Lmax);
  const name = `${o(3).prefix || ''}${fam.name}`;
  return { ...res, family: QUIZ[0].options[answers[0]].v, name, desc: `${o(1).desc || ''}。` };
}

// 套用撞色規則：和核心色的色差夠大、明亮度在可讀範圍
export function finalizeColor(L, C, h, neutral = false, Lmax = L_RANGE[1]) {
  L = clamp(L, L_RANGE[0], Lmax);
  C = clamp(C, neutral ? 0.02 : 0.06, 0.2);
  h = ((h % 360) + 360) % 360;
  let hex = oklchToHex(L, C, h), adjusted = false;
  for (let k = 0; k < 8 && minCoreDelta(hex) < MIN_DE_CORE; k++) {
    // 還太像某個核心色：往遠離那個核心色的明亮度方向推
    const near = CORE.reduce((a, c) => (deltaE(hex, c.color) < deltaE(hex, a.color) ? c : a));
    const nl = hexToOklch(near.color).L;
    L = clamp(L + (L >= nl ? 0.03 : -0.03), L_RANGE[0], Lmax);
    hex = oklchToHex(L, C, h); adjusted = true;
  }
  for (let k = 0; k < 12 && minCoreDelta(hex) < MIN_DE_CORE; k++) {
    // 明亮度已經推到底還是太像：色相再往遠離最近核心色的方向轉 4°，並稍微降低彩度
    const near = CORE.reduce((a, c) => (deltaE(hex, c.color) < deltaE(hex, a.color) ? c : a));
    const nh = hexToOklch(near.color).h;
    const diff = ((h - nh + 540) % 360) - 180;
    if (!neutral) h = (h + (diff >= 0 ? 4 : -4) + 360) % 360;
    C = Math.max(neutral ? 0.02 : 0.06, C - 0.01);
    hex = oklchToHex(L, C, h); adjusted = true;
  }
  const dark = darkVariant(L, C, h);
  return { color: hex, colorDark: dark, L, C, h, ok: minCoreDelta(hex) >= MIN_DE_CORE, adjusted };
}
export const minCoreDelta = hex => Math.min(...CORE.map(c => deltaE(hex, c.color)));
const minCoreDarkDelta = hex => Math.min(...CORE.map(c => deltaE(hex, c.colorDark)));

// 深色模式的顏色：預設比淺色亮 0.12；太像小夥伴的深色版時，找最接近預設、但分得出來的明暗／彩度
function darkVariant(L, C, h) {
  const L0 = clamp(L + 0.12, 0.70, 0.86);
  const first = oklchToHex(L0, C, h);
  if (minCoreDarkDelta(first) >= MIN_DE_CORE) return first;
  let best = first, bestCost = Infinity, bestD = minCoreDarkDelta(first);
  for (let dL = -0.20; dL <= 0.201; dL += 0.01) {
    const l = L0 + dL;
    if (l < 0.62 || l > 0.92) continue;
    for (const k of [1, 0.85, 0.7, 0.55]) {
      const hex = oklchToHex(l, C * k, h), d = minCoreDarkDelta(hex);
      const cost = Math.abs(dL) + (1 - k) * 0.15;
      if (d >= MIN_DE_CORE ? cost < bestCost : bestCost === Infinity && d > bestD) {
        best = hex; if (d >= MIN_DE_CORE) bestCost = cost; else bestD = d;
      }
    }
  }
  return best;
}

// 存檔前檢查：旅伴的顏色不能用核心色
export function isAllowedGuestColor(hex) {
  return /^#[0-9A-F]{6}$/i.test(hex) && minCoreDelta(hex) >= MIN_DE_CORE - 0.005;
}

// 淡色底（頭像、標籤用）
export const soft = (hex, dark) => hex + (dark ? '33' : '2E');

// 同一趟旅程裡，和其他人的顏色太像時，只在這趟微調明亮度（個人檔案的顏色不變）
export function adjustForPeers(color, colorDark, peerColors) {
  const tooClose = hex => peerColors.some(p => deltaE(hex, p) < MIN_DE_PEER);
  if (!tooClose(color)) return { color, colorDark, adjusted: false };
  const base = hexToOklch(color), baseDark = hexToOklch(colorDark);
  for (const step of [0.04, -0.04, 0.08, -0.08, 0.12, -0.12]) {
    const L = clamp(base.L + step, L_RANGE[0], L_RANGE[1]);
    const c = oklchToHex(L, base.C, base.h);
    if (!tooClose(c) && minCoreDelta(c) >= MIN_DE_CORE) {
      return { color: c, colorDark: oklchToHex(clamp(baseDark.L + step, 0.70, 0.86), baseDark.C, baseDark.h), adjusted: true };
    }
  }
  return { color, colorDark, adjusted: false };
}
