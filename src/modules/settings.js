/**
 * تب «تنظیمات»: وضعیت حافظه، پوشه ذخیره‌سازی، ارسال خودکار، خروج
 */
import { CONFIG } from "../../config/app.config.js";
import { h, formatBytes, toPersianDigits } from "../core/utils.js";
import { alertBox, confirmBox, toast } from "../core/ui.js";
import { getPref, setPref } from "../core/prefs.js";
import { bus, EV } from "../core/bus.js";
import { pickFolder, clearFolder, status, usage, requestPersistence, folderApiSupported } from "./storage.js";
import { userCount } from "./auth.js";

export function createSettingsModule({ getUser, onLogout, checkUpdate }) {
  let box;

  const toggle = (label, hint, key) => {
    const input = h("input", { type: "checkbox", checked: !!getPref(key), onchange: (e) => setPref(key, e.target.checked).then(() => bus.emit(EV.RECORDS_CHANGED)) });
    return h("label", { class: "switch-row" }, h("div", {}, h("div", { class: "sw-title" }, label), h("div", { class: "info-text" }, hint)), input);
  };

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
        h("h3", { class: "card-title" }, "ارسال به سرور"),
        toggle("ارسال خودکار هنگام اتصال به اینترنت", "به‌محض آنلاین شدن، موارد ارسال‌نشده خودکار ارسال می‌شوند.", "autoSync"),
        toggle("نمایش اطلاعات همه کاربران این گوشی", "اگر چند نفر از یک گوشی استفاده می‌کنند، بایگانی و گزارش همه را نشان می‌دهد.", "allUsersOnPhone")
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
    title: "تنظیمات",
    icon: "⚙️",
    mount(container) { box = container; },
    onShow: render,
  };
}
