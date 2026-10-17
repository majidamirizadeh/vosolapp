/**
 * منطق داده: ساخت رکورد، نام‌گذاری عکس‌ها، آمار، مهاجرت از نسخه قدیمی
 */
import { CONFIG } from "../../config/app.config.js";
import { MODES, WARNING_DEADLINES } from "../../config/modes.js";
import * as db from "../core/db.js";
import { bus, EV } from "../core/bus.js";
import { safeFileName, toLatinDigits, uuid } from "../core/utils.js";
import { allocateNames } from "./naming.js";

/**
 * تأخیر ارسال خودکار بعد از «ذخیره در گوشی» (پیش‌فرض ۱۰ دقیقه) تا فرصت ویرایش باشد.
 * برای تغییر: در config/app.config.js داخل rules بنویسید  sendDelayMinutes: 10  (۰ = فوری)
 */
export const SEND_DELAY_MS = Math.max(0, Number(CONFIG.rules?.sendDelayMinutes ?? 10)) * 60000;
/** زمان ارسال خودکارِ این لحظه به بعد (ISO) */
export const sendAfterNow = () => new Date(Date.now() + SEND_DELAY_MS).toISOString();
/** آیا موعد ارسال خودکار رکورد رسیده است؟ (رکوردِ بدون sendAfter = قدیمی → بله) */
export const isSendDue = (r, now = Date.now()) => !(Date.parse(r?.sendAfter) > now);

/** شماره اشتراک → رشته امن برای نام فایل */
export function subscriptionKey(raw) {
  return safeFileName(toLatinDigits(raw)).replace(/-/g, "");
}

/** مهلت انتخاب‌شده (ساعت) → { deadlineHours, deadlineLabel } فقط برای «صدور اخطار» */
function deadlineFields(data) {
  if (data.mode !== "warning") return { deadlineHours: null, deadlineLabel: "" };
  const d = WARNING_DEADLINES.find((x) => x.value === Number(data.deadline));
  return d ? { deadlineHours: d.value, deadlineLabel: d.label } : { deadlineHours: null, deadlineLabel: "" };
}

/**
 * وضعیت یک اخطار «ارسال‌شده»: "open" در جریان | "expired" پایان مهلت | "resolved" تعیین تکلیف شده
 * مبنا: زمان ثبت روی گوشی (createdAt) + مهلت. اخطار بدون مهلت (قدیمی) در این فهرست نمی‌آید (null).
 */
export function warnState(rec, now = Date.now()) {
  if (!rec || rec.mode !== "warning" || !rec.deadlineHours) return null;
  if (rec.resolved) return "resolved";
  const base = Date.parse(rec.createdAt);
  if (isNaN(base)) return "expired";
  return now >= base + rec.deadlineHours * 3600000 ? "expired" : "open";
}

/** اخطارهای ارسال‌شدهٔ هنوز تعیین‌تکلیف‌نشده (برای بخش «اخطارهای در جریان») */
export const isActiveWarning = (r) => r.mode === "warning" && r.status === "sent" && !!r.deadlineHours && !r.resolved;

/** بعد از ارسال موفق رکوردی که اخطار را تعیین تکلیف کرده: اخطار اصلی از «در جریان» خارج می‌شود */
export async function finishResolution(id) {
  const rec = await db.records.get(id);
  if (!rec || !rec.resolvesUid) return;
  const all = await db.records.all();
  const warn = all.find((r) => r.uid === rec.resolvesUid && r.mode === "warning");
  if (warn && !warn.resolved) {
    await db.records.update(warn.id, { resolved: { uid: rec.uid, modeTitle: rec.modeTitle, at: new Date().toISOString() } });
    bus.emit(EV.RECORDS_CHANGED);
  }
}

/** رکورد تعیین‌تکلیفِ ذخیره‌شده (هنوز ارسال‌نشده) برای یک اخطار، اگر باشد */
export async function pendingResolutionFor(warnUid) {
  const all = await db.records.all();
  return all.find((r) => r.resolvesUid === warnUid && r.status === "pending") || null;
}

