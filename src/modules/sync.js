/**
 * ارسال رکوردها به سرور (Google Apps Script)
 *
 * - هر رکورد یک uid یکتا دارد؛ سرور رکورد تکراری را دوباره ثبت نمی‌کند، پس ارسال مجدد بعد از قطع شدن اینترنت امن است.
 * - رکورد فقط وقتی «ارسال‌شده» می‌شود که سرور صریحاً {ok:true} برگرداند.
 */
import { CONFIG } from "../../config/app.config.js";
import { blobToBase64, fetchWithTimeout } from "../core/utils.js";
import * as db from "../core/db.js";
import { markSent, markError } from "./records.js";
import { currentUser, canSend } from "./auth.js";

export const TEST_USER_MSG = "حساب تست است؛ ارسال به سرور غیرفعال است";
const blocked = () => !canSend(currentUser());

export function serverConfigured() {
  const { url, token } = CONFIG.server;
  return !!url && !url.includes("YOUR_SCRIPT_ID") && !!token && token !== "CHANGE_ME_SECRET_TOKEN";
}

/* تنظیمات ارسال: دسته‌ای و هم‌زمان */
const BATCH_RECORDS = 3;          // حداکثر رکورد در هر درخواست
const BATCH_BYTES = 2_500_000;    // حداکثر حجم تقریبی هر درخواست (بایت)
const CONCURRENCY = 2;            // تعداد درخواست هم‌زمان
let legacyServer = false;         // سرور قدیمی که submitBatch ندارد → ارسال تکی
const inflight = new Set();       // رکوردهایی که همین الان در حال ارسال‌اند (جلوی ارسال دوباره را می‌گیرد)

const estBytes = (rec) => Math.round((rec.photos || []).reduce((t, p) => t + (p.blob?.size || 0), 0) * 1.34) + 2000;

async function buildPayload(rec) {
  // تبدیل عکس‌ها به base64 هم‌زمان
  const photos = await Promise.all(
    (rec.photos || []).map(async (p) => ({ name: p.name, type: p.blob.type || "image/jpeg", data: await blobToBase64(p.blob) }))
  );
  const { photos: _omit, id, tries, lastError, lastTryAt, ...rest } = rec;
  // retry=false فقط برای «اولین ارسال» → سرور بررسی‌های تکراری را رد می‌کند و سریع‌تر است
  return { ...rest, retry: (tries || 0) > 0 || !!lastError, photoCount: photos.length, photos };
}

async function post(body, timeoutMs) {
  const res = await fetchWithTimeout(
    CONFIG.server.url,
    { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ token: CONFIG.server.token, ...body }) },
    timeoutMs
  );
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { ok: false, error: "پاسخ نامعتبر از سرور: " + text.slice(0, 120) }; }
}

const netError = (e) => (e.name === "AbortError" ? "پاسخ سرور دیر شد (timeout)" : "عدم ارتباط با سرور: " + (e.message || e));

/** نتیجه یک رکورد را در دیتابیس گوشی ثبت می‌کند → { ok, error?, duplicate? } */
async function settle(id, out) {
  if (out?.ok) {
    await markSent(id);
    return { ok: true, duplicate: !!out.duplicate };
  }
  const error = out?.error || "خطای نامشخص سرور";
  await markError(id, error);
  return { ok: false, error };
}

/** یک دسته رکورد را می‌فرستد → آرایه نتیجه به ترتیب recs */
async function sendBatch(recs) {
  await Promise.all(recs.map((r) => db.records.update(r.id, { tries: (r.tries || 0) + 1 }))); // قبل از ارسال ثبت می‌شود تا قطعی وسط کار «ارسال مجدد» حساب شود
  try {
    const payloads = await Promise.all(recs.map(buildPayload));
    if (!legacyServer) {
      const out = await post({ action: "submitBatch", records: payloads }, CONFIG.server.timeoutMs);
      if (out.ok && Array.isArray(out.results)) {
        const byUid = new Map(out.results.map((x) => [x.uid, x]));
        return Promise.all(recs.map((r, i) => settle(r.id, byUid.get(payloads[i].uid))));
      }
      if (!/action نامعتبر/.test(out.error || "")) return Promise.all(recs.map((r) => settle(r.id, out)));
      legacyServer = true; // اسکریپت سرور هنوز به‌روز نشده؛ ارسال تکی مثل قبل
    }
    const results = [];
    for (let i = 0; i < recs.length; i++) {
      const out = await post({ action: "submit", ...payloads[i] }, CONFIG.server.timeoutMs);
      results.push(await settle(recs[i].id, out));
    }
    return results;
  } catch (e) {
    const out = { ok: false, error: netError(e) };
    return Promise.all(recs.map((r) => settle(r.id, out)));
  }
}

