/**
 * Google Apps Script — سرور دریافت اطلاعات اکیپ‌ها (نسخه ۴)
 * ─────────────────────────────────────────────────────────
 * این فایل را در script.google.com جایگزین Code.gs کنید و بعد Deploy → Web app.
 *
 * بهبودها نسبت به نسخه قبل:
 *  ✔ ثبت تکراری ندارد: هر رکورد uid دارد؛ اگر گوشی به‌خاطر قطعی اینترنت دوباره بفرستد، ردیف دوم ساخته نمی‌شود.
 *  ✔ پاسخ صریح JSON ({ok:true} یا {ok:false,error}) تا گوشی خطا را «ارسال‌شده» حساب نکند.
 *  ✔ قفل (LockService) فقط دور نوشتن ردیف شیت (و ساخت پوشه جدید)؛ آپلود عکس‌ها بدون قفل و هم‌زمان انجام می‌شود.
 *  ✔ ارسال دسته‌ای (submitBatch)، Cache شناسه پوشه‌ها، نوشتن همه ردیف‌ها با یک setValues.
 *  ✔ توکن مشترک (APP_TOKEN): درخواست‌های بیرونی بدون توکن رد می‌شوند.
 *  ✔ عکس‌ها با «همان نامی که گوشی ساخته» (شماره‌اشتراک.jpg یا شماره‌اشتراک_۱.jpg …) در پوشه تاریخ/کاربر ذخیره می‌شوند.
 *  ✔ ابتدا عکس‌ها، سپس ردیف شیت؛ اگر آپلود عکس خطا بدهد ردیفی ثبت نمی‌شود و گوشی بعداً دوباره می‌فرستد.
 *  ✔ اشتراک به‌صورت متن ذخیره می‌شود (صفر ابتدای عدد حذف نمی‌شود).
 *
 * نسخه ۴.۱ — اکشن‌های ادمین (گزارش‌گیری از همه اکیپ‌ها):
 *  ✔ listRecords       فهرست رکوردها با فیلتر (تاریخ، اکیپ، نوع عملیات، امور، اشتراک) + لینک عکس‌ها
 *  ✔ getSummary        جمع تعداد/مبلغ به تفکیک نوع عملیات، اکیپ و امور
 *  ✔ getPhotos         چند عکس (با شناسه فایل) به‌صورت base64 — گوشی ادمین ZIP + Excel را خودش می‌سازد و دانلود می‌کند
 *  ✔ signPhotos        (نسخه ۴.۲) یک‌بار مجاز بودن شناسه‌ها را با شیت می‌سنجد و برای هر کدام امضا می‌دهد؛
 *                      getPhotos با امضا دیگر کل شیت را نمی‌خواند و عکس‌ها را هم‌زمان (UrlFetchApp.fetchAll) می‌گیرد
 *  ✔ listRecords       پارامترهای اختیاری: noLinks (بدون لینک عکس‌ها = سبک‌تر) و withSummary (جمع‌ها در همان پاسخ)
 *  ✔ همهٔ پاسخ‌های ادمین فیلد ms (زمان اجرای سرور، میلی‌ثانیه) دارند
 *  ✔ این اکشن‌ها علاوه بر APP_TOKEN، «ADMIN_KEY» هم می‌خواهند (باید با رمز ورود ادمین یکی باشد)
 *  ✔ ستون‌های قبلی شیت دست‌نخورده‌اند؛ فقط ستون «توضیحات» به انتها (ستون ۲۲) اضافه شده است.
 *  ✔ ستون ۸ حالا «شهر/بخش» است و ستون «آبادی» به انتها (ستون ۲۳) اضافه شده است.
 *
 * نسخه ۴.۷ — myRecords: «بازیابی از سرور» (برای هر اکیپ؛ فقط توکن برنامه + کد کاربر) رکوردهای ۶۰ روز اخیر همان کاربر را (بدون عکس/لینک) برمی‌گرداند
 *  تا بعد از پاک شدن اطلاعات برنامه، بایگانی و «اخطارهای در جریان» دوباره ساخته شود.
 *
 * نسخه ۴.۶ — اخطارها: دو ستون جدید «مهلت اخطار» (۲۴) و «وضعیت» (۲۵)؛ رکورد تعیین‌تکلیف (resolvesUid) وضعیت اخطار اصلی را «تعیین تکلیف با …» می‌کند؛
 *  groupReport اخطارها را از عملکرد جدا می‌کند (در جریان / پایان مهلت / تعیین تکلیف شده)؛ وضعیت «پایان مهلت» با زمان ثبت + مهلت محاسبه می‌شود.
 *
 * نسخه ۴.۵: groupReport نتیجه را ۵ دقیقه Cache می‌کند و زمان مرحله‌ها (t) را برمی‌گرداند؛ بررسی سرستون‌های شیت دیگر در هر درخواست انجام نمی‌شود.
 *
 * نسخه ۴.۴ — گزارش سریع:
 *  ✔ groupReport       خلاصهٔ ۶ عملیات برای کل و به تفکیک امور / شهر-بخش / سرگروه در «یک» عبور روی شیت (بدون ساخت ردیف‌ها)؛
 *                      قانون اشتراک تکراری مثل برنامه: مبلغ «وصول» اول، بعد بزرگ‌ترین مبلغ. پاسخ فقط چند کیلوبایت است
 *                      → PDF خلاصه و گزارش نمایشی ادمین
 *  ✔ listRecords       (برای Excel/ZIP) سریع‌تر: ستون‌های لینک عکس وقتی لازم نیست خوانده نمی‌شوند و فرمت تاریخ سریع‌تر است
 */

