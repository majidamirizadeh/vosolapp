/**
 * تب «فرم جدید»: فیلدها، GPS، عکس‌ها، ذخیره در گوشی
 */
import { CONFIG } from "../../config/app.config.js";
import { FIELDS, MODES } from "../../config/modes.js";
import { todayJalali, parseJalali } from "../core/jalali.js";
import { h, toLatinDigits, toPersianDigits, normalizeText, formatMoney } from "../core/utils.js";
import { alertBox, confirmBox, toast, busy } from "../core/ui.js";
import { kv } from "../core/db.js";
import { getPref } from "../core/prefs.js";
import { downscale, stampPhoto } from "./photos.js";
import { createRecord, updateRecord, markDeviceSaved } from "./records.js";
import { saveFiles } from "./storage.js";
import { sendRecord, serverConfigured } from "./sync.js";
import { canSend } from "./auth.js";

const STAMP_LABELS = {
  modeTitle: "عملیات",
  eshterak: "اشتراک",
  date: "تاریخ",
  omoor: "امور",
  city: "شهر",
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
  };
  let root, photoBox, amountLabelEl, gpsInfo, gpsBtn, modeBtns, editBanner, saveBtn;

  const mode = () => MODES[state.mode];

  function revokePhotos() {
    state.photos.forEach((p) => p && URL.revokeObjectURL(p.url));
    state.photos = mode().photoSlots.map(() => null);
  }

  /* ───────── عکس‌ها ───────── */
  function renderPhotos() {
    photoBox.replaceChildren();
    photoBox.style.setProperty("--n", Math.min(mode().photoSlots.length, 4)); // تعداد ستون = تعداد عکس‌ها
    mode().photoSlots.forEach((label, i) => {
      const p = state.photos[i];
      const input = h("input", {
        type: "file",
        accept: "image/*",
        ...(CONFIG.photos.captureOnly ? { capture: "environment" } : {}),
        "aria-label": label,
        onchange: (e) => onPick(i, e.target),
      });
      const box = h("div", { class: "photo-box" + (p ? " filled" : "") },
        p
          ? [h("img", { src: p.url, alt: label }), h("span", { class: "photo-tag" }, label)]
          : h("span", { class: "photo-label" }, h("b", {}, "📷"), label),
        input,
        p && h("button", { type: "button", class: "photo-x", "aria-label": "حذف عکس", onclick: (e) => { e.stopPropagation(); removePhoto(i); } }, "✕")
      );
      photoBox.append(box);
    });
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
    else if (f.type === "money") input = h("input", { ...common, type: "text", inputmode: "numeric", dir: "ltr", class: "ltr-in", placeholder: "مثال: 1,250,000" });
    else if (f.type === "shamsi") input = h("input", { ...common, type: "text", inputmode: "numeric", dir: "ltr", class: "ltr-in", placeholder: "1405/07/15" });
    else if (f.type === "textarea") input = h("textarea", { ...common, rows: 2, placeholder: f.placeholder || "", maxlength: 500 });
    else if (f.type === "select") {
      // لیست انتخابی (مثل «امور»)
      input = h("select", { ...common },
        h("option", { value: "" }, `— ${f.label} را انتخاب کنید —`),
        (f.options || []).map((o) => h("option", { value: o }, o)));
    }
    else input = h("input", { ...common, type: "text" });

    if (f.type === "digits") input.addEventListener("input", () => { input.value = toLatinDigits(input.value).replace(/\D/g, ""); });
    if (f.type === "money") input.addEventListener("input", () => {
      const raw = toLatinDigits(input.value).replace(/\D/g, "");
      input.value = raw ? Number(raw).toLocaleString("en-US") : "";
    });
    if (f.type === "shamsi") input.addEventListener("input", () => { input.value = toLatinDigits(input.value).replace(/[^\d/]/g, ""); });

    state.inputs[f.key] = input;
    const label = h("label", { for: input.id }, f.label, f.required && h("span", { class: "req" }, " *"));
    if (f.labelByMode) amountLabelEl = label;
    // راهنما به‌صورت tooltip/placeholder تا چیدمان دو ستونی جمع بماند
    if (f.hint) input.title = f.hint;
    return h("div", { class: "field" + (f.wide ? " wide" : "") }, label, input);
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
    return v;
  }

  function validate(v) {
    for (const f of FIELDS) {
      if (f.type === "shamsi" && !v[f.key]) return `«${f.label}» نامعتبر است (مثال: 1405/07/15)`;
      if (f.required && (v[f.key] === "" || v[f.key] == null || (f.type === "money" && !v[f.key] && state.inputs[f.key].value === ""))) {
        return f.type === "select" ? `«${f.label}» را از فهرست انتخاب کنید` : `«${f.label}» را وارد کنید`;
      }
    }
    const n = state.photos.filter(Boolean).length;
    if (n < mode().minPhotos) return `حداقل ${toPersianDigits(mode().minPhotos)} عکس لازم است`;
    if (CONFIG.rules.requireGps && state.gps.lat == null) return "موقعیت GPS را ثبت کنید";
    return null;
  }

  /* ───────── GPS ───────── */
  function getGps() {
    if (!navigator.geolocation) return alertBox("مرورگر شما از موقعیت مکانی پشتیبانی نمی‌کند");
    gpsBtn.disabled = true;
    gpsBtn.textContent = "در حال دریافت…";
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        state.gps = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy) };
        showGps();
        gpsBtn.disabled = false;
        gpsBtn.textContent = "دریافت مجدد موقعیت";
      },
      (err) => {
        toast("خطا در دریافت موقعیت: " + err.message, "error");
        gpsBtn.disabled = false;
        gpsBtn.textContent = "دریافت موقعیت فعلی";
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 }
    );
  }

  function showGps() {
    const g = state.gps;
    gpsInfo.classList.toggle("hidden", g.lat == null);
    if (g.lat != null) {
      gpsInfo.textContent = `عرض: ${g.lat.toFixed(6)}  |  طول: ${g.lng.toFixed(6)}  |  دقت: ${toPersianDigits(g.accuracy)} متر`;
    }
  }

  /* ───────── حالت‌ها ───────── */
  async function setMode(key, force = false) {
    if (key === state.mode && !force) return;
    if (!force && state.photos.some(Boolean)) {
      if (!(await confirmBox("با تغییر نوع فرم، عکس‌های گرفته‌شده پاک می‌شوند. ادامه می‌دهید؟", { yes: "ادامه", danger: true }))) return;
    }
    state.mode = key;
    revokePhotos();
    modeBtns.forEach((b) => b.classList.toggle("active", b.dataset.mode === key));
    amountLabelEl.firstChild.textContent = mode().amountLabel;
    renderPhotos();
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
      } else resetAfterSave();
    } catch (e) {
      b.done();
      console.error(e);
      alertBox("خطا در ذخیره: " + (e.message || e), "خطا");
    }
  }

  function resetAfterSave() {
    for (const f of FIELDS) {
      if (f.sticky || f.key === "date") continue;
      state.inputs[f.key].value = "";
    }
    state.gps = { lat: null, lng: null, accuracy: null };
    showGps();
    gpsBtn.textContent = "دریافت موقعیت فعلی";
    revokePhotos();
    renderPhotos();
    state.inputs.eshterak.focus();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* ───────── ویرایش رکورد در انتظار ───────── */

  /** پاک‌کردن کامل فرم و بازگرداندن مقادیر ثابت (sticky) ذخیره‌شده */
  async function clearForm() {
    const sticky = (await kv.get("sticky", {})) || {};
    for (const f of FIELDS) {
      const el = state.inputs[f.key];
      el.value = f.sticky && sticky[f.key] ? sticky[f.key] : "";
      if (f.sticky && el.value !== (sticky[f.key] || "")) el.value = ""; // مقدار قدیمی که در فهرست نیست
    }
    state.inputs.date.value = todayJalali();
    state.gps = { lat: null, lng: null, accuracy: null };
    showGps();
    gpsBtn.textContent = "دریافت موقعیت فعلی";
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
    state.mode = MODES[rec.mode] ? rec.mode : Object.keys(MODES)[0];
    await setMode(state.mode, true);
    for (const f of FIELDS) {
      const el = state.inputs[f.key];
      let val = rec[f.key] ?? "";
      if (f.type === "money") val = val ? Number(val).toLocaleString("en-US") : "";
      if (f.type === "select" && val && ![...el.options].some((o) => o.value === val)) {
        el.append(h("option", { value: val }, val)); // مقدار قدیمی که در فهرست جدید نیست
      }
      el.value = val;
    }
    state.gps = { lat: rec.gpsLat ?? null, lng: rec.gpsLng ?? null, accuracy: rec.gpsAccuracy ?? null };
    showGps();
    gpsBtn.textContent = state.gps.lat != null ? "دریافت مجدد موقعیت" : "دریافت موقعیت فعلی";
    // عکس‌های فعلی در اسلات‌ها (قابل حذف/تعویض)
    state.photos.forEach((p) => p && URL.revokeObjectURL(p.url));
    state.photos = mode().photoSlots.map((_, i) => {
      const p = rec.photos?.[i];
      return p ? { blob: p.blob, width: p.width, height: p.height, name: p.name, existing: true, url: URL.createObjectURL(p.blob) } : null;
    });
    renderPhotos();
    state.editing = {
      id: rec.id,
      userName: rec.userName,
      stamp: buildStampInfo({ ...rec, modeTitle: rec.modeTitle, userName: rec.userName, gps: { lat: rec.gpsLat, lng: rec.gpsLng } }),
    };
    editBanner.querySelector("b").textContent = `ویرایش مورد اشتراک ${toPersianDigits(rec.eshterak)}`;
    editBanner.classList.remove("hidden");
    saveBtn.textContent = "ذخیره تغییرات";
    window.scrollTo({ top: 0 });
    return true;
  }

  return {
    id: "form",
    title: "فرم جدید",
    icon: "📝",
    startEdit,
    async mount(container) {
      root = container;
      modeBtns = Object.entries(MODES).map(([key, m]) =>
        h("button", { type: "button", class: "mode-btn", "data-mode": key, onclick: () => setMode(key) }, m.title)
      );
      photoBox = h("div", { class: "photos" });
      gpsInfo = h("div", { class: "gps-info hidden" });
      gpsBtn = h("button", { type: "button", class: "btn btn-warning btn-xs", onclick: getGps }, "دریافت موقعیت فعلی");

      editBanner = h("div", { class: "edit-banner hidden" },
        h("b", {}, "ویرایش"),
        h("button", { type: "button", class: "btn btn-secondary btn-sm", onclick: cancelEdit }, "انصراف از ویرایش"));
      saveBtn = h("button", { type: "button", class: "btn btn-primary btn-lg", onclick: save }, "ذخیره در گوشی");

      root.append(
        h("div", { class: "card" },
          editBanner,
          h("div", { class: "mode-btns" }, modeBtns),
          h("div", { class: "field-grid" }, FIELDS.map(buildField)),
          h("div", { class: "field gps-field" }, h("div", { class: "gps-row" }, h("label", {}, "موقعیت (GPS)"), gpsBtn), gpsInfo),
          h("div", { class: "field" }, h("label", {}, "عکس‌ها"), photoBox),
          saveBtn
        )
      );

      // مقادیر اولیه
      const sticky = (await kv.get("sticky", {})) || {};
      for (const f of FIELDS) if (f.sticky && sticky[f.key]) state.inputs[f.key].value = sticky[f.key];
      state.inputs.date.value = todayJalali();
      await setMode(state.mode, true);
    },
    onShow() {
      // تاریخ پیش‌فرض اگر روز عوض شده یا خالی است
      if (!state.inputs.date.value) state.inputs.date.value = todayJalali();
    },
  };
}
