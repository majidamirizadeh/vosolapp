/**
 * تب «گزارش سرور» — فقط برای کاربر ادمین (role === "admin")
 * از داده‌های همه اکیپ‌ها در Google Sheet گزارش می‌گیرد، Excel / PDF می‌سازد و عکس‌ها را (ZIP یا لینک Drive) می‌دهد.
 * فراخوانی‌ها: listRecords ، getSummary ، getPhotos (server/apps-script.js)
 */
import { MODES } from "../../config/modes.js";
import { OMOORS } from "../../config/omoors.js";
import { h, downloadBlob, toPersianDigits, toLatinDigits, formatMoney } from "../core/utils.js";
import { parseJalali, todayJalali, rangePreset, PRESETS, jalaliSpanDays } from "../core/jalali.js";
import { toast, busy, alertBox, confirmBox, rangeSelect } from "../core/ui.js";
import { createXlsx } from "../lib/xlsx.js";
import { createZip } from "../lib/zip.js";
import { createPdfFromJpegs } from "../lib/pdf.js";
import { ensureFonts } from "./photos.js";
import { serverCall } from "./sync.js";
import { sessionPass } from "./auth.js";

/** کلیدهای مرتب‌سازی — پیش‌فرض: امور */
const SORT_KEYS = [
  { value: "omoor", label: "امور" },
  { value: "date", label: "روز (تاریخ)" },
  { value: "user", label: "اکیپ" },
  { value: "leader", label: "سرگروه" },
  { value: "mode", label: "نوع عملیات" },
];

function sortRecords(list, key) {
  const arr = [...(list || [])];
  const cmp = (a, b) => String(a || "").localeCompare(String(b || ""), "fa");
  const byDate = (a, b) => cmp(a.date, b.date) || cmp(a.omoor, b.omoor) || cmp(a.userCode, b.userCode);
  switch (key) {
    case "date":
      return arr.sort(byDate);
    case "user":
      return arr.sort((a, b) => cmp(a.userCode || a.userName, b.userCode || b.userName) || cmp(a.date, b.date) || cmp(a.omoor, b.omoor));
    case "leader":
      return arr.sort((a, b) => cmp(a.leader, b.leader) || cmp(a.date, b.date) || cmp(a.omoor, b.omoor));
    case "mode":
      return arr.sort((a, b) => cmp(a.modeTitle, b.modeTitle) || cmp(a.date, b.date) || cmp(a.omoor, b.omoor));
    case "omoor":
    default:
      return arr.sort((a, b) => cmp(a.omoor, b.omoor) || cmp(a.date, b.date) || cmp(a.userCode, b.userCode));
  }
}

