/**
 * دیتا پیکر شمسی (تقویم) — کاملاً آفلاین، بدون کتابخانهٔ بیرونی
 *
 * attachDatePicker(input): کادر را «فقط‌خواندنی» می‌کند (کیبورد باز نمی‌شود)؛ با لمس آن تقویم از پایین باز می‌شود.
 * قالب مقدار همان قبلی است: 1405/07/15 (با ارقام لاتین) و رویدادهای input/change هم فرستاده می‌شوند.
 * مقداردهی برنامه‌نویسی (input.value = "...") مثل قبل کار می‌کند.
 */
import { h, toPersianDigits } from "./utils.js";
import { toGregorian, daysInJalaliMonth, parseJalali, todayJalali } from "./jalali.js";

const MONTHS = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];
const WEEK = ["ش", "ی", "د", "س", "چ", "پ", "ج"]; // شنبه تا جمعه
const pad = (n) => String(n).padStart(2, "0");
const fa = (n) => toPersianDigits(String(n));

const ICON_PREV = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>';
const ICON_NEXT = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m15 6-6 6 6 6"/></svg>';

let openSheet = null; // فقط یک تقویم همزمان

/** اندیس روز هفته (شنبه = 0) برای اولین روز ماه شمسی */
function firstWeekday(jy, jm) {
  const g = toGregorian(jy, jm, 1);
  const d = new Date(g.gy, g.gm - 1, g.gd, 12);
  return (d.getDay() + 1) % 7;
}

function openPicker(input) {
  if (openSheet) return;
  const today = parseJalali(todayJalali());
  const cur = parseJalali(input.value);
  let vy = (cur || today).jy, vm = (cur || today).jm; // ماهِ در حال نمایش
  let yearMode = false;

  const close = () => { sheet.remove(); openSheet = null; document.removeEventListener("keydown", onKey, true); };
  const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };

  const choose = (jy, jm, jd) => {
    input.value = `${jy}/${pad(jm)}/${pad(jd)}`;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    close();
  };

  const title = h("button", { type: "button", class: "dp-title", "aria-label": "انتخاب سال", onclick: () => { yearMode = !yearMode; render(); } });
  const body = h("div", { class: "dp-body" });
  const prev = h("button", { type: "button", class: "dp-nav", "aria-label": "ماه قبل", html: ICON_PREV, onclick: () => step(-1) });
  const next = h("button", { type: "button", class: "dp-nav", "aria-label": "ماه بعد", html: ICON_NEXT, onclick: () => step(1) });

  function step(d) {
    if (yearMode) { vy += d * 12; }
    else { vm += d; if (vm < 1) { vm = 12; vy--; } if (vm > 12) { vm = 1; vy++; } }
    vy = Math.min(1600, Math.max(1300, vy));
    render();
  }

  function render() {
    body.replaceChildren();
    if (yearMode) {
      title.textContent = `${fa(vy - 5)} – ${fa(vy + 6)}`;
      const grid = h("div", { class: "dp-years" });
      for (let y = vy - 5; y <= vy + 6; y++) {
        grid.append(h("button", {
          type: "button", class: "dp-year" + (y === vy ? " sel" : "") + (y === today.jy ? " today" : ""),
          onclick: () => { vy = y; yearMode = false; render(); },
        }, fa(y)));
      }
      body.append(grid);
      return;
    }
    title.textContent = `${MONTHS[vm - 1]} ${fa(vy)}`;
    const grid = h("div", { class: "dp-grid" }, WEEK.map((w) => h("span", { class: "dp-wd" }, w)));
    const lead = firstWeekday(vy, vm);
    for (let i = 0; i < lead; i++) grid.append(h("span", { class: "dp-empty" }));
    const n = daysInJalaliMonth(vy, vm);
    for (let d = 1; d <= n; d++) {
      const isSel = cur && cur.jy === vy && cur.jm === vm && cur.jd === d;
      const isToday = today.jy === vy && today.jm === vm && today.jd === d;
      const col = (lead + d - 1) % 7; // ستون ۶ = جمعه
      grid.append(h("button", {
        type: "button", class: "dp-day" + (isSel ? " sel" : "") + (isToday ? " today" : "") + (col === 6 ? " fri" : ""),
        onclick: () => choose(vy, vm, d),
      }, fa(d)));
    }
    body.append(grid);
  }

  const sheet = h("div", { class: "dp-overlay", onclick: (e) => e.target === sheet && close() },
    h("div", { class: "dp-sheet", role: "dialog", "aria-modal": "true", "aria-label": "انتخاب تاریخ", dir: "rtl" },
      h("div", { class: "dp-head" }, prev, title, next),
      body,
      h("div", { class: "dp-foot" },
        h("button", { type: "button", class: "btn btn-secondary", onclick: close }, "بستن"),
        h("button", { type: "button", class: "btn btn-primary", onclick: () => choose(today.jy, today.jm, today.jd) }, "امروز"))
    ));
  render();
  openSheet = sheet;
  document.addEventListener("keydown", onKey, true);
  (document.getElementById("overlay-host") || document.body).append(sheet);
}

/** کادر تاریخ را به دیتا پیکر تبدیل می‌کند و همان input را برمی‌گرداند */
export function attachDatePicker(input) {
  input.readOnly = true;                  // کیبورد باز نشود
  input.setAttribute("inputmode", "none");
  input.classList.add("dp-input");
  input.addEventListener("click", () => { if (!input.disabled) openPicker(input); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (!input.disabled) openPicker(input); }
  });
  return input;
}
