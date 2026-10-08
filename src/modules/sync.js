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

async function buildPayload(rec) {
  const photos = [];
  for (const p of rec.photos || []) {
    photos.push({ name: p.name, type: p.blob.type || "image/jpeg", data: await blobToBase64(p.blob) });
  }
  const { photos: _omit, id, ...rest } = rec;
  return { action: "submit", token: CONFIG.server.token, ...rest, photoCount: photos.length, photos };
}

/** ارسال یک رکورد → { ok, error?, duplicate? } */
export async function sendRecord(id) {
  if (blocked()) return { ok: false, error: TEST_USER_MSG }; // حساب تست: هیچ fetchی انجام نمی‌شود
  const rec = await db.records.get(id);
  if (!rec) return { ok: false, error: "رکورد پیدا نشد" };
  if (rec.status === "sent") return { ok: true, skipped: true };
  if (!serverConfigured()) return { ok: false, error: "آدرس یا توکن سرور در config/app.config.js تنظیم نشده است" };
  if (!navigator.onLine) return { ok: false, error: "دستگاه آفلاین است" };

  try {
    const res = await fetchWithTimeout(
      CONFIG.server.url,
      { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(await buildPayload(rec)) },
      CONFIG.server.timeoutMs
    );
    const text = await res.text();
    let out;
    try { out = JSON.parse(text); } catch { out = { ok: false, error: "پاسخ نامعتبر از سرور: " + text.slice(0, 120) }; }
    if (out.ok) {
      await markSent(id);
      return { ok: true, duplicate: !!out.duplicate };
    }
    await markError(id, out.error || "خطای نامشخص سرور");
    return { ok: false, error: out.error || "خطای نامشخص سرور" };
  } catch (e) {
    const msg = e.name === "AbortError" ? "پاسخ سرور دیر شد (timeout)" : "عدم ارتباط با سرور: " + (e.message || e);
    await markError(id, msg);
    return { ok: false, error: msg };
  }
}

/** ارسال همه موارد در انتظار؛ onProgress({index,total,record,result}) */
export async function sendMany(ids, onProgress) {
  if (blocked()) return { ok: 0, failed: ids.length, lastError: TEST_USER_MSG };
  let ok = 0, failed = 0, lastError = "";
  for (let i = 0; i < ids.length; i++) {
    if (!navigator.onLine) { lastError = "اینترنت قطع شد"; failed += ids.length - i; break; }
    const result = await sendRecord(ids[i]);
    result.ok ? ok++ : (failed++, (lastError = result.error));
    onProgress?.({ index: i + 1, total: ids.length, result });
  }
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
