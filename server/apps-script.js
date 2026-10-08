/**
 * Google Apps Script — سرور دریافت اطلاعات اکیپ‌ها (نسخه ۴)
 * ─────────────────────────────────────────────────────────
 * این فایل را در script.google.com جایگزین Code.gs کنید و بعد Deploy → Web app.
 *
 * بهبودها نسبت به نسخه قبل:
 *  ✔ ثبت تکراری ندارد: هر رکورد uid دارد؛ اگر گوشی به‌خاطر قطعی اینترنت دوباره بفرستد، ردیف دوم ساخته نمی‌شود.
 *  ✔ پاسخ صریح JSON ({ok:true} یا {ok:false,error}) تا گوشی خطا را «ارسال‌شده» حساب نکند.
 *  ✔ قفل (LockService): وقتی ۳۰ تا ۵۰ نفر هم‌زمان می‌فرستند، ردیف‌ها و پوشه‌ها قاطی/تکراری نمی‌شوند.
 *  ✔ توکن مشترک (APP_TOKEN): درخواست‌های بیرونی بدون توکن رد می‌شوند.
 *  ✔ عکس‌ها با «همان نامی که گوشی ساخته» (شماره‌اشتراک.jpg یا شماره‌اشتراک_۱.jpg …) در پوشه تاریخ/کاربر ذخیره می‌شوند.
 *  ✔ ابتدا عکس‌ها، سپس ردیف شیت؛ اگر آپلود عکس خطا بدهد ردیفی ثبت نمی‌شود و گوشی بعداً دوباره می‌فرستد.
 *  ✔ اشتراک به‌صورت متن ذخیره می‌شود (صفر ابتدای عدد حذف نمی‌شود).
 *
 * نسخه ۴.۱ — اکشن‌های ادمین (گزارش‌گیری از همه اکیپ‌ها):
 *  ✔ listRecords       فهرست رکوردها با فیلتر (تاریخ، اکیپ، نوع عملیات، امور، اشتراک) + لینک عکس‌ها
 *  ✔ getSummary        جمع تعداد/مبلغ به تفکیک نوع عملیات، اکیپ و امور
 *  ✔ getPhotos         چند عکس (با شناسه فایل) به‌صورت base64 — گوشی ادمین ZIP + Excel را خودش می‌سازد و دانلود می‌کند
 *  ✔ این اکشن‌ها علاوه بر APP_TOKEN، «ADMIN_KEY» هم می‌خواهند (باید با رمز ورود ادمین یکی باشد)
 *  ✔ ستون‌های قبلی شیت دست‌نخورده‌اند؛ فقط ستون «توضیحات» به انتها (ستون ۲۲) اضافه شده است.
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
  MAX_LIST: 800,            // سقف پیش‌فرض تعداد ردیف در listRecords
  PHOTOS_PER_CALL: 6,       // حداکثر تعداد عکس در هر درخواست getPhotos
};
// ====================================================

const HEADERS = [
  "زمان ثبت سرور", "شناسه یکتا (uid)", "کد کاربر", "نام کاربر", "نوع عملیات", "تاریخ شمسی",
  "امور", "شهر", "سرگروه", "شماره اشتراک", "مبلغ", "تعداد عکس", "نام فایل عکس‌ها",
  "عرض جغرافیایی", "طول جغرافیایی", "دقت GPS (متر)", "زمان ثبت در گوشی",
  "لینک عکس ۱", "لینک عکس ۲", "لینک عکس ۳", "لینک عکس ۴",
  "توضیحات", // ستون ۲۲ (انتهای جدول تا ستون‌های قبلی جابه‌جا نشوند)
];
const UID_COL = 2;
const USERCODE_COL = 3;
const DATE_COL = 6;
const ESHTERAK_COL = 10;

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return json_({ ok: true, app: "collection-app-server", version: 41, time: new Date().toISOString() });
}

function doPost(e) {
  let lock;
  try {
    const data = JSON.parse(e.postData.contents);
    if (data.token !== SETTINGS.APP_TOKEN) return json_({ ok: false, error: "توکن نامعتبر است" });
    // اکشن‌های ادمین (فقط خواندن؛ بدون قفل)
    if (ADMIN_ACTIONS_[data.action]) {
      checkAdmin_(data);
      return json_(ADMIN_ACTIONS_[data.action](data));
    }
    if (data.action !== "submit") return json_({ ok: false, error: "action نامعتبر" });
    validate_(data);

    lock = LockService.getScriptLock();
    lock.waitLock(60000);

    const sheet = getSheet_();

    // رکورد تکراری؟ (همان uid قبلاً ثبت شده)
    if (sheet.getLastRow() > 1) {
      const found = sheet.getRange(2, UID_COL, sheet.getLastRow() - 1, 1)
        .createTextFinder(data.uid).matchEntireCell(true).findNext();
      if (found) return json_({ ok: true, duplicate: true });
    }

    // 1) عکس‌ها
    const links = uploadPhotos_(data);

    // 2) ردیف شیت
    const row = [
      new Date(), data.uid, data.userCode || "", data.userName || "", data.modeTitle || "", data.date || "",
      data.omoor || "", data.city || "", data.leader || "", String(data.eshterak || ""),
      Number(data.amount) || 0, (data.photos || []).length,
      (data.photos || []).map(function (p) { return p.name; }).join(" ، "),
      data.gpsLat == null ? "" : data.gpsLat, data.gpsLng == null ? "" : data.gpsLng,
      data.gpsAccuracy == null ? "" : data.gpsAccuracy, data.createdAt || "",
      links[0] || "", links[1] || "", links[2] || "", links[3] || "",
      String(data.note || "").slice(0, 500),
    ];
    sheet.appendRow(row);
    const r = sheet.getLastRow();
    sheet.getRange(r, ESHTERAK_COL).setNumberFormat("@").setValue(String(data.eshterak || ""));
    // کد کاربر و تاریخ هم متن بمانند (وگرنه «05» به ۵ و «1405/07/15» به تاریخ میلادی تبدیل می‌شود و فیلتر ادمین خراب می‌شود)
    sheet.getRange(r, USERCODE_COL).setNumberFormat("@").setValue(String(data.userCode || ""));
    sheet.getRange(r, DATE_COL).setNumberFormat("@").setValue(String(data.date || ""));
    SpreadsheetApp.flush();

    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  } finally {
    if (lock) { try { lock.releaseLock(); } catch (x) {} }
  }
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
  } else if (!sheet.getRange(1, HEADERS.length).getValue()) {
    // شیت قدیمی (۲۱ ستون): سرستون «توضیحات» را به انتها اضافه کن
    sheet.getRange(1, HEADERS.length).setValue(HEADERS[HEADERS.length - 1])
      .setFontWeight("bold").setBackground("#0d6efd").setFontColor("white");
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

/** آپلود عکس‌ها؛ نام فایل همان نام ارسالی از گوشی است. خروجی: آرایه لینک‌ها */
function uploadPhotos_(data) {
  const photos = data.photos || [];
  if (!photos.length) return [];
  const dateFolder = child_(rootFolder_(), String(data.date).replace(/[\\/]/g, "-"));
  const userFolder = child_(dateFolder, String(data.userCode || "نامشخص"));
  const links = [];
  photos.forEach(function (p) {
    const name = String(p.name || "photo.jpg").replace(/[\\/:*?"<>|]/g, "");
    // ارسال مجدد همین رکورد → فایل قبلی با همین نام جایگزین می‌شود، نه تکراری
    const old = userFolder.getFilesByName(name);
    while (old.hasNext()) old.next().setTrashed(true);
    const blob = Utilities.newBlob(Utilities.base64Decode(p.data), p.type || "image/jpeg", name);
    const file = userFolder.createFile(blob);
    if (SETTINGS.SHARE_PHOTOS_PUBLIC) file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    links.push(file.getUrl());
  });
  return links;
}

/** اجرای دستی یک‌باره برای گرفتن مجوزهای Drive/Sheets (در ادیتور اجرا کنید) */
function authorize() {
  getSheet_();
  rootFolder_();
  Logger.log("OK");
}


/* ═══════════════════════════════════════════════════════════
 * اکشن‌های ادمین
 * ═══════════════════════════════════════════════════════════ */

const ADMIN_ACTIONS_ = {
  listRecords: listRecords_,
  getSummary: getSummary_,
  getPhotos: getPhotos_,
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
/** کلید عددی تاریخ شمسی: 1405/07/15 → 14050715 (نامعتبر = 0) */
function dateKey_(v) {
  if (v instanceof Date) v = Utilities.formatDate(v, Session.getScriptTimeZone(), "yyyy/MM/dd");
  const m = latin_(v).match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  return m ? Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]) : 0;
}
function dateText_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), "yyyy/MM/dd");
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
function rowToRecord_(row) {
  const links = [];
  for (let i = 17; i <= 20; i++) if (row[i]) links.push(String(row[i]));
  const t = row[0];
  return {
    serverTime: t instanceof Date ? Utilities.formatDate(t, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss") : String(t || ""),
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
  };
}

/** خواندن و فیلتر ردیف‌ها؛ جدیدترین اول */
function filterRecords_(data) {
  const sheet = getSheet_();
  const last = sheet.getLastRow();
  if (last < 2) return [];
  const rows = sheet.getRange(2, 1, last - 1, HEADERS.length).getValues();

  const from = data.fromDate ? dateKey_(data.fromDate) : 0;
  const to = data.toDate ? dateKey_(data.toDate) : 99999999;
  const lo = Math.min(from, to), hi = Math.max(from, to);
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
    out.push(rowToRecord_(r));
  }
  return out;
}

