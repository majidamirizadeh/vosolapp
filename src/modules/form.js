/**
 * تب «فرم جدید»: فیلدها، GPS، عکس‌ها، ذخیره در گوشی
 */
import { CONFIG } from "../../config/app.config.js";
import { FIELDS, MODES, WARNING_DEADLINES, RESOLVE_MAX_PHOTOS, GPS_MAX_FAILS } from "../../config/modes.js";
import { isBakhsh } from "../../config/cities.js";
import { todayJalali, parseJalali } from "../core/jalali.js";
import { attachDatePicker } from "../core/datepicker.js";
import { h, toLatinDigits, toPersianDigits, normalizeText, formatMoney } from "../core/utils.js";
import { alertBox, confirmBox, confirmTyped, choiceBox, toast, busy } from "../core/ui.js";
import { kv } from "../core/db.js";
import { getPref } from "../core/prefs.js";
import { feedback } from "../core/feedback.js";
import { downscale, stampPhoto } from "./photos.js";
import { createRecord, updateRecord, markDeviceSaved, pendingResolutionFor, SEND_DELAY_MS } from "./records.js";
import { saveFiles } from "./storage.js";
import { serverConfigured } from "./sync.js";
import { canSend } from "./auth.js";
import { acquirePosition, geoErrorMessage } from "./geo.js";
import { ICONS } from "../core/icons.js";

const STAMP_LABELS = {
  modeTitle: "عملیات",
  eshterak: "اشتراک",
  date: "تاریخ",
  omoor: "امور",
  city: "شهر/بخش",
  abadi: "آبادی",
  leader: "سرگروه",
  amount: "مبلغ (ریال)",
  userName: "کاربر",
  gps: "GPS",
};

/** ساخت ستون‌های نوار پایین عکس از مقادیر فرم: هر ستون { label (عنوان)، value (مقدار) } */
export function buildStampInfo(v) {
  const cols = [];
  for (const group of CONFIG.stamp.lines) {
    for (const key of group) {
      let val;
      if (key === "gps") val = v.gps?.lat != null ? `\u202A${v.gps.lat.toFixed(5)}, ${v.gps.lng.toFixed(5)}\u202C` : ""; // LTR تا ترتیب اعداد برعکس نشود
      else if (key === "amount") val = v.amount === "" || v.amount == null ? "" : formatMoney(v.amount);
      else val = v[key] === "" || v[key] == null ? "" : toPersianDigits(v[key]);
      if (val !== "") cols.push({ label: STAMP_LABELS[key] || key, value: val });
    }
  }
  return { cols };
}