/** شمارندهٔ نام عکس از نام فایل‌های سرور: 123.jpg → ۱ ؛ 123_3.jpg → ۳ */
function photoCounterOf(names) {
  let max = 0;
  for (const n of String(names || "").split("،")) {
    const m = n.trim().match(/_(\d+)\.[a-z0-9]+$/i);
    max = Math.max(max, m ? Number(m[1]) : n.trim() ? 1 : 0);
  }
  return max;
}

/** ISO از «زمان ثبت در گوشی» یا (اگر نبود) «زمان ثبت سرور» */
function isoOf(a, b) {
  for (const v of [a, b]) {
    if (!v) continue;
    const d = new Date(String(v).includes("T") ? v : String(v).replace(" ", "T"));
    if (!isNaN(d)) return d.toISOString();
  }
  return new Date().toISOString();
}

/**
 * «بازیابی از سرور»: رکوردهای برگشتی سرور (myRecords) را به بایگانی گوشی اضافه می‌کند.
 * - رکوردی که uid آن روی گوشی هست دوباره ساخته نمی‌شود (فقط اگر اخطار روی سرور تعیین تکلیف شده بود، همین‌جا هم بسته می‌شود).
 * - رکوردهای بازیابی‌شده «ارسال‌شده» هستند و عکس ندارند (عکس‌ها فقط در سرور می‌مانند)؛ اخطارهای در جریان در بخش «اخطارهای در جریان» برمی‌گردند.
 * @returns {{added:number, existing:number, skipped:number}}
 */
