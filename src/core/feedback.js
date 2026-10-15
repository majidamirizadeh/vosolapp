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
  // [فرکانس Hz ، شروع (ثانیه) ، طول (ثانیه) ، نوع موج ، بلندی]
  success: [[880, 0, 0.09, "sine", 0.9], [1320, 0.1, 0.16, "sine", 0.9]],
  error: [[240, 0, 0.17, "square", 0.45], [200, 0.22, 0.24, "square", 0.45]],
  photo: [[1500, 0, 0.04, "triangle", 0.8], [900, 0.045, 0.05, "triangle", 0.6]],
  alert: [[784, 0, 0.14, "sine", 0.85], [988, 0.18, 0.14, "sine", 0.85], [784, 0.36, 0.2, "sine", 0.85]],
  online: [[523, 0, 0.08, "sine", 0.6], [784, 0.1, 0.12, "sine", 0.6]],
};
const VIBES = {
  success: [60],
  error: [130, 70, 130],
  photo: [25],
  alert: [100, 60, 100, 60, 100],
  online: [40],
};
const MASTER = 0.3; // بلندی کلی (متوسط؛ برای محیط عمومی مزاحم نباشد)

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
  for (const [freq, at, dur, type, vol] of TONES[kind] || []) {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    const s = t0 + at, e = s + dur;
    g.gain.setValueAtTime(0.0001, s);
    g.gain.exponentialRampToValueAtTime(MASTER * vol, s + 0.01); // شروع نرم (بدون تق)
    g.gain.exponentialRampToValueAtTime(0.0001, e);
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
