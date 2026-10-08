/**
 * تبدیل تاریخ میلادی ⇄ شمسی (الگوریتم jalaali — بدون وابستگی، کاملاً آفلاین)
 */
const BREAKS = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];
const div = (a, b) => ~~(a / b);
const mod = (a, b) => a - ~~(a / b) * b;

function jalCal(jy, withoutLeap) {
  const bl = BREAKS.length;
  const gy = jy + 621;
  let leapJ = -14;
  let jp = BREAKS[0];
  let jm, jump = 0, leap, n;
  if (jy < jp || jy >= BREAKS[bl - 1]) throw new Error("Invalid Jalaali year " + jy);
  for (let i = 1; i < bl; i++) {
    jm = BREAKS[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  n = jy - jp;
  leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (withoutLeap) return { gy, march };
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return { leap, gy, march };
}

function g2d(gy, gm, gd) {
  let d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4) + div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}

function d2g(jdn) {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1;
  const gm = mod(div(i, 153), 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}

function j2d(jy, jm, jd) {
  const r = jalCal(jy, true);
  return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}

function d2j(jdn) {
  const gy = d2g(jdn).gy;
  let jy = gy - 621;
  const r = jalCal(jy, false);
  const jdn1f = g2d(gy, 3, r.march);
  let k = jdn - jdn1f;
  let jm, jd;
  if (k >= 0) {
    if (k <= 185) {
      jm = 1 + div(k, 31);
      jd = mod(k, 31) + 1;
      return { jy, jm, jd };
    }
    k -= 186;
  } else {
    jy -= 1;
    k += 179;
    if (r.leap === 1) k += 1;
  }
  jm = 7 + div(k, 30);
  jd = mod(k, 30) + 1;
  return { jy, jm, jd };
}

export const toJalali = (gy, gm, gd) => d2j(g2d(gy, gm, gd));
export const toGregorian = (jy, jm, jd) => d2g(j2d(jy, jm, jd));

export function isLeapJalali(jy) {
  return jalCal(jy, false).leap === 0;
}

export function daysInJalaliMonth(jy, jm) {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  return isLeapJalali(jy) ? 30 : 29;
}

const pad = (n) => String(n).padStart(2, "0");

/** امروز به شکل YYYY/MM/DD شمسی */
export function todayJalali(date = new Date()) {
  const j = toJalali(date.getFullYear(), date.getMonth() + 1, date.getDate());
  return `${j.jy}/${pad(j.jm)}/${pad(j.jd)}`;
}

/** بررسی و استانداردسازی رشته تاریخ شمسی؛ در صورت نامعتبر بودن null */
export function parseJalali(str) {
  const m = String(str ?? "")
    .replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))
    .replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d))
    .trim()
    .match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);
  if (!m) return null;
  const jy = +m[1], jm = +m[2], jd = +m[3];
  if (jy < 1300 || jy > 1600 || jm < 1 || jm > 12 || jd < 1 || jd > daysInJalaliMonth(jy, jm)) return null;
  return { jy, jm, jd, text: `${jy}/${pad(jm)}/${pad(jd)}` };
}

/** برای مقایسه/مرتب‌سازی: عدد 14050715 */
export function jalaliKey(str) {
  const p = parseJalali(str);
  return p ? p.jy * 10000 + p.jm * 100 + p.jd : 0;
}

/**
 * بازه‌های آماده برای فیلتر تاریخ گزارش‌ها → { from, to } به شکل YYYY/MM/DD
 * kind: today | yesterday | last7 | thisMonth | lastMonth | all
 */
export function rangePreset(kind, now = new Date()) {
  const t = todayJalali(now);
  const daysAgo = (n) => { const d = new Date(now); d.setDate(d.getDate() - n); return todayJalali(d); };
  const { jy, jm } = parseJalali(t);
  switch (kind) {
    case "yesterday": return { from: daysAgo(1), to: daysAgo(1) };
    case "last7": return { from: daysAgo(6), to: t };
    case "thisMonth": return { from: `${jy}/${pad(jm)}/01`, to: t };
    case "lastMonth": {
      const y = jm === 1 ? jy - 1 : jy, m = jm === 1 ? 12 : jm - 1;
      return { from: `${y}/${pad(m)}/01`, to: `${y}/${pad(m)}/${pad(daysInJalaliMonth(y, m))}` };
    }
    case "all": return { from: "1400/01/01", to: t };
    default: return { from: t, to: t };
  }
}

export const PRESETS = [
  ["today", "امروز"], ["yesterday", "دیروز"], ["last7", "۷ روز اخیر"],
  ["thisMonth", "این ماه"], ["lastMonth", "ماه قبل"], ["all", "همه"],
];
