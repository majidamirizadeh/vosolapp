/** مؤلفه‌های مشترک رابط کاربری: پیام، تأیید، وضعیت در حال کار */
import { h, toLatinDigits } from "./utils.js";
import { feedback } from "./feedback.js";

function host() {
  let el = document.getElementById("overlay-host");
  if (!el) {
    el = h("div", { id: "overlay-host" });
    document.body.append(el);
  }
  return el;
}

/** پیام کوتاه */
export function toast(message, type = "info", opts = {}) {
  const box = host();
  const t = h("div", { class: `toast toast-${type}`, role: "status" }, h("span", {}, message));
  if (opts.action) {
    t.append(h("button", { type: "button", class: "toast-btn", onclick: () => { opts.action.run(); t.remove(); } }, opts.action.label));
  }
  box.append(t);
  if (type === "success" || type === "error") feedback(type); // صدا/لرزش (طبق تنظیمات) — در همهٔ پیام‌های موفقیت و خطا
  const ms = opts.sticky ? 0 : opts.ms || (type === "error" ? 6000 : 3200);
  if (ms) setTimeout(() => t.remove(), ms);
  return t;
}

function modal(content, buttons) {
  return new Promise((resolve) => {
    const close = (val) => { overlay.remove(); resolve(val); };
    const overlay = h(
      "div",
      { class: "modal-overlay", onclick: (e) => e.target === overlay && close(null) },
      h("div", { class: "modal", role: "dialog", "aria-modal": "true" },
        h("div", { class: "modal-body" }, content),
        h("div", { class: "modal-actions" },
          buttons.map((b) => h("button", { type: "button", class: `btn ${b.cls || "btn-secondary"}`, onclick: () => close(b.value) }, b.label)))
      )
    );
    host().append(overlay);
    overlay.querySelector(".btn:last-child")?.focus();
  });
}

/** انتخاب بین چند گزینه؛ مقدار گزینه انتخابی یا null (بستن) */
export const choiceBox = (title, options) =>
  modal([h("h3", {}, title)], options.map((o) => ({ label: o.label, cls: o.cls || "btn-primary", value: o.value })));

const msgNode = (m) => (m instanceof Node ? m : h("p", { style: "white-space:pre-line" }, m));

export const alertBox = (message, title) =>
  modal([title && h("h3", {}, title), msgNode(message)].filter(Boolean), [{ label: "باشه", cls: "btn-primary", value: true }]);

export const confirmBox = async (message, { yes = "بله", no = "انصراف", danger = false, title } = {}) =>
  (await modal([title && h("h3", {}, title), msgNode(message)].filter(Boolean), [
    { label: no, cls: "btn-secondary", value: false },
    { label: yes, cls: danger ? "btn-danger" : "btn-primary", value: true },
  ])) === true;

/**
 * تأیید با «نوشتن دوباره»: کاربر باید مقدار مورد انتظار (مثلاً شماره اشتراک) را دوباره تایپ کند.
 * @param {Node|string} message  متن/عنصر بالای کادر
 * @param {{expect:string, yes?:string, no?:string, label?:string, mismatch?:string}} opts
 * @returns {Promise<boolean>} true فقط وقتی مقدار تایپ‌شده با expect یکی باشد
 */
export function confirmTyped(message, { expect, yes = "تأیید و ثبت", no = "اصلاح", label = "دوباره بنویسید", mismatch = "با مقدار واردشده در فرم یکی نیست" } = {}) {
  const norm = (v) => toLatinDigits(String(v ?? "")).replace(/\D/g, "");
  const want = norm(expect);
  return new Promise((resolve) => {
    const close = (val) => { overlay.remove(); resolve(val); };
    const input = h("input", { type: "text", inputmode: "numeric", dir: "ltr", class: "ltr-in confirm-input", autocomplete: "off", "aria-label": label, placeholder: label });
    const err = h("p", { class: "confirm-err hidden" }, mismatch);
    const okBtn = h("button", { type: "button", class: "btn btn-primary", disabled: true, onclick: () => submit() }, yes);
    const submit = () => { if (norm(input.value) === want && want) close(true); };
    input.addEventListener("input", () => {
      const typed = norm(input.value);
      const good = typed === want && !!want;
      okBtn.disabled = !good;
      // وقتی هم‌طول شد ولی یکی نبود پیام بده
      err.classList.toggle("hidden", good || typed.length < want.length);
    });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } });
    const overlay = h("div", { class: "modal-overlay" },
      h("div", { class: "modal", role: "dialog", "aria-modal": "true" },
        h("div", { class: "modal-body" }, msgNode(message), h("label", { class: "confirm-lbl" }, label), input, err),
        h("div", { class: "modal-actions" },
          h("button", { type: "button", class: "btn btn-secondary", onclick: () => close(false) }, no), okBtn)));
    host().append(overlay);
    setTimeout(() => input.focus(), 50);
  });
}

/** پوشش «در حال انجام…» با امکان به‌روزرسانی متن */
export function busy(text = "لطفاً صبر کنید…") {
  const label = h("div", { class: "busy-text" }, text);
  const bar = h("div", { class: "busy-bar" }, h("i"));
  const el = h("div", { class: "busy-overlay" }, h("div", { class: "busy-card" }, h("div", { class: "spinner" }), label, bar));
  host().append(el);
  bar.style.display = "none";
  return {
    text: (t) => (label.textContent = t),
    progress: (ratio) => {
      bar.style.display = "";
      bar.firstChild.style.width = `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%`;
    },
    done: () => el.remove(),
  };
}

/** کلید بازشو برای انتخاب سریع بازه (امروز، هفته، ماه …) — onPick(kind) */
export function rangeSelect(presets, onPick) {
  const sel = h("select", { class: "range-select", "aria-label": "بازه سریع" },
    h("option", { value: "" }, "📅 انتخاب بازه سریع…"),
    presets.map(([k, label]) => h("option", { value: k }, label)));
  sel.addEventListener("change", () => { if (sel.value) onPick(sel.value); });
  return sel;
}
