/**
 * تب «تنظیمات»: وضعیت حافظه، پوشه ذخیره‌سازی، ارسال خودکار، خروج
 */
import { CONFIG } from "../../config/app.config.js";
import { h, formatBytes, toPersianDigits } from "../core/utils.js";
import { alertBox, confirmBox, toast, busy } from "../core/ui.js";
import { getPref, setPref, isPrefLocked } from "../core/prefs.js";
import { bus, EV } from "../core/bus.js";
import { pickFolder, clearFolder, status, usage, requestPersistence, folderApiSupported } from "./storage.js";
import { userCount, canSend } from "./auth.js";
import { restoreMyRecords, serverConfigured } from "./sync.js";
import { ICONS } from "../core/icons.js";
import { feedback, vibrationSupported } from "../core/feedback.js";

const RESTORE_DAYS = 60;

/** اجرای بازیابی از سرور با نوار پیشرفت و پیام نتیجه */
export async function runRestore(user, { silent = false } = {}) {
  if (!serverConfigured()) { if (!silent) await alertBox("آدرس/توکن سرور تنظیم نشده است."); return null; }
  if (!navigator.onLine) { if (!silent) await alertBox("دستگاه آفلاین است. با اینترنت دوباره تلاش کنید."); return null; }
  const b = busy("در حال دریافت اطلاعات از سرور…");
  const out = await restoreMyRecords(user, RESTORE_DAYS);
  b.done();
  if (!out.ok) { await alertBox(out.error, "بازیابی ناموفق"); return null; }
  await alertBox(
    out.added
      ? `${toPersianDigits(out.added)} مورد بازیابی شد.\n(${toPersianDigits(out.existing)} مورد از قبل روی گوشی بود)\nمواردِ ارسال‌شده در «بایگانی» و اخطارهای تعیین‌تکلیف‌نشده در «اخطارهای در جریان» هستند.`
      : out.total ? "همهٔ موارد از قبل روی گوشی بود؛ چیزی اضافه نشد." : `در ${toPersianDigits(RESTORE_DAYS)} روز اخیر موردی برای این کاربر در سرور ثبت نشده است.`,
    "بازیابی از سرور"
  );
  return out;
}

