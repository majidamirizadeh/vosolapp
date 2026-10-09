/** مؤلفه‌های مشترک رابط کاربری: پیام، تأیید، وضعیت در حال کار */
import { h } from "./utils.js";

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

const msgNode = (m) => (m instanceof Node ? m : h("p", { style: "white-space:pre-line" }, m));

export const alertBox = (message, title) =>
  modal([title && h("h3", {}, title), msgNode(message)].filter(Boolean), [{ label: "باشه", cls: "btn-primary", value: true }]);

export const confirmBox = async (message, { yes = "بله", no = "انصراف", danger = false, title } = {}) =>
  (await modal([title && h("h3", {}, title), msgNode(message)].filter(Boolean), [
    { label: no, cls: "btn-secondary", value: false },
    { label: yes, cls: danger ? "btn-danger" : "btn-primary", value: true },
  ])) === true;

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
