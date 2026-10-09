/**
 * تنظیمات اصلی برنامه
 * ─────────────────────────────────────────────
 * فقط همین فایل (و users.json) را برای راه‌اندازی ویرایش کنید.
 */
export const CONFIG = {
  appName: "گزارش میدانی",
  version: "4.2.0",

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
    maxSide: 850,        // بزرگ‌ترین ضلع عکس (پیکسل)
    quality: 0.5,        // کیفیت JPEG ‏(۰ تا ۱)
    separator: "_",       // 12345_1.jpg ، 12345_2.jpg ...
    captureOnly: false,   // false = با کلیک روی باکس، انتخاب بین دوربین و گالری ‏(true = مستقیم دوربین)
  },

  /** درج اطلاعات فرم روی عکس (نوار نیمه‌شفاف پایین عکس: سطر اول عنوان‌ها، سطر دوم مقدارها) */
  stamp: {
    enabled: true,
    fontRatio: 0.022,     // اندازه فونت نسبت به عرض عکس (هدف؛ اگر جا نشود خودکار کمی کوچک می‌شود)
    maxGroups: 1,         // حداکثر طبقه‌های نوار (هر طبقه = یک سطر عنوان + یک سطر مقدار)
    bgOpacity: 0.5,       // شفافیت زمینه نوار (۰ = کاملاً شفاف، ۱ = تیره)
    // هر آرایه = یک خط؛ کلیدها از فیلدهای config/modes.js (همه موارد زیر هم، در یک ستون)
    lines: [
      ["modeTitle"],
      ["eshterak"],
      ["date"],
      ["omoor"],
      ["city"],
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
