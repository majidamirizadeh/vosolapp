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
import { splitTotals, summarize } from "./records.js";
import { ICONS } from "../core/icons.js";
import { getCached, putCached, clearCache, cacheCount } from "./photocache.js";

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

  /** خطای سرور/شبکه → علت و راه‌حل به فارسی ساده (متن فنی در انتها) */
  function explain(res) {
    const raw = String(res?.error || "خطای نامشخص");
    let why = "سرور پاسخ درستی نداد.", tip = "کمی بعد دوباره تلاش کنید.";
    if (/آفلاین/.test(raw)) { why = "اینترنت دستگاه قطع است."; tip = "اتصال اینترنت (Wi-Fi یا داده) را بررسی و دوباره تلاش کنید."; }
    else if (/رمز ادمین/.test(raw)) { why = "رمز ادمین واردشده با رمز سرور یکی نیست."; tip = "رمز را همان رمز ورود ادمین وارد کنید (ADMIN_KEY در اسکریپت سرور هم باید همان باشد)."; }
    else if (/ADMIN_KEY/.test(raw)) { why = "رمز ادمین در اسکریپت سرور تنظیم نشده است."; tip = "ADMIN_KEY را در server/apps-script.js بگذارید و اسکریپت را دوباره Deploy کنید."; }
    else if (/توکن/.test(raw)) { why = "توکن برنامه با توکن سرور یکی نیست."; tip = "مقدار token در config/app.config.js و APP_TOKEN در اسکریپت سرور باید یکسان باشد."; }
    else if (/timeout|دیر شد/.test(raw)) { why = "سرور در زمان مجاز پاسخ نداد (اینترنت ضعیف یا حجم زیاد)."; tip = "اینترنت را بررسی کنید و بازه/فیلتر را کوچک‌تر کنید."; }
    else if (/عدم ارتباط|Failed to fetch|NetworkError/i.test(raw)) { why = "ارتباط با سرور برقرار نشد."; tip = "اینترنت را بررسی کنید؛ اگر اینترنت سالم است آدرس سرور (url در config/app.config.js) یا Deploy اسکریپت را کنترل کنید."; }
    else if (/پاسخ نامعتبر/.test(raw)) { why = "سرور پاسخ غیرمنتظره داد (احتمالاً Deploy نسخهٔ جدید انجام نشده یا دسترسی «Anyone» نیست)."; tip = "اسکریپت را با دسترسی Anyone دوباره Deploy کنید."; }
    return { why, tip, raw };
  }

  /** نمایش خطا؛ قبل از آن پیام «در حال دریافت» حتماً بسته می‌شود تا روی هم نیفتند */
  async function failStage(j, stage, res) {
    j?.done();
    const x = explain(res);
    await alertBox(`مرحلهٔ «${stage}» انجام نشد.\n\nعلت: ${x.why}\nراه‌حل: ${x.tip}\n\nجزئیات فنی: ${x.raw}`, "خطا — " + stage);
  }
  const fail = (res, stage = "ارتباط با سرور") => failStage(null, stage, res);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const fa = (ms) => toPersianDigits((ms / 1000).toFixed(1)).replace(".", "٫");

  /** یک پیام «در حال انجام» واحد برای کل عملیات: مرحله n از N + شرح + زمان سپری‌شده؛ و زمان‌سنجی هر مرحله */
  function makeJob(total, prev) {
    const b = busy("در حال آماده‌سازی…");
    let n = 0, label = "", t0 = Date.now(), tm = Date.now(), srvMs = prev ? prev.srvMs() : 0;
    const t00 = prev ? prev.t00 : Date.now(), marks = prev ? [...prev.marks] : []; // prev: ادامهٔ همان عملیات بعد از یک پرسش
    const show = () => {
      const s = Math.floor((Date.now() - t0) / 1000);
      b.text(`مرحلهٔ ${toPersianDigits(n)} از ${toPersianDigits(total)}\n${label}` + (s >= 4 ? `\n(${toPersianDigits(s)} ثانیه)` : ""));
    };
    const timer = setInterval(show, 1000);
    return {
      step(i, text) { n = i; label = text; t0 = Date.now(); show(); },
      detail(text) { label = text; show(); },
      progress: b.progress,
      /** ثبت زمان مرحله‌ای که تمام شد (نام فارسی کوتاه) */
      mark(name) { marks.push([name, Date.now() - tm]); tm = Date.now(); },
      t00, marks, srvMs: () => srvMs,
      /** جمع زمان اجرای خود سرور (فیلد ms پاسخ‌ها) */
      srv(res) { if (res && Number.isFinite(res.ms)) srvMs += res.ms; },
      /** «زمان کل … | مرحله‌ها … | سرور …» برای نمایش زیر دکمه‌ها */
      summary() {
        const parts = marks.filter((m) => m[1] >= 100).map((m) => `${m[0]} ${fa(m[1])}`).join(" · ");
        return `زمان کل ${fa(Date.now() - t00)} ثانیه` + (parts ? ` — ${parts}` : "") + (srvMs ? ` — اجرای سرور ${fa(srvMs)}` : "");
      },
      done() { clearInterval(timer); b.done(); },
    };
  }
  const currentSort = () => (f.sort && f.sort.value) || "omoor";

  let combinedOk = true; // سرور جدید جمع‌ها را در همان پاسخ listRecords می‌دهد؛ سرور قدیمی نه
  async function fetchReport() {
    const p = readFilters();
    if (!p) return null;
    cache = null; // دکمهٔ «دریافت گزارش» = تازه‌سازی صریح
    const j = makeJob(1);
    j.step(1, "دریافت گزارش از سرور…");
    let list, sum;
    if (combinedOk) {
      list = await serverCall("listRecords", { ...p, withSummary: true });
      j.srv(list);
      if (list.ok && list.summary) sum = list.summary;
      else if (list.ok) { combinedOk = false; sum = await serverCall("getSummary", p); }
    } else {
      [list, sum] = await Promise.all([serverCall("listRecords", p), serverCall("getSummary", p)]);
    }
    if (!list.ok) { await failStage(j, "دریافت گزارش از سرور", list); return null; }
    j.mark("دریافت");
    j.done();
    lastRecords = list.records || [];
    lastFilters = p;
    lastSum = sum && sum.ok ? sum : null;
    render(list, lastSum);
    links.replaceChildren(h("p", { class: "info-text" }, j.summary()));
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
    const tot = sum && sum.collectAmount != null ? { collectTotal: sum.collectAmount, followedTotal: sum.followedAmount } : splitTotals(recs);
    result.append(
      h("div", { class: "stat-grid" },
        stat("تعداد کل", total),
        h("div", { class: "stat" }, h("b", {}, formatMoney(tot.collectTotal)), h("span", {}, "جمع وصول (ریال)")),
        h("div", { class: "stat" }, h("b", {}, formatMoney(tot.followedTotal)), h("span", {}, "جمع مبالغ پیگیری‌شده (ریال)")),
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
          h("thead", {}, h("tr", {}, ["تاریخ", "اکیپ", "نوع عملیات", "امور", "شهر/بخش", "آبادی", "اشتراک", "مبلغ", "توضیحات", "عکس‌ها"].map((t) => h("th", {}, t)))),
          h("tbody", {}, recs.map((r) =>
            h("tr", {},
              h("td", {}, toPersianDigits(r.date)), h("td", {}, r.userName || r.userCode), h("td", {}, r.modeTitle),
              h("td", {}, r.omoor), h("td", {}, r.city), h("td", {}, r.abadi || ""), h("td", { dir: "ltr" }, toPersianDigits(r.eshterak)),
              h("td", {}, formatMoney(r.amount)),
              h("td", { style: "white-space:normal;min-width:120px" }, r.note || ""),
              h("td", {}, (r.photoLinks || []).map((u, i) => h("a", { href: u, target: "_blank", rel: "noopener" }, `عکس ${toPersianDigits(i + 1)}`)))
            ))))
      )
    );
  }

  /** فهرست کامل اخیر (۲ دقیقه) — تا Excel و PDF و ZIP پشت‌سرهم هر بار از سرور نخوانند */
  const CACHE_MS = 120_000;
  let cache = null;

  /** همه ردیف‌های فیلتر فعلی — برای Excel و ZIP و PDF (needLinks=false: بدون لینک عکس‌ها = سبک‌تر) */
  async function fetchAll(j, step, needLinks) {
    const p = readFilters();
    if (!p) return null;
    const key = JSON.stringify(p);
    let res;
    if (cache && cache.key === key && Date.now() - cache.t < CACHE_MS && (cache.links || !needLinks)) {
      res = cache.res;
      j.step(step, `استفاده از فهرست دریافت‌شده (${toPersianDigits(Math.round((Date.now() - cache.t) / 1000))} ثانیه پیش)…`);
      j.mark("فهرست (از حافظه)");
    } else {
      j.step(step, "دریافت فهرست رکوردها از سرور…");
      res = await serverCall("listRecords", { ...p, limit: 20000, ...(needLinks ? {} : { noLinks: true }) });
      j.srv(res);
      if (!res.ok) { await failStage(j, "دریافت فهرست از سرور", res); return null; }
      j.mark("فهرست");
      cache = { key, t: Date.now(), links: !!needLinks, res };
    }
    if (res.truncated) toast(`فقط ${toPersianDigits((res.records || []).length)} مورد اول از ${toPersianDigits(res.total)} مورد گرفته شد؛ بازه را محدودتر کنید`, "error");
    j.detail(`${toPersianDigits((res.records || []).length)} رکورد؛ در حال مرتب‌سازی…`);
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
        { header: "شهر/بخش", width: 16 }, { header: "آبادی", width: 16 }, { header: "سرگروه", width: 18 }, { header: "شماره اشتراک", width: 15 },
        { header: "مبلغ (ریال)", width: 16, type: "number" }, { header: "تعداد عکس", width: 10, type: "number" },
        { header: "نام فایل عکس‌ها", width: 34 }, { header: "عرض جغرافیایی", width: 14 }, { header: "طول جغرافیایی", width: 14 },
        { header: "زمان ثبت", width: 20 }, { header: "توضیحات", width: 30 },
      ],
      rows: recs.map((r, i) => [
        i + 1, r.date, r.userCode, r.userName, r.modeTitle, r.omoor, r.city, r.abadi || "", r.leader, r.eshterak,
        Number(r.amount) || 0, Number(r.photoCount) || 0, r.photoNames, r.gpsLat ?? "", r.gpsLng ?? "",
        r.serverTime, r.note || "",
      ]),
    }]);
  }

  /* ─── PDF ادمین (Canvas + همان موتور pdf.js) ─── */
  const PW = 1754, PH = 1240;
  const PDF_QUALITY = 0.78; // متن روی زمینهٔ سفید با این کیفیت خوانا می‌ماند و فایل و زمان ساخت کمتر می‌شود
  const PDF_WARN_ROWS = 1500;
  const FONT = `Vazirmatn, Tahoma, sans-serif`;
  function fit(ctx, text, maxW) {
    text = String(text ?? "");
    if (ctx.measureText(text).width <= maxW) return text;
    while (text.length > 1 && ctx.measureText(text + "…").width > maxW) text = text.slice(0, -1);
    return text + "…";
  }

  async function buildAdminPdf(recs, filters, onPage) {
    await ensureFonts();
    const list = recs;
    const tot = splitTotals(list); // هر اشتراک در هر جمع فقط یک مبلغ
    const byOmoor = {};
    for (const r of list) {
      const k = r.omoor || "—";
      if (!byOmoor[k]) byOmoor[k] = { count: 0 };
      byOmoor[k].count++;
    }
    const cols = [
      { h: "ردیف", w: 55, a: "c", v: (r, i) => toPersianDigits(i + 1) },
      { h: "تاریخ", w: 115, a: "c", v: (r) => toPersianDigits(r.date) },
      { h: "اکیپ", w: 140, v: (r) => r.userName || r.userCode },
      { h: "نوع عملیات", w: 170, v: (r) => r.modeTitle },
      { h: "امور", w: 160, v: (r) => r.omoor },
      { h: "شهر/بخش", w: 130, v: (r) => r.city },
      { h: "آبادی", w: 110, v: (r) => r.abadi || "" },
      { h: "سرگروه", w: 150, v: (r) => r.leader },
      { h: "اشتراک", w: 130, a: "c", v: (r) => toPersianDigits(r.eshterak) },
      { h: "مبلغ (ریال)", w: 160, a: "c", v: (r) => formatMoney(r.amount) },
      { h: "عکس", w: 55, a: "c", v: (r) => toPersianDigits(r.photoCount || 0) },
    ];
    const M = 50;
    const tableW = PW - M * 2;
    const k = tableW / cols.reduce((t, c) => t + c.w, 0);
    cols.forEach((c) => (c.w *= k));

    const ROW = 44, HEAD = 52, TOP_FIRST = 475, TOP_NEXT = 100, BOTTOM = 70;
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

        const bx = M, by = 230, bw = 820, bh = 215;
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
        ctx.fillText(`کل: ${toPersianDigits(list.length)} مورد`, bx + bw - 20, by + 66);
        ctx.fillText(`جمع وصول: ${formatMoney(tot.collectTotal)} ریال`, bx + bw - 20, by + 96);
        ctx.fillText(`جمع مبالغ پیگیری‌شده: ${formatMoney(tot.followedTotal)} ریال`, bx + bw - 20, by + 126);
        const omoorEntries = Object.entries(byOmoor).sort((a, b) => b[1].count - a[1].count).slice(0, 3);
        ctx.font = `400 20px ${FONT}`;
        ctx.fillStyle = "#555";
        let ox = bx + 20;
        for (const [name, v] of omoorEntries) {
          ctx.textAlign = "left";
          ctx.fillText(`${name}: ${toPersianDigits(v.count)}`, ox, by + 55);
          ox += 260;
        }

        // خلاصهٔ ۶ عملیات: تعداد ثبت و مبلغ (مبلغ هر عملیات بدون تکرار اشتراک، مثل خلاصهٔ داخل برنامه)
        const byMode = summarize(list).byMode;
        const cx = bx + bw + 30, cw = PW - M - cx;
        ctx.strokeStyle = "#c5cdd8";
        ctx.lineWidth = 2;
        ctx.strokeRect(cx, by, cw, bh);
        ctx.fillStyle = "#f4f7fb";
        ctx.fillRect(cx + 1, by + 1, cw - 2, bh - 2);
        ctx.fillStyle = "#0d6efd";
        ctx.font = `700 26px ${FONT}`;
        ctx.textAlign = "right";
        ctx.fillText("خلاصهٔ عملیات‌ها", cx + cw - 20, by + 32);
        Object.values(MODES).forEach((m, mi) => {
          const v = byMode[m.title] || { count: 0, amount: 0 };
          const ry = by + 68 + mi * 26;
          if (mi % 2 === 0) { ctx.fillStyle = "#e9eff8"; ctx.fillRect(cx + 10, ry - 13, cw - 20, 26); }
          ctx.fillStyle = "#222";
          ctx.font = `700 21px ${FONT}`;
          ctx.textAlign = "right";
          ctx.fillText(m.title, cx + cw - 20, ry);
          ctx.font = `400 21px ${FONT}`;
          ctx.textAlign = "center";
          ctx.fillText(`${toPersianDigits(v.count)} مورد`, cx + cw / 2, ry);
          ctx.textAlign = "left";
          ctx.fillText(`${formatMoney(v.amount)} ریال`, cx + 22, ry);
        });
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

      const blob = await new Promise((res) => c.toBlob(res, "image/jpeg", PDF_QUALITY));
      pages.push({ jpeg: new Uint8Array(await blob.arrayBuffer()), width: PW, height: PH });
      if (onPage) { onPage(p + 1, pagesRows.length); await sleep(0); } // فرصت به‌روزرسانی صفحه
    }
    return createPdfFromJpegs(pages, { title: "AdminReport" });
  }

  const outName = (ext) => `گزارش-سرور_${todayJalali().replace(/\//g, "-")}.${ext}`;
  const showSummary = (j, extra = "") => links.replaceChildren(h("p", { class: "info-text" }, (extra ? extra + " — " : "") + j.summary()));

  /** خطای غیرشبکه‌ای (ساخت فایل / ذخیره) با نام مرحله */
  async function failBuild(j, stage, e) {
    console.error(e);
    j?.done();
    await alertBox(`مرحلهٔ «${stage}» انجام نشد.\n\nعلت: خطا در پردازش روی همین دستگاه (نه سرور).\nراه‌حل: دوباره تلاش کنید؛ اگر تکرار شد بازه را کوچک‌تر کنید یا برنامه را ببندید و باز کنید.\n\nجزئیات فنی: ${e?.message || e}`, "خطا — " + stage);
  }

  async function exportExcel() {
    if (!readFilters()) return;
    links.replaceChildren();
    const j = makeJob(3);
    let stage = "دریافت فهرست از سرور";
    try {
      const got = await fetchAll(j, 1, false);
      if (!got) return;
      if (!got.recs.length) { j.done(); return toast("برای این فیلترها موردی در سرور نیست", "error"); }
      stage = "ساخت فایل Excel";
      j.step(2, `ساخت فایل Excel (${toPersianDigits(got.recs.length)} ردیف)…`);
      await sleep(0);
      const blob = await buildAdminXlsx(got.recs, got.filters);
      j.mark("ساخت Excel");
      stage = "ذخیره فایل";
      j.step(3, "ذخیرهٔ فایل روی دستگاه…");
      downloadBlob(blob, outName("xlsx"));
      j.done();
      showSummary(j);
      toast(`فایل Excel ذخیره شد (${toPersianDigits(got.recs.length)} ردیف)`, "success");
    } catch (e) { await failBuild(j, stage, e); } finally { j.done(); }
  }

  async function exportPdf() {
    if (!readFilters()) return;
    links.replaceChildren();
    let j = makeJob(3);
    let stage = "دریافت فهرست از سرور";
    try {
      const got = await fetchAll(j, 1, false);
      if (!got) return;
      if (!got.recs.length) { j.done(); return toast("برای این فیلترها موردی در سرور نیست", "error"); }
      if (got.recs.length > PDF_WARN_ROWS) {
        const prevJob = j;
        j.done();
        const pages = Math.ceil(got.recs.length / 23);
        if (!(await confirmBox(`این گزارش ${toPersianDigits(got.recs.length)} ردیف است؛ PDF حدود ${toPersianDigits(pages)} صفحه می‌شود و ساخت آن چند دقیقه طول می‌کشد و فایل حجیم است.\n\nبرای تعداد زیاد، خروجی Excel خیلی سریع‌تر است. PDF ساخته شود؟`, { yes: "ساخت PDF", no: "انصراف", title: "گزارش حجیم" }))) return;
        j = makeJob(3, prevJob);
      }
      stage = "ساخت صفحه‌های PDF";
      j.step(2, "آماده‌سازی فونت و صفحه‌ها…");
      const blob = await buildAdminPdf(got.recs, got.filters, (i, n) => { j.detail(`ساخت صفحهٔ ${toPersianDigits(i)} از ${toPersianDigits(n)}…`); j.progress(i / n); });
      j.mark("ساخت صفحه‌ها");
      stage = "ذخیره فایل";
      j.step(3, "ذخیرهٔ فایل روی دستگاه…");
      downloadBlob(blob, outName("pdf"));
      j.done();
      showSummary(j);
      toast(`فایل PDF ذخیره شد (${toPersianDigits(got.recs.length)} ردیف)`, "success");
    } catch (e) { await failBuild(j, stage, e); } finally { j.done(); }
  }

  /** base64 → بایت (با روش بومی مرورگر در صورت وجود؛ وگرنه حلقهٔ سریع) */
  const b64ToBytes = (b64) => {
    if (typeof Uint8Array.fromBase64 === "function") { try { return Uint8Array.fromBase64(b64); } catch { /* ادامه */ } }
    const bin = atob(b64), n = bin.length, out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = bin.charCodeAt(i);
    return out;
  };
  const cleanSeg = (x) => String(x || "نامشخص").replace(/[\\/:*?"<>|]/g, "-").trim() || "نامشخص";
  const driveId = (u) => (String(u).match(/[-\w]{25,}/) || [""])[0];
  const MAX_ZIP_PHOTOS = 1500;   // سقف کل عکس‌ها در یک دانلود (بیشتر از PART_SIZE در چند فایل ZIP)
  const PART_SIZE = 300;         // حداکثر عکس در هر فایل ZIP
  const OLD_BATCH = 6;           // سرور قدیمی (بدون signPhotos): ≤ PHOTOS_PER_CALL قدیمی
  const MAX_BATCH = 20;

  /** شرایط دانلود ZIP عکس‌ها: حداقل یک فیلتر (امور / تاریخ / اکیپ)، امور فقط یکی، تاریخ حداکثر ۱۰ روز */
  const ZIP_MAX_DAYS = 10;
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

  const PHOTO_WORKERS = 3; // تعداد درخواست هم‌زمان عکس
  const FATAL = /آفلاین|رمز ادمین|ADMIN_KEY|توکن/;

  /**
   * یک دسته عکس با تلاش مجدد؛ اگر دسته بزرگ دوبار شکست خورد (مثلاً timeout) به دو نیم تقسیم و دوباره تلاش می‌شود.
   * files: [{id, sig?}] — با sig = روش جدید (بدون خواندن شیت) ؛ بدون sig = روش قدیمی (fileIds)
   */
  async function getBatch(j, filters, files, signed, depth = 0) {
    let res;
    for (let a = 0; a < 2; a++) {
      const body = signed ? { files } : { fileIds: files.map((x) => x.id) };
      res = await serverCall("getPhotos", { ...pick(filters), ...body });
      if (res.ok) { j.srv(res); return res; }
      if (FATAL.test(String(res.error))) return res;
      await sleep(900 * (a + 1));
    }
    if (files.length > 3 && depth < 1) {
      const mid = Math.ceil(files.length / 2);
      const [x, y] = [await getBatch(j, filters, files.slice(0, mid), signed, depth + 1), await getBatch(j, filters, files.slice(mid), signed, depth + 1)];
      if (x.ok || y.ok) {
        const lost = (r, part) => (r.ok ? [] : part.map((q) => q.id));
        return { ok: true, photos: [...(x.photos || []), ...(y.photos || [])], missing: [...(x.missing || []), ...(y.missing || []), ...lost(x, files.slice(0, mid)), ...lost(y, files.slice(mid))], fast: (x.fast || 0) + (y.fast || 0), error: x.ok ? y.error : x.error };
      }
      return x;
    }
    return res;
  }

  async function photosZip() {
    links.replaceChildren();
    const gate = zipGate();
    if (!gate) return;
    const ok = await confirmBox(
      `محدودیت‌های دانلود عکس‌ها:\n• حداقل یک فیلتر (امور / تاریخ / اکیپ) لازم است\n• امور: فقط یک امور\n• تاریخ: حداکثر ${toPersianDigits(ZIP_MAX_DAYS)} روز\n• حداکثر ${toPersianDigits(MAX_ZIP_PHOTOS)} عکس (هر ${toPersianDigits(PART_SIZE)} عکس یک فایل ZIP)\n\nفیلتر انتخاب‌شده شما:\n${gate.lines.join("\n")}\n\nشروع شود؟`,
      { yes: "شروع دانلود", title: "دانلود عکس‌های زیپ‌شده" });
    if (!ok) return;
    const TOTAL = 5;
    let j = makeJob(TOTAL);
    let stage = "دریافت فهرست از سرور";
    try {
      const got = await fetchAll(j, 1, true);
      if (!got) return;
      const { recs, filters } = got;
      if (!recs.length) { j.done(); return toast("برای این فیلترها موردی در سرور نیست", "error"); }

      const root = `گزارش-سرور_${todayJalali().replace(/\//g, "-")}`;
      const items = [];
      for (const r of recs) {
        const names = String(r.photoNames || "").split(/\s*،\s*/).filter(Boolean);
        (r.photoLinks || []).forEach((u, i) => {
          const id = driveId(u);
          if (id) items.push({ id, path: `${root}/عکس‌ها/${cleanSeg(r.omoor)}/${cleanSeg(r.date).replace(/\//g, "-")}/${cleanSeg(r.userCode)}/${cleanSeg(names[i] || `${r.eshterak}_${i + 1}.jpg`)}` });
        });
      }
      if (!items.length) { j.done(); return alertBox("برای این فیلترها رکورد پیدا شد اما هیچ عکسی ثبت نشده است.", "عکسی وجود ندارد"); }
      if (items.length > MAX_ZIP_PHOTOS) {
        j.done();
        return alertBox(`${toPersianDigits(items.length)} عکس پیدا شد؛ سقف هر دانلود ${toPersianDigits(MAX_ZIP_PHOTOS)} عکس است.\nبازه تاریخ یا امور را محدودتر کنید.`, "تعداد عکس زیاد است");
      }
      const nParts = Math.ceil(items.length / PART_SIZE);

      // عکس‌هایی که قبلاً روی همین دستگاه دانلود شده‌اند دوباره از سرور گرفته نمی‌شوند
      stage = "بررسی حافظهٔ دستگاه";
      const cached = await getCached([...new Set(items.map((it) => it.id))]);
      const nNeed = items.filter((it) => !cached.has(it.id)).length;

      if (items.length > 80 || nParts > 1) {
        const prevJob = j;
        j.done();
        const mb = Math.round(nNeed * 0.15);
        const msg = `${toPersianDigits(items.length)} عکس` + (cached.size ? ` (${toPersianDigits(items.filter((it) => cached.has(it.id)).length)} عدد از قبل روی همین دستگاه است)` : "") +
          `؛ حدود ${toPersianDigits(mb)} مگابایت باید دانلود شود.` +
          (nParts > 1 ? `\nعکس‌ها در ${toPersianDigits(nParts)} فایل ZIP پشت‌سرهم ذخیره می‌شوند؛ اگر مرورگر دربارهٔ «دانلودهای چندگانه» پرسید، اجازه دهید.` : "") +
          "\nاینترنت پایدار لازم است و صفحه را نبندید. ادامه؟";
        if (!(await confirmBox(msg, { yes: "ادامه" }))) return;
        j = makeJob(TOTAL, prevJob);
      }

      stage = "ساخت Excel گزارش";
      j.step(2, "ساخت Excel گزارش و تأیید عکس‌ها…");
      await sleep(0);
      const excel = { name: `${root}/گزارش.xlsx`, data: await buildAdminXlsx(recs, filters) };
      j.mark("Excel");

      // مرحلهٔ تأیید: شناسه‌ها یک‌بار با شیت سنجیده می‌شوند (سرور جدید)؛ سرور قدیمی → روش قبلی
      stage = "تأیید عکس‌ها در سرور";
      let sigs = null, perCall = OLD_BATCH;
      const needIds = [...new Set(items.filter((it) => !cached.has(it.id)).map((it) => it.id))];
      if (needIds.length) {
        const sres = await serverCall("signPhotos", { ...pick(filters), fileIds: needIds });
        j.srv(sres);
        if (sres.ok && sres.sigs) { sigs = sres.sigs; perCall = Math.max(1, Math.min(Number(sres.perCall) || OLD_BATCH, MAX_BATCH)); }
        else if (FATAL.test(String(sres.error))) { await failStage(j, "تأیید عکس‌ها در سرور", sres); return; }
        j.mark("تأیید");
      }
      const signed = !!sigs;

      const dlName = (k) => (nParts > 1 ? `${root}_بخش-${toPersianDigits(k + 1)}-از-${toPersianDigits(nParts)}.zip` : `${root}.zip`);
      let doneN = 0, gotN = 0, fromCache = 0, failN = 0, fast = 0, fatal = "", lastErr = "", streak = 0;
      const saved = [];
      const pending = [];

      for (let k = 0; k < nParts; k++) {
        const part = items.slice(k * PART_SIZE, (k + 1) * PART_SIZE);
        const tag = nParts > 1 ? `بخش ${toPersianDigits(k + 1)} از ${toPersianDigits(nParts)} — ` : "";
        const entries = k === 0 ? [excel] : [];
        const need = [];
        for (const it of part) {
          const c = cached.get(it.id);
          if (c) { entries.push({ name: it.path, data: c }); gotN++; fromCache++; doneN++; }
          else if (signed && !sigs[it.id]) { failN++; doneN++; lastErr = lastErr || "عکس در شیت ثبت نشده است"; }
          else need.push(it);
        }

        stage = "دریافت عکس‌ها";
        j.step(3, `${tag}دریافت عکس‌ها: ${toPersianDigits(doneN)} از ${toPersianDigits(items.length)}`);
        const byId = new Map();
        for (const it of need) { if (!byId.has(it.id)) byId.set(it.id, []); byId.get(it.id).push(it); }
        const uniq = [...byId.keys()];
        const batches = [];
        for (let i = 0; i < uniq.length; i += perCall) batches.push(uniq.slice(i, i + perCall));
        let next = 0;
        const worker = async () => {
          while (!fatal) {
            const bi = next++;
            if (bi >= batches.length) return;
            const ids = batches[bi];
            const files = ids.map((id) => ({ id, ...(signed ? { sig: sigs[id] } : {}) }));
            const res = await getBatch(j, filters, files, signed);
            const count = ids.reduce((t, id) => t + byId.get(id).length, 0);
            if (res.ok) {
              streak = 0;
              fast += res.fast || 0;
              const toCache = [];
              const have = new Set();
              for (const ph of res.photos || []) {
                const list = byId.get(ph.id);
                if (!list) continue;
                const bytes = b64ToBytes(ph.data);
                have.add(ph.id);
                list.forEach((it) => { entries.push({ name: it.path, data: bytes }); gotN++; });
                toCache.push({ id: ph.id, bytes });
              }
              ids.forEach((id) => { if (!have.has(id)) failN += byId.get(id).length; });
              if (res.error) lastErr = res.error;
              if (toCache.length) pending.push(putCached(toCache));
            } else {
              failN += count;
              lastErr = res.error || lastErr;
              if (FATAL.test(String(res.error))) fatal = res.error;
              else if (++streak >= 4) fatal = "سرور چند بار پشت‌سرهم پاسخ نداد: " + String(res.error || "");
            }
            doneN += count;
            j.detail(`${tag}دریافت عکس‌ها: ${toPersianDigits(Math.min(doneN, items.length))} از ${toPersianDigits(items.length)}` + (failN ? `\n(${toPersianDigits(failN)} عکس دریافت نشد)` : ""));
            j.progress(Math.min(doneN, items.length) / items.length);
          }
        };
        await Promise.all(Array.from({ length: Math.min(PHOTO_WORKERS, batches.length) }, worker));
        j.mark(`عکس‌ها${nParts > 1 ? " " + toPersianDigits(k + 1) : ""}`);

        const photosInPart = entries.length - (k === 0 ? 1 : 0);
        if (!photosInPart) { if (fatal) break; continue; } // این بخش عکسی نیاورد: ZIP خالی ساخته نمی‌شود

        stage = "ساخت فایل ZIP";
        j.step(4, `${tag}ساخت فایل ZIP (${toPersianDigits(photosInPart)} عکس${k === 0 ? " + Excel" : ""})…`);
        await sleep(0);
        const zip = await createZip(entries);
        j.mark(`ZIP${nParts > 1 ? " " + toPersianDigits(k + 1) : ""}`);

        stage = "ذخیره فایل";
        j.step(5, `${tag}ذخیرهٔ فایل روی دستگاه…`);
        downloadBlob(zip, dlName(k));
        saved.push(dlName(k));
        if (k < nParts - 1 && !fatal) await sleep(900); // فاصله تا مرورگر دانلودها را پشت‌سرهم بپذیرد
        if (fatal) break;
      }
      await Promise.all(pending);
      j.done();

      if (!gotN) {
        await failStage(null, "دریافت عکس‌ها", { error: fatal || lastErr || "عکسی از سرور دریافت نشد (فایل‌ها در Drive پیدا نشدند)" });
        return;
      }
      failN = items.length - gotN; // شامل بخش‌هایی که به‌خاطر خطای قطعی اصلاً شروع نشدند
      const cacheNote = fromCache ? ` — ${toPersianDigits(fromCache)} عکس از حافظهٔ دستگاه` : "";
      const modeNote = !needIds.length ? "" : signed ? (fast ? " — دریافت سریع" : "") : " — روش قدیمی (اسکریپت سرور را به‌روز کنید)";
      showSummary(j, `ذخیره شد: ${saved.join(" ، ")} — ${toPersianDigits(gotN)} عکس + Excel${cacheNote}${modeNote}` + (failN ? ` (${toPersianDigits(failN)} عکس دریافت نشد؛ دوباره امتحان کنید)` : ""));
      if (failN) {
        const x = explain({ error: fatal || lastErr });
        await alertBox(`ZIP ذخیره شد، اما ${toPersianDigits(failN)} عکس از ${toPersianDigits(items.length)} عکس دریافت نشد.\n\n` + (fatal || lastErr ? `علت: ${x.why}\nراه‌حل: ${x.tip}\n\nجزئیات فنی: ${x.raw}` : "علت: فایل آن عکس‌ها در Drive پیدا نشد یا دسترسی نداشت.") + "\n\nدوباره همین دانلود را بزنید؛ عکس‌های گرفته‌شده از حافظهٔ دستگاه می‌آیند و فقط عکس‌های ناموفق دوباره از سرور گرفته می‌شوند.", "ZIP ناقص ذخیره شد");
      } else toast(`${nParts > 1 ? "ZIPها" : "ZIP"} ذخیره شد — ${toPersianDigits(gotN)} عکس`, "success");
    } catch (e) { await failBuild(j, stage, e); } finally { j.done(); }
  }

  async function clearPhotoCache() {
    const n = await cacheCount();
    if (!n) return toast("حافظهٔ عکس‌ها خالی است", "success");
    if (!(await confirmBox(`${toPersianDigits(n)} عکس برای سرعت بیشتر روی همین دستگاه نگه داشته شده است.\nپاک شود؟ (دانلود بعدی کندتر می‌شود)`, { yes: "پاک شود", danger: true }))) return;
    await clearCache();
    toast("حافظهٔ عکس‌ها پاک شد", "success");
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
    icon: ICONS.admin,
    mount(container) {
      f.key = h("input", { type: "password", name: "admin-key", dir: "ltr", class: "ltr-in", autocomplete: "new-password", placeholder: "همان رمز ورود ادمین" });
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
            h("button", { type: "button", class: "btn btn-primary", onclick: fetchReport }, h("span", { class: "ico-sm", html: ICONS.list }), "دریافت گزارش"),
            h("button", { type: "button", class: "btn btn-success", onclick: exportExcel }, h("span", { class: "ico-sm", html: ICONS.sheet }), "خروجی Excel"),
            h("button", { type: "button", class: "btn btn-danger", onclick: exportPdf }, h("span", { class: "ico-sm", html: ICONS.pdf }), "خروجی PDF"),
            h("button", { type: "button", class: "btn btn-warning", onclick: photosZip }, h("span", { class: "ico-sm", html: ICONS.zip }), "ZIP عکس‌ها (حداقل یک فیلتر، تاریخ ≤ ۱۰ روز)")
          ),
          links,
          h("div", { style: "margin-top:8px" }, h("button", { type: "button", class: "btn btn-secondary btn-xs", onclick: clearPhotoCache }, "پاک کردن حافظهٔ عکس‌های دانلودشده"))
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