/** بررسی‌های مشترک قبل از ارسال؛ پیام خطا یا null */
function precheck() {
  if (blocked()) return TEST_USER_MSG;
  if (!serverConfigured()) return "آدرس یا توکن سرور در config/app.config.js تنظیم نشده است";
  if (!navigator.onLine) return "دستگاه آفلاین است";
  return null;
}

/** ارسال یک رکورد → { ok, error?, duplicate? } */
export async function sendRecord(id) {
  const bad = precheck();
  if (bad) return { ok: false, error: bad };
  if (inflight.has(id)) return { ok: true, skipped: true };
  const rec = await db.records.get(id);
  if (!rec) return { ok: false, error: "رکورد پیدا نشد" };
  if (rec.status === "sent") return { ok: true, skipped: true };
  inflight.add(id);
  try {
    return (await sendBatch([rec]))[0];
  } finally {
    inflight.delete(id);
  }
}

/**
 * ارسال همه موارد در انتظار: دسته‌های ۳تایی، ۲ درخواست هم‌زمان؛ onProgress({index,total,result}) بعد از هر رکورد
 */
export async function sendMany(ids, onProgress) {
  if (blocked()) return { ok: 0, failed: ids.length, lastError: TEST_USER_MSG };
  let ok = 0, failed = 0, lastError = "", done = 0;
  const total = ids.length;

  // بارگذاری رکوردها و ساخت دسته‌ها
  const recs = [];
  for (const id of ids) {
    if (inflight.has(id)) { done++; continue; }
    const r = await db.records.get(id);
    if (!r || r.status === "sent") { done++; continue; }
    recs.push(r);
  }
  const batches = [];
  let cur = [], bytes = 0;
  for (const r of recs) {
    const b = estBytes(r);
    if (cur.length && (cur.length >= BATCH_RECORDS || bytes + b > BATCH_BYTES)) { batches.push(cur); cur = []; bytes = 0; }
    cur.push(r); bytes += b;
  }
  if (cur.length) batches.push(cur);

  let next = 0, stop = false;
  const worker = async () => {
    while (!stop && next < batches.length) {
      const batch = batches[next++];
      if (!navigator.onLine) { lastError = "اینترنت قطع شد"; failed += batch.length; stop = true; break; }
      batch.forEach((r) => inflight.add(r.id));
      let results;
      try { results = await sendBatch(batch); } finally { batch.forEach((r) => inflight.delete(r.id)); }
      results.forEach((result) => {
        result.ok ? ok++ : (failed++, (lastError = result.error));
        onProgress?.({ index: ++done, total, result });
      });
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker));
  // دسته‌هایی که به‌خاطر قطع شدن اینترنت اصلاً شروع نشدند
  for (; next < batches.length; next++) failed += batches[next].length;
  return { ok, failed, lastError };
}

/**
 * فراخوانی عمومی سرور (برای اکشن‌های ادمین: listRecords / getSummary / downloadPhotosZip)
 * → آبجکت JSON سرور؛ در خطا { ok:false, error }
 */
export async function serverCall(action, params = {}) {
  if (!serverConfigured()) return { ok: false, error: "آدرس یا توکن سرور در config/app.config.js تنظیم نشده است" };
  if (!navigator.onLine) return { ok: false, error: "دستگاه آفلاین است" };
  try {
    const res = await fetchWithTimeout(
      CONFIG.server.url,
      { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ action, token: CONFIG.server.token, ...params }) },
      CONFIG.server.timeoutMs * 2
    );
    const text = await res.text();
    try { return JSON.parse(text); } catch { return { ok: false, error: "پاسخ نامعتبر از سرور: " + text.slice(0, 120) }; }
  } catch (e) {
    return { ok: false, error: e.name === "AbortError" ? "پاسخ سرور دیر شد (timeout)" : "عدم ارتباط با سرور: " + (e.message || e) };
  }
}
