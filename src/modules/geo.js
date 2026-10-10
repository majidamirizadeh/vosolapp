/**
 * دریافت موقعیت مکانی (GPS) — مقاوم در برابر خطاهای رایج گوشی
 *
 * مشکل نسخهٔ قبل: فقط یک درخواست «GPS دقیق» با مهلت ۲۰ ثانیه ارسال می‌شد؛ داخل ساختمان، با GPS سرد
 * یا وقتی سرویس موقعیت شبکهٔ گوگل در دسترس نبود، خطای انگلیسی مرورگر (Timeout expired / User denied …) نشان داده می‌شد.
 *
 * روش جدید: دو درخواست هم‌زمان
 *   ۱) GPS دقیق (watchPosition با enableHighAccuracy) — به‌مرور دقیق‌تر می‌شود
 *   ۲) موقعیت شبکه/وای‌فای (سریع‌تر، کم‌دقت‌تر)
 * اولین نتیجهٔ دقیق (≤ goodAccuracy متر) پذیرفته می‌شود؛ اگر فقط نتیجهٔ کم‌دقت رسید،
 * چند ثانیه صبر می‌کند تا دقت بهتر بیاید و بعد بهترین نتیجه را برمی‌گرداند.
 * خطاها به پیام فارسی همراه با راه‌حل تبدیل می‌شوند.
 */

const MESSAGES = {
  denied:
    "برنامه اجازهٔ دسترسی به موقعیت مکانی ندارد.\n\n" +
    "۱) در تنظیمات گوشی وارد بخش «برنامه‌ها» شوید و برنامه یا مرورگر (Chrome) را باز کنید\n" +
    "۲) «مجوزها ← موقعیت مکانی» را روی «اجازه دادن» بگذارید\n" +
    "۳) برنامه را کامل ببندید و دوباره باز کنید\n\n" +
    "اگر از مرورگر استفاده می‌کنید، روی آیکون کنار آدرس بزنید و «موقعیت مکانی» را مجاز کنید.",
  unavailable:
    "موقعیت در دسترس نیست.\n\n" +
    "• GPS (Location) گوشی را از نوار بالای صفحه روشن کنید\n" +
    "• در تنظیمات موقعیت، حالت «دقت بالا» را فعال کنید\n" +
    "• در صورت امکان به فضای باز بروید و دوباره امتحان کنید",
  timeout:
    "دریافت موقعیت بیش از حد طول کشید.\n\n" +
    "به فضای باز یا کنار پنجره بروید، مطمئن شوید GPS گوشی روشن است و دوباره دکمه را بزنید.",
  insecure: "دریافت موقعیت فقط در آدرس امن (https) کار می‌کند. برنامه را از آدرس https باز کنید.",
  unsupported: "مرورگر شما از موقعیت مکانی پشتیبانی نمی‌کند",
};

export const geoErrorMessage = (kind) => MESSAGES[kind] || MESSAGES.unavailable;

function geoError(kind) {
  const e = new Error(geoErrorMessage(kind));
  e.kind = kind;
  return e;
}

const toFix = (pos) => ({
  lat: pos.coords.latitude,
  lng: pos.coords.longitude,
  accuracy: Math.round(pos.coords.accuracy),
});

/**
 * @param {{goodAccuracy?:number, settleMs?:number, totalMs?:number, onUpdate?:(fix:{lat:number,lng:number,accuracy:number})=>void}} [opts]
 * @returns {Promise<{lat:number,lng:number,accuracy:number}>}  در صورت خطا Error با فیلد kind:
 *          denied | unavailable | timeout | insecure | unsupported
 */
export function acquirePosition(opts = {}) {
  const { goodAccuracy = 50, settleMs = 6000, totalMs = 40000, onUpdate } = opts;
  return new Promise((resolve, reject) => {
    const geo = navigator.geolocation;
    if (!geo) return reject(geoError("unsupported"));
    if (window.isSecureContext === false) return reject(geoError("insecure"));

    let best = null;
    let settled = false;
    let watchId = null;
    let settleTimer = null;
    let totalTimer = null;
    const failed = new Set(); // منبع‌هایی که خطا داده‌اند: "hi" | "lo"
    const errors = [];

    const cleanup = () => {
      clearTimeout(settleTimer);
      clearTimeout(totalTimer);
      if (watchId != null) { try { geo.clearWatch(watchId); } catch { /* ادامه */ } }
    };
    const finish = () => { if (settled) return; settled = true; cleanup(); resolve(toFix(best)); };
    const abort = (kind) => { if (settled) return; settled = true; cleanup(); reject(geoError(kind)); };
    const kindOfErrors = () => (errors.length && errors.every((e) => e.code === 2) ? "unavailable" : "timeout");

    const onFix = (pos) => {
      if (settled) return;
      if (!best || pos.coords.accuracy < best.coords.accuracy) {
        best = pos;
        try { onUpdate?.(toFix(pos)); } catch { /* ادامه */ }
      }
      if (best.coords.accuracy <= goodAccuracy) return finish();
      if (!settleTimer) settleTimer = setTimeout(() => best && finish(), settleMs);
    };
    const onErr = (src) => (err) => {
      if (settled) return;
      if (err && err.code === 1) return abort("denied"); // PERMISSION_DENIED
      if (!failed.has(src)) { failed.add(src); errors.push(err || {}); }
      if (failed.size >= 2 && !best) abort(kindOfErrors());
    };

    // اگر تا مهلت کل چیزی نرسید: بهترین نتیجه یا خطا
    totalTimer = setTimeout(() => (best ? finish() : abort(errors.length ? kindOfErrors() : "timeout")), totalMs + 1500);

    try {
      watchId = geo.watchPosition(onFix, onErr("hi"), { enableHighAccuracy: true, maximumAge: 0, timeout: totalMs });
      geo.getCurrentPosition(onFix, onErr("lo"), { enableHighAccuracy: false, maximumAge: 120000, timeout: 15000 });
    } catch (e) {
      abort("unavailable");
    }
  });
}
