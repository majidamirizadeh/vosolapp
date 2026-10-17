/**
 * نوار هشدار «ارسال‌نشده‌ها» — بالای صفحه (زیر سربرگ)
 * هر چه رکورد زودتر به سرور برود، امن‌تر است (اطلاعات فقط روی گوشی در برابر پاک شدن حافظه آسیب‌پذیر است).
 * - تعداد موارد ارسال‌نشده + قدیمی‌ترین (چقدر پیش)
 * - دکمهٔ «ارسال همه» (اگر اینترنت و سرور در دسترس باشد) و لمس نوار = رفتن به بایگانی
 * - بعد از ۱۲ ساعت زرد، بعد از ۲۴ ساعت قرمز
 */
import { h, toPersianDigits } from "../core/utils.js";
import { bus, EV } from "../core/bus.js";
import { toast, alertBox, busy } from "../core/ui.js";
import { getPref } from "../core/prefs.js";
import { feedback } from "../core/feedback.js";
import { listFor, isActiveWarning, warnState, isSendDue } from "./records.js";
import { sendMany, serverConfigured } from "./sync.js";
import { canSend } from "./auth.js";

const HOUR = 3600000;

function ago(ms) {
  const m = Math.max(1, Math.round(ms / 60000));
  if (m < 60) return `${toPersianDigits(m)} دقیقه`;
  const hh = Math.floor(m / 60);
  if (hh < 48) return `${toPersianDigits(hh)} ساعت`;
  return `${toPersianDigits(Math.floor(hh / 24))} روز`;
}

export function mountUnsentBar({ anchor, getUser, goArchive }) {
  const text = h("span", { class: "ub-text" });
  const btn = h("button", { type: "button", class: "btn btn-success btn-xs", onclick: (e) => { e.stopPropagation(); sendAll(); } }, "ارسال همه");
  const bar = h("div", { class: "unsent-bar hidden", role: "button", tabindex: 0, onclick: () => goArchive?.(), onkeydown: (e) => { if (e.key === "Enter") goArchive?.(); } }, text, btn);
  anchor.before(bar);

  let ids = [];
  let danger = false; // هشدار صوتی ۲۴ ساعت: در هر بار باز شدن برنامه فقط یک‌بار

  async function refresh() {
    const u = getUser();
    if (!u || !canSend(u)) return bar.classList.add("hidden"); // حساب تست: چیزی ارسال نمی‌شود
    const list = (await listFor(u, { allUsers: getPref("allUsersOnPhone") })).filter((r) => r.status === "pending");
    ids = list.map((r) => r.id);
    if (!list.length) return bar.classList.add("hidden");
    const oldest = Math.min(...list.map((r) => Date.parse(r.createdAt) || Date.now()));
    const age = Date.now() - oldest;
    bar.classList.remove("hidden");
    bar.classList.toggle("warn", age >= 12 * HOUR && age < 24 * HOUR);
    bar.classList.toggle("danger", age >= 24 * HOUR);
    if (age >= 24 * HOUR && !danger) { danger = true; feedback("alert"); }
    const waiting = list.filter((r) => !isSendDue(r));
    if (waiting.length === list.length && getPref("autoSync") && serverConfigured()) {
      // همه تازه ذخیره شده‌اند: هنوز در مهلت ویرایش (ارسال خودکار با تأخیر)
      const next = Math.min(...waiting.map((r) => Date.parse(r.sendAfter)));
      text.textContent = `${toPersianDigits(list.length)} مورد ذخیره شد — ارسال خودکار تا ${ago(Math.max(0, next - Date.now()))} دیگر (تا آن زمان در «بایگانی» قابل ویرایش است).`;
    } else {
      text.textContent = `${toPersianDigits(list.length)} مورد ارسال‌نشده — قدیمی‌ترین ${ago(age)} پیش. تا ارسال نشود فقط روی همین گوشی است.`;
    }
    btn.disabled = !navigator.onLine || !serverConfigured();
    btn.title = navigator.onLine ? "" : "دستگاه آفلاین است";
  }

  async function sendAll() {
    if (!ids.length) return;
    if (!navigator.onLine) return alertBox("دستگاه آفلاین است. وقتی اینترنت وصل شد دوباره تلاش کنید.");
    const b = busy("در حال ارسال…");
    const out = await sendMany(ids, ({ index, total }) => { b.text(`ارسال ${toPersianDigits(index)} از ${toPersianDigits(total)}`); b.progress(index / total); });
    b.done();
    if (out.failed) feedback("error");
    if (out.failed) await alertBox(`${toPersianDigits(out.ok)} مورد ارسال شد\n${toPersianDigits(out.failed)} مورد ناموفق ماند\n${out.lastError || ""}`, "ارسال ناقص");
    else toast("همهٔ موارد ارسال شد ✓", "success");
  }

  bus.on(EV.RECORDS_CHANGED, refresh);
  bus.on(EV.NET, refresh);
  setInterval(refresh, 30000); // شمارش معکوس ارسال خودکار و رنگ نوار (۱۲/۲۴ ساعت)؛ بقیه‌ی تغییرات با رویداد می‌آید
  refresh();
  return { refresh };
}

/**
 * هشدار «پایان مهلت اخطار»: وقتی یک اخطار در جریان از مهلتش گذشت (یا برنامه را که باز کردید اخطارِ پایان‌مهلت دارید)
 * یک هشدار صوتی/لرزشی + پیام با دکمهٔ «نمایش» می‌آید. هر اخطار در هر بار باز شدن برنامه فقط یک‌بار اعلام می‌شود.
 */
export function watchWarnings({ getUser, goWarnings }) {
  const told = new Set();
  let first = true;
  let dirty = true;       // رکوردها تغییر کرده‌اند → بازبینی لازم است
  let nextDue = Infinity; // نزدیک‌ترین زمان پایان مهلت یک اخطار «در جریان» (تا آن موقع بازبینی لازم نیست)
  let running = false;
  async function check() {
    if (running) return;
    const u = getUser();
    if (!u) return;
    const now = Date.now();
    if (!dirty && now < nextDue) return; // هر ۳۰ ثانیه فقط یک مقایسهٔ ساده؛ دیتابیس فقط وقتی لازم است خوانده می‌شود
    running = true;
    try {
      dirty = false;
      const list = (await listFor(u, { allUsers: getPref("allUsersOnPhone") })).filter(isActiveWarning);
      const expired = list.filter((r) => warnState(r, now) === "expired");
      nextDue = Math.min(Infinity, ...list.filter((r) => warnState(r, now) === "open").map((r) => Date.parse(r.createdAt) + r.deadlineHours * 3600000));
      const fresh = expired.filter((r) => !told.has(r.uid));
      if (!fresh.length) { first = false; return; }
      fresh.forEach((r) => told.add(r.uid));
      feedback("alert");
      toast(
        first ? `${toPersianDigits(fresh.length)} اخطار پایان مهلت دارد` : `مهلت ${toPersianDigits(fresh.length)} اخطار تمام شد`,
        "info",
        { ms: 9000, action: { label: "نمایش", run: () => goWarnings?.() } }
      );
      first = false;
    } finally {
      running = false;
    }
  }
  bus.on(EV.RECORDS_CHANGED, () => { dirty = true; check(); });
  setInterval(check, 30000);
  check();
}
