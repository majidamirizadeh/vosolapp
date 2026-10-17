/**
 * ارسال خودکارِ «با تأخیر»
 * رکوردی که در گوشی ذخیره می‌شود تا SEND_DELAY_MS (پیش‌فرض ۱۰ دقیقه) فرصت ویرایش دارد؛ بعد از آن خودکار به سرور می‌رود.
 * - فقط رکوردهایی که موعدشان رسیده (sendAfter) ارسال می‌شود؛ «ارسال» و «ارسال همه» دستی در بایگانی همچنان فوری است.
 * - هر ۱۵ ثانیه و هنگام آنلاین شدن بررسی می‌شود. رکورد خطادار حداقل ۲ دقیقه بعد دوباره تلاش می‌شود.
 */
import { getPref } from "../core/prefs.js";
import { toast } from "../core/ui.js";
import { toPersianDigits } from "../core/utils.js";
import { bus, EV } from "../core/bus.js";
import { listFor, isSendDue, SEND_DELAY_MS } from "./records.js";
import { sendMany, serverConfigured } from "./sync.js";
import { canSend } from "./auth.js";

const TICK_MS = 15000;
const RETRY_GAP_MS = 120000;
const FAIL_TOAST_GAP_MS = 10 * 60000;

/** شناسه رکوردهای «در انتظار» که موعد ارسال خودکارشان رسیده است */
export async function dueIds(user, now = Date.now()) {
  const list = await listFor(user, { allUsers: getPref("allUsersOnPhone") });
  return list
    .filter((r) => r.status === "pending" && isSendDue(r, now))
    .filter((r) => !(r.lastError && Date.parse(r.lastTryAt) > now - RETRY_GAP_MS))
    .map((r) => r.id);
}

export function startAutoSender({ getUser }) {
  let running = false, lastFailToast = 0;

  async function tick() {
    if (running) return;
    const user = getUser();
    if (!user || !getPref("autoSync") || !serverConfigured() || !canSend(user) || !navigator.onLine) return;
    running = true;
    try {
      const ids = await dueIds(user);
      if (!ids.length) return;
      const out = await sendMany(ids);
      if (out.ok) toast(`${toPersianDigits(out.ok)} مورد به سرور ارسال شد ✓`, "success");
      if (out.failed && Date.now() - lastFailToast > FAIL_TOAST_GAP_MS) {
        lastFailToast = Date.now();
        toast("ارسال خودکار ناموفق بود؛ از تب «بایگانی» دوباره بفرستید", "error");
      }
    } catch (e) {
      console.warn("autosend", e);
    } finally {
      running = false;
    }
  }

  setInterval(tick, TICK_MS);
  window.addEventListener("online", () => setTimeout(tick, 1500));
  // تأخیر صفر (sendDelayMinutes: 0) = ارسال فوری بعد از هر ذخیره
  if (!SEND_DELAY_MS) bus.on(EV.RECORDS_CHANGED, () => setTimeout(tick, 300));
  tick();
  return { tick };
}