// ============ تنظیمات (حتماً تغییر دهید) ============
const SETTINGS = {
  SHEET_ID: "1shnPofOEprB-fepgJuDnvXUlH3-cnft4YzP_nZkebmA",              // آیدی گوگل شیت
  DRIVE_FOLDER_ID: "170oi_49NgrPdCy3b--RpkzVLPB_-UvX_",          // آیدی پوشه اصلی عکس‌ها در Drive (خالی = ساخت خودکار در ریشه Drive)
  APP_TOKEN: "09172209668",          // باید دقیقاً با server.token در config/app.config.js یکی باشد
  SHEET_NAME: "ثبت‌ها",
  ROOT_FOLDER_NAME: "عکس‌های وصول مطالبات",
  SHARE_PHOTOS_PUBLIC: false,                   // true = هر کس لینک را داشته باشد می‌تواند عکس را ببیند
  MAX_PHOTOS: 8,
  // رمز ادمین: باید دقیقاً با "pass" کاربر ادمین در config/users.json یکی باشد.
  // (چون APP_TOKEN داخل برنامه‌ی همه اکیپ‌ها هست، اکشن‌های گزارش بدون این رمز کار نمی‌کنند.)
  ADMIN_KEY: "admin1405",
  WARNING_TITLE: "صدور اخطار",   // باید دقیقاً با MODES.warning.title در config/modes.js یکی باشد (اخطارها در گزارش از عملکرد جدا می‌شوند)
  COLLECT_TITLE: "وصول مطالبات", // باید دقیقاً با MODES.collect.title در config/modes.js یکی باشد (اولویت مبلغ در اشتراک تکراری)
  MAX_LIST: 800,            // سقف پیش‌فرض تعداد ردیف در listRecords
  PHOTOS_PER_CALL: 20,      // حداکثر تعداد عکس در هر درخواست getPhotos (عکس‌ها هم‌زمان خوانده می‌شوند)
  MAX_BATCH: 5,             // حداکثر تعداد رکورد در هر درخواست submitBatch
  MY_DAYS: 60,              // «بازیابی از سرور»: پیش‌فرض چند روز اخیر
  MY_DAYS_MAX: 120,         // بیشترین بازهٔ قابل درخواست (روز)
  MY_LIMIT: 3000,           // سقف تعداد رکورد در یک بازیابی
};
// ====================================================

const HEADERS = [
  "زمان ثبت سرور", "شناسه یکتا (uid)", "کد کاربر", "نام کاربر", "نوع عملیات", "تاریخ شمسی",
  "امور", "شهر/بخش", "سرگروه", "شماره اشتراک", "مبلغ", "تعداد عکس", "نام فایل عکس‌ها",
  "عرض جغرافیایی", "طول جغرافیایی", "دقت GPS (متر)", "زمان ثبت در گوشی",
  "لینک عکس ۱", "لینک عکس ۲", "لینک عکس ۳", "لینک عکس ۴",
  "توضیحات", // ستون ۲۲ (انتهای جدول تا ستون‌های قبلی جابه‌جا نشوند)
  "آبادی",   // ستون ۲۳
  "مهلت اخطار", // ستون ۲۴ — فقط برای «صدور اخطار» (مثلاً «۲۴ ساعت»)
  "وضعیت",      // ستون ۲۵ — اخطار: «در جریان» ← «پایان مهلت» ← «تعیین تکلیف با …» ؛ رکورد تعیین‌تکلیف: «تعیین تکلیف شده از صدور اخطار»
];
const DEADLINE_COL = 24;
const STATUS_COL = 25;
const ST_OPEN = "در جریان";
const ST_EXPIRED = "پایان مهلت";
const ST_RESOLVED_PREFIX = "تعیین تکلیف با ";
const ST_FROM_WARNING = "تعیین تکلیف شده از صدور اخطار";
const UID_COL = 2;
const USERCODE_COL = 3;
const DATE_COL = 6;
const ESHTERAK_COL = 10;

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return json_({ ok: true, app: "collection-app-server", version: 47, time: new Date().toISOString() });
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    if (data.token !== SETTINGS.APP_TOKEN) return json_({ ok: false, error: "توکن نامعتبر است" });
    // اکشن‌های ادمین (فقط خواندن؛ بدون قفل)
    if (ADMIN_ACTIONS_[data.action]) {
      checkAdmin_(data);
      return json_(ADMIN_ACTIONS_[data.action](data));
    }
    // ارسال یک رکورد (سازگار با نسخه‌های قدیمی برنامه)
    if (data.action === "submit") {
      const r = submitBatch_([data])[0];
      return json_(r.ok ? { ok: true, duplicate: !!r.duplicate, ms: r.ms } : { ok: false, error: r.error });
    }
    // ارسال دسته‌ای: چند رکورد در یک درخواست؛ نتیجه هر رکورد جدا برگردانده می‌شود
    if (data.action === "submitBatch") {
      const list = (data.records || []).slice(0, SETTINGS.MAX_BATCH);
      return json_({ ok: true, results: submitBatch_(list) });
    }
    // بازیابی رکوردهای خود کاربر (فقط خواندن؛ بدون قفل)
    if (data.action === "myRecords") return json_(myRecords_(data));
    return json_({ ok: false, error: "action نامعتبر" });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

/**
 * ثبت چند رکورد:
 *  ۱) بدون قفل: اعتبارسنجی، بررسی تکراری، آپلود عکس‌ها در Drive (کندترین بخش — هم‌زمان برای همه اکیپ‌ها)
 *  ۲) فقط برای نوشتن در شیت: قفل کوتاه و یک setValues برای همه ردیف‌ها
 * اگر آپلود عکس‌های یک رکورد خطا بدهد، فقط همان رکورد خطا می‌گیرد و گوشی بعداً دوباره می‌فرستد.
 */
