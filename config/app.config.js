/**
 * تنظیمات اصلی برنامه
 * ─────────────────────────────────────────────
 * فقط همین فایل (و users.json) را برای راه‌اندازی ویرایش کنید.
 */
export const CONFIG = {
  appName: "فرم اکیپ‌های وصول مطالبات",
  version: "4.1.0",

  /** اتصال به سرور (Google Apps Script) */
  server: {
    // آدرس Web App بعد از Deploy (مرحله ۳ راهنما)
    url: "https://script.google.com/macros/s/AKfycbwUvbOFCYHIxCjs1h8xVAouKpXH75zkzyvNe2VUihI_S7z7Ctr5_OT4HEFTgg3UvChUTQ/exec",
    // باید دقیقاً با APP_TOKEN داخل apps-script.js یکی باشد
    token: "09172209668",
    timeoutMs: 120000,
  },

  /** عکس‌ها */
  photos: {
    maxSide: 800,        // بزرگ‌ترین ضلع عکس (پیکسل)
    quality: 0.4,        // کیفیت JPEG ‏(۰ تا ۱)
    separator: "_",       // 12345_1.jpg ، 12345_2.jpg ...
    captureOnly: true,    // true = فقط دوربین ‏(بدون انتخاب از گالری)
  },

  /** درج اطلاعات فرم روی عکس (گوشه بالا سمت راست) */
  stamp: {
    enabled: true,
    fontRatio: 0.020,     // اندازه فونت نسبت به عرض عکس
    maxWidthRatio: 0.50,  // حداکثر عرض کادر نسبت به عرض عکس
    // هر آرایه = یک خط؛ کلیدها از فیلدهای config/modes.js
    lines: [
      ["modeTitle"],
      ["eshterak", "date"],
      ["omoor", "city"],
      ["leader"],
      ["amount"],
      ["userName"],
      ["gps"],
    ],
  },

  /** ذخیره در حافظه گوشی */
  device: {
    folderName: "CollectionApp", // نام پوشه (وقتی مرورگر اجازه ساخت پوشه بدهد)
    autoSavePhotos: true,        // با هر «ذخیره» عکس‌ها هم در گوشی ذخیره شوند
  },

  /** قوانین */
  rules: {
    allowDeletePending: true,    // حذف موارد ارسال‌نشده (با تأیید دوباره)
    requireGps: false,
  },
};