export function createFormModule({ getUser, onEditDone }) {
  const state = {
    mode: Object.keys(MODES)[0],
    photos: [],            // [{blob,width,height,url}|null]
    gps: { lat: null, lng: null, accuracy: null },
    inputs: {},
    editing: null,         // وقتی در حال ویرایش رکورد در انتظار هستیم: { id, info }
    resolving: null,       // تعیین تکلیف یک اخطار در جریان: { warn, mode } (mode = عملیات جدید انتخاب‌شده یا null)
    slots: [],             // عنوان باکس‌های عکس (معمولاً photoSlots حالت؛ در ویرایش/تعیین تکلیف ممکن است بیشتر باشد)
    gpsFails: 0,           // تعداد تلاش ناموفق دریافت GPS در همین فرم (برای عملیات‌های با GPS اجباری)
    gpsWaived: false,      // بعد از GPS_MAX_FAILS تلاش ناموفق (یا رکورد قدیمیِ بدون GPS) ثبت بدون موقعیت مجاز است
  };
  let root, photoBox, amountLabelEl, gpsInfo, gpsAcc, gpsBtn, modeSel, editBanner, saveBtn, deadlineSel, deadlineField, bannerText;
  // عناصر چیدمان جدید
  let tilesEl, tileEls = [], modeCard, modeSum, modeSumText, modeOpen = true, locCard, locSum, locText, locEditor, gpsCard, gpsHostMain, gpsHostDetail, gpsField, gpsBadge, gpsNote, photoBadge,
    detBtn, detSum, detBody, guideText, stepEl, footEl, chipsEl, locOpen = true, detOpen = false;

  const mode = () => MODES[state.mode];

  function revokePhotos() {
    state.photos.forEach((p) => p && URL.revokeObjectURL(p.url));
    state.photos = state.slots.map(() => null);
  }

  /* ───────── عکس‌ها ───────── */
  function renderPhotos() {
    photoBox.replaceChildren();
    photoBox.style.setProperty("--n", Math.min(state.slots.length, 4)); // تعداد ستون = تعداد عکس‌ها
    photoBox.classList.toggle("single", state.slots.length === 1);
    state.slots.forEach((label, i) => {
      const p = state.photos[i];
      const box = h("div", {
        class: "photo-box" + (p ? " filled" : "") + (p?.locked ? " locked" : ""),
        role: "button", tabindex: 0, "aria-label": label,
        onclick: () => choosePhoto(i),
        onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choosePhoto(i); } },
      },
        p
          ? [h("img", { src: p.url, alt: label }), h("span", { class: "photo-tag" }, label)]
          : h("span", { class: "photo-label" }, h("i", { class: "ph-ico", html: ICONS.camera }), h("span", {}, label)),
        p && !p.locked && h("button", { type: "button", class: "photo-x", "aria-label": "حذف عکس", html: ICONS.close, onclick: (e) => { e.stopPropagation(); removePhoto(i); } })
      );
      photoBox.append(box);
    });
    scheduleDraft(true);
    refreshUi();
  }

  // دو ورودی فایل ثابت: دوربین و گالری (ورودی جدا در DOM نگه داشته می‌شود تا روی همه مرورگرهای موبایل کار کند)
  let camInput, galInput, pickSlot = 0;

  function ensurePickers() {
    if (camInput) return;
    const mk = (extra) => {
      const el = h("input", { type: "file", accept: "image/*", class: "hidden-file", tabindex: -1, "aria-hidden": "true", ...extra,
        onchange: (e) => onPick(pickSlot, e.target) });
      document.body.append(el);
      return el;
    };
    camInput = mk({ capture: "environment" });
    galInput = mk({});
  }

  /** کلیک روی باکس عکس: انتخاب دوربین یا گالری */
  async function choosePhoto(i) {
    if (state.photos[i]?.locked) return; // عکس اخطار در تعیین تکلیف قابل تعویض/حذف نیست
    ensurePickers();
    pickSlot = i;
    if (CONFIG.photos.captureOnly) return camInput.click();
    const how = await choiceBox(state.slots[i], [
      { label: "دوربین", value: "camera" },
      { label: "انتخاب از گالری", value: "gallery", cls: "btn-secondary" },
    ]);
    if (how === "camera") camInput.click();
    else if (how === "gallery") galInput.click();
  }

  async function onPick(i, input) {
    const file = input.files?.[0];
    if (!file) return;
    const b = busy("در حال آماده‌سازی عکس…");
    try {
      const { blob, width, height } = await downscale(file);
      if (state.photos[i]) URL.revokeObjectURL(state.photos[i].url);
      state.photos[i] = { blob, width, height, url: URL.createObjectURL(blob) };
      renderPhotos();
      feedback("photo");
    } catch (e) {
      toast("خواندن عکس ممکن نشد", "error");
    } finally {
      b.done();
      input.value = "";
    }
  }

  function removePhoto(i) {
    URL.revokeObjectURL(state.photos[i].url);
    state.photos[i] = null;
    renderPhotos();
  }

  /* ───────── فیلدها ───────── */
  function buildField(f) {
    const common = { id: `f-${f.key}`, autocomplete: "off", enterkeyhint: "next" };
    let input;
    if (f.type === "digits") input = h("input", { ...common, type: "text", inputmode: "numeric", dir: "ltr", class: "ltr-in" });
    // autocomplete معتبر «transaction-amount» تا مرورگر پیشنهاد رمز/نام کاربری ذخیره‌شده را برای مبلغ نشان ندهد
    else if (f.type === "money") input = h("input", { ...common, autocomplete: "transaction-amount", name: "txn-amount", "data-lpignore": "true", "data-1p-ignore": "true", type: "text", inputmode: "numeric", dir: "ltr", class: "ltr-in", placeholder: "مثال: 1,250,000" });
    else if (f.type === "shamsi") input = attachDatePicker(h("input", { ...common, type: "text", inputmode: "numeric", dir: "ltr", class: "ltr-in", placeholder: "1405/07/15" })); // فقط‌خواندنی؛ با لمس تقویم باز می‌شود
    else if (f.type === "textarea") input = h("textarea", { ...common, rows: 2, placeholder: f.placeholder || "", maxlength: 500 });
    else if (f.type === "select") {
      // لیست انتخابی (مثل «امور»)؛ اگر optionsMap دارد (مثل «شهر/بخش») گزینه‌ها بعد از انتخاب امور پر می‌شود
      input = h("select", { ...common },
        h("option", { value: "" }, f.optionsMap ? `ابتدا ${FIELDS.find((x) => x.key === f.dependsOn)?.label || "مقدار مرتبط"}` : "انتخاب کنید"),
        (f.options || []).map((o) => h("option", { value: o }, o)));
      if (f.optionsMap) input.disabled = true;
    }
    else input = h("input", { ...common, type: "text" });

    if (f.type === "digits") input.addEventListener("input", () => { input.value = toLatinDigits(input.value).replace(/\D/g, ""); });
    if (f.type === "money") input.addEventListener("input", () => {
      const raw = toLatinDigits(input.value).replace(/\D/g, "");
      input.value = raw ? Number(raw).toLocaleString("en-US") : "";
    });
    if (f.type === "shamsi") input.addEventListener("input", () => { input.value = toLatinDigits(input.value).replace(/[^\d/]/g, ""); });

    if (f.key === "abadi") { input.disabled = true; input.placeholder = "فقط برای «بخش»"; } // با انتخاب «بخش…» در شهر/بخش فعال می‌شود

    state.inputs[f.key] = input;
    const label = h("label", { for: input.id }, f.label, f.required && h("span", { class: "req" }, " *"));
    if (f.labelByMode) amountLabelEl = label;
    // راهنما به‌صورت tooltip/placeholder تا چیدمان دو ستونی جمع بماند
    if (f.hint) input.title = f.hint;
    // «سرگروه» به‌صورت خودکار از نام کاربر (name) پر می‌شود و در فرم دیده نمی‌شود (مقدار همچنان ذخیره می‌شود)
    return h("div", { class: "field" + (f.wide ? " wide" : "") + (f.key === "leader" ? " is-auto" : "") }, label, input);
  }

  /** «مهلت اخطار» — فقط در «صدور اخطار» دیده می‌شود و اجباری است؛ دکمه‌های انتخابی روی یک select (برای ذخیره و پیش‌نویس) */
  function buildDeadlineField() {
    deadlineSel = h("select", { id: "f-deadline", class: "sr-only", tabindex: -1, "aria-label": "مهلت اخطار" },
      h("option", { value: "" }, "انتخاب کنید"),
      WARNING_DEADLINES.map((d) => h("option", { value: String(d.value) }, d.label)));
    chipsEl = h("div", { class: "dl-chips", role: "radiogroup", "aria-label": "مهلت اخطار" },
      WARNING_DEADLINES.map((d) => h("button", { type: "button", class: "dl-chip", "data-v": String(d.value), role: "radio",
        onclick: () => {
          if (deadlineSel.disabled) return;
          deadlineSel.value = deadlineSel.value === String(d.value) ? "" : String(d.value);
          deadlineSel.dispatchEvent(new Event("change", { bubbles: true }));
          refreshUi();
        } }, d.label)));
    deadlineField = h("div", { class: "deadline-field hidden" },
      h("span", { class: "dl-lbl" }, "مهلت اخطار", h("span", { class: "req" }, " *")), chipsEl, deadlineSel);
    return deadlineField;
  }

  /* ───────── «شهر/بخش» وابسته به «امور» ، «آبادی» وابسته به «شهر/بخش» ───────── */
  const cityDef = FIELDS.find((x) => x.optionsMap);

  /** فهرست شهر/بخش را از روی امور انتخاب‌شده می‌سازد؛ keep=true مقدار فعلی را (اگر در فهرست باشد) نگه می‌دارد */
  function fillCityOptions(keep = false) {
    const sel = state.inputs[cityDef.key];
    const omoor = state.inputs[cityDef.dependsOn].value;
    const list = cityDef.optionsMap[omoor] || [];
    const prev = keep ? sel.value : "";
    sel.replaceChildren(
      h("option", { value: "" }, omoor ? "انتخاب کنید" : "ابتدا امور"),
      ...list.map((o) => h("option", { value: o }, o)));
    sel.disabled = !omoor;
    sel.value = list.includes(prev) ? prev : "";
  }

  /** «آبادی» فقط وقتی فعال است که شهر/بخش با «بخش» شروع شود؛ در غیر این صورت غیرفعال و خالی می‌ماند */
  function syncAbadi() {
    const el = state.inputs.abadi;
    const on = isBakhsh(state.inputs[cityDef.key].value);
    el.disabled = !on;
    if (!on) el.value = "";
  }

  /** سرگروه = نام کاربر واردشده (نمایش داده نمی‌شود؛ در ثبت، گزارش و جدول‌ها مثل قبل ذخیره می‌شود) */
  function applyLeader() {
    const u = getUser();
    if (u && state.inputs.leader) state.inputs.leader.value = u.name || String(u.code || "");
  }

  function readValues() {
    const v = {};
    for (const f of FIELDS) {
      let val = state.inputs[f.key].value;
      if (f.type === "digits") val = toLatinDigits(val).replace(/\D/g, "");
      else if (f.type === "money") val = Number(toLatinDigits(val).replace(/\D/g, "")) || 0;
      else if (f.type === "shamsi") val = parseJalali(val)?.text || "";
      else val = normalizeText(val);
      v[f.key] = val;
    }
    v.deadline = deadlineSel.value ? Number(deadlineSel.value) : "";
    return v;
  }

  function validate(v) {
    for (const f of FIELDS) {
      if (f.type === "shamsi" && !v[f.key]) return `«${f.label}» نامعتبر است (مثال: 1405/07/15)`;
      if (f.required && (v[f.key] === "" || v[f.key] == null || (f.type === "money" && !v[f.key] && state.inputs[f.key].value === ""))) {
        return f.type === "select" ? `«${f.label}» را از فهرست انتخاب کنید` : `«${f.label}» را وارد کنید`;
      }
    }
    if (state.mode === "warning" && !state.resolving && !v.deadline) return "«مهلت اخطار» را انتخاب کنید";
    const n = state.photos.filter(Boolean).length;
    if (n < mode().minPhotos) return `حداقل ${toPersianDigits(mode().minPhotos)} عکس لازم است`;
    if ((CONFIG.rules.requireGps || mode().requireGps) && state.gps.lat == null && !state.gpsWaived) return "موقعیت GPS را ثبت کنید";
    return null;
  }

  /* ───────── خط راهنما: موارد لازم و وضعیت هرکدام ───────── */
  const photoCount = () => state.photos.filter((p) => p && !(state.resolving && p.existing)).length;

  function requirements() {
    const R = state.resolving;
    const val = (k) => String(state.inputs[k].value || "").trim();
    const m = mode();
    const items = [];
    if (R) items.push({ key: "mode", label: "عملیات جدید", ok: !!R.mode });
    items.push({ key: "loc", label: "محل", ok: !!val("omoor") && !!val("city") });
    items.push({ key: "eshterak", label: "اشتراک", ok: !!toLatinDigits(val("eshterak")).replace(/\D/g, "") });
    if (!R || R.mode === "collect") {
      const amt = Number(toLatinDigits(val("amount")).replace(/\D/g, "")) || 0;
      items.push({ key: "amount", label: R ? "مبلغ وصول" : "مبلغ", ok: R ? amt > 0 : val("amount") !== "" });
    }
    if (!R && state.mode === "warning") items.push({ key: "deadline", label: "مهلت", ok: !!deadlineSel.value });
    if (m.requireGps) items.push({ key: "gps", label: "موقعیت GPS", ok: state.gps.lat != null || state.gpsWaived });
    items.push({ key: "photos", label: R ? "عکس جدید" : "عکس", ok: photoCount() >= (R ? 1 : m.minPhotos) });
    if (!parseJalali(state.inputs.date.value)) items.push({ key: "date", label: "تاریخ", ok: false });
    return items;
  }

  /** رفتن به اولین مورد ناقص: بخش مربوط باز می‌شود و روی آن می‌رود */
  function focusItem(key) {
    const go = (el, focus) => {
      if (!el) return;
      el.scrollIntoView?.({ block: "center", behavior: "smooth" });
      if (focus) setTimeout(() => { try { el.focus({ preventScroll: true }); } catch { /* ادامه */ } }, 250);
    };
    if (key === "mode") { modeOpen = true; refreshUi(); return go(modeCard); }
    if (key === "loc") { setLocOpen(true); return go(state.inputs.omoor.value ? state.inputs.city : state.inputs.omoor, true); }
    if (key === "eshterak") return go(state.inputs.eshterak, true);
    if (key === "amount") return go(state.inputs.amount, true);
    if (key === "deadline") return go(chipsEl);
    if (key === "gps") return go(gpsBtn);
    if (key === "photos") return go(photoBox);
    if (key === "date") { setDetOpen(true); return go(state.inputs.date); }
  }

  function setLocOpen(on) {
    locOpen = !!on;
    refreshUi();
  }
  function setDetOpen(on) {
    detOpen = !!on;
    refreshUi();
  }

  /** همهٔ نشان‌های چیدمان (کاشی‌ها، محل، موقعیت، عکس، جزئیات، خط راهنما، کلید ذخیره) را با وضعیت فعلی هماهنگ می‌کند */
  function refreshUi() {
    if (!saveBtn || !guideText) return;
    const R = state.resolving;
    const m = mode();
    const cur = R ? R.mode : state.mode;
    tileEls.forEach(([key, el]) => {
      el.classList.toggle("sel", key === cur);
      el.setAttribute("aria-checked", key === cur ? "true" : "false");
      el.disabled = !!R && key === "warning";
    });
    // نوع عملیات: بعد از انتخاب فشرده می‌شود (با «تغییر» دوباره باز می‌شود)
    const showTiles = modeOpen || !cur;
    tilesEl.classList.toggle("hidden", !showTiles);
    modeSum.classList.toggle("hidden", showTiles);
    modeCard.classList.toggle("open", showTiles);
    if (cur && MODES[cur]) { modeSum.dataset.mode = cur; modeSumText.textContent = MODES[cur].title; }
    // محل
    const omoor = String(state.inputs.omoor.value || ""), city = String(state.inputs.city.value || ""), abadi = String(state.inputs.abadi.value || "").trim();
    const hasLoc = !!omoor && !!city;
    locText.textContent = hasLoc ? [omoor, city, abadi].filter(Boolean).join(" · ") : "هنوز انتخاب نشده";
    const lockedLoc = !!R;
    const showEditor = locOpen && !lockedLoc;
    locCard.classList.toggle("open", showEditor);
    locCard.classList.toggle("empty", !hasLoc);
    locCard.classList.toggle("locked", lockedLoc);
    locSum.classList.toggle("hidden", showEditor);
    locEditor.classList.toggle("hidden", !showEditor);
    // GPS: در عملیات‌های با GPS اجباری، کادر موقعیت بیرون از «جزئیات» و جداگانه می‌آید
    const gReq = !!m.requireGps;
    gpsCard.classList.toggle("hidden", !gReq);
    const host = gReq ? gpsHostMain : gpsHostDetail;
    if (gpsField.parentNode !== host) host.append(gpsField);
    const has = state.gps.lat != null;
    gpsBadge.textContent = has ? "ثبت شد" : state.gpsWaived ? "ثبت بدون موقعیت مجاز است" : "اجباری";
    gpsBadge.className = "pill " + (has ? "g" : state.gpsWaived ? "w" : "d");
    gpsNote.textContent = has ? "" : state.gpsWaived
      ? "دریافت موقعیت ناموفق بود؛ می‌توانید بدون موقعیت ثبت کنید یا دوباره تلاش کنید."
      : state.gpsFails > 0 ? `تلاش ${toPersianDigits(state.gpsFails)} از ${toPersianDigits(GPS_MAX_FAILS)} ناموفق بود؛ دوباره امتحان کنید.` : "";
    gpsNote.classList.toggle("hidden", !gpsNote.textContent);
    // عکس‌ها
    const need = R ? 1 : m.minPhotos, n = photoCount(), total = state.slots.filter((_, i) => !(R && state.photos[i]?.existing)).length;
    photoBadge.textContent = n >= need ? (n < total ? `${toPersianDigits(n)} از ${toPersianDigits(total)} — کافی است` : `${toPersianDigits(n)} از ${toPersianDigits(total)}`) : `حداقل ${toPersianDigits(need)} عکس لازم است`;
    photoBadge.className = "pill " + (n >= need ? "g" : "d");
    // مهلت
    chipsEl.querySelectorAll(".dl-chip").forEach((c) => {
      const on = c.dataset.v === deadlineSel.value;
      c.classList.toggle("on", on);
      c.setAttribute("aria-checked", on ? "true" : "false");
      c.disabled = deadlineSel.disabled;
    });
    // جزئیات بیشتر
    detBody.classList.toggle("hidden", !detOpen);
    detBtn.classList.toggle("open", detOpen);
    const dateTxt = String(state.inputs.date.value || "").trim();
    detSum.textContent = [dateTxt ? toPersianDigits(dateTxt) : "", !gReq && (has ? "موقعیت ✓" : "موقعیت —"), String(state.inputs.note.value || "").trim() && "توضیحات ✓"].filter(Boolean).join(" · ");
    // خط راهنما و کلید ذخیره
    const items = requirements();
    const miss = items.filter((i) => !i.ok);
    guideText.textContent = miss.length ? "لازم است: " + miss.map((i) => i.label).join("، ") : "همه‌چیز کامل است ✓";
    guideText.classList.toggle("bad", miss.length > 0);
    guideText.classList.toggle("good", miss.length === 0);
    stepEl.replaceChildren(...items.map((i) => h("i", { class: i.ok ? "d" : "" })));
    stepEl.classList.toggle("all", miss.length === 0);
    saveBtn.classList.toggle("is-off", miss.length > 0);
    saveBtn.classList.toggle("is-go", miss.length === 0);
    saveBtn.setAttribute("aria-disabled", miss.length ? "true" : "false");
    footEl.dataset.first = miss[0]?.key || "";
  }

  /* ───────── GPS ───────── */
  let gpsBusy = false;

  async function getGps() {
    if (gpsBusy) return;
    if (!navigator.geolocation) {
      if (state.gps.lat == null) { state.gpsFails = GPS_MAX_FAILS; state.gpsWaived = true; refreshUi(); }
      return alertBox(geoErrorMessage("unsupported"));
    }
    gpsBusy = true;
    gpsBtn.disabled = true;
    gpsBtn.classList.add("loading");
    gpsInfo.textContent = "در حال دریافت…";
    gpsInfo.removeAttribute("dir");
    gpsAcc.textContent = "";
    try {
      // دقت‌های بهتر به‌مرور در همین فرم نمایش داده می‌شود
      const fix = await acquirePosition({ onUpdate: (f) => { state.gps = f; showGps(); gpsInfo.classList.add("live"); } });
      state.gps = fix;
      state.gpsFails = 0;
      state.gpsWaived = false;
      toast("موقعیت ثبت شد ✓", "success", { ms: 1800 });
    } catch (e) {
      // در عملیات‌های با GPS اجباری: بعد از GPS_MAX_FAILS تلاش ناموفق (یا وقتی گوشی/آدرس اصلاً GPS ندارد) ثبت بدون موقعیت مجاز می‌شود
      if (state.gps.lat == null) {
        state.gpsFails++;
        if (state.gpsFails >= GPS_MAX_FAILS || e.kind === "unsupported" || e.kind === "insecure") state.gpsWaived = true;
      }
      await alertBox(e.kind ? geoErrorMessage(e.kind) : "خطا در دریافت موقعیت: " + (e.message || e), "موقعیت مکانی (GPS)");
    } finally {
      gpsBusy = false;
      gpsBtn.disabled = false;
      gpsBtn.classList.remove("loading");
      gpsInfo.classList.remove("live");
      showGps();
      scheduleDraft();
    }
  }

  /** نمایش وضعیت GPS داخل خودِ دکمه (مختصات + دقت) */
  function showGps() {
    const g = state.gps;
    const has = g.lat != null;
    gpsBtn.classList.toggle("has-fix", has);
    gpsBtn.title = has ? "دریافت مجدد موقعیت" : "دریافت موقعیت فعلی";
    if (has) {
      gpsInfo.setAttribute("dir", "ltr");
      gpsInfo.textContent = `${g.lat.toFixed(5)}, ${g.lng.toFixed(5)}`;
      gpsAcc.textContent = g.accuracy != null ? `±${toPersianDigits(g.accuracy)}م` : "";
    } else {
      gpsInfo.removeAttribute("dir");
      gpsInfo.textContent = "ثبت موقعیت فعلی";
      gpsAcc.textContent = "";
    }
    refreshUi();
  }

  /* ───────── حالت‌ها ───────── */
  /** لمس کاشی: نوع را انتخاب می‌کند و اگر انتخاب انجام شد کاشی‌ها فشرده می‌شوند */
  async function pickMode(key) {
    await setMode(key);
    const chosen = state.resolving ? state.resolving.mode : state.mode;
    if (chosen === key) modeOpen = false;
    refreshUi();
  }

  async function setMode(key, force = false) {
    if (state.resolving) return chooseResolveMode(key); // در تعیین تکلیف، عکس‌ها و فیلدها دست نمی‌خورند
    if (key === state.mode && !force) return;
    if (!force && state.photos.some(Boolean)) {
      if (!(await confirmBox("با تغییر نوع فرم، عکس‌های گرفته‌شده پاک می‌شوند. ادامه می‌دهید؟", { yes: "ادامه", danger: true }))) { modeSel.value = state.mode; return; }
    }
    state.mode = key;
    state.slots = [...mode().photoSlots];
    revokePhotos();
    state.gpsFails = 0;
    state.gpsWaived = false;
    deadlineField.classList.toggle("hidden", key !== "warning");
    modeSel.value = key;
    modeSel.dataset.mode = key; // رنگ کاشی/کلید انتخاب بر اساس نوع عملیات (CSS)
    amountLabelEl.firstChild.textContent = mode().amountLabel;
    renderPhotos(); // خودش refreshUi را هم صدا می‌زند
  }

  /* ───────── پیش‌نویس خودکار (۲۴ ساعت) ─────────
   * فرم ذخیره‌نشده (فیلدها + عکس‌های خام کوچک‌شده) در IndexedDB نگه داشته می‌شود تا با بستن/مینیمایز شدن برنامه یا
   * رفرش شدن صفحه (مثلاً هنگام باز شدن دوربین) از بین نرود. بار بعد کاربر تصمیم می‌گیرد: ادامه یا حذف.
   * هر کاربر پیش‌نویس خودش را دارد؛ بعد از ثبت موفق، حذف یا گذشت ۲۴ ساعت پاک می‌شود. در حالت ویرایش ذخیره نمی‌شود. */
  const DRAFT_TTL = 24 * 3600 * 1000;
  const dKey = (u) => `draft:${u.code}`;
  const pKey = (u) => `draftph:${u.code}`;
  let draftChecked = false, draftTimer = null, draftReady = false, photosDirty = false, restoring = false, saving = false, draftGen = 0;

  function isDirty() {
    if (state.photos.some(Boolean) || state.gps.lat != null) return true;
    return FIELDS.some((f) => !f.sticky && f.key !== "date" && f.key !== "leader" && String(state.inputs[f.key].value || "").trim() !== "");
  }

  function scheduleDraft(photosChanged = false) {
    if (photosChanged) photosDirty = true;
    if (!draftReady || state.editing || state.resolving || restoring) return;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(flushDraft, 700);
  }

  async function clearDraft() {
    clearTimeout(draftTimer);
    draftTimer = null;
    draftGen++;
    photosDirty = false;
    const u = getUser();
    if (!u) return;
    try { await kv.del(dKey(u)); await kv.del(pKey(u)); } catch { /* مهم نیست */ }
  }

  async function flushDraft() {
    clearTimeout(draftTimer);
    draftTimer = null;
    const u = getUser();
    if (!u || !draftReady || state.editing || state.resolving || restoring || saving) return;
    const gen = draftGen;
    try {
      if (!isDirty()) { await clearDraft(); return; }
      const values = {};
      for (const f of FIELDS) if (f.key !== "leader") values[f.key] = state.inputs[f.key].value;
      values.deadline = deadlineSel.value;
      if (photosDirty) {
        photosDirty = false;
        const photos = state.photos.map((p) => (p ? { blob: p.blob, width: p.width, height: p.height } : null));
        if (gen !== draftGen) return;
        await kv.set(pKey(u), { mode: state.mode, photos });
      }
      if (gen !== draftGen) return;
      await kv.set(dKey(u), { t: Date.now(), mode: state.mode, values, gps: state.gps, n: state.photos.filter(Boolean).length });
    } catch (e) {
      photosDirty = true;
      console.warn("draft", e);
    }
  }

  function ago(ms) {
    const m = Math.max(1, Math.round(ms / 60000));
    if (m < 60) return `${toPersianDigits(m)} دقیقه`;
    const hh = Math.floor(m / 60), mm = m % 60;
    return `${toPersianDigits(hh)} ساعت` + (mm ? ` و ${toPersianDigits(mm)} دقیقه` : "");
  }

  async function restoreDraft(d, pr) {
    restoring = true;
    try {
      state.mode = MODES[d.mode] ? d.mode : Object.keys(MODES)[0];
      await setMode(state.mode, true);
      for (const f of FIELDS) {
        if (f.key === "leader") continue;
        const el = state.inputs[f.key];
        const val = d.values?.[f.key] ?? "";
        if (f.type === "select" && val && ![...el.options].some((o) => o.value === val)) continue; // مقدار قدیمی که در فهرست نیست
        el.value = val;
        if (f.key === cityDef.dependsOn) fillCityOptions(false);
      }
      if (!state.inputs.date.value) state.inputs.date.value = todayJalali();
      deadlineSel.value = [...deadlineSel.options].some((o) => o.value === String(d.values?.deadline || "")) ? String(d.values?.deadline || "") : "";
      syncAbadi();
      applyLeader();
      state.gps = d.gps && d.gps.lat != null ? d.gps : { lat: null, lng: null, accuracy: null };
      showGps();
      state.photos.forEach((p) => p && URL.revokeObjectURL(p.url));
      const okPhotos = pr && pr.mode === state.mode && Array.isArray(pr.photos);
      state.photos = state.slots.map((_, i) => {
        const p = okPhotos ? pr.photos[i] : null;
        return p?.blob ? { blob: p.blob, width: p.width, height: p.height, url: URL.createObjectURL(p.blob) } : null;
      });
      locOpen = !(state.inputs.omoor.value && state.inputs.city.value);
      modeOpen = false; // پیش‌نویس یعنی نوع قبلاً انتخاب شده بود
      renderPhotos();
    } finally {
      restoring = false;
    }
  }

  /** یک بار بعد از باز شدن فرم: اگر پیش‌نویس معتبر هست از کاربر می‌پرسد */
  async function checkDraft() {
    const u = getUser();
    try {
      const d = u && (await kv.get(dKey(u), null));
      if (d && Date.now() - d.t > DRAFT_TTL) { await clearDraft(); return; }
      if (!d || d.mode == null) return;
      const pr = await kv.get(pKey(u), null);
      const nPhotos = pr && pr.mode === d.mode ? (pr.photos || []).filter((p) => p?.blob).length : 0;
      const small = "font-size:.84rem;font-weight:400;line-height:1.9;margin-top:4px;color:var(--ink2)";
      const view = h("div", { style: "text-align:center" },
        h("div", {}, "فرم ذخیره‌نشده دارید"),
        h("div", { style: small }, `${MODES[d.mode]?.title || ""}${d.values?.eshterak ? " — اشتراک " + toPersianDigits(d.values.eshterak) : ""}`),
        h("div", { style: small }, `${toPersianDigits(nPhotos)} عکس — ${ago(Date.now() - d.t)} پیش`),
        h("div", { style: small }, "ادامه می‌دهید یا پیش‌نویس حذف شود؟"));
      let how = null;
      while (!how) { // بستن با لمس بیرون = بدون تصمیم؛ دوباره می‌پرسیم تا پیش‌نویس ناخواسته گم نشود
        how = await choiceBox(view, [
          { label: "حذف پیش‌نویس", value: "drop", cls: "btn-secondary" },
          { label: "ادامهٔ فرم", value: "restore" },
        ]);
      }
      if (how === "restore") await restoreDraft(d, pr);
      else await clearDraft();
    } catch (e) {
      console.warn("draft", e);
    } finally {
      draftReady = true;
    }
  }

  /* ───────── ذخیره ───────── */

  /** ارسال خودکار برای این کاربر فعال است؟ (حساب تست و حالت خاموش: نه) */
  const autoSendOn = (user) => getPref("autoSync") && serverConfigured() && canSend(user);
  const delayMin = () => Math.round(SEND_DELAY_MS / 60000);

  /** یادآوری قرمز تأخیر ارسال (در کادر تأیید و پیام‌های بعد از ذخیره) */
  function delayNotice(user) {
    if (!autoSendOn(user) || !SEND_DELAY_MS) return null;
    return h("p", { class: "delay-note" }, `ارسال به سرور ${toPersianDigits(delayMin())} دقیقه بعد از ذخیره انجام می‌شود؛ تا آن زمان می‌توانید از تب «بایگانی» ویرایش کنید.`);
  }

  /** تأیید نهایی با «نوشتن دوباره شمارهٔ اشتراک» (شماره روی کادر نمایش داده نمی‌شود)؛ true = تأیید شد */
  function confirmEshterak(num, user, title = "تأیید شماره اشتراک") {
    const view = h("div", { style: "text-align:center" },
      h("h3", {}, title),
      h("p", {}, "برای اطمینان، شمارهٔ اشتراک را دوباره بنویسید:"),
      delayNotice(user));
    return confirmTyped(view, { expect: num, yes: "تأیید و ثبت", no: "اصلاح", label: "شمارهٔ اشتراک را دوباره بنویسید", mismatch: "با شمارهٔ واردشده در فرم یکی نیست؛ دوباره بنویسید یا «اصلاح» را بزنید" });
  }

  /** مقادیر ثابت (امور/شهر/آبادی/سرگروه) «به‌ازای هر کاربر»؛ اگر هنوز برای این کاربر ذخیره نشده، مقدار قدیمیِ مشترک گوشی خوانده می‌شود */
  const stickyKey = () => { const u = getUser(); return u ? `sticky:${u.code}` : "sticky"; };
  async function loadSticky() {
    try {
      const own = await kv.get(stickyKey(), null);
      if (own && typeof own === "object") return own;
      return (await kv.get("sticky", {})) || {};
    } catch { return {}; }
  }

  /** ذخیره مقادیر ثابت (امور/شهر/آبادی/سرگروه) برای فرم بعدی همین کاربر */
  async function saveSticky(v) {
    const sticky = {};
    FIELDS.filter((f) => f.sticky).forEach((f) => (sticky[f.key] = v[f.key]));
    await kv.set(stickyKey(), sticky);
  }

  async function save() {
    const user = getUser();
    if (!user) return alertBox("ابتدا وارد شوید");
    if (state.resolving) return saveResolution(user);
    const v = readValues();
    const err = validate(v);
    if (err) {
      toast(err, "error");
      const first = requirements().find((i) => !i.ok);
      if (first) focusItem(first.key);
      return;
    }

    // اگر عکس‌های قبلی (مهرخورده) نگه داشته شده‌اند ولی اطلاعات روی مهر عوض شده، هشدار بده
    if (state.editing) {
      const newStamp = buildStampInfo({ ...v, modeTitle: mode().title, userName: state.editing.userName, gps: state.gps });
      const changed = JSON.stringify(newStamp) !== JSON.stringify(state.editing.stamp);
      if (changed && state.photos.some((p) => p?.existing)) {
        const ok = await confirmBox(
          "اطلاعات روی عکس‌های قبلی درج شده و با ویرایش تغییر نمی‌کند.\nاگر می‌خواهید اطلاعات جدید روی عکس باشد، همان عکس‌ها را دوباره بگیرید.\n\nبا همین عکس‌ها ادامه می‌دهید؟",
          { yes: "ادامه", no: "برمی‌گردم" }
        );
        if (!ok) return;
      }
    }

    // تأیید شماره اشتراک
    if (!(await confirmEshterak(v.eshterak, user))) {
      state.inputs.eshterak.focus();
      return;
    }

    const b = busy("در حال درج اطلاعات روی عکس‌ها…");
    saving = true; // تا پایان ذخیره، پیش‌نویس نوشته نمی‌شود
    try {
      const info = buildStampInfo({ ...v, modeTitle: mode().title, userName: state.editing?.userName || user.name, gps: state.gps });
      const picked = state.photos.filter(Boolean);
      const stamped = [];
      // عکس قبلی دوباره مهر نمی‌خورد؛ عکس تازه مهر می‌خورد
      for (const p of picked) {
        if (p.existing) stamped.push({ blob: p.blob, width: p.width, height: p.height, name: p.name });
        else stamped.push(await stampPhoto(p.blob, info));
      }

      b.text("در حال ذخیره در گوشی…");
      let rec, toSave;
      if (state.editing) {
        const out = await updateRecord(state.editing.id, { ...v, mode: state.mode, gps: state.gps }, stamped);
        rec = out.record;
        toSave = rec.photos.filter((p) => out.newNames.includes(p.name));
      } else {
        rec = await createRecord({ ...v, mode: state.mode, user, gps: state.gps }, stamped);
        toSave = rec.photos;
      }

      // نسخه قابل‌مشاهده عکس‌ها در حافظه گوشی (پوشه/دانلودها)
      let saveNote = "";
      if (getPref("autoSavePhotos") && toSave.length) {
        b.text("ذخیره فایل عکس‌ها در گوشی…");
        const res = await saveFiles(toSave.map((p) => ({ name: p.name, blob: p.blob })), [rec.date.replace(/\//g, "-")]);
        await markDeviceSaved(rec.id, res.saved === toSave.length);
        saveNote = res.method === "folder" ? " (در پوشه انتخابی)" : res.method === "downloads" ? " (در پوشه دانلود)" : "";
        if (res.error) toast("ذخیره فایل‌ها در گوشی کامل نشد؛ از بایگانی دوباره تلاش کنید", "error");
      }

      const wasEdit = !!state.editing;
      if (!wasEdit) await saveSticky(v);

      b.done();
      // ارسال خودکار با تأخیر (SEND_DELAY_MS) توسط autosend.js انجام می‌شود؛ اینجا فوراً چیزی ارسال نمی‌شود
      const auto = autoSendOn(user);
      const sendNote = auto
        ? (SEND_DELAY_MS ? `ارسال خودکار به سرور ${toPersianDigits(delayMin())} دقیقه دیگر انجام می‌شود (تا آن زمان از تب «بایگانی» قابل ویرایش است).` : "ارسال خودکار به سرور انجام می‌شود (وضعیت در تب «بایگانی»).")
        : wasEdit ? "هنوز ارسال نشده است؛ از تب «بایگانی» ارسال کنید." : "پس از اتصال به اینترنت از تب «بایگانی» ارسال کنید.";
      feedback("success");
      await alertBox(
        `${wasEdit ? "✅ تغییرات ذخیره شد" : "✅ ذخیره شد"}${saveNote}\n\nعکس‌ها:\n${rec.photos.map((p) => p.name).join("\n")}\n\n${sendNote}`,
        wasEdit ? "ویرایش موفق" : "ثبت موفق"
      );
      if (wasEdit) {
        await endEdit();
        onEditDone?.();
      } else { await clearDraft(); resetAfterSave(); }
    } catch (e) {
      b.done();
      console.error(e);
      feedback("error");
      alertBox("خطا در ذخیره: " + (e.message || e), "خطا");
    } finally {
      saving = false;
    }
  }

  function resetAfterSave() {
    for (const f of FIELDS) {
      if (f.sticky || f.key === "date") continue;
      state.inputs[f.key].value = "";
    }
    syncAbadi();
    applyLeader();
    deadlineSel.value = "";
    state.gps = { lat: null, lng: null, accuracy: null };
    state.gpsFails = 0;
    state.gpsWaived = false;
    detOpen = false;
    showGps();
    revokePhotos();
    renderPhotos();
    state.inputs.eshterak.focus();
    window.scrollTo({ top: 0, behavior: "smooth" });
    document.getElementById("view")?.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* ───────── تعیین تکلیف اخطار در جریان ─────────
   * اخطار ارسال‌شده در فرم باز می‌شود؛ همهٔ باکس‌ها فقط‌خواندنی‌اند به‌جز «تاریخ» و عکس‌های جدید.
   * کاربر «عملیات جدید» را انتخاب می‌کند؛ حداقل یک عکس جدید لازم است و مجموع عکس‌های قبلی و جدید حداکثر ۴ است.
   * با ثبت، یک رکورد «جدید» ساخته می‌شود (عکس‌های قبلی هم در آن می‌آیند)؛ بعد از ارسال موفق، اخطار از «در جریان» خارج می‌شود. */

  /** گزینه‌های «نوع عملیات»: در حالت عادی همه؛ در تعیین تکلیف: «انتخاب عملیات جدید» + عملیات‌ها بدون «صدور اخطار» */
  function setModeOptions(resolving) {
    modeSel.replaceChildren(
      ...(resolving ? [h("option", { value: "" }, "عملیات جدید را انتخاب کنید")] : []),
      ...Object.entries(MODES).filter(([k]) => !resolving || k !== "warning").map(([key, m]) => h("option", { value: key }, m.title)));
  }

  /** خروج از ظاهر «تعیین تکلیف» (فیلدها باز، فهرست کامل عملیات‌ها) — بدون پاک‌کردن مقادیر */
  function leaveResolveUi() {
    if (!state.resolving && !deadlineSel.disabled && modeSel.options.length === Object.keys(MODES).length) return;
    state.resolving = null;
    setFieldsLocked(false);
    setModeOptions(false);
    refreshUi();
  }

  function setFieldsLocked(lock) {
    for (const f of FIELDS) if (f.key !== "date") state.inputs[f.key].disabled = lock;
    deadlineSel.disabled = lock;
  }

  function refreshResolveBanner() {
    const r = state.resolving;
    const e = toPersianDigits(r.warn.eshterak);
    bannerText.textContent = r.mode ? `تعیین تکلیف اخطار با ${MODES[r.mode].title}` : `تعیین تکلیف اخطار اشتراک ${e} — عملیات جدید را انتخاب کنید`;
    saveBtn.textContent = "ثبت تعیین تکلیف";
  }

  /** انتخاب عملیات جدید (یا برگشت به «انتخاب نشده») بدون دست‌زدن به عکس‌ها */
  function chooseResolveMode(key) {
    const r = state.resolving;
    r.mode = MODES[key] && key !== "warning" ? key : null;
    modeSel.value = r.mode || "";
    modeSel.dataset.mode = r.mode || "";
    if (r.mode) { state.mode = r.mode; amountLabelEl.firstChild.textContent = mode().amountLabel; }
    // مبلغ: فقط برای «وصول مطالبات» آزاد است (باید مبلغ وصول‌شده وارد شود)؛ برای بقیه عملیات‌ها قفل و همان مبلغ اخطار می‌ماند
    const amt = state.inputs.amount;
    if (r.mode === "collect") {
      if (amt.disabled) { amt.disabled = false; amt.value = ""; }
    } else {
      amt.disabled = true;
      amt.value = r.warn.amount ? Number(r.warn.amount).toLocaleString("en-US") : "";
    }
    refreshResolveBanner();
    refreshUi();
  }

  async function startResolve(warn) {
    if (!warn || warn.mode !== "warning") return false;
    const dirty = state.photos.some(Boolean) || state.inputs.eshterak.value.trim() || state.inputs.amount.value.trim();
    if (dirty || state.editing || state.resolving) {
      if (!(await confirmBox("اطلاعات نیمه‌کاره‌ی فرم فعلی پاک می‌شود. ادامه می‌دهید؟", { yes: "ادامه", danger: true }))) return false;
    }
    await clearDraft();
    state.editing = null;
    leaveResolveUi();
    state.mode = "warning";
    await setMode("warning", true); // عکس‌ها و فیلدهای فرم قبلی را پاک می‌کند
    for (const f of FIELDS) {
      const el = state.inputs[f.key];
      let val = warn[f.key] ?? "";
      if (f.type === "money") val = val ? Number(val).toLocaleString("en-US") : "";
      if (f.type === "select" && val && ![...el.options].some((o) => o.value === val)) el.append(h("option", { value: val }, val));
      el.value = val;
      if (f.key === cityDef.dependsOn) fillCityOptions(false);
    }
    // فهرست شهر پس از تعیین امور ساخته می‌شود؛ مقدار شهر دوباره گذاشته شود
    const cityEl = state.inputs[cityDef.key];
    if (warn.city && ![...cityEl.options].some((o) => o.value === warn.city)) cityEl.append(h("option", { value: warn.city }, warn.city));
    cityEl.value = warn.city || "";
    syncAbadi();
    state.inputs.abadi.value = warn.abadi || "";
    state.inputs.date.value = todayJalali(); // تاریخ عملیات جدید: امروز (قابل ویرایش)
    state.gps = { lat: warn.gpsLat ?? null, lng: warn.gpsLng ?? null, accuracy: warn.gpsAccuracy ?? null };
    showGps();

    state.resolving = { warn, mode: null };
    setModeOptions(true);
    modeSel.value = "";
    modeSel.dataset.mode = "";
    deadlineField.classList.add("hidden");
    // عکس‌های اخطار (قفل) + جای عکس‌های جدید؛ مجموع حداکثر ۴
    const old = (warn.photos || []).slice(0, RESOLVE_MAX_PHOTOS);
    const fresh = Math.max(1, RESOLVE_MAX_PHOTOS - old.length);
    state.photos.forEach((p) => p && URL.revokeObjectURL(p.url));
    state.slots = [...old.map((_, i) => `عکس اخطار${old.length > 1 ? " " + toPersianDigits(i + 1) : ""}`), ...Array.from({ length: fresh }, (_, i) => `عکس جدید${fresh > 1 ? " " + toPersianDigits(i + 1) : ""}`)];
    state.photos = [
      ...old.map((p) => ({ blob: p.blob, width: p.width, height: p.height, name: p.name, existing: true, locked: true, url: URL.createObjectURL(p.blob) })),
      ...Array.from({ length: fresh }, () => null),
    ];
    renderPhotos();
    setFieldsLocked(true);
    editBanner.classList.remove("hidden");
    refreshResolveBanner();
    locOpen = false;
    modeOpen = true; // تعیین تکلیف: نوع عملیات جدید باید انتخاب شود
    detOpen = false;
    state.gpsFails = 0;
    state.gpsWaived = false;
    refreshUi();
    window.scrollTo({ top: 0 });
    document.getElementById("view")?.scrollTo({ top: 0 });
    return true;
  }

  /** پیام راهنما بعد از باز شدن تب فرم (از main.js صدا زده می‌شود) */
  function resolveHint() {
    if (state.resolving && !state.resolving.mode)
      alertBox("عملیات جدید را از فهرست «نوع عملیات» (بالای فرم) انتخاب کنید.\n\nفقط «تاریخ» و «عکس‌های جدید» قابل ویرایش‌اند (اگر «وصول مطالبات» را انتخاب کنید، «مبلغ وصول» هم آزاد می‌شود)؛ حداقل یک عکس جدید لازم است.", "تعیین تکلیف اخطار");
  }

  async function endResolve() {
    leaveResolveUi();
    editBanner.classList.add("hidden");
    saveBtn.textContent = "ذخیره در گوشی";
    state.mode = Object.keys(MODES)[0];
    await clearForm();
  }

  async function cancelResolve() {
    if (!(await confirmBox("از تعیین تکلیف منصرف می‌شوید؟ اخطار همچنان «در جریان» می‌ماند.", { yes: "انصراف", no: "ادامه", danger: true }))) return;
    await endResolve();
    onEditDone?.();
  }

  async function saveResolution(user) {
    const r = state.resolving;
    if (!r.mode) { toast("ابتدا «عملیات جدید» را انتخاب کنید", "error"); return focusItem("mode"); }
    const v = readValues();
    if (!v.date) return toast("«تاریخ» نامعتبر است (مثال: 1405/07/15)", "error");
    if (r.mode === "collect" && !(Number(v.amount) > 0)) { toast("«مبلغ وصول» را وارد کنید", "error"); return focusItem("amount"); }
    const fresh = state.photos.filter((p) => p && !p.existing);
    if (!fresh.length) { toast("حداقل یک عکس جدید لازم است", "error"); return focusItem("photos"); }
    if (MODES[r.mode].requireGps && state.gps.lat == null && !state.gpsWaived) { toast("موقعیت GPS را ثبت کنید", "error"); return focusItem("gps"); }
    const dup = await pendingResolutionFor(r.warn.uid);
    if (dup) return alertBox("برای این اخطار قبلاً یک تعیین تکلیف ذخیره شده و هنوز ارسال نشده است.\nاز تب «بایگانی» آن را ارسال کنید.", "تعیین تکلیف تکراری");
    if (!(await confirmEshterak(r.warn.eshterak, user, `تعیین تکلیف اخطار با «${MODES[r.mode].title}»`))) return;

    const b = busy("در حال درج اطلاعات روی عکس‌ها…");
    saving = true;
    try {
      const info = buildStampInfo({ ...v, modeTitle: MODES[r.mode].title, userName: user.name, gps: state.gps });
      const stamped = [];
      for (const p of state.photos.filter(Boolean)) {
        if (p.existing) stamped.push({ blob: p.blob, width: p.width, height: p.height });
        else stamped.push(await stampPhoto(p.blob, info));
      }
      b.text("در حال ذخیره در گوشی…");
      const rec = await createRecord({ ...v, mode: r.mode, user, gps: state.gps, resolvesUid: r.warn.uid }, stamped);
      let saveNote = "";
      if (getPref("autoSavePhotos") && rec.photos.length) {
        b.text("ذخیره فایل عکس‌ها در گوشی…");
        const res = await saveFiles(rec.photos.map((p) => ({ name: p.name, blob: p.blob })), [rec.date.replace(/\//g, "-")]);
        await markDeviceSaved(rec.id, res.saved === rec.photos.length);
        saveNote = res.method === "folder" ? " (در پوشه انتخابی)" : res.method === "downloads" ? " (در پوشه دانلود)" : "";
      }
      b.done();
      const auto = autoSendOn(user);
      feedback("success");
      await alertBox(
        `✅ تعیین تکلیف ذخیره شد${saveNote}\n\n${MODES[r.mode].title} — اشتراک ${toPersianDigits(rec.eshterak)}\n\n${auto ? (SEND_DELAY_MS ? `ارسال خودکار به سرور ${toPersianDigits(delayMin())} دقیقه دیگر انجام می‌شود (تا آن زمان از تب «بایگانی» قابل ویرایش است)؛ بعد از ارسال، اخطار از «در جریان» خارج می‌شود.` : "ارسال خودکار به سرور انجام می‌شود.") : "پس از اتصال به اینترنت از تب «بایگانی» ارسال کنید؛ بعد از ارسال، اخطار از «در جریان» خارج می‌شود."}`,
        "تعیین تکلیف اخطار"
      );
      await endResolve();
      onEditDone?.();
    } catch (e) {
      b.done();
      console.error(e);
      feedback("error");
      alertBox("خطا در ذخیره: " + (e.message || e), "خطا");
    } finally {
      saving = false;
    }
  }

  /* ───────── ویرایش رکورد در انتظار ───────── */

  /** پاک‌کردن کامل فرم و بازگرداندن مقادیر ثابت (sticky) ذخیره‌شده */
  async function clearForm() {
    const sticky = await loadSticky();
    for (const f of FIELDS) {
      const el = state.inputs[f.key];
      el.value = f.sticky && sticky[f.key] ? sticky[f.key] : "";
      if (f.sticky && el.value !== (sticky[f.key] || "")) el.value = ""; // مقدار قدیمی که در فهرست نیست
      if (f.key === cityDef.dependsOn) fillCityOptions(false); // فهرست شهر/بخش مربوط به همین امور
    }
    syncAbadi();
    applyLeader();
    state.inputs.date.value = todayJalali();
    state.gps = { lat: null, lng: null, accuracy: null };
    deadlineSel.value = "";
    showGps();
    await setMode(state.mode, true);
    locOpen = !(state.inputs.omoor.value && state.inputs.city.value); // محل از آخرین انتخاب پر شده؟ فشرده؛ وگرنه باز
    modeOpen = true;
    detOpen = false;
    refreshUi();
  }

  async function endEdit() {
    state.editing = null;
    editBanner.classList.add("hidden");
    saveBtn.textContent = "ذخیره در گوشی";
    await clearForm();
  }

  async function cancelEdit() {
    if (!(await confirmBox("از ویرایش منصرف می‌شوید؟ تغییرات ذخیره نمی‌شود.", { yes: "انصراف از ویرایش", no: "ادامه ویرایش", danger: true }))) return;
    await endEdit();
    onEditDone?.();
  }

  /** ورود به حالت ویرایش؛ فقط برای رکوردهای status === "pending" */
  async function startEdit(rec) {
    if (!rec || rec.status !== "pending") { toast("فقط موارد ارسال‌نشده قابل ویرایش‌اند", "error"); return false; }
    const dirty = state.photos.some(Boolean) || state.inputs.eshterak.value.trim() || state.inputs.amount.value.trim();
    if (dirty || state.editing) {
      if (!(await confirmBox("اطلاعات نیمه‌کاره‌ی فرم فعلی پاک می‌شود. ادامه می‌دهید؟", { yes: "ادامه", danger: true }))) return false;
    }
    await clearDraft(); // فرم نیمه‌کاره (و پیش‌نویسش) با تأیید کاربر کنار می‌رود
    leaveResolveUi();
    state.mode = MODES[rec.mode] ? rec.mode : Object.keys(MODES)[0];
    await setMode(state.mode, true);
    deadlineSel.value = String(rec.deadlineHours || "");
    // رکورد قدیمی ممکن است عکس بیشتری از باکس‌های فعلی داشته باشد؛ هیچ عکسی حذف نشود
    while (state.slots.length < (rec.photos?.length || 0)) state.slots.push(`عکس ${toPersianDigits(state.slots.length + 1)}`);
    for (const f of FIELDS) {
      const el = state.inputs[f.key];
      let val = rec[f.key] ?? "";
      if (f.type === "money") val = val ? Number(val).toLocaleString("en-US") : "";
      if (f.type === "select" && val && ![...el.options].some((o) => o.value === val)) {
        el.append(h("option", { value: val }, val)); // مقدار قدیمی که در فهرست جدید نیست
      }
      el.value = val;
      if (f.key === cityDef.dependsOn) fillCityOptions(false); // فهرست شهر/بخش مربوط به امور این مورد
    }
    syncAbadi();
    state.gps = { lat: rec.gpsLat ?? null, lng: rec.gpsLng ?? null, accuracy: rec.gpsAccuracy ?? null };
    state.gpsFails = 0;
    state.gpsWaived = rec.gpsLat == null; // رکوردی که قبلاً بدون موقعیت ذخیره شده، برای ویرایش GPS اجباری نمی‌شود
    locOpen = !(rec.omoor && rec.city);
    modeOpen = false; // ویرایش: نوع عملیات از قبل مشخص است
    detOpen = false;
    showGps();
    // عکس‌های فعلی در اسلات‌ها (قابل حذف/تعویض)
    state.photos.forEach((p) => p && URL.revokeObjectURL(p.url));
    state.photos = state.slots.map((_, i) => {
      const p = rec.photos?.[i];
      return p ? { blob: p.blob, width: p.width, height: p.height, name: p.name, existing: true, url: URL.createObjectURL(p.blob) } : null;
    });
    renderPhotos();
    state.editing = {
      id: rec.id,
      userName: rec.userName,
      stamp: buildStampInfo({ ...rec, modeTitle: rec.modeTitle, userName: rec.userName, gps: { lat: rec.gpsLat, lng: rec.gpsLng } }),
    };
    bannerText.textContent = `ویرایش مورد اشتراک ${toPersianDigits(rec.eshterak)}`;
    editBanner.classList.remove("hidden");
    saveBtn.textContent = "ذخیره تغییرات";
    window.scrollTo({ top: 0 });
    document.getElementById("view")?.scrollTo({ top: 0 });
    return true;
  }

  return {
    id: "form",
    title: "فرم جدید",
    icon: ICONS.form,
    startEdit,
    startResolve,
    resolveHint,
    async mount(container) {
      root = container;
      // نوع عملیات: کاشی‌های رنگی (یک لمس)؛ یک select مخفی (پشتیبانی دسترسی‌پذیری/ابزارها) هم‌گام می‌ماند
      modeSel = h("select", { class: "mode-select sr-only", id: "f-mode", "aria-label": "نوع عملیات", tabindex: -1, onchange: (e) => setMode(e.target.value) },
        Object.entries(MODES).map(([key, m]) => h("option", { value: key }, m.title)));
      tileEls = Object.entries(MODES).map(([key, m]) =>
        [key, h("button", { type: "button", class: "mode-tile", "data-mode": key, role: "radio", "aria-checked": "false", onclick: () => pickMode(key) }, m.title)]);
      tilesEl = h("div", { class: "mode-tiles", role: "radiogroup", "aria-label": "نوع عملیات" }, tileEls.map((t) => t[1]));
      modeSumText = h("span", { class: "loc-val" });
      modeSum = h("div", { class: "loc-sum mode-sum hidden" },
        h("div", { class: "loc-tx" }, h("small", {}, "نوع عملیات"), modeSumText),
        h("button", { type: "button", class: "loc-edit", onclick: () => { modeOpen = true; refreshUi(); } }, "تغییر"));
      modeCard = h("div", { class: "sec mode-card" }, modeSum, tilesEl, modeSel);

      photoBox = h("div", { class: "photos" });
      gpsInfo = h("span", { class: "gps-val" }, "ثبت موقعیت فعلی");
      gpsAcc = h("span", { class: "gps-acc" });
      gpsBtn = h("button", { type: "button", class: "gps-btn", onclick: getGps, "aria-label": "دریافت موقعیت مکانی (GPS)" },
        h("span", { class: "gps-lbl" }, "موقعیت (GPS)"),
        h("span", { class: "gps-line" }, gpsInfo), gpsAcc,
        h("span", { class: "gps-ico", html: ICONS.pin }));

      bannerText = h("b", {}, "ویرایش");
      editBanner = h("div", { class: "edit-banner hidden" },
        bannerText,
        h("button", { type: "button", class: "btn btn-secondary btn-sm", onclick: () => (state.resolving ? cancelResolve() : cancelEdit()) }, "انصراف"));
      saveBtn = h("button", { type: "button", class: "btn btn-primary btn-lg save-btn is-off", onclick: save }, "ذخیره در گوشی");

      // فیلدها (همه با همان شناسه‌های قبلی f-…) و چیدمان جدید: محل ← مشخصات ← (GPS اجباری) ← عکس ← جزئیات بیشتر
      const F = {};
      FIELDS.forEach((f) => { F[f.key] = buildField(f); });
      const deadlineEl = buildDeadlineField();

      locText = h("span", { class: "loc-val" });
      locSum = h("div", { class: "loc-sum" },
        h("div", { class: "loc-tx" }, h("small", {}, "محل (آخرین انتخاب شما)"), locText),
        h("button", { type: "button", class: "loc-edit", onclick: () => setLocOpen(true) }, "تغییر"));
      locEditor = h("div", { class: "loc-editor hidden" },
        h("div", { class: "sec-t" }, "محل"),
        h("div", { class: "field-grid fg loc-grid" }, F.omoor, F.city, F.abadi),
        h("button", { type: "button", class: "btn btn-secondary btn-xs loc-ok", onclick: () => {
          if (!(state.inputs.omoor.value && state.inputs.city.value)) return toast("«امور» و «شهر/بخش» را انتخاب کنید", "error");
          setLocOpen(false);
        } }, "تأیید محل"));
      locCard = h("div", { class: "sec loc-card" }, locSum, locEditor);

      const mainCard = h("div", { class: "sec main-card" },
        h("div", { class: "sec-t" }, "مشخصات اشتراک"),
        h("div", { class: "field-grid fg main-grid" }, F.eshterak, F.amount),
        deadlineEl);

      gpsField = h("div", { class: "field gps-field" }, gpsBtn);
      gpsHostMain = h("div", { class: "gps-host" });
      gpsHostDetail = h("div", { class: "gps-host det-gps" });
      gpsBadge = h("span", { class: "pill d" }, "اجباری");
      gpsNote = h("div", { class: "gps-note hidden" });
      gpsCard = h("div", { class: "sec gps-card hidden" }, h("div", { class: "sec-t" }, "موقعیت مکانی (GPS)", gpsBadge), gpsHostMain, gpsNote);
      gpsHostDetail.append(gpsField);

      photoBadge = h("span", { class: "pill d" });
      const photosSec = h("div", { class: "sec photos-sec" }, h("div", { class: "sec-t" }, "عکس‌ها", photoBadge), photoBox);

      detSum = h("span", { class: "det-sum" });
      detBtn = h("button", { type: "button", class: "det-btn", onclick: () => setDetOpen(!detOpen) },
        h("span", { class: "det-t" }, "جزئیات بیشتر"), detSum, h("span", { class: "chev", html: ICONS.chevron }));
      detBody = h("div", { class: "det-body field-grid fg hidden" }, F.date, gpsHostDetail, F.note, F.leader);
      const detSec = h("div", { class: "sec det-sec" }, detBtn, detBody);

      guideText = h("span", { class: "gd-text" });
      stepEl = h("div", { class: "stepline" });
      footEl = h("div", { class: "form-foot" },
        h("div", { class: "guide", role: "button", tabindex: 0, title: "رفتن به مورد ناقص",
          onclick: () => { const k = footEl.dataset.first; if (k) focusItem(k); },
          onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); const k = footEl.dataset.first; if (k) focusItem(k); } } }, guideText, stepEl),
        saveBtn);

      root.append(
        h("div", { class: "card" },
          editBanner,
          h("div", { class: "form-flow" }, modeCard, locCard, mainCard, gpsCard, photosSec, detSec),
          footEl
        )
      );

      // با تغییر امور، فهرست شهر/بخش عوض می‌شود؛ با تغییر شهر/بخش، «آبادی» فعال/غیرفعال می‌شود
      state.inputs[cityDef.dependsOn].addEventListener("change", () => { fillCityOptions(false); syncAbadi(); });
      state.inputs[cityDef.key].addEventListener("change", () => {
        syncAbadi();
        // شهر (غیر از «بخش») انتخاب شد: محل کامل است و فشرده می‌شود (برای «بخش» باید آبادی هم دیده شود؛ با «تأیید محل» بسته می‌شود)
        const c = state.inputs[cityDef.key].value;
        if (c && !isBakhsh(c) && !state.resolving) locOpen = false;
        refreshUi();
      });

      // ذخیرهٔ خودکار پیش‌نویس با هر تغییر فیلد؛ و فوراً وقتی برنامه پنهان/بسته می‌شود
      root.addEventListener("input", () => { scheduleDraft(); refreshUi(); });
      root.addEventListener("change", () => { scheduleDraft(); refreshUi(); });
      document.addEventListener("visibilitychange", () => { if (document.hidden && draftTimer) flushDraft(); });
      window.addEventListener("pagehide", () => { if (draftTimer) flushDraft(); });

      // مقادیر اولیه
      const sticky = await loadSticky();
      for (const f of FIELDS) {
        if (f.sticky && sticky[f.key]) state.inputs[f.key].value = sticky[f.key];
        if (f.key === cityDef.dependsOn) fillCityOptions(false);
      }
      syncAbadi();
      applyLeader();
      state.inputs.date.value = todayJalali();
      await setMode(state.mode, true);
      locOpen = !(state.inputs.omoor.value && state.inputs.city.value);
      modeOpen = true;
      refreshUi();
    },
    onShow() {
      if (!draftChecked) { draftChecked = true; checkDraft(); } // بدون انتظار؛ پرسش پیش‌نویس روی فرم باز می‌شود
      if (!state.editing && !state.resolving) applyLeader();
      // تاریخ پیش‌فرض اگر روز عوض شده یا خالی است
      if (!state.inputs.date.value) state.inputs.date.value = todayJalali();
      refreshUi();
    },
  };
}