function submitBatch_(list) {
  const cache = CacheService.getScriptCache();
  const results = [], pending = [], resolves = [];

  list.forEach(function (data) {
    const res = { uid: data && data.uid, ok: false };
    results.push(res);
    const t0 = Date.now();
    try {
      validate_(data);
      // retry:false فقط از نسخه جدید برنامه برای «اولین ارسال» می‌آید؛ نسخه‌های قدیمی (بدون این فیلد) محتاطانه مثل ارسال مجدد بررسی می‌شوند
      const retry = data.retry !== false;
      const rv = data.resolvesUid ? { uid: String(data.resolvesUid), title: data.modeTitle, res: res } : null;
      if (cache.get("uid:" + data.uid)) { if (rv) resolves.push(rv); res.ok = true; res.duplicate = true; return; }
      if (retry && uidExists_(data.uid)) {
        cache.put("uid:" + data.uid, "1", 21600);
        if (rv) resolves.push(rv);
        res.ok = true; res.duplicate = true; return;
      }
      const links = uploadPhotos_(data, retry);
      res.ms = { photos: Date.now() - t0 };
      pending.push({ res: res, uid: String(data.uid), row: buildRow_(data, links) });
      if (data.resolvesUid) resolves.push({ uid: String(data.resolvesUid), title: data.modeTitle, res: res });
    } catch (err) {
      res.error = String(err && err.message ? err.message : err);
    }
  });

  if (pending.length) {
    const lock = LockService.getScriptLock();
    const t1 = Date.now();
    try {
      lock.waitLock(60000);
      const sheet = getSheet_();
      ensureFormats_(sheet);
      const start = sheet.getLastRow() + 1;
      const need = start + pending.length - 1 - sheet.getMaxRows();
      if (need > 0) sheet.insertRowsAfter(sheet.getMaxRows(), need + 300);
      sheet.getRange(start, 1, pending.length, HEADERS.length).setValues(pending.map(function (p) { return p.row; }));
      SpreadsheetApp.flush(); // قبل از آزادسازی قفل، تا درخواست بعدی ردیف آخر را درست ببیند
      pending.forEach(function (p) {
        p.res.ok = true;
        if (p.res.ms) p.res.ms.sheet = Date.now() - t1;
        cache.put("uid:" + p.uid, "1", 21600);
      });
    } catch (err) {
      pending.forEach(function (p) { p.res.error = String(err && err.message ? err.message : err); });
    } finally {
      try { lock.releaseLock(); } catch (x) {}
    }
  }
  // اخطارهای اصلی که با این رکوردها تعیین تکلیف شدند (فقط برای رکوردهایی که واقعاً ثبت شدند یا قبلاً ثبت شده بودند)
  const todo = resolves.filter(function (x) { return x.res.ok; });
  if (todo.length) {
    const lock2 = LockService.getScriptLock();
    try {
      lock2.waitLock(30000);
      markResolved_(getSheet_(), todo);
    } catch (err) { /* ادامه */ } finally {
      try { lock2.releaseLock(); } catch (x) {}
    }
  }
  return results;
}

function buildRow_(data, links) {
  return [
    new Date(), data.uid, String(data.userCode || ""), data.userName || "", data.modeTitle || "", String(data.date || ""),
    data.omoor || "", data.city || "", data.leader || "", String(data.eshterak || ""),
    Number(data.amount) || 0, (data.photos || []).length,
    (data.photos || []).map(function (p) { return p.name; }).join(" ، "),
    data.gpsLat == null ? "" : data.gpsLat, data.gpsLng == null ? "" : data.gpsLng,
    data.gpsAccuracy == null ? "" : data.gpsAccuracy, data.createdAt || "",
    links[0] || "", links[1] || "", links[2] || "", links[3] || "",
    String(data.note || "").slice(0, 500),
    String(data.abadi || "").slice(0, 200),
    isWarningTitle_(data.modeTitle) ? String(data.deadlineLabel || "") : "",
    rowStatusOnCreate_(data),
  ];
}

function isWarningTitle_(t) { return normText_(t) === normText_(SETTINGS.WARNING_TITLE); }
/** وضعیت اولیهٔ ردیف: اخطار با مهلت = «در جریان» ؛ رکوردی که اخطاری را تعیین تکلیف کرده = «تعیین تکلیف شده از صدور اخطار» */
function rowStatusOnCreate_(data) {
  if (data.resolvesUid) return ST_FROM_WARNING;
  if (isWarningTitle_(data.modeTitle) && data.deadlineLabel) return ST_OPEN;
  return "";
}
/** زمان (Date یا متن ISO) → میلی‌ثانیه؛ نامعتبر = NaN */
function tsMs_(v) {
  if (v instanceof Date) return v.getTime();
  const t = String(v || "");
  return t ? Date.parse(t) : NaN;
}
/** مهلت (متن مثل «۲۴ ساعت» یا «یک هفته») → ساعت */
function deadlineHours_(v) {
  const t = latin_(v);
  const m = t.match(/(\d+)\s*ساعت/);
  if (m) return Number(m[1]);
  return /هفته/.test(t) ? 168 : 0;
}
/**
 * دستهٔ یک اخطار: "open" (در جریان) | "expired" (پایان مهلت) | "resolved" (تعیین تکلیف شده)
 * مبنا: زمان ثبت در گوشی (createdAt) + مهلت؛ اخطارهای قدیمی بدون مهلت = پایان مهلت.
 * (row = ردیف خام شیت؛ اندیس ۱۶ = زمان ثبت در گوشی، ۲۳ = مهلت، ۲۴ = وضعیت)
 */
function warnBucket_(row, nowMs) {
  const st = normText_(row[24]);
  if (st.indexOf("تعیین تکلیف") === 0) return "resolved";
  const hrs = deadlineHours_(row[23]);
  if (!hrs) return "expired";
  let base = tsMs_(row[16]);
  if (isNaN(base)) base = tsMs_(row[0]); // نبود زمان گوشی: زمان ثبت در سرور
  if (isNaN(base)) return "expired";
  return nowMs >= base + hrs * 3600000 ? "expired" : "open";
}

/** اخطار اصلی را بعد از ثبت عملیات جدید «تعیین تکلیف با …» می‌کند (ردیف با uid پیدا می‌شود؛ نبود ردیف مهم نیست) */
function markResolved_(sheet, items) {
  items.forEach(function (it) {
    try {
      const last = sheet.getLastRow();
      if (last < 2) return;
      const cell = sheet.getRange(2, UID_COL, last - 1, 1).createTextFinder(String(it.uid)).matchEntireCell(true).findNext();
      if (cell) sheet.getRange(cell.getRow(), STATUS_COL).setValue(ST_RESOLVED_PREFIX + String(it.title || "").trim());
    } catch (e) { /* ثبت رکورد جدید به این مورد وابسته نیست */ }
  });
}

/**
 * ظاهر شیت: اخطارهایی که مهلتشان تمام شده در ستون «وضعیت» به «پایان مهلت» تغییر می‌کنند
 * (گزارش‌ها همیشه وضعیت را محاسبه می‌کنند؛ این فقط برای کسی است که خود شیت را می‌بیند). حداکثر هر ۱۵ دقیقه یک بار.
 */