export async function restoreFromServer(user, list) {
  const local = await db.records.all();
  const byUid = new Map(local.map((r) => [r.uid, r]));
  const modeOf = (title) => Object.keys(MODES).find((k) => MODES[k].title === title) || null;
  const prefix = "تعیین تکلیف با ";
  const add = [], bumps = {};
  let existing = 0, skipped = 0, closed = 0;

  for (const s of list || []) {
    if (!s || !s.uid) { skipped++; continue; }
    const st = String(s.warnStatus || "");
    const doneWith = st.startsWith(prefix) ? st.slice(prefix.length).trim() : "";
    const have = byUid.get(s.uid);
    if (have) {
      existing++;
      if (have.mode === "warning" && doneWith && !have.resolved) {
        await db.records.update(have.id, { resolved: { uid: "", modeTitle: doneWith, at: "" } });
        closed++;
      }
      continue;
    }
    const mode = modeOf(s.modeTitle);
    const key = subscriptionKey(s.eshterak);
    if (!mode || !key) { skipped++; continue; }
    const isWarn = mode === "warning";
    const dl = isWarn ? WARNING_DEADLINES.find((x) => x.label === String(s.deadline || "").trim()) : null;
    add.push({
      uid: s.uid,
      userCode: user.code,
      userName: user.name,
      mode,
      modeTitle: s.modeTitle,
      date: s.date,
      omoor: s.omoor || "",
      city: s.city || "",
      abadi: s.abadi || "",
      leader: s.leader || "",
      eshterak: key,
      amount: Number(s.amount) || 0,
      note: s.note || "",
      deadlineHours: dl ? dl.value : null,
      deadlineLabel: dl ? dl.label : "",
      ...(isWarn && doneWith ? { resolved: { uid: "", modeTitle: doneWith, at: "" } } : {}),
      ...(st === "تعیین تکلیف شده از صدور اخطار" ? { resolvesUid: "server" } : {}),
      gpsLat: s.gpsLat ?? null,
      gpsLng: s.gpsLng ?? null,
      gpsAccuracy: s.gpsAccuracy ?? null,
      photos: [],
      photoCount: Number(s.photoCount) || 0,
      photoNames: s.photoNames || "",
      status: "sent",
      deviceSaved: false,
      restored: true,
      createdAt: isoOf(s.createdAt, s.serverTime),
      sentAt: isoOf(s.serverTime, s.createdAt),
    });
    const c = photoCounterOf(s.photoNames);
    if (c) bumps[key] = Math.max(bumps[key] || 0, c);
  }
  // قدیمی‌ترین اول تا شناسهٔ محلی (id) با ترتیب زمانی جور باشد (سرور جدیدترین‌ها را اول می‌دهد)
  add.reverse();
  if (add.length || closed) {
    if (add.length) await db.records.addMany(add, bumps);
    bus.emit(EV.RECORDS_CHANGED);
  }
  return { added: add.length, existing, skipped };
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
      abadi: data.abadi || "",
      leader: data.leader,
      eshterak: key,
      amount: Number(data.amount) || 0,
      note: data.note || "",
      ...deadlineFields(data),
      ...(data.resolvesUid ? { resolvesUid: data.resolvesUid } : {}), // این رکورد یک اخطار را تعیین تکلیف کرده است
      gpsLat: data.gps?.lat ?? null,
      gpsLng: data.gps?.lng ?? null,
      gpsAccuracy: data.gps?.accuracy ?? null,
      photos: photos.map((p, i) => ({ name: names[i], blob: p.blob, width: p.width, height: p.height })),
      status: "pending",
      deviceSaved: false,
      createdAt: new Date().toISOString(),
      sendAfter: sendAfterNow(),
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
        abadi: data.abadi || "",
        leader: data.leader,
        eshterak: key,
        amount: Number(data.amount) || 0,
        note: data.note || "",
        ...deadlineFields(data),
        gpsLat: data.gps?.lat ?? null,
        gpsLng: data.gps?.lng ?? null,
        gpsAccuracy: data.gps?.accuracy ?? null,
        photos: photos.map((p, i) => ({ name: needName[i] ? names[k++] : p.name, blob: p.blob, width: p.width, height: p.height })),
        lastError: null,
        editedAt: new Date().toISOString(),
        sendAfter: sendAfterNow(), // با ویرایش، ۱۰ دقیقهٔ ارسال خودکار از نو شروع می‌شود
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

/**
 * جمع مبلغ بدون تکرار اشتراک: هر اشتراک ممکن است در چند نوع عملیات ثبت شده باشد؛
 * برای هر شماره اشتراک فقط «یک» مبلغ حساب می‌شود:
 *   اولویت اول: مبلغ «وصول مطالبات» (اگر چند وصول بود، بزرگ‌ترین مبلغ وصول)
 *   اولویت دوم: بزرگ‌ترین مبلغ بین بقیه ثبت‌ها
 */
export function dedupAmount(list) {
  const best = new Map();
  for (const r of list) {
    const key = toLatinDigits(String(r.eshterak ?? "")).replace(/\D/g, "") || `__${r.uid || r.id}`;
    const amt = Number(r.amount) || 0;
    const isCollect = (r.mode ? r.mode === "collect" : r.modeTitle === MODES.collect.title) && amt > 0;
    const cur = best.get(key);
    if (!cur || (isCollect && !cur.isCollect) || (isCollect === cur.isCollect && amt > cur.amt)) best.set(key, { amt, isCollect });
  }
  let sum = 0;
  best.forEach((v) => (sum += v.amt));
  return { total: sum, unique: best.size };
}

/** تفکیک جمع‌ها: «جمع وصول» = مبالغ وصول مطالبات؛ «جمع مبالغ پیگیری‌شده» = بدهی‌ها (اخطار، قطع کنتور، قطع کمربند، فک پلمپ، مسدودی حساب). هر دو بدون تکرار اشتراک */
export function splitTotals(list) {
  const isCollect = (r) => (r.mode ? r.mode === "collect" : r.modeTitle === MODES.collect.title);
  const c = dedupAmount(list.filter(isCollect));
  const f = dedupAmount(list.filter((r) => !isCollect(r)));
  return { collectTotal: c.total, followedTotal: f.total, collectUnique: c.unique, followedUnique: f.unique };
}

export function summarize(list) {
  const byMode = {};
  const groups = {};
  let sent = 0, pending = 0, photos = 0;
  for (const r of list) {
    (groups[r.modeTitle] = groups[r.modeTitle] || []).push(r);
    photos += r.photos?.length || 0;
    r.status === "sent" ? sent++ : pending++;
  }
  // تعداد = تعداد ثبت‌ها؛ مبلغ هر نوع عملیات = جمع بدون تکرار اشتراک در همان نوع
  for (const [k, arr] of Object.entries(groups)) byMode[k] = { count: arr.length, amount: dedupAmount(arr).total };
  const all = dedupAmount(list);
  return { count: list.length, sent, pending, ...splitTotals(list), uniqueCount: all.unique, photos, byMode };
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
