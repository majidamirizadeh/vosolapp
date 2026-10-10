/** صفحه ورود */
import { h } from "../core/utils.js";
import { login, userCount } from "./auth.js";
import { CONFIG } from "../../config/app.config.js";

export function showLogin(host) {
  return new Promise((resolve) => {
    const code = h("input", { type: "text", id: "loginCode", inputmode: "numeric", autocomplete: "username", placeholder: "مثال: 01", dir: "ltr", class: "ltr-in" });
    const pass = h("input", { type: "password", id: "loginPass", autocomplete: "current-password", placeholder: "رمز عبور", dir: "ltr", class: "ltr-in" });
    const err = h("div", { class: "login-err", role: "alert" });
    const btn = h("button", { type: "button", class: "btn btn-primary btn-lg", id: "loginBtn" }, "ورود");

    async function submit() {
      err.textContent = "";
      if (!userCount()) { err.textContent = "فهرست کاربران بارگذاری نشده است. یک بار با اینترنت برنامه را باز کنید."; return; }
      btn.disabled = true;
      const s = await login(code.value, pass.value);
      btn.disabled = false;
      if (!s) { err.textContent = "کد کاربری یا رمز عبور اشتباه است"; pass.select(); return; }
      el.remove();
      resolve(s);
    }
    btn.addEventListener("click", submit);
    pass.addEventListener("keydown", (e) => e.key === "Enter" && submit());

    const el = h("div", { class: "login-overlay", id: "loginOverlay" },
      h("div", { class: "login-box" },
        h("img", { src: "assets/icons/icon-192.png", alt: "", class: "login-logo", width: 72, height: 72 }),
        h("h2", {}, "ورود به برنامه"),
        h("p", { class: "info-text center" }, CONFIG.appName),
        h("label", { for: "loginCode" }, "کد کاربری"), code,
        h("label", { for: "loginPass" }, "رمز عبور"), pass,
        err, btn,
        h("p", { class: "info-text center" }, "رمز را از مسئول دریافت کنید. ورود بدون اینترنت هم کار می‌کند.")
      ),
      h("div", { class: "login-credit" }, "تهیه کننده: مجید امیری زاده ، کارشناس مسئول سیستمهای مشترکین")
    );
    host.append(el);
    code.focus();
  });
}