function sweepExpired_() {
  const cache = CacheService.getScriptCache();
  if (cache.get("sweep")) return;
  cache.put("sweep", "1", 900);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) return;
  try {
    const sheet = getSheet_();
    const last = sheet.getLastRow();
    if (last < 2 || sheet.getLastColumn() < STATUS_COL) return;
    const n = last - 1;
    const modes = sheet.getRange(2, 5, n, 1).getValues();
    const created = sheet.getRange(2, 17, n, 1).getValues();
    const dl = sheet.getRange(2, DEADLINE_COL, n, 2).getValues();
    const now = Date.now();
    let changed = 0;
    for (let i = 0; i < n && changed < 300; i++) {
      if (!isWarningTitle_(modes[i][0]) || normText_(dl[i][1]) !== ST_OPEN) continue;
      const hrs = deadlineHours_(dl[i][0]);
      const base = tsMs_(created[i][0]);
      if (!hrs || isNaN(base) || now < base + hrs * 3600000) continue;
      sheet.getRange(2 + i, STATUS_COL).setValue(ST_EXPIRED);
      changed++;
    }
  } catch (e) { /* فقط ظاهر شیت است */ } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

/** آیا این uid قبلاً در شیت ثبت شده؟ (فقط برای ارسال مجدد صدا زده می‌شود) */
function uidExists_(uid) {
  const sheet = getSheet_();
  if (sheet.getLastRow() < 2) return false;
  return !!sheet.getRange(2, UID_COL, sheet.getLastRow() - 1, 1)
    .createTextFinder(String(uid)).matchEntireCell(true).findNext();
}

/**
 * ستون‌های کد کاربر، تاریخ و اشتراک یک بار برای کل ستون «متن» می‌شوند
 * (وگرنه «05» به ۵ و «1405/07/15» به تاریخ میلادی تبدیل می‌شود و فیلتر ادمین خراب می‌شود).
 * دیگر برای هر ردیف جداگانه فرمت نمی‌زنیم.
 */
function ensureFormats_(sheet) {
  const cache = CacheService.getScriptCache();
  if (cache.get("fmt1")) return;
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty("FMT1") !== "1") {
    [USERCODE_COL, DATE_COL, ESHTERAK_COL].forEach(function (col) {
      sheet.getRange(1, col, sheet.getMaxRows(), 1).setNumberFormat("@");
    });
    props.setProperty("FMT1", "1");
  }
  cache.put("fmt1", "1", 21600);
}

function validate_(d) {
  if (!d.uid || String(d.uid).length < 8) throw new Error("uid نامعتبر");
  if (!d.eshterak) throw new Error("شماره اشتراک خالی است");
  if (!d.date) throw new Error("تاریخ خالی است");
  if (d.photos && d.photos.length > SETTINGS.MAX_PHOTOS) throw new Error("تعداد عکس‌ها زیاد است");
}

function getSheet_() {
  const ss = SpreadsheetApp.openById(SETTINGS.SHEET_ID);
  let sheet = ss.getSheetByName(SETTINGS.SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SETTINGS.SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight("bold").setBackground("#0d6efd").setFontColor("white");
    sheet.setFrozenRows(1);
    sheet.setRightToLeft(true);
  } else if (!CacheService.getScriptCache().get("hdr:ok:" + HEADERS.length)) {
    // شیت قدیمی: سرستون‌های جدید («توضیحات» و «آبادی») را در صورت نبودن به انتها اضافه کن
    // (یک‌بار در ۶ ساعت بررسی می‌شود؛ هر بار بررسی چند فراخوانی کند به شیت بود)
    if (sheet.getMaxColumns() < HEADERS.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), HEADERS.length - sheet.getMaxColumns());
    const hdr = sheet.getRange(1, 1, 1, Math.max(1, Math.min(HEADERS.length, sheet.getLastColumn()))).getValues()[0];
    for (let c = 22; c <= HEADERS.length; c++) {
      if (!hdr[c - 1]) {
        sheet.getRange(1, c).setValue(HEADERS[c - 1])
          .setFontWeight("bold").setBackground("#0d6efd").setFontColor("white");
      }
    }
    CacheService.getScriptCache().put("hdr:ok:" + HEADERS.length, "1", 21600);
  }
  return sheet;
}

