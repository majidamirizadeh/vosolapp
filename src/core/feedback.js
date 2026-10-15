/**
 * بازخورد صوتی و لرزشی (برای وقتی که کاربر صفحه را درست نمی‌بیند: آفتاب، حرکت، …)
 * - صدا با Web Audio ساخته می‌شود (بدون فایل صوتی؛ کاملاً آفلاین)
 * - لرزش با navigator.vibrate (اندروید Chrome؛ در iPhone پشتیبانی نمی‌شود)
 * - تنظیمات: «sound» پیش‌فرض روشن ، «vibrate» پیش‌فرض خاموش (از تب تنظیمات)
 *
 * انواع: success | error | photo | alert | online
 */
import { getPref } from "./prefs.js";

const TONES = {
  // [فرکانس Hz ، شروع (ثانیه) ، طول (ثانیه) ، نوع موج]
  // موج مربعی (انرژی بیشتر = بلندتر) و فرکانس‌های ۰٫۵ تا ۲ کیلوهرتز (جایی که بلندگوی گوشی و گوش انسان بیشترین حساسیت را دارند)
  success: [[1568, 0, 0.12, "square"], [2093, 0.14, 0.24, "square"]],
  error: [[700, 0, 0.22, "square"], [500, 0.27, 0.3, "square"], [700, 0.62, 0.22, "square"]],
  photo: [[2000, 0, 0.06, "square"], [1200, 0.07, 0.08, "square"]],
  alert: [[1000, 0, 0.16, "square"], [1400, 0.18, 0.16, "square"], [1000, 0.36, 0.16, "square"], [1400, 0.54, 0.16, "square"], [1000, 0.72, 0.3, "square"]],
  online: [[1047, 0, 0.1, "square"], [1568, 0.12, 0.18, "square"]],
};
const VIBES = {
  success: [60],
  error: [130, 70, 130],
  photo: [25],
  alert: [100, 60, 100, 60, 100],
  online: [40],
};
const MASTER = 1; // بلندی کلی: حداکثر (۱ = بالاترین سطح دیجیتال؛ بلندی نهایی را «بلندی رسانه»ی گوشی تعیین می‌کند)

let ctx = null;

function audio() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
  } catch {
    return null;
  }
}

/** مرورگر فقط بعد از اولین لمس کاربر اجازهٔ صدا می‌دهد؛ با اولین لمس آماده می‌شود */
export function unlockAudio() {
  const go = () => { audio(); window.removeEventListener("pointerdown", go, true); window.removeEventListener("keydown", go, true); };
  window.addEventListener("pointerdown", go, true);
  window.addEventListener("keydown", go, true);
}

function beep(kind) {
  const ac = audio();
  if (!ac || ac.state !== "running") return;
  const t0 = ac.currentTime + 0.01;
  for (const [freq, at, dur, type] of TONES[kind] || []) {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    const s = t0 + at, e = s + dur;
    g.gain.setValueAtTime(0, s);
    g.gain.linearRampToValueAtTime(MASTER, s + 0.004); // شروع خیلی کوتاه و نرم (بدون تق) و بعد تا آخر در بالاترین سطح
    g.gain.setValueAtTime(MASTER, Math.max(s + 0.005, e - 0.012));
    g.gain.linearRampToValueAtTime(0, e);
    osc.connect(g).connect(ac.destination);
    osc.start(s);
    osc.stop(e + 0.02);
  }
}

/** بازخورد یک رویداد؛ طبق تنظیمات کاربر صدا و/یا لرزش */
export function feedback(kind, { force = false } = {}) {
  try {
    if (force || getPref("sound")) beep(kind);
    if (force || getPref("vibrate")) navigator.vibrate?.(VIBES[kind] || [50]);
  } catch { /* بی‌اثر */ }
}

export const vibrationSupported = () => typeof navigator.vibrate === "function";