function listRecords_(data) {
  const all = filterRecords_(data);
  const limit = Math.min(Math.max(Number(data.limit) || SETTINGS.MAX_LIST, 1), 5000);
  return { ok: true, total: all.length, truncated: all.length > limit, records: all.slice(0, limit) };
}

function getSummary_(data) {
  const all = filterRecords_(data);
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

function fileIdFromUrl_(url) {
  const m = String(url).match(/[-\w]{25,}/);
  return m ? m[0] : "";
}

/**
 * چند عکس را با شناسه فایل برمی‌گرداند (base64).
 * فقط فایل‌هایی مجازند که لینکشان در شیت ثبت شده است (با رمز ادمین هم نمی‌شود فایل دلخواه Drive را خواند).
 */
function getPhotos_(data) {
  const ids = (data.fileIds || []).slice(0, SETTINGS.PHOTOS_PER_CALL).map(String);
  if (!ids.length) return { ok: true, photos: [], missing: [] };

  const allowed = {};
  const sheet = getSheet_();
  const last = sheet.getLastRow();
  if (last > 1) {
    sheet.getRange(2, 18, last - 1, 4).getValues().forEach(function (row) {
      row.forEach(function (u) { const id = fileIdFromUrl_(u); if (id) allowed[id] = true; });
    });
  }

  const photos = [], missing = [];
  ids.forEach(function (id) {
    if (!allowed[id]) { missing.push(id); return; }
    try {
      const b = DriveApp.getFileById(id).getBlob();
      photos.push({ id: id, name: b.getName(), type: b.getContentType(), data: Utilities.base64Encode(b.getBytes()) });
    } catch (e) { missing.push(id); }
  });
  return { ok: true, photos: photos, missing: missing };
}