function child_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function rootFolder_() {
  if (SETTINGS.DRIVE_FOLDER_ID) return DriveApp.getFolderById(SETTINGS.DRIVE_FOLDER_ID);
  const it = DriveApp.getFoldersByName(SETTINGS.ROOT_FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(SETTINGS.ROOT_FOLDER_NAME);
}

/**
 * پوشه «تاریخ/کد کاربر»؛ شناسه‌اش در Cache می‌ماند تا هر بار جست‌وجوی پوشه نکنیم.
 * فقط وقتی پوشه باید ساخته شود قفل کوتاه می‌گیریم (تا دو درخواست هم‌زمان پوشه تکراری نسازند).
 */
function userFolder_(date, userCode) {
  const dateName = String(date).replace(/[\\/]/g, "-");
  const codeName = String(userCode || "نامشخص");
  const cache = CacheService.getScriptCache();
  const key = "fd:" + dateName + "|" + codeName;
  const hit = cache.get(key);
  if (hit) {
    try { return DriveApp.getFolderById(hit); } catch (e) { cache.remove(key); }
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(60000);
  try {
    const f = child_(child_(rootFolder_(), dateName), codeName);
    cache.put(key, f.getId(), 21600);
    return f;
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

/** آپلود عکس‌ها؛ نام فایل همان نام ارسالی از گوشی است. خروجی: آرایه لینک‌ها */
function uploadPhotos_(data, retry) {
  const photos = data.photos || [];
  if (!photos.length) return [];
  const userFolder = userFolder_(data.date, data.userCode);
  const links = [];
  photos.forEach(function (p) {
    const name = String(p.name || "photo.jpg").replace(/[\\/:*?"<>|]/g, "");
    // فقط در ارسال مجدد: فایل قبلی با همین نام جایگزین می‌شود، نه تکراری (در ارسال اول جست‌وجو لازم نیست)
    if (retry) {
      const old = userFolder.getFilesByName(name);
      while (old.hasNext()) old.next().setTrashed(true);
    }
    const blob = Utilities.newBlob(Utilities.base64Decode(p.data), p.type || "image/jpeg", name);
    const file = userFolder.createFile(blob);
    if (SETTINGS.SHARE_PHOTOS_PUBLIC) file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    links.push(file.getUrl());
  });
  return links;
}

/** اجرای دستی یک‌باره برای گرفتن مجوزهای Drive/Sheets (در ادیتور اجرا کنید) */
function authorize() {
  const sheet = getSheet_();
  rootFolder_();
  ensureFormats_(sheet);
  LockService.getScriptLock();
  CacheService.getScriptCache();
  // نسخهٔ ۴.۲: دریافت سریع عکس‌ها از Drive API؛ این خط مجوز UrlFetchApp را هم می‌گیرد و دسترسی را می‌آزماید
  try {
    const r = UrlFetchApp.fetch("https://www.googleapis.com/drive/v3/about?fields=user",
      { headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
    Logger.log("Drive API: HTTP " + r.getResponseCode());
  } catch (e) { Logger.log("Drive API در دسترس نیست (دریافت عکس با روش قدیمی ادامه می‌یابد): " + e); }
  Logger.log("OK");
}


/* ═══════════════════════════════════════════════════════════
 * اکشن‌های ادمین
 * ═══════════════════════════════════════════════════════════ */

const ADMIN_ACTIONS_ = {
  listRecords: listRecords_,
  getSummary: getSummary_,
  getPhotos: getPhotos_,
  signPhotos: signPhotos_,
  groupReport: groupReport_,
};

function checkAdmin_(data) {
  const key = SETTINGS.ADMIN_KEY;
  if (!key || key === "CHANGE_ME_ADMIN_KEY") throw new Error("ADMIN_KEY در اسکریپت سرور تنظیم نشده است");
  if (String(data.adminKey || "") !== String(key)) throw new Error("رمز ادمین نامعتبر است");
}

/** ارقام فارسی/عربی → لاتین */
function latin_(v) {
  return String(v == null ? "" : v)
    .replace(/[۰-۹]/g, function (d) { return "۰۱۲۳۴۵۶۷۸۹".indexOf(d); })
    .replace(/[٠-٩]/g, function (d) { return "٠١٢٣٤٥٦٧٨٩".indexOf(d); });
}
/** نرمال‌سازی متن برای مقایسه (ی/ک عربی، فاصله‌ها، نیم‌فاصله) */
function normText_(v) {
  return latin_(v).replace(/ي/g, "ی").replace(/ك/g, "ک").replace(/\u200c/g, " ").replace(/\s+/g, " ").trim();
}
/**
 * قالب‌دهی تاریخ؛ Utilities.formatDate برای هزاران ردیف کند است، پس روش مستقیم (getFullYear و …) به‌کار می‌رود.
 * ۵ بار اول نتیجهٔ دو روش مقایسه می‌شود؛ اگر هر بار یکی نبود (منطقهٔ زمانی متفاوت) همیشه روش رسمی می‌ماند.
 */
const FMT_ = { tz: null, ok: {}, n: {} };
function fmtDate_(d, pat) {
  if (!FMT_.tz) FMT_.tz = Session.getScriptTimeZone();
  if (FMT_.ok[pat] === false) return Utilities.formatDate(d, FMT_.tz, pat);
  const p2 = function (n) { return (n < 10 ? "0" : "") + n; };
  let fast;
  if (pat === "yyyy/MM/dd") fast = d.getFullYear() + "/" + p2(d.getMonth() + 1) + "/" + p2(d.getDate());
  else if (pat === "yyyy-MM-dd HH:mm:ss") fast = d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()) + " " + p2(d.getHours()) + ":" + p2(d.getMinutes()) + ":" + p2(d.getSeconds());
  else return Utilities.formatDate(d, FMT_.tz, pat);
  if ((FMT_.n[pat] || 0) < 5) {
    FMT_.n[pat] = (FMT_.n[pat] || 0) + 1;
    const slow = Utilities.formatDate(d, FMT_.tz, pat);
    if (slow !== fast) { FMT_.ok[pat] = false; return slow; }
    return slow;
  }
  return fast;
}

/** کلید عددی تاریخ شمسی: 1405/07/15 → 14050715 (نامعتبر = 0) */
function dateKey_(v) {
  if (v instanceof Date) v = fmtDate_(v, "yyyy/MM/dd");
  const m = latin_(v).match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  return m ? Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]) : 0;
}
function dateText_(v) {
  if (v instanceof Date) return fmtDate_(v, "yyyy/MM/dd");
  return latin_(v);
}
/** کد اکیپ: «05» و ۵ یکی حساب شوند */
function codeKey_(v) {
  const t = latin_(v).trim();
  return /^\d+$/.test(t) ? String(Number(t)) : t.toLowerCase();
}
function code2_(v) {
  const t = latin_(v).trim();
  return /^\d$/.test(t) ? "0" + t : t;
}

/** فایل‌های ردیف شیت → آبجکت رکورد */
function rowToRecord_(row, noLinks) {
  const links = [];
  if (!noLinks) for (let i = 17; i <= 20; i++) if (row[i]) links.push(String(row[i])); // noLinks=true → پاسخ سبک‌تر و سریع‌تر
  const t = row[0];
  return {
    serverTime: t instanceof Date ? fmtDate_(t, "yyyy-MM-dd HH:mm:ss") : String(t || ""),
    uid: String(row[1] || ""),
    userCode: code2_(row[2]),
    userName: String(row[3] || ""),
    modeTitle: String(row[4] || ""),
    date: dateText_(row[5]),
    omoor: String(row[6] || ""),
    city: String(row[7] || ""),
    leader: String(row[8] || ""),
    eshterak: String(row[9] || ""),
    amount: Number(row[10]) || 0,
    photoCount: Number(row[11]) || 0,
    photoNames: String(row[12] || ""),
    gpsLat: row[13] === "" ? null : row[13],
    gpsLng: row[14] === "" ? null : row[14],
    gpsAccuracy: row[15] === "" ? null : row[15],
    createdAt: String(row[16] || ""),
    photoLinks: links,
    note: String(row[21] || ""),
    abadi: String(row[22] || ""),
    deadline: String(row[23] || ""),
    warnStatus: warnStatusText_(row),
  };
}
/** وضعیت اخطار برای نمایش (محاسبه‌شده با زمان فعلی)؛ برای رکوردهای غیراخطار همان متن ستون وضعیت */
function warnStatusText_(row) {
  if (!isWarningTitle_(row[4])) return String(row[24] || "");
  const b = warnBucket_(row, Date.now());
  return b === "open" ? ST_OPEN : b === "expired" ? ST_EXPIRED : String(row[24] || "");
}

/**
 * خواندن بلوک ردیف‌ها از شیت:
 *  "all" = همهٔ ستون‌ها | "nolinks" = بدون ۴ ستون لینک عکس (سبک‌تر؛ برای Excel) | "agg" = فقط ۱۱ ستون اول (برای جمع‌ها)
 */
function readBlock_(sheet, startRow, count, mode) {
  if (mode === "agg") {
    // ۱۱ ستون اول + زمان ثبت در گوشی (ستون ۱۷) + مهلت و وضعیت اخطار (ستون ۲۴ و ۲۵) برای جدا کردن اخطارها
    const a = sheet.getRange(startRow, 1, count, 11).getValues();
    const b = sheet.getRange(startRow, 17, count, 1).getValues();
    const hasC = sheet.getLastColumn() >= STATUS_COL;
    const c = hasC ? sheet.getRange(startRow, DEADLINE_COL, count, 2).getValues() : null;
    for (let i = 0; i < count; i++) {
      const row = a[i];
      row.push("", "", "", "", "");            // اندیس ۱۱ تا ۱۵
      row.push(b[i][0]);                       // ۱۶
      row.push("", "", "", "", "", "");        // ۱۷ تا ۲۲
      row.push(hasC ? c[i][0] : "", hasC ? c[i][1] : ""); // ۲۳ و ۲۴
    }
    return a;
  }
  if (mode === "nolinks") {
    const a = sheet.getRange(startRow, 1, count, 17).getValues();
    const b = sheet.getRange(startRow, 22, count, HEADERS.length - 21).getValues();
    for (let i = 0; i < count; i++) {
      const row = a[i];
      row.push("", "", "", ""); // جای خالی ستون‌های ۱۸ تا ۲۱ (لینک‌ها) تا اندیس ستون‌های بعدی همان بماند
      for (let k = 0; k < b[i].length; k++) row.push(b[i][k]);
    }
    return a;
  }
  return sheet.getRange(startRow, 1, count, HEADERS.length).getValues();
}

/** خواندن و فیلتر ردیف‌های خام؛ جدیدترین اول (mode: روش خواندن ستون‌ها، بالا) */
function filterRows_(data, mode, tm, sheet0) {
  tm = tm || {};
  let tp = Date.now();
  const lap = function (k) { const n = Date.now(); tm[k] = (tm[k] || 0) + (n - tp); tp = n; };
  const sheet = sheet0 || getSheet_();
  lap("open");
  const last = sheet.getLastRow();
  if (last < 2) return [];
  const n = last - 1;

  const from = data.fromDate ? dateKey_(data.fromDate) : 0;
  const to = data.toDate ? dateKey_(data.toDate) : 99999999;
  const lo = Math.min(from, to), hi = Math.max(from, to);

  // با فیلتر تاریخ: ابتدا فقط ستون تاریخ خوانده می‌شود و فقط بلوک ردیف‌های همان بازه کامل خوانده می‌شود
  // (ردیف‌ها تقریباً به ترتیب زمان ثبت می‌آیند؛ ردیف‌های بیرون بلوک هرگز با فیلتر تاریخ جور نبودند)
  let offset = 0, count = n;
  if (data.fromDate || data.toDate) {
    const dcol = sheet.getRange(2, DATE_COL, n, 1).getValues();
    let first = -1, lastHit = -1;
    for (let i = 0; i < n; i++) {
      const k = dateKey_(dcol[i][0]);
      if (k < lo || k > hi) continue;
      if (first < 0) first = i;
      lastHit = i;
    }
    if (first < 0) return [];
    offset = first;
    count = lastHit - first + 1;
  }
  lap("scan");
  const rows = readBlock_(sheet, 2 + offset, count, mode || "all");
  lap("read");
  tm.rows = rows.length;

  const wantCode = data.userCode ? codeKey_(data.userCode) : "";
  const wantMode = data.modeTitle ? normText_(data.modeTitle) : "";
  const wantOmoor = data.omoor ? normText_(data.omoor) : "";
  const wantEsh = data.eshterak ? latin_(data.eshterak).replace(/\D/g, "") : "";

  const out = [];
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (!r[1]) continue; // ردیف بدون uid
    if (data.fromDate || data.toDate) {
      const k = dateKey_(r[5]);
      if (k < lo || k > hi) continue;
    }
    if (wantCode && codeKey_(r[2]) !== wantCode) continue;
    if (wantMode && normText_(r[4]) !== wantMode) continue;
    if (wantOmoor && normText_(r[6]) !== wantOmoor) continue;
    if (wantEsh && latin_(r[9]).replace(/\D/g, "") !== wantEsh) continue;
    out.push(r);
  }
  lap("filter");
  return out;
}

/** رکوردهای فیلترشده (آبجکت) — جدیدترین اول */
function filterRecords_(data, noLinks) {
  return filterRows_(data, noLinks ? "nolinks" : "all").map(function (r) { return rowToRecord_(r, noLinks); });
}

/* ───────── گزارش گروهی (PDF خلاصه و گزارش نمایشی ادمین) ───────── */

/**
 * بهترین مبلغ هر اشتراک — دقیقاً مثل dedupAmount در برنامه (src/modules/records.js):
 * مبلغ «وصول مطالبات» (بزرگ‌تر از صفر) بر بقیه می‌چربد؛ بین هم‌رده‌ها بزرگ‌ترین مبلغ.
 */
function bestPut_(map, key, amt, isCollect) {
  const cur = map[key];
  if (!cur || (isCollect && !cur.c) || (isCollect === cur.c && amt > cur.a)) map[key] = { a: amt, c: isCollect };
}
function bestSum_(map) {
  let s = 0;
  for (const k in map) s += map[k].a;
  return s;
}
function newGroup_() { return { count: 0, modes: {}, follow: {}, warn: {} }; }
function addToGroup_(g, title, isColl, key, amt, wb) {
  g.count++;
  if (wb) {
    // اخطارها از عملکرد جدا هستند: به‌تفکیک در جریان / پایان مهلت / تعیین تکلیف شده؛ مبلغ هر دسته بدون تکرار اشتراک
    const w = g.warn[wb] || (g.warn[wb] = { count: 0, best: {} });
    w.count++;
    bestPut_(w.best, key, amt, false);
    return;
  }
  const m = g.modes[title] || (g.modes[title] = { count: 0, best: {} });
  m.count++;
  bestPut_(m.best, key, amt, isColl && amt > 0);
  if (!isColl) bestPut_(g.follow, key, amt, false); // «پیگیری‌شده» = قطع/فک پلمپ/مسدودی (بدون اخطار و بدون وصول)، بدون تکرار اشتراک
}
function finishGroup_(g, collectKey, name, sub) {
  const modes = {};
  for (const t in g.modes) modes[t] = { count: g.modes[t].count, amount: bestSum_(g.modes[t].best) };
  const out = {
    count: g.count,
    collectTotal: g.modes[collectKey] ? bestSum_(g.modes[collectKey].best) : 0,
    followedTotal: bestSum_(g.follow),
    modes: modes,
    warn: {},
  };
  ["open", "expired", "resolved"].forEach(function (k) {
    out.warn[k] = g.warn[k] ? { count: g.warn[k].count, amount: bestSum_(g.warn[k].best) } : { count: 0, amount: 0 };
  });
  if (name !== undefined) out.name = name;
  if (sub) out.sub = sub;
  return out;
}

/** ردیف‌های خام (۱۱ ستون اول) → جمع کل و جمع به تفکیک امور / شهر-بخش / سرگروه */
function aggregateRows_(rows) {
  const collectKey = normText_(SETTINGS.COLLECT_TITLE);
  const warnKey = normText_(SETTINGS.WARNING_TITLE);
  const now = Date.now();
  const all = newGroup_();
  const views = { omoor: {}, city: {}, leader: {} };
  function slot(view, k, name, sub) {
    return views[view][k] || (views[view][k] = { name: name, sub: sub, g: newGroup_() });
  }
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const title = normText_(r[4]);
    const isColl = title === collectKey;
    const wb = title === warnKey ? warnBucket_(r, now) : "";
    const amt = Number(r[10]) || 0;
    const key = "k" + (latin_(r[9]).replace(/\D/g, "") || "_" + r[1]);
    const omoor = normText_(r[6]) || "—", city = normText_(r[7]) || "—", leader = normText_(r[8]) || "—";
    addToGroup_(all, title, isColl, key, amt, wb);
    addToGroup_(slot("omoor", omoor, omoor).g, title, isColl, key, amt, wb);
    addToGroup_(slot("city", omoor + "|" + city, city, omoor).g, title, isColl, key, amt, wb);
    addToGroup_(slot("leader", leader, leader).g, title, isColl, key, amt, wb);
  }
  const groups = {};
  for (const v in views) {
    const list = [];
    for (const k in views[v]) list.push(finishGroup_(views[v][k].g, collectKey, views[v][k].name, views[v][k].sub));
    list.sort(function (a, b) { return b.count - a.count || String(a.name).localeCompare(String(b.name)); });
    groups[v] = list;
  }
  return { count: all.count, all: finishGroup_(all, collectKey), groups: groups };
}

function groupReport_(data) {
  const t0 = Date.now();
  const cache = CacheService.getScriptCache();
  // نتیجهٔ همین فیلتر تا ۵ دقیقه (تا وقتی تعداد ردیف‌های شیت عوض نشده) در Cache می‌ماند؛ fresh:true آن را نادیده می‌گیرد
  const keyRaw = [data.fromDate, data.toDate, data.userCode, data.modeTitle, data.omoor, data.eshterak].join("|");
  const key = "gr:" + Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, keyRaw, Utilities.Charset.UTF_8));
  const tm = {};
  const sheet0 = getSheet_();
  tm.open = Date.now() - t0;
  const last = sheet0.getLastRow();
  if (!data.fresh) {
    const hit = cache.get(key);
    if (hit) {
      try {
        const o = JSON.parse(hit);
        if (o.last === last) { o.res.cached = true; o.res.ms = Date.now() - t0; o.res.t = { open: tm.open }; return o.res; }
      } catch (e) { /* ادامه بدون Cache */ }
    }
  }
  const rows = filterRows_(data, "agg", tm, sheet0);
  const t1 = Date.now();
  const out = aggregateRows_(rows);
  tm.agg = Date.now() - t1;
  out.ok = true;
  out.t = tm; // زمان مرحله‌ها (میلی‌ثانیه): باز کردن شیت / خواندن ستون تاریخ / خواندن ردیف‌ها / فیلتر / جمع‌زدن؛ rows = تعداد ردیف
  out.ms = Date.now() - t0;
  try {
    const txt = JSON.stringify({ last: last, res: out });
    if (txt.length < 95000) cache.put(key, txt, 300);
  } catch (e) { /* Cache اختیاری است */ }
  sweepExpired_();
  return out;
}

function summarize_(all) {
  const out = { ok: true, totalCount: all.length, totalAmount: 0, byMode: {}, byUser: {}, byOmoor: {} };
  function add(map, key, amount) {
    key = key || "—";
    if (!map[key]) map[key] = { count: 0, amount: 0 };
    map[key].count++;
    map[key].amount += amount;
  }
  all.forEach(function (r) {
    out.totalAmount += r.amount;
    add(out.byMode, r.modeTitle, r.amount);
    add(out.byUser, r.userName || r.userCode, r.amount);
    add(out.byOmoor, r.omoor, r.amount);
  });
  return out;
}

function listRecords_(data) {
  const t0 = Date.now();
  const all = filterRecords_(data, data.noLinks === true);
  const limit = Math.min(Math.max(Number(data.limit) || SETTINGS.MAX_LIST, 1), 20000);
  const out = { ok: true, total: all.length, truncated: all.length > limit, records: all.slice(0, limit) };
  if (data.withSummary === true) out.summary = summarize_(all); // جمع‌ها در همان پاسخ (یک خواندن شیت به‌جای دو)
  out.ms = Date.now() - t0;
  sweepExpired_();
  return out;
}

/**
 * «بازیابی از سرور»: رکوردهای N روز اخیر «همان کاربر» (بر اساس زمان ثبت در سرور) — بدون لینک عکس.
 * فقط ردیف‌های انتهای شیت خوانده می‌شوند (ردیف‌ها به ترتیب زمان ثبت هستند)؛ پاسخ جدیدترین اول.
 * وضعیت اخطار (در جریان / پایان مهلت / تعیین تکلیف با …) همان لحظه محاسبه می‌شود (warnStatus).
 */
function myRecords_(data) {
  const t0 = Date.now();
  const code = codeKey_(data.userCode);
  if (!code) return { ok: false, error: "کد کاربر مشخص نیست" };
  const days = Math.min(Math.max(Number(data.days) || SETTINGS.MY_DAYS, 1), SETTINGS.MY_DAYS_MAX);
  const cutoff = Date.now() - days * 86400000;
  const sheet = getSheet_();
  const last = sheet.getLastRow();
  if (last < 2) return { ok: true, days: days, total: 0, records: [], ms: Date.now() - t0 };
  const n = last - 1;
  // ستون زمان ثبت سرور: اولین ردیفی که از cutoff جدیدتر است (از انتها به عقب؛ نزدیک به انتها می‌ایستد)
  const tcol = sheet.getRange(2, 1, n, 1).getValues();
  let first = n;
  for (let i = n - 1; i >= 0; i--) {
    const t = tcol[i][0];
    if (t instanceof Date && t.getTime() < cutoff) break;
    first = i;
  }
  const count = n - first;
  const out = [];
  if (count > 0) {
    const rows = readBlock_(sheet, 2 + first, count, "nolinks");
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i];
      if (!r[1] || codeKey_(r[2]) !== code) continue;
      out.push(rowToRecord_(r, true));
      if (out.length >= SETTINGS.MY_LIMIT) break;
    }
  }
  return { ok: true, days: days, total: out.length, records: out, ms: Date.now() - t0 };
}

