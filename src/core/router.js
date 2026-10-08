/**
 * مسیریاب تب‌ها — هر ماژول: { id, title, icon, mount(container), onShow?, onHide?, badge?() }
 * برای افزودن بخش جدید فقط یک ماژول بنویسید و در main.js ثبت کنید.
 */
import { h, toPersianDigits } from "./utils.js";
import { bus, EV } from "./bus.js";

export function createRouter(modules, navEl, viewEl) {
  const panes = new Map();
  const buttons = new Map();
  let current = null;

  for (const m of modules) {
    const pane = h("section", { class: "pane", id: `tab-${m.id}`, hidden: true });
    viewEl.append(pane);
    panes.set(m.id, pane);
    const badge = h("span", { class: "nav-badge hidden" });
    const btn = h("button", { type: "button", class: "nav-btn", "data-tab": m.id, onclick: () => show(m.id) },
      h("span", { class: "nav-ico" }, m.icon), h("span", { class: "nav-lbl" }, m.title), badge);
    btn._badge = badge;
    buttons.set(m.id, btn);
    navEl.append(btn);
  }

  async function mountAll() {
    for (const m of modules) await m.mount(panes.get(m.id));
  }

  async function refreshBadges() {
    for (const m of modules) {
      if (!m.badge) continue;
      const n = await m.badge();
      const b = buttons.get(m.id)._badge;
      b.textContent = toPersianDigits(n);
      b.classList.toggle("hidden", !n);
    }
  }

  async function show(id) {
    if (current === id) { modules.find((m) => m.id === id).onShow?.(); return; }
    const prev = modules.find((m) => m.id === current);
    prev?.onHide?.();
    for (const [pid, pane] of panes) {
      const on = pid === id;
      pane.hidden = !on;
      pane.classList.toggle("active", on);
      buttons.get(pid).classList.toggle("active", on);
    }
    current = id;
    await modules.find((m) => m.id === id).onShow?.();
    refreshBadges();
    window.scrollTo(0, 0);
  }

  bus.on(EV.RECORDS_CHANGED, refreshBadges);
  return { mountAll, show, refreshBadges, get current() { return current; } };
}
