/**
 * تب «فرم جدید»: فیلدها، GPS، عکس‌ها، ذخیره در گوشی
 */
import { CONFIG } from "../../config/app.config.js";
import { FIELDS, MODES, WARNING_DEADLINES, RESOLVE_MAX_PHOTOS } from "../../config/modes.js";
import { isBakhsh } from "../../config/cities.js";
import { todayJalali, parseJalali } from "../core/jalali.js";
import { attachDatePicker } from "../core/datepicker.js";
import { h, toLatinDigits, toPersianDigits, normalizeText, formatMoney } from "../core/utils.js";
import { alertBox, confirmBox, choiceBox, toast, busy } from "../core/ui.js";
import { kv } from "../core/db.js";
import { getPref } from "../core/prefs.js";
import { downscale, stampPhoto } from "./photos.js";
import { createRecord, updateRecord, markDeviceSaved, pendingResolutionFor } from "./records.js";
import { saveFiles } from "./storage.js";
import { sendRecord, serverConfigured } from "./sync.js";
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
  };
  let root, photoBox, amountLabelEl, gpsInfo, gpsAcc, gpsBtn, modeSel, editBanner, saveBtn, deadlineSel, deadlineField, bannerText;

  const mode = () => MODES[state.mode];

  function revokePhotos() {
    state.photos.forEach((p) => p && URL.revokeObjectURL(p.url));
    state.photos = state.slots.map(() => null);
  }

  /* ───────── عکس‌ها ───────── */
  function renderPhotos() {
    photoBox.replaceChildren();
    photoBox.style.setProperty("--n", Math.min(state.slots.length, 4)); // تعداد ستون = تعداد عکس‌ها
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

  /** «مهلت اخطار» — فقط در «صدور اخطار» دیده می‌شود و اجباری است */
  function buildDeadlineField() {
    deadlineSel = h("select", { id: "f-deadline" },
      h("option", { value: "" }, "انتخاب کنید"),
      WARNING_DEADLINES.map((d) => h("option", { value: String(d.value) }, d.label)));
    deadlineField = h("div", { class: "field deadline-field hidden" },
      h("label", { for: "f-deadline" }, "مهلت اخطار", h("span", { class: "req" }, " *")), deadlineSel);
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
    if (CONFIG.rules.requireGps && state.gps.lat == null) return "موقعیت GPS را ثبت کنید";
    return null;
  }

  /* ───────── GPS ───────── */
  let gpsBusy = false;

  async function getGps() {
    if (gpsBusy) return;
    if (!navigator.geolocation) return alertBox(geoErrorMessage("unsupported"));
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
      toast("موقعیت ثبت شد ✓", "success", { ms: 1800 });
    } catch (e) {
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
  }

  /* ───────── حالت‌ها ───────── */
  async function setMode(key, force = false) {
    if (state.resolving) return chooseResolveMode(key); // در تعیین تکلیف، عکس‌ها و فیلدها دست نمی‌خورند
    if (key === state.mode && !force) return;
    if (!force && state.photos.some(Boolean)) {
      if (!(await confirmBox("با تغییر نوع فرم، عکس‌های گرفته‌شده پاک می‌شوند. ادامه می‌دهید؟", { yes: "ادامه", danger: true }))) { modeSel.value = state.mode; return; }
    }
    state.mode = key;
    state.slots = [...mode().photoSlots];
    revokePhotos();
    deadlineField.classList.toggle("hidden", key !== "warning");
    modeSel.value = key;
    modeSel.dataset.mode = key; // رنگ کلید انتخاب بر اساس نوع عملیات (CSS)
    amountLabelEl.firstChild.textContent = mode().amountLabel;
    renderPhotos();
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

  /** تأیید شماره اشتراک قبل از ثبت نهایی؛ true = تأیید شد */
  function confirmEshterak(num) {
    const view = h("div", { style: "text-align:center" },
      h("p", {}, "شماره اشتراک واردشده:"),
      h("p", { dir: "ltr", style: "font-size:1.7rem;font-weight:700;letter-spacing:1px;margin:10px 0" }, toPersianDigits(num)),
      h("p", {}, "آیا تأیید می‌کنید؟"));
    return confirmBox(view, { yes: "تأیید و ثبت", no: "اصلاح" });
  }

  /** ذخیره مقادیر ثابت (امور/شهر/سرگروه) برای فرم بعدی */
  async function saveSticky(v) {
    const sticky = {};
    FIELDS.filter((f) => f.sticky).forEach((f) => (sticky[f.key] = v[f.key]));
    await kv.set("sticky", sticky);
  }

  async function save() {
    const user = getUser();
    if (!user) return alertBox("ابتدا وارد شوید");
    if (state.resolving) return saveResolution(user);
    const v = readValues();
    const err = validate(v);
    if (err) return toast(err, "error");

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
    if (!(await confirmEshterak(v.eshterak))) {
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
      // ارسال خودکار بلافاصله بعد از ذخیره (در پس‌زمینه) اگر آنلاین باشیم
      const auto = getPref("autoSync") && navigator.onLine && serverConfigured() && canSend(user);
      if (auto) {
        sendRecord(rec.id).then((res) => {
          if (res.skipped) return;
          toast(res.ok ? "به سرور ارسال شد ✓" : "ارسال خودکار ناموفق بود؛ از تب «بایگانی» دوباره بفرستید", res.ok ? "success" : "error");
        });
      }
      const sendNote = auto
        ? "در حال ارسال خودکار به سرور… (وضعیت در تب «بایگانی»)"
        : wasEdit ? "هنوز ارسال نشده است؛ از تب «بایگانی» ارسال کنید." : "پس از اتصال به اینترنت از تب «بایگانی» ارسال کنید.";
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
    refreshResolveBanner();
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
    window.scrollTo({ top: 0 });
    document.getElementById("view")?.scrollTo({ top: 0 });
    return true;
  }

  /** پیام راهنما بعد از باز شدن تب فرم (از main.js صدا زده می‌شود) */
  function resolveHint() {
    if (state.resolving && !state.resolving.mode)
      alertBox("عملیات جدید را از فهرست «نوع عملیات» (بالای فرم) انتخاب کنید.\n\nفقط «تاریخ» و «عکس‌های جدید» قابل ویرایش‌اند؛ حداقل یک عکس جدید لازم است.", "تعیین تکلیف اخطار");
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
    if (!r.mode) return toast("ابتدا «عملیات جدید» را انتخاب کنید", "error");
    const v = readValues();
    if (!v.date) return toast("«تاریخ» نامعتبر است (مثال: 1405/07/15)", "error");
    const fresh = state.photos.filter((p) => p && !p.existing);
    if (!fresh.length) return toast("حداقل یک عکس جدید لازم است", "error");
    const dup = await pendingResolutionFor(r.warn.uid);
    if (dup) return alertBox("برای این اخطار قبلاً یک تعیین تکلیف ذخیره شده و هنوز ارسال نشده است.\nاز تب «بایگانی» آن را ارسال کنید.", "تعیین تکلیف تکراری");
    if (!(await confirmBox(`اخطار اشتراک ${toPersianDigits(r.warn.eshterak)} با «${MODES[r.mode].title}» تعیین تکلیف شود؟`, { yes: "تأیید و ثبت", no: "برگشت" }))) return;

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
      const auto = getPref("autoSync") && navigator.onLine && serverConfigured() && canSend(user);
      if (auto) {
        sendRecord(rec.id).then((res) => {
          if (res.skipped) return;
          toast(res.ok ? "به سرور ارسال شد ✓ — اخطار از «در جریان» خارج شد" : "ارسال خودکار ناموفق بود؛ از تب «بایگانی» دوباره بفرستید", res.ok ? "success" : "error");
        });
      }
      await alertBox(
        `✅ تعیین تکلیف ذخیره شد${saveNote}\n\n${MODES[r.mode].title} — اشتراک ${toPersianDigits(rec.eshterak)}\n\n${auto ? "در حال ارسال خودکار به سرور…" : "پس از اتصال به اینترنت از تب «بایگانی» ارسال کنید؛ بعد از ارسال، اخطار از «در جریان» خارج می‌شود."}`,
        "تعیین تکلیف اخطار"
      );
      await endResolve();
      onEditDone?.();
    } catch (e) {
      b.done();
      console.error(e);
      alertBox("خطا در ذخیره: " + (e.message || e), "خطا");
    } finally {
      saving = false;
    }
  }

  /* ───────── ویرایش رکورد در انتظار ───────── */

  /** پاک‌کردن کامل فرم و بازگرداندن مقادیر ثابت (sticky) ذخیره‌شده */
  async function clearForm() {
    const sticky = (await kv.get("sticky", {})) || {};
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
      // انتخاب نوع عملیات: یک کلید بازشوی تمام‌عرض (به‌جای ۶ دکمه) که با هر گزینه رنگ خودش را می‌گیرد
      modeSel = h("select", { class: "mode-select", id: "f-mode", "aria-label": "نوع عملیات", onchange: (e) => setMode(e.target.value) },
        Object.entries(MODES).map(([key, m]) => h("option", { value: key }, m.title)));
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
      saveBtn = h("button", { type: "button", class: "btn btn-primary btn-lg", onclick: save }, "ذخیره در گوشی");

      root.append(
        h("div", { class: "card" },
          editBanner,
          h("div", { class: "mode-wrap" }, modeSel),
          h("div", { class: "field-grid" }, FIELDS.flatMap((f) => (f.key === "amount" ? [buildField(f), buildDeadlineField()] : [buildField(f)])), h("div", { class: "field gps-field" }, gpsBtn)),
          h("div", { class: "field photos-field" }, h("label", {}, "عکس‌ها"), photoBox),
          saveBtn
        )
      );

      // با تغییر امور، فهرست شهر/بخش عوض می‌شود؛ با تغییر شهر/بخش، «آبادی» فعال/غیرفعال می‌شود
      state.inputs[cityDef.dependsOn].addEventListener("change", () => { fillCityOptions(false); syncAbadi(); });
      state.inputs[cityDef.key].addEventListener("change", syncAbadi);

      // ذخیرهٔ خودکار پیش‌نویس با هر تغییر فیلد؛ و فوراً وقتی برنامه پنهان/بسته می‌شود
      root.addEventListener("input", () => scheduleDraft());
      root.addEventListener("change", () => scheduleDraft());
      document.addEventListener("visibilitychange", () => { if (document.hidden && draftTimer) flushDraft(); });
      window.addEventListener("pagehide", () => { if (draftTimer) flushDraft(); });

      // مقادیر اولیه
      const sticky = (await kv.get("sticky", {})) || {};
      for (const f of FIELDS) {
        if (f.sticky && sticky[f.key]) state.inputs[f.key].value = sticky[f.key];
        if (f.key === cityDef.dependsOn) fillCityOptions(false);
      }
      syncAbadi();
      applyLeader();
      state.inputs.date.value = todayJalali();
      await setMode(state.mode, true);
    },
    onShow() {
      if (!draftChecked) { draftChecked = true; checkDraft(); } // بدون انتظار؛ پرسش پیش‌نویس روی فرم باز می‌شود
      if (!state.editing && !state.resolving) applyLeader();
      // تاریخ پیش‌فرض اگر روز عوض شده یا خالی است
      if (!state.inputs.date.value) state.inputs.date.value = todayJalali();
    },
  };
}