function getSummary_(data) {
  const t0 = Date.now();
  const out = summarize_(filterRecords_(data, true));
  out.ms = Date.now() - t0;
  return out;
}

function fileIdFromUrl_(url) {
  const m = String(url).match(/[-\w]{25,}/);
  return m ? m[0] : "";
}

/** مجموعهٔ شناسه فایل‌های ثبت‌شده در شیت (فقط همین‌ها قابل خواندن‌اند) */
function allowedIds_() {
  const allowed = {};
  const sheet = getSheet_();
  const last = sheet.getLastRow();
  if (last > 1) {
    sheet.getRange(2, 18, last - 1, 4).getValues().forEach(function (row) {
      row.forEach(function (u) { const id = fileIdFromUrl_(u); if (id) allowed[id] = true; });
    });
  }
  return allowed;
}

/** امضای کوتاه یک شناسه فایل (HMAC با رمز ادمین) — بدون رمز ادمین قابل ساختن نیست */
function sigOf_(id) {
  const raw = Utilities.computeHmacSha256Signature(String(id), String(SETTINGS.ADMIN_KEY) + "|photo");
  return Utilities.base64EncodeWebSafe(raw).slice(0, 22);
}

/**
 * مرحلهٔ اول دانلود ZIP: شناسه‌ها را یک‌بار با شیت می‌سنجد و برای مجازها امضا می‌دهد.
 * بعد getPhotos با {files:[{id,sig}]} دیگر نیازی به خواندن شیت ندارد.
 */