export function createSettingsModule({ getUser, onLogout, checkUpdate }) {
  let box;

  const toggle = (label, hint, key) => {
    const lock = isPrefLocked(key); // برای کاربران غیرادمین: همیشه روشن و غیرفعال
    const input = h("input", { type: "checkbox", checked: !!getPref(key), disabled: lock, onchange: (e) => setPref(key, e.target.checked).then(() => bus.emit(EV.RECORDS_CHANGED)) });
    return h("label", { class: "switch-row" + (lock ? " locked" : "") }, h("div", {}, h("div", { class: "sw-title" }, label), h("div", { class: "info-text" }, hint + (lock ? " (این گزینه همیشه روشن است و فقط ادمین می‌تواند تغییرش دهد.)" : ""))), input);
  };

  async function restore(u) {
    await runRestore(u);
  }

  async function render() {
    box.replaceChildren();
    const st = await status();
    const us = await usage();
    const u = getUser();

    box.append(
      h("div", { class: "card" },
        h("h3", { class: "card-title" }, "حساب کاربری"),
        h("p", {}, `کاربر فعلی: `, h("b", {}, u.name), `  (کد ${toPersianDigits(u.code)})`),
        h("button", { type: "button", class: "btn btn-secondary", onclick: onLogout }, "خروج از حساب")
      ),
      h("div", { class: "card" },
        h("h3", { class: "card-title" }, "ذخیره‌سازی روی گوشی"),
        h("p", { class: "info-text" },
          `حافظه مصرفی برنامه: ${formatBytes(us.usage)}${us.quota ? " از " + formatBytes(us.quota) : ""} — ` +
          (us.persisted ? "حافظه پایدار فعال است ✓" : "حافظه پایدار فعال نیست")),
        !us.persisted && h("button", { type: "button", class: "btn btn-warning btn-sm", onclick: async () => { const ok = await requestPersistence(); toast(ok ? "حافظه پایدار فعال شد" : "مرورگر اجازه نداد؛ برنامه را به صفحه اصلی اضافه (نصب) کنید", ok ? "success" : "error"); render(); } }, "فعال‌سازی حافظه پایدار"),
        toggle("ذخیره خودکار عکس‌ها در گوشی", "با هر «ذخیره»، فایل عکس‌ها با نام شماره اشتراک ذخیره می‌شود.", "autoSavePhotos"),
        h("div", { class: "folder-box" },
          h("div", {}, "محل ذخیره فایل‌ها: ", h("b", {}, st.mode === "folder" ? `پوشه «${st.folderName}» / ${CONFIG.device.folderName}` : "پوشه دانلود گوشی")),
          folderApiSupported()
            ? h("div", {},
                h("button", { type: "button", class: "btn btn-primary btn-sm", onclick: async () => { try { await pickFolder(); toast("پوشه انتخاب شد", "success"); } catch (e) { if (e.name !== "AbortError") toast(e.message, "error"); } render(); } }, "انتخاب پوشه ذخیره‌سازی"),
                st.mode === "folder" && h("button", { type: "button", class: "btn btn-secondary btn-sm", onclick: async () => { await clearFolder(); render(); } }, "بازگشت به پوشه دانلود"),
                h("div", { class: "info-text" }, "پوشه‌ای مثل Documents انتخاب کنید (مرورگر اجازه انتخاب خود Download را نمی‌دهد). برنامه داخل آن پوشه‌ای به نام " + CONFIG.device.folderName + " می‌سازد."))
            : h("div", { class: "info-text" }, "این مرورگر اجازه ساخت پوشه نمی‌دهد؛ فایل‌ها مستقیم در پوشه دانلود ذخیره می‌شوند. برای دریافت پوشه‌بندی‌شده از «ZIP کامل» در تب گزارش استفاده کنید.")
        )
      ),
      h("div", { class: "card" },
        h("h3", { class: "card-title" }, "صدا و لرزش"),
        toggle("صدا", "بوق کوتاه برای ذخیره موفق، خطا، گرفتن عکس، ارسال، پایان مهلت اخطار و وصل/قطع شدن اینترنت (برای وقتی که صفحه را درست نمی‌بینید).", "sound"),
        toggle("لرزش", vibrationSupported() ? "همین رویدادها با لرزش گوشی هم اعلام شوند (پیش‌فرض خاموش)." : "این مرورگر/گوشی از لرزش پشتیبانی نمی‌کند.", "vibrate"),
        h("div", { class: "btn-row" },
          h("button", { type: "button", class: "btn btn-secondary btn-sm", onclick: () => feedback("success") }, "آزمایش: موفق"),
          h("button", { type: "button", class: "btn btn-secondary btn-sm", onclick: () => feedback("error") }, "آزمایش: خطا"),
          h("button", { type: "button", class: "btn btn-secondary btn-sm", onclick: () => feedback("alert") }, "آزمایش: هشدار")
        ),
        h("p", { class: "info-text" }, "اگر صدا نیامد: گوشی را از حالت بی‌صدا خارج کنید و بلندی «رسانه» را بالا ببرید.")
      ),
      h("div", { class: "card" },
        h("h3", { class: "card-title" }, "ارسال به سرور"),
        toggle("ارسال خودکار هنگام اتصال به اینترنت", "به‌محض آنلاین شدن، موارد ارسال‌نشده خودکار ارسال می‌شوند.", "autoSync"),
        toggle("نمایش اطلاعات همه کاربران این گوشی", "اگر چند نفر از یک گوشی استفاده می‌کنند، بایگانی و گزارش همه را نشان می‌دهد.", "allUsersOnPhone")
      ),
      canSend(u) && h("div", { class: "card" },
        h("h3", { class: "card-title" }, "بازیابی اطلاعات از سرور"),
        h("p", { class: "info-text" }, `اگر اطلاعات برنامه روی گوشی پاک شد (یا گوشی عوض شد)، موارد ${toPersianDigits(RESTORE_DAYS)} روز اخیر که قبلاً به سرور ارسال کرده‌اید دوباره در «بایگانی» و «اخطارهای در جریان» برمی‌گردد. عکس‌ها بازیابی نمی‌شوند (در سرور محفوظ‌اند) و مواردی که ارسال نشده بودند قابل بازیابی نیستند.`),
        h("button", { type: "button", class: "btn btn-primary", onclick: () => restore(u) }, "بازیابی ۶۰ روز اخیر از سرور")
      ),
      h("div", { class: "card" },
        h("h3", { class: "card-title" }, "درباره برنامه"),
        h("p", { class: "info-text" }, `نسخه ${toPersianDigits(CONFIG.version)} — ${toPersianDigits(userCount())} کاربر تعریف‌شده`),
        h("button", { type: "button", class: "btn btn-secondary btn-sm", onclick: checkUpdate }, "بررسی نسخه جدید")
      )
    );
  }

  return {
    id: "settings",
    nav: false,
    title: "تنظیمات",
    icon: ICONS.settings,
    mount(container) { box = container; },
    onShow: render,
  };
}
