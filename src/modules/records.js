/**
 * منطق داده: ساخت رکورد، نام‌گذاری عکس‌ها، آمار، مهاجرت از نسخه قدیمی
 */
import { CONFIG } from "../../config/app.config.js";
import { MODES } from "../../config/modes.js";
import * as db from "../core/db.js";
import { bus, EV } from "../core/bus.js";
import { safeFileName, toLatinDigits, uuid } from "../core/utils.js";
import { allocateNames } from "./naming.js";

/** شماره اشتراک → رشته امن برای نام فایل */
export function subscriptionKey(raw) {
  return safeFileName(toLatinDigits(raw)).replace(/-/g, "");
}

/**
 * @param {object} data   فیلدهای فرم + user + mode + gps
 * @param {{blob:Blob,width:number,height:number}[]} photos  عکس‌های مهرخورده
 */
export async function createRecord(data, photos) {
  const key = subscriptionKey(data.eshterak);
  if (!key) throw new Error("شماره اشتراک نامعتبر است");

  const rec = await db.addRecordWithCounter(
    key,
    photos.length,
    (existing, n) => allocateNames(key, existing, n, CONFIG.photos.separator),
    (names) => ({
      uid: uuid(),
      userCode: data.user.code,
      userName: data.user.name,
      mode: data.mode,
      modeTitle: MODES[data.mode].title,
      date: data.date,
      omoor: data.omoor,
      city: data.city,
      leader: data.leader,
      eshterak: key,
      amount: Number(data.amount) || 0,
      note: data.note || "",
      gpsLat: data.gps?.lat ?? null,
      gpsLng: data.gps?.lng ?? null,
      gpsAccuracy: data.gps?.accuracy ?? null,
      photos: photos.map((p, i) => ({ name: names[i], blob: p.blob, width: p.width, height: p.height })),
      status: "pending",
      deviceSaved: false,
      createdAt: new Date().toISOString(),
      sentAt: null,
    })
  );
  bus.emit(EV.RECORDS_CHANGED);
  return rec;
}

/**
 * ویرایش رکورد «در انتظار ارسال» — id، uid، کاربر و زمان ایجاد حفظ می‌شود (رکورد جدید ساخته نمی‌شود).
 * @param {number} id
 * @param {object} data   فیلدهای فرم + mode + gps
 * @param {{blob:Blob,width:number,height:number,name?:string}[]} photos
 *        عکس‌های نهایی به ترتیب؛ آیتمی که name دارد = عکس قبلی که نگه داشته شده
 * @returns {Promise<{record:object, newNames:string[]}>} newNames = نام عکس‌هایی که تازه یا تغییرنام‌یافته‌اند
 */
export async function updateRecord(id, data, photos) {
  const key = subscriptionKey(data.eshterak);
  if (!key) throw new Error("شماره اشتراک نامعتبر است");
  const before = await db.records.get(id);
  if (!before) throw new Error("رکورد پیدا نشد");
  const sameKey = before.eshterak === key;
  // عکس قبلی فقط وقتی نامش را نگه می‌دارد که شماره اشتراک عوض نشده باشد
  const needName = photos.map((p) => !(p.name && sameKey));
  const fresh = needName.filter(Boolean).length;

  const record = await db.replaceRecordWithCounter(
    id,
    key,
    fresh,
    (existing, n) => allocateNames(key, existing, n, CONFIG.photos.separator),
    (old, names) => {
      let k = 0;
      return {
        ...old,
        mode: data.mode,
        modeTitle: MODES[data.mode].title,
        date: data.date,
        omoor: data.omoor,
        city: data.city,
        leader: data.leader,
        eshterak: key,
        amount: Number(data.amount) || 0,
        note: data.note || "",
        gpsLat: data.gps?.lat ?? null,
        gpsLng: data.gps?.lng ?? null,
        gpsAccuracy: data.gps?.accuracy ?? null,
        photos: photos.map((p, i) => ({ name: needName[i] ? names[k++] : p.name, blob: p.blob, width: p.width, height: p.height })),
        lastError: null,
        editedAt: new Date().toISOString(),
      };
    }
  );
  bus.emit(EV.RECORDS_CHANGED);
  const oldNames = new Set((before.photos || []).map((p) => p.name));
  // فقط فایل‌هایی که قبلاً با همین نام در گوشی ذخیره نشده‌اند
  const newNames = record.photos.map((p) => p.name).filter((n) => !oldNames.has(n));
  return { record, newNames };
}

export async function listFor(user, { allUsers = false } = {}) {
  const all = await db.records.all();
  return (allUsers ? all : all.filter((r) => r.userCode === user.code)).sort((a, b) => b.id - a.id);
}

export async function markSent(id) {
  const r = await db.records.update(id, { status: "sent", sentAt: new Date().toISOString(), lastError: null });
  bus.emit(EV.RECORDS_CHANGED);
  return r;
}

export async function markError(id, message) {
  await db.records.update(id, { lastError: String(message).slice(0, 300), lastTryAt: new Date().toISOString() });
}

export async function markDeviceSaved(id, ok) {
  await db.records.update(id, { deviceSaved: !!ok });
}

export async function remove(id) {
  await db.records.remove(id);
  bus.emit(EV.RECORDS_CHANGED);
}

export function summarize(list) {
  const byMode = {};
  let total = 0, sent = 0, pending = 0, photos = 0;
  for (const r of list) {
    byMode[r.modeTitle] = byMode[r.modeTitle] || { count: 0, amount: 0 };
    byMode[r.modeTitle].count++;
    byMode[r.modeTitle].amount += Number(r.amount) || 0;
    total += Number(r.amount) || 0;
    photos += r.photos?.length || 0;
    r.status === "sent" ? sent++ : pending++;
  }
  return { count: list.length, sent, pending, total, photos, byMode };
}

/**
 * مهاجرت داده‌های نسخه قدیمی (عکس‌ها به‌صورت base64 و فیلد teamCode)
 * تا هیچ رکورد ارسال‌نشده‌ای هنگام به‌روزرسانی گم نشود.
 */
export async function migrateLegacy() {
  const all = await db.records.all();
  let n = 0;
  for (const r of all) {
    const legacyPhotos = (r.photos || []).some((p) => typeof p === "string");
    if (!legacyPhotos && r.userCode) continue;
    const photos = [];
    const key = subscriptionKey(r.eshterak);
    const total = (r.photos || []).length;
    for (let i = 0; i < total; i++) {
      const p = r.photos[i];
      if (typeof p === "string") {
        const blob = await (await fetch(p)).blob();
        photos.push({ name: total === 1 ? `${key}.jpg` : `${key}${CONFIG.photos.separator}${i + 1}.jpg`, blob });
      } else photos.push(p);
    }
    // کد قدیمی «اکیپ-۰۵» → کد جدید «05»
    const oldTeam = String(r.teamCode || "");
    const m = toLatinDigits(oldTeam).match(/(\d+)\s*$/);
    const code = r.userCode || (m ? m[1].padStart(2, "0") : oldTeam);
    await db.records.update(r.id, {
      photos,
      eshterak: key,
      userCode: code,
      userName: r.userName || oldTeam,
      uid: r.uid || uuid(),
      deviceSaved: !!r.deviceSaved,
    });
    n++;
  }
  return n;
}