function signPhotos_(data) {
  const t0 = Date.now();
  const ids = (data.fileIds || []).slice(0, 3000).map(String);
  const allowed = allowedIds_();
  const sigs = {}, missing = [];
  ids.forEach(function (id) { if (allowed[id]) sigs[id] = sigOf_(id); else missing.push(id); });
  return { ok: true, sigs: sigs, missing: missing, perCall: SETTINGS.PHOTOS_PER_CALL, ms: Date.now() - t0 };
}

/** خواندن هم‌زمان چند فایل از Drive API؛ هر فایلی که نیامد با DriveApp (روش قدیمی) تلاش مجدد می‌شود */
function readPhotos_(ids) {
  const got = {};
  let token = "";
  try { token = ScriptApp.getOAuthToken(); } catch (e) { token = ""; }
  if (token && ids.length) {
    try {
      const reqs = ids.map(function (id) {
        return {
          url: "https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(id) + "?alt=media&supportsAllDrives=true",
          headers: { Authorization: "Bearer " + token },
          muteHttpExceptions: true,
        };
      });
      UrlFetchApp.fetchAll(reqs).forEach(function (r, i) {
        if (r.getResponseCode() !== 200) return;
        const hdr = r.getHeaders() || {};
        const ct = String(hdr["Content-Type"] || hdr["content-type"] || "image/jpeg").split(";")[0];
        got[ids[i]] = { id: ids[i], name: "", type: ct, data: Utilities.base64Encode(r.getContent()) };
      });
    } catch (e) { /* مجوز UrlFetchApp/Drive API نیست → روش قدیمی */ }
  }
  const photos = [], missing = [];
  ids.forEach(function (id) {
    if (got[id]) { photos.push(got[id]); return; }
    try {
      const b = DriveApp.getFileById(id).getBlob();
      photos.push({ id: id, name: b.getName(), type: b.getContentType(), data: Utilities.base64Encode(b.getBytes()) });
    } catch (e) { missing.push(id); }
  });
  return { photos: photos, missing: missing, fast: Object.keys(got).length };
}

