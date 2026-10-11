/**
 * صفحهٔ خوش‌آمدگویی بعد از ورود
 * - بعد از هر ورود نشان داده می‌شود.
 * - اگر مرورگر انتخاب پوشه را پشتیبانی کند و کاربر هنوز پوشه‌ای انتخاب نکرده باشد، دکمهٔ «انتخاب پوشه ذخیره‌سازی»
 *   هر بار که برنامه باز می‌شود دوباره نشان داده می‌شود (تا پوشه انتخاب شود).
 * همان توابع تنظیمات (storage.js) استفاده می‌شوند؛ داده یا منطق دیگری تغییر نمی‌کند.
 */
import { CONFIG } from "../../config/app.config.js";
import { h, toPersianDigits } from "../core/utils.js";
import { todayJalali } from "../core/jalali.js";
import { toast } from "../core/ui.js";
import { ICONS } from "../core/icons.js";
import { pickFolder, status, folderApiSupported } from "./storage.js";

function greeting() {
  const hr = new Date().getHours();
  if (hr < 5) return "شب بخیر";
  if (hr < 12) return "صبح بخیر";
  if (hr < 17) return "ظهر بخیر";
  if (hr < 20) return "عصر بخیر";
  return "شب بخیر";
}

export function showWelcome(host, { userLabel }) {
  return new Promise((resolve) => {
    const folderBox = h("div", { class: "wl-folder" });
    const go = h("button", { type: "button", class: "btn btn-primary btn-lg", id: "welcomeGo" }, "ورود به برنامه");
    const later = h("button", { type: "button", class: "wl-later", id: "welcomeLater" }, "فعلاً ادامه می‌دهم");

    const finish = () => { el.remove(); resolve(); };
    go.addEventListener("click", finish);
    later.addEventListener("click", finish);

    async function pick() {
      try { await pickFolder(); toast("پوشه انتخاب شد", "success"); }
      catch (e) { if (e && e.name !== "AbortError") toast(e.message || String(e), "error"); }
      render();
    }

    async function render() {
      const st = await status();
      const chosen = st.mode === "folder";
      folderBox.replaceChildren();
      later.hidden = true;
      if (!folderApiSupported()) {
        folderBox.append(h("p", { class: "info-text center" }, "فایل‌ها در پوشهٔ Download گوشی ذخیره می‌شوند."));
        return;
      }
      if (chosen) {
        folderBox.classList.add("ok");
        folderBox.append(
          h("div", { class: "wl-fhead" }, h("span", { class: "wl-ico", html: ICONS.check }), h("b", {}, `پوشهٔ «${st.folderName}» انتخاب شد`)),
          h("p", { class: "info-text" }, `فایل‌ها داخل پوشه‌ای به نام ${CONFIG.device.folderName} در همین پوشه ذخیره می‌شوند. تغییر پوشه: تنظیمات.`)
        );
        return;
      }
      folderBox.classList.remove("ok");
      later.hidden = false;
      folderBox.append(
        h("div", { class: "wl-fhead" }, h("span", { class: "wl-ico", html: ICONS.folder }), h("b", {}, "پوشهٔ ذخیره‌سازی انتخاب نشده است")),
        h("p", { class: "info-text" }, "یک پوشه (مثلاً Documents) انتخاب کنید تا عکس‌ها و فایل‌ها مرتب داخل آن ذخیره شوند. تا انتخاب نکنید، این صفحه هر بار نشان داده می‌شود."),
        h("button", { type: "button", class: "btn btn-warning", id: "pickFolderBtn", onclick: pick }, h("span", { class: "ico-sm", html: ICONS.folder }), "انتخاب پوشه ذخیره‌سازی")
      );
    }

    const el = h("div", { class: "login-overlay", id: "welcomeOverlay" },
      h("div", { class: "login-box welcome-box" },
        h("img", { src: "assets/icons/icon-192.png", alt: "", class: "login-logo", width: 72, height: 72 }),
        h("h2", {}, "خوش آمدید"),
        h("div", { class: "wl-name" }, `${greeting()}، ${userLabel}`),
        h("p", { class: "info-text center" }, CONFIG.appName),
        h("p", { class: "info-text center" }, toPersianDigits(todayJalali())),
        folderBox,
        go,
        later
      ),
      h("div", { class: "login-credit" }, "تهیه کننده: مجید امیری زاده ، کارشناس مسئول سیستمهای مشترکین")
    );
    host.append(el);
    render();
  });
}