export function createAdminModule({ getUser }) {
  let f = {}, result, links, lastRecords = null, lastFilters = null, lastSum = null;

  /** فیلترها → پارامترهای سرور؛ null = خطا */
  function readFilters() {
    const p = { adminKey: f.key.value.trim() };
    if (!p.adminKey) { toast("رمز ادمین را وارد کنید", "error"); return null; }
    if (!f.all.checked) {
      const a = parseJalali(f.from.value), b = parseJalali(f.to.value);
      if (!a || !b) { toast("تاریخ‌ها را به شکل 1405/07/15 وارد کنید (یا «همه بازه» را بزنید)", "error"); return null; }
      p.fromDate = a.text;
      p.toDate = b.text;
    }
    const code = toLatinDigits(f.user.value).trim();
    if (code) p.userCode = code;
    if (f.mode.value) p.modeTitle = f.mode.value;
    if (f.omoor.value) p.omoor = f.omoor.value;
    const esh = toLatinDigits(f.eshterak.value).replace(/\D/g, "");
    if (esh) p.eshterak = esh;
    return p;
  }

  const fail = (res) => alertBox(res?.error || "خطای نامشخص", "خطا از سرور");
  const currentSort = () => (f.sort && f.sort.value) || "omoor";

  async function fetchReport() {
    const p = readFilters();
    if (!p) return null;
    const b = busy("در حال دریافت گزارش از سرور…");
    const [list, sum] = await Promise.all([serverCall("listRecords", p), serverCall("getSummary", p)]);
    b.done();
    if (!list.ok) { await fail(list); return null; }
    lastRecords = list.records || [];
    lastFilters = p;
    lastSum = sum.ok ? sum : null;
    render(list, lastSum);
    return lastRecords;
  }

  function stat(label, n) { return h("div", { class: "stat" }, h("b", {}, toPersianDigits(n)), h("span", {}, label)); }

  function breakdown(title, obj) {
    const rows = Object.entries(obj || {}).sort((a, b) => b[1].count - a[1].count);
    if (!rows.length) return null;
    return h("div", {},
      h("h3", { class: "card-title section-title" }, title),
      h("table", { class: "mini-table" }, h("tbody", {}, rows.map(([k, v]) =>
        h("tr", {}, h("td", {}, k || "—"), h("td", {}, `${toPersianDigits(v.count)} مورد`), h("td", {}, `${formatMoney(v.amount)} ریال`))))));
  }

  function render(list, sum) {
    result.replaceChildren();
    links.replaceChildren();
    const raw = list.records || [];
    if (!raw.length) { result.append(h("p", { class: "muted" }, "برای این فیلترها موردی در سرور نیست.")); return; }
    const recs = sortRecords(raw, currentSort());
    const total = sum?.totalCount ?? list.total ?? recs.length;
    result.append(
      h("div", { class: "stat-grid" },
        stat("تعداد کل", total),
        h("div", { class: "stat" }, h("b", {}, sum ? formatMoney(sum.totalAmount) : "—"), h("span", {}, "جمع مبلغ (ریال)")),
        stat("نمایش‌داده‌شده", recs.length)
      ),
      list.truncated && h("p", { class: "info-text" }, `فقط ${toPersianDigits(recs.length)} مورد اول از ${toPersianDigits(list.total)} مورد نمایش داده شد؛ فیلترها را محدودتر کنید.`),
      sum && breakdown("به تفکیک نوع عملیات", sum.byMode),
      sum && breakdown("به تفکیک اکیپ", sum.byUser),
      sum && breakdown("به تفکیک امور", sum.byOmoor),
      h("div", { class: "table-toolbar" },
        h("span", { class: "muted" }, `مرتب‌شده بر اساس: ${SORT_KEYS.find((s) => s.value === currentSort())?.label || "امور"}`)
      ),
      h("div", { class: "table-scroll" },
        h("table", { class: "data-table" },
          h("thead", {}, h("tr", {}, ["تاریخ", "اکیپ", "نوع عملیات", "امور", "شهر", "اشتراک", "مبلغ", "توضیحات", "عکس‌ها"].map((t) => h("th", {}, t)))),
          h("tbody", {}, recs.map((r) =>
            h("tr", {},
              h("td", {}, toPersianDigits(r.date)), h("td", {}, r.userName || r.userCode), h("td", {}, r.modeTitle),
              h("td", {}, r.omoor), h("td", {}, r.city), h("td", { dir: "ltr" }, toPersianDigits(r.eshterak)),
              h("td", {}, formatMoney(r.amount)),
              h("td", { style: "white-space:normal;min-width:120px" }, r.note || ""),
              h("td", {}, (r.photoLinks || []).map((u, i) => h("a", { href: u, target: "_blank", rel: "noopener" }, `عکس ${toPersianDigits(i + 1)}`)))
            ))))
      )
    );
  }

  /** همه ردیف‌های فیلتر فعلی — برای Excel و ZIP و PDF */
  async function fetchAll() {
    const p = readFilters();
    if (!p) return null;
    const res = await serverCall("listRecords", { ...p, limit: 20000 });
    if (!res.ok) { await fail(res); return null; }
    if (res.truncated) toast(`فقط ${toPersianDigits((res.records || []).length)} مورد اول از ${toPersianDigits(res.total)} مورد گرفته شد؛ بازه را محدودتر کنید`, "error");
    return { recs: sortRecords(res.records || [], currentSort()), filters: p };
  }

  /** ساخت فایل Excel از رکوردهای سرور (مرتب‌شده) */
  async function buildAdminXlsx(recs, filters) {
    const rng = filters.fromDate ? `${filters.fromDate} تا ${filters.toDate}` : "همه بازه";
    const sortLabel = SORT_KEYS.find((s) => s.value === currentSort())?.label || "امور";
    return createXlsx([{
      name: "گزارش سرور",
      title: `گزارش سرور — ${rng}${filters.omoor ? " — " + filters.omoor : ""} — مرتب‌سازی: ${sortLabel}`,
      columns: [
        { header: "ردیف", width: 7, type: "number" }, { header: "تاریخ", width: 13 }, { header: "کد اکیپ", width: 9 },
        { header: "نام اکیپ", width: 16 }, { header: "نوع عملیات", width: 20 }, { header: "امور", width: 18 },
        { header: "شهر", width: 16 }, { header: "سرگروه", width: 18 }, { header: "شماره اشتراک", width: 15 },
        { header: "مبلغ (ریال)", width: 16, type: "number" }, { header: "تعداد عکس", width: 10, type: "number" },
        { header: "نام فایل عکس‌ها", width: 34 }, { header: "عرض جغرافیایی", width: 14 }, { header: "طول جغرافیایی", width: 14 },
        { header: "زمان ثبت", width: 20 }, { header: "توضیحات", width: 30 }, { header: "لینک عکس‌ها", width: 60 },
      ],
      rows: recs.map((r, i) => [
        i + 1, r.date, r.userCode, r.userName, r.modeTitle, r.omoor, r.city, r.leader, r.eshterak,
        Number(r.amount) || 0, Number(r.photoCount) || 0, r.photoNames, r.gpsLat ?? "", r.gpsLng ?? "",
        r.serverTime, r.note || "", (r.photoLinks || []).join("  "),
      ]),
    }]);
  }

  /* ─── PDF ادمین (Canvas + همان موتور pdf.js) ─── */
  const PW = 1754, PH = 1240;
  const FONT = `Vazirmatn, Tahoma, sans-serif`;
  function fit(ctx, text, maxW) {
    text = String(text ?? "");
    if (ctx.measureText(text).width <= maxW) return text;
    while (text.length > 1 && ctx.measureText(text + "…").width > maxW) text = text.slice(0, -1);
    return text + "…";
  }

  async function buildAdminPdf(recs, filters) {
    await ensureFonts();
    const list = recs;
    const totalAmt = list.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const byOmoor = {};
    for (const r of list) {
      const k = r.omoor || "—";
      if (!byOmoor[k]) byOmoor[k] = { count: 0, amount: 0 };
      byOmoor[k].count++;
      byOmoor[k].amount += Number(r.amount) || 0;
    }
    const cols = [
      { h: "ردیف", w: 55, a: "c", v: (r, i) => toPersianDigits(i + 1) },
      { h: "تاریخ", w: 115, a: "c", v: (r) => toPersianDigits(r.date) },
      { h: "اکیپ", w: 140, v: (r) => r.userName || r.userCode },
      { h: "نوع عملیات", w: 170, v: (r) => r.modeTitle },
      { h: "امور", w: 160, v: (r) => r.omoor },
      { h: "شهر", w: 120, v: (r) => r.city },
      { h: "سرگروه", w: 150, v: (r) => r.leader },
      { h: "اشتراک", w: 130, a: "c", v: (r) => toPersianDigits(r.eshterak) },
      { h: "مبلغ (ریال)", w: 160, a: "c", v: (r) => formatMoney(r.amount) },
      { h: "عکس", w: 55, a: "c", v: (r) => toPersianDigits(r.photoCount || 0) },
    ];
    const M = 50;
    const tableW = PW - M * 2;
    const k = tableW / cols.reduce((t, c) => t + c.w, 0);
    cols.forEach((c) => (c.w *= k));

    const ROW = 44, HEAD = 52, TOP_FIRST = 380, TOP_NEXT = 100, BOTTOM = 70;
    const pagesRows = [];
    let i = 0;
    const firstCap = Math.floor((PH - TOP_FIRST - BOTTOM - HEAD) / ROW);
    const nextCap = Math.floor((PH - TOP_NEXT - BOTTOM - HEAD) / ROW);
    if (!list.length) pagesRows.push([]);
    while (i < list.length) {
      const cap = pagesRows.length === 0 ? firstCap : nextCap;
      pagesRows.push(list.slice(i, i + cap));
      i += cap;
    }

    const rng = filters.fromDate ? `${filters.fromDate} تا ${filters.toDate}` : "همه بازه";
    const sortLabel = SORT_KEYS.find((s) => s.value === currentSort())?.label || "امور";
    const pages = [];
    let rowIndex = 0;
    for (let p = 0; p < pagesRows.length; p++) {
      const c = document.createElement("canvas");
      c.width = PW; c.height = PH;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, PW, PH);
      ctx.direction = "rtl";
      ctx.textBaseline = "middle";

      let y = TOP_NEXT;
      if (p === 0) {
        ctx.fillStyle = "#0d6efd";
        ctx.fillRect(0, 0, PW, 12);
        ctx.fillStyle = "#111";
        ctx.textAlign = "right";
        ctx.font = `700 44px ${FONT}`;
        ctx.fillText("گزارش سرور — اکیپ‌های وصول مطالبات", PW - M, 70);
        ctx.font = `400 26px ${FONT}`;
        ctx.fillStyle = "#333";
        ctx.fillText(toPersianDigits(`بازه: ${rng}`), PW - M, 120);
        ctx.fillText(`مرتب‌سازی: ${sortLabel}${filters.omoor ? "  |  امور: " + filters.omoor : ""}`, PW - M, 158);
        ctx.fillText(toPersianDigits(`تاریخ تولید: ${new Date().toLocaleDateString("fa-IR")}`), PW - M, 196);

        const bx = M, by = 230, bw = 820, bh = 120;
        ctx.strokeStyle = "#c5cdd8";
        ctx.lineWidth = 2;
        ctx.strokeRect(bx, by, bw, bh);
        ctx.fillStyle = "#f4f7fb";
        ctx.fillRect(bx + 1, by + 1, bw - 2, bh - 2);
        ctx.fillStyle = "#0d6efd";
        ctx.font = `700 26px ${FONT}`;
        ctx.textAlign = "right";
        ctx.fillText("خلاصه", bx + bw - 20, by + 32);
        ctx.fillStyle = "#222";
        ctx.font = `700 24px ${FONT}`;
        ctx.fillText(`کل: ${toPersianDigits(list.length)} مورد`, bx + bw - 20, by + 70);
        ctx.fillText(`جمع مبالغ: ${formatMoney(totalAmt)} ریال`, bx + bw - 20, by + 100);
        const omoorEntries = Object.entries(byOmoor).sort((a, b) => b[1].count - a[1].count).slice(0, 3);
        ctx.font = `400 20px ${FONT}`;
        ctx.fillStyle = "#555";
        let ox = bx + 20;
        for (const [name, v] of omoorEntries) {
          ctx.textAlign = "left";
          ctx.fillText(`${name}: ${toPersianDigits(v.count)}`, ox, by + 55);
          ox += 260;
        }
        y = TOP_FIRST - 10;
      }

      ctx.fillStyle = "#0d6efd";
      ctx.fillRect(M, y, tableW, HEAD);
      ctx.fillStyle = "#fff";
      ctx.font = `700 22px ${FONT}`;
      let x = PW - M;
      for (const col of cols) {
        ctx.textAlign = "center";
        ctx.fillText(col.h, x - col.w / 2, y + HEAD / 2);
        x -= col.w;
      }
      y += HEAD;

      ctx.font = `400 21px ${FONT}`;
      pagesRows[p].forEach((r, ri) => {
        ctx.fillStyle = ri % 2 ? "#f4f7fb" : "#ffffff";
        ctx.fillRect(M, y, tableW, ROW);
        ctx.fillStyle = "#222";
        let cx = PW - M;
        for (const col of cols) {
          const text = fit(ctx, col.v(r, rowIndex), col.w - 14);
          if (col.a === "c") {
            ctx.textAlign = "center";
            ctx.fillText(text, cx - col.w / 2, y + ROW / 2);
          } else {
            ctx.textAlign = "right";
            ctx.fillText(text, cx - 8, y + ROW / 2);
          }
          cx -= col.w;
        }
        ctx.strokeStyle = "#d9dee6";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(M, y + ROW);
        ctx.lineTo(M + tableW, y + ROW);
        ctx.stroke();
        y += ROW;
        rowIndex++;
      });

      if (!list.length) {
        ctx.fillStyle = "#666";
        ctx.textAlign = "center";
        ctx.font = `400 26px ${FONT}`;
        ctx.fillText("برای این فیلترها موردی ثبت نشده است", PW / 2, y + 50);
      }

      ctx.fillStyle = "#666";
      ctx.font = `400 20px ${FONT}`;
      ctx.textAlign = "center";
      ctx.fillText(toPersianDigits(`صفحه ${p + 1} از ${pagesRows.length}`), PW / 2, PH - 36);

      const blob = await new Promise((res) => c.toBlob(res, "image/jpeg", 0.88));
      pages.push({ jpeg: new Uint8Array(await blob.arrayBuffer()), width: PW, height: PH });
    }
    return createPdfFromJpegs(pages, { title: "AdminReport" });
  }

  async function exportExcel() {
    const b = busy("در حال دریافت اطلاعات و ساخت Excel…");
    try {
      const got = await fetchAll();
      if (!got) return;
      if (!got.recs.length) return toast("موردی برای خروجی نیست", "error");
      const blob = await buildAdminXlsx(got.recs, got.filters);
      downloadBlob(blob, `گزارش-سرور_${todayJalali().replace(/\//g, "-")}.xlsx`);
      toast("فایل Excel ذخیره شد", "success");
    } catch (e) {
      console.error(e);
      toast("ساخت Excel ناموفق بود: " + (e.message || e), "error");
    } finally { b.done(); }
  }

  async function exportPdf() {
    const b = busy("در حال دریافت اطلاعات و ساخت PDF…");
    try {
      const got = await fetchAll();
      if (!got) return;
      if (!got.recs.length) return toast("موردی برای خروجی نیست", "error");
      const blob = await buildAdminPdf(got.recs, got.filters);
      downloadBlob(blob, `گزارش-سرور_${todayJalali().replace(/\//g, "-")}.pdf`);
      toast("فایل PDF ذخیره شد", "success");
    } catch (e) {
      console.error(e);
      toast("ساخت PDF ناموفق بود: " + (e.message || e), "error");
    } finally { b.done(); }
  }

  const b64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const cleanSeg = (x) => String(x || "نامشخص").replace(/[\\/:*?"<>|]/g, "-").trim() || "نامشخص";
  const driveId = (u) => (String(u).match(/[-\w]{25,}/) || [""])[0];
  const MAX_ZIP_PHOTOS = 600;
  const BATCH = 6; // باید ≤ PHOTOS_PER_CALL در اسکریپت سرور باشد

  /** ZIP کامل: فایل Excel + عکس‌ها (پوشه‌بندی امور / تاریخ / اکیپ) → مستقیم روی گوشی دانلود می‌شود */
  const ZIP_MAX_DAYS = 10;

  /** شرایط دانلود ZIP عکس‌ها: حداقل یک فیلتر (امور / تاریخ / اکیپ)، امور فقط یکی، تاریخ حداکثر ۱۰ روز */
  function zipGate() {
    const p = readFilters();
    if (!p) return null;
    const hasDate = !f.all.checked;
    const hasOmoor = !!p.omoor;
    const hasUser = !!p.userCode;
    if (!hasDate && !hasOmoor && !hasUser) {
      alertBox(`برای دانلود عکس‌های زیپ‌شده حداقل یکی از فیلترهای «امور»، «تاریخ» یا «اکیپ» را انتخاب کنید.\n\nمحدودیت‌ها:\n• امور: فقط یک امور\n• تاریخ: حداکثر ${toPersianDigits(ZIP_MAX_DAYS)} روز`, "فیلتر انتخاب نشده");
      return null;
    }
    if (hasDate) {
      const days = jalaliSpanDays(p.fromDate, p.toDate);
      if (days > ZIP_MAX_DAYS) {
        alertBox(`بازه تاریخ برای دانلود عکس‌ها حداکثر ${toPersianDigits(ZIP_MAX_DAYS)} روز است.\nبازه انتخابی شما ${toPersianDigits(days)} روز است.`, "بازه بیش از حد مجاز");
        return null;
      }
    }
    const lines = [
      `امور: ${p.omoor || "همه (بدون فیلتر)"}`,
      `تاریخ: ${hasDate ? toPersianDigits(`${p.fromDate} تا ${p.toDate}`) : "بدون فیلتر"}`,
      `اکیپ: ${hasUser ? toPersianDigits(p.userCode) : "همه (بدون فیلتر)"}`,
    ];
    if (p.modeTitle) lines.push(`نوع عملیات: ${p.modeTitle}`);
    if (p.eshterak) lines.push(`شماره اشتراک: ${toPersianDigits(p.eshterak)}`);
    return { p, lines };
  }

  async function photosZip() {
    links.replaceChildren();
    const gate = zipGate();
    if (!gate) return;
    const ok = await confirmBox(
      `محدودیت‌های دانلود عکس‌ها:\n• حداقل یک فیلتر (امور / تاریخ / اکیپ) لازم است\n• امور: فقط یک امور\n• تاریخ: حداکثر ${toPersianDigits(ZIP_MAX_DAYS)} روز\n• حداکثر ${toPersianDigits(MAX_ZIP_PHOTOS)} عکس در هر ZIP\n\nفیلتر انتخاب‌شده شما:\n${gate.lines.join("\n")}\n\nشروع شود؟`,
      { yes: "شروع دانلود", title: "دانلود عکس‌های زیپ‌شده" });
    if (!ok) return;
    const b = busy("در حال دریافت فهرست از سرور…");
    try {
      const got = await fetchAll();
      if (!got) return;
      const { recs, filters } = got;
      if (!recs.length) return toast("برای این فیلترها موردی نیست", "error");

      const root = `گزارش-سرور_${todayJalali().replace(/\//g, "-")}`;
      const items = [];
      for (const r of recs) {
        const names = String(r.photoNames || "").split(/\s*،\s*/).filter(Boolean);
        (r.photoLinks || []).forEach((u, i) => {
          const id = driveId(u);
          if (id) items.push({ id, path: `${root}/عکس‌ها/${cleanSeg(r.omoor)}/${cleanSeg(r.date).replace(/\//g, "-")}/${cleanSeg(r.userCode)}/${cleanSeg(names[i] || `${r.eshterak}_${i + 1}.jpg`)}` });
        });
      }
      if (items.length > MAX_ZIP_PHOTOS) {
        return alertBox(`${toPersianDigits(items.length)} عکس پیدا شد؛ سقف هر ZIP ${toPersianDigits(MAX_ZIP_PHOTOS)} عکس است.\nبازه تاریخ یا امور را محدودتر کنید.`, "تعداد عکس زیاد است");
      }
      if (items.length > 80) {
        b.done();
        const mb = Math.round(items.length * 0.3);
        if (!(await confirmBox(`${toPersianDigits(items.length)} عکس (حدود ${toPersianDigits(mb)} مگابایت) دانلود می‌شود.\nاینترنت پایدار لازم است و صفحه را نبندید. ادامه؟`, { yes: "ادامه" }))) return;
      }

      const entries = [{ name: `${root}/گزارش.xlsx`, data: await buildAdminXlsx(recs, filters) }];
      const byId = new Map(items.map((it) => [it.id, it]));
      let got_n = 0, skipped = 0;
      const bb = busy("در حال دریافت عکس‌ها…");
      try {
        for (let i = 0; i < items.length; i += BATCH) {
          const ids = items.slice(i, i + BATCH).map((it) => it.id);
          let res = await serverCall("getPhotos", { ...pick(filters), fileIds: ids });
          if (!res.ok) res = await serverCall("getPhotos", { ...pick(filters), fileIds: ids });
          if (!res.ok) { skipped += ids.length; if (!navigator.onLine) break; continue; }
          for (const ph of res.photos) {
            entries.push({ name: byId.get(ph.id).path, data: b64ToBytes(ph.data) });
            got_n++;
          }
          skipped += (res.missing || []).length;
          bb.text(`دریافت عکس ${toPersianDigits(Math.min(i + BATCH, items.length))} از ${toPersianDigits(items.length)}`);
          bb.progress(Math.min(i + BATCH, items.length) / items.length);
        }
        bb.text("در حال ساخت فایل ZIP…");
        const zip = await createZip(entries);
        const file = `${root}.zip`;
        downloadBlob(zip, file);
        links.append(h("p", { class: "info-text" }, `ذخیره شد: ${file} — ${toPersianDigits(got_n)} عکس + Excel` + (skipped ? ` (${toPersianDigits(skipped)} عکس دریافت نشد؛ دوباره امتحان کنید)` : "")));
        toast(skipped ? "ZIP ساخته شد (بعضی عکس‌ها نیامد)" : "ZIP ذخیره شد", skipped ? "error" : "success");
      } finally { bb.done(); }
    } catch (e) {
      console.error(e);
      toast("ساخت ZIP ناموفق بود: " + (e.message || e), "error");
    } finally { b.done(); }
  }
  const pick = (f) => ({ adminKey: f.adminKey });

  const field = (label, el) => h("div", { class: "field" }, h("label", {}, label), el);

  function reRenderSorted() {
    if (!lastRecords) return;
    render({ records: lastRecords, total: lastRecords.length, truncated: false }, lastSum);
  }

  return {
    id: "admin",
    title: "گزارش سرور",
    icon: "🛰",
    mount(container) {
      f.key = h("input", { type: "password", dir: "ltr", class: "ltr-in", autocomplete: "off", placeholder: "همان رمز ورود ادمین" });
      f.from = h("input", { type: "text", inputmode: "numeric", dir: "ltr", class: "ltr-in", placeholder: "1405/07/01" });
      f.to = h("input", { type: "text", inputmode: "numeric", dir: "ltr", class: "ltr-in", placeholder: "1405/07/30" });
      f.all = h("input", { type: "checkbox", onchange: () => { f.from.disabled = f.to.disabled = f.all.checked; } });
      f.user = h("input", { type: "text", inputmode: "numeric", dir: "ltr", class: "ltr-in", placeholder: "مثال: 05 (خالی = همه)" });
      f.mode = h("select", {}, h("option", { value: "" }, "همه عملیات‌ها"), Object.values(MODES).map((m) => h("option", { value: m.title }, m.title)));
      f.omoor = h("select", {}, h("option", { value: "" }, "همه امورها"), OMOORS.map((o) => h("option", { value: o }, o)));
      f.eshterak = h("input", { type: "text", inputmode: "numeric", dir: "ltr", class: "ltr-in", placeholder: "خالی = همه" });
      f.sort = h("select", { onchange: reRenderSorted }, SORT_KEYS.map((s) => h("option", { value: s.value }, s.label)));
      result = h("div", { class: "report-result" });
      links = h("div", { class: "export-links" });

      container.append(
        h("div", { class: "card card-elevated" },
          h("h3", { class: "card-title" }, "فیلتر گزارش سرور"),
          field("رمز ادمین (برای تأیید دسترسی در سرور)", f.key),
          h("div", { class: "field" }, rangeSelect(PRESETS, (k) => {
            if (k === "all") { f.all.checked = true; f.from.disabled = f.to.disabled = true; return; }
            f.all.checked = false; f.from.disabled = f.to.disabled = false;
            const r = rangePreset(k); f.from.value = r.from; f.to.value = r.to;
          })),
          h("div", { class: "row2" }, field("از تاریخ", f.from), field("تا تاریخ", f.to)),
          h("label", { class: "chk-row" }, f.all, "همه بازه (بدون محدودیت تاریخ)"),
          h("div", { class: "row2" }, field("کد اکیپ", f.user), field("شماره اشتراک", f.eshterak)),
          field("نوع عملیات", f.mode),
          field("امور (برای ZIP عکس‌ها فقط یک امور)", f.omoor),
          field("مرتب‌سازی خروجی و جدول", f.sort),
          h("div", { class: "btn-group" },
            h("button", { type: "button", class: "btn btn-primary", onclick: fetchReport }, "📋 دریافت گزارش"),
            h("button", { type: "button", class: "btn btn-success", onclick: exportExcel }, "📗 خروجی Excel"),
            h("button", { type: "button", class: "btn btn-danger", onclick: exportPdf }, "📕 خروجی PDF"),
            h("button", { type: "button", class: "btn btn-warning", onclick: photosZip }, "🗂 ZIP عکس‌ها (حداقل یک فیلتر، تاریخ ≤ ۱۰ روز)")
          ),
          links
        ),
        h("div", { class: "card card-elevated" }, result)
      );
    },
    onShow() {
      const t = todayJalali();
      if (!f.from.value) f.from.value = t;
      if (!f.to.value) f.to.value = t;
      if (!f.key.value) f.key.value = sessionPass();
    },
  };
}