/**
 * چند عکس را با شناسه فایل برمی‌گرداند (base64).
 * دو روش:
 *  • جدید: data.files = [{id, sig}] — امضا از signPhotos؛ بدون خواندن شیت
 *  • قدیمی (سازگار با برنامهٔ نسخه‌های قبل): data.fileIds — فقط فایل‌هایی مجازند که لینکشان در شیت ثبت شده است
 * با رمز ادمین هم نمی‌شود فایل دلخواه Drive را خواند.
 */
function getPhotos_(data) {
  const t0 = Date.now();
  const max = SETTINGS.PHOTOS_PER_CALL;
  const bad = [];
  let ids = [];
  if (data.files && data.files.length) {
    data.files.slice(0, max).forEach(function (f) {
      const id = String(f && f.id || "");
      if (id && f.sig && String(f.sig) === sigOf_(id)) ids.push(id); else if (id) bad.push(id);
    });
  } else {
    const req = (data.fileIds || []).slice(0, max).map(String);
    if (!req.length) return { ok: true, photos: [], missing: [], ms: 0 };
    const allowed = allowedIds_();
    req.forEach(function (id) { if (allowed[id]) ids.push(id); else bad.push(id); });
  }
  const r = ids.length ? readPhotos_(ids) : { photos: [], missing: [], fast: 0 };
  return { ok: true, photos: r.photos, missing: r.missing.concat(bad), fast: r.fast, ms: Date.now() - t0 };
}
