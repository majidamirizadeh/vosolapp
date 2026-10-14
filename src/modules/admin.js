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
import { attachDatePicker } from "../core/datepicker.js";
import { createXlsx } from "../lib/xlsx.js";
import { createZip } from "../lib/zip.js";
import { createPdfFromJpegs } from "../lib/pdf.js";
import { ensureFonts } from "./photos.js";
import { serverCall } from "./sync.js";
import { sessionPass } from "./auth.js";
import { summarize, dedupAmount } from "./records.js";
import { ICONS } from "../core/icons.js";
import { getCached, cachedIds, putCached, clearCache, cacheCount } from "./photocache.js";

/** کلیدهای مرتب‌سازی — پیش‌فرض: امور */
const SORT_KEYS = [
  { value: "omoor", label: "امور" },
  { value: "date", label: "روز (تاریخ)" },
  { value: "user", label: "اکیپ" },
  { value: "leader", label: "سرگروه" },
  { value: "mode", label: "نوع عملیات" },
];

/** گروه‌بندی گزارش خلاصه (PDF و گزارش نمایشی) */
const GROUPS = [
  { value: "omoor", label: "امور" },
  { value: "city", label: "شهر/بخش" },
  { value: "leader", label: "سرگروه" },
];

const COLLATOR = new Intl.Collator("fa"); // مرتب‌سازی با Collator چند برابر سریع‌تر از localeCompare است

function sortRecords(list, key) {
  const arr = [...(list || [])];
  const cmp = (a, b) => COLLATOR.compare(String(a || ""), String(b || ""));
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

const normName = (v) => String(v ?? "").replace(/ي/g, "ی").replace(/ك/g, "ک").replace(/\u200c/g, " ").replace(/\s+/g, " ").trim() || "—";
/** «ی/ک» عربی و ارقام را یکسان می‌کند تا عنوان عملیات با کلید پاسخ سرور یکی شود */
const modeVal = (g, title) => (g.modes && (g.modes[title] || g.modes[normName(title)])) || { count: 0, amount: 0 };

const WARN_BUCKETS = [["open", "در جریان"], ["expired", "پایان مهلت"], ["resolved", "تعیین‌تکلیف‌شده"]];
const warnVal = (g, b) => (g.warn && g.warn[b]) || { count: 0, amount: 0 };
/** عملیات‌ها بدون «صدور اخطار» — اخطارها از عملکرد جدا حساب می‌شوند */
const opModes = () => Object.values(MODES).filter((m) => m.title !== MODES.warning.title);
const isWarnRec = (r) => normName(r.modeTitle) === normName(MODES.warning.title);
/** دستهٔ اخطار یک رکورد (فقط برای حالت جایگزین؛ سرور جدید warnStatus را محاسبه‌شده می‌دهد): اخطار قدیمی بدون وضعیت = پایان مهلت */
const warnBucketOf = (r) => {
  const st = String(r.warnStatus || "");
  return st === "در جریان" ? "open" : st.startsWith("تعیین تکلیف") ? "resolved" : "expired";
};

/**
 * جایگزین سمت دستگاه برای سرورِ قدیمی (بدون action «groupReport»): از فهرست رکوردها همان ساختار پاسخ سرور را می‌سازد.
 * قانون تکراری‌ها همان قبلی است (dedupAmount در records.js: وصول اولویت دارد، بعد بزرگ‌ترین مبلغ).
 * اخطارها از عملکرد جدا می‌شوند: به‌تفکیک در جریان / پایان مهلت / تعیین‌تکلیف‌شده.
 */
function aggregateRecords(recs) {
  const mk = (list, name, sub) => {
    const ops = list.filter((r) => !isWarnRec(r)), ws = list.filter(isWarnRec);
    const s = summarize(ops);
    const g = { count: list.length, collectTotal: s.collectTotal, followedTotal: s.followedTotal, modes: s.byMode, warn: {} };
    for (const [b] of WARN_BUCKETS) {
      const l = ws.filter((r) => warnBucketOf(r) === b);
      g.warn[b] = { count: l.length, amount: dedupAmount(l).total };
    }
    if (name !== undefined) g.name = name;
    if (sub) g.sub = sub;
    return g;
  };
  const views = { omoor: new Map(), city: new Map(), leader: new Map() };
  const put = (view, key, name, sub, r) => {
    let e = views[view].get(key);
    if (!e) views[view].set(key, (e = { name, sub, list: [] }));
    e.list.push(r);
  };
  for (const r of recs) {
    const om = normName(r.omoor), ci = normName(r.city), le = normName(r.leader);
    put("omoor", om, om, "", r);
    put("city", om + "|" + ci, ci, om, r);
    put("leader", le, le, "", r);
  }
  const groups = {};
  for (const v in views) {
    groups[v] = [...views[v].values()].map((e) => mk(e.list, e.name, e.sub)).sort((a, b) => b.count - a.count || COLLATOR.compare(String(a.name), String(b.name)));
  }
  return { ok: true, count: recs.length, all: mk(recs), groups };
}

/** آیا جمعِ گروه‌ها با جمع کل (بدون تکرار در کل داده) فرق دارد؟ (اشتراک ثبت‌شده در بیش از یک گروه) */
function groupsDiffer(list, all) {
  const sum = (fn) => list.reduce((t, g) => t + fn(g), 0);
  if (sum((g) => g.collectTotal) !== all.collectTotal || sum((g) => g.followedTotal) !== all.followedTotal) return true;
  if (opModes().some((m) => sum((g) => modeVal(g, m.title).amount) !== modeVal(all, m.title).amount)) return true;
  return WARN_BUCKETS.some(([b]) => sum((g) => warnVal(g, b).amount) !== warnVal(all, b).amount);
}
const DIFF_NOTE = "توجه: هر گروه جداگانه و بدون تکرار اشتراک حساب شده است. اشتراکی که در بیش از یک گروه ثبت شده در هر گروه یک‌بار می‌آید؛ جمع کل بالا در کل داده بدون تکرار است، پس ممکن است با مجموع گروه‌ها کمی فرق کند.";

/**
 * هم‌زمانی تطبیقی دریافت عکس‌ها: با `start` درخواست هم‌زمان شروع می‌کند و تا `max` بالا می‌رود
 * مادامی که «سرعت کل» (بایت بر ثانیه) با هر پله دست‌کم ۱۰٪ بهتر شود؛ وقتی بهتر نشد (اینترنت یا سرور اشباع شد)
 * به پلهٔ قبل برمی‌گردد و ثابت می‌ماند. با خطای سرور یا فشار (کند شدن عکس‌ها) یک پله کم می‌کند و دیگر بالا نمی‌رود.
 */
function createAdaptivePool({ start = 4, min = 2, max = 6, gain = 1.1 } = {}) {
  let limit = start, peak = 0, active = 0, settled = false, prevTp = 0, marks = [];
  const waiters = [];
  const grant = () => { while (waiters.length && active < limit) { active++; peak = Math.max(peak, active); waiters.shift()(); } };
  return {
    max,
    get limit() { return limit; },
    get peak() { return peak; },
    /** شروع یک بخش (ZIP) تازه: نمونه‌های سرعت قبلی دور ریخته می‌شود (فاصلهٔ بین بخش‌ها سرعت را خراب می‌کند) */
    rest() { marks = []; },
    acquire() { return new Promise((resolve) => { waiters.push(resolve); grant(); }); },
    /** پایان یک درخواست؛ info = { ok, bytes, pressure } یا null (درخواستی انجام نشد) */
    done(info) {
      active--;
      if (info) this._report(info);
      grant();
    },
    _report({ ok, bytes, pressure }) {
      const t = performance.now();
      if (!ok || pressure) { // خطا یا فشار روی سرور: یک پله کمتر و دیگر بالا نرو
        if (limit > min) limit--;
        settled = true; marks = [];
        return;
      }
      if (settled) return;
      marks.push({ t, bytes });
      if (marks.length < limit + 1) return; // برای سنجش سرعت این پله، به‌اندازهٔ یک «دور» تکمیل لازم است
      const dt = (marks[marks.length - 1].t - marks[0].t) / 1000;
      const tp = dt > 0 ? marks.slice(1).reduce((a, m) => a + m.bytes, 0) / dt : 0;
      if (!prevTp || tp >= prevTp * gain) {
        prevTp = tp;
        if (limit < max) { limit++; marks = [{ t, bytes: 0 }]; }
        else settled = true;
      } else { // پلهٔ آخر فایده نداشت
        limit = Math.max(min, limit - 1);
        settled = true;
      }
    },
  };
}

export function createAdminModule({ getUser }) {
  let f = {}, result, links, gr = null; // gr: آخرین خلاصهٔ گروه‌بندی‌شده برای نمایش (بدون دریافت دوباره با تغییر گروه‌بندی)

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
      /** ثبت زمان کاری که هم‌زمان با مرحلهٔ دیگری انجام شده (مرجع زمان مرحله‌ها را جابه‌جا نمی‌کند) */
      add(name, ms) { marks.push([name, ms]); },
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
  const currentSort = () => "omoor"; // ردیف‌های Excel همیشه بر اساس امور (و بعد تاریخ، اکیپ) مرتب می‌شوند

  const currentGroup = () => (f.group && f.group.value) || "omoor";
  const groupLabel = (k) => GROUPS.find((g) => g.value === k)?.label || "امور";
  let groupOk = true; // سرور جدید action «groupReport» دارد؛ سرور قدیمی نه (جایگزین: محاسبه روی دستگاه)

  /** دکمهٔ «دریافت گزارش»: خلاصهٔ کامل همهٔ ردیف‌ها (نه فهرست ردیف‌ها) */
  async function fetchReport() {
    const p = readFilters();
    if (!p) return null;
    cache = null; grCache = null; // دکمهٔ «دریافت گزارش» = تازه‌سازی صریح
    const j = makeJob(1);
    try {
      const got = await fetchGroupReport(j, 1, true);
      if (!got) return null;
      j.done();
      gr = got;
      renderGroupReport();
      links.replaceChildren(h("p", { class: "info-text" }, j.summary()));
      return got;
    } finally { j.done(); }
  }

  function stat(label, n) { return h("div", { class: "stat" }, h("b", {}, toPersianDigits(n)), h("span", {}, label)); }
  const statMoney = (label, n) => h("div", { class: "stat" }, h("b", {}, formatMoney(n)), h("span", {}, label));

  /** جدول خلاصهٔ ۵ عملیات (بدون اخطار) یک گروه (فقط عملیات‌های دارای ثبت؛ برای کل همه نمایش داده می‌شوند) */
  function opsTable(g, all5) {
    const rows = opModes().map((m) => ({ title: m.title, v: modeVal(g, m.title) })).filter((r) => all5 || r.v.count > 0);
    return h("table", { class: "mini-table" }, h("tbody", {}, rows.map((r) =>
      h("tr", {}, h("td", {}, r.title), h("td", {}, `${toPersianDigits(r.v.count)} مورد`), h("td", {}, `${formatMoney(r.v.amount)} ریال`)))));
  }

  /** اخطارها (جدا از عملکرد): در جریان / پایان مهلت / تعیین‌تکلیف‌شده؛ برای کارت گروه فقط ردیف‌های دارای ثبت */
  function warnTable(g, always) {
    const rows = WARN_BUCKETS.map(([b, label]) => ({ b, label, v: warnVal(g, b) }))
      .filter((r) => r.v.count > 0 || (always && r.b !== "resolved"));
    if (!rows.length) return null;
    return h("table", { class: "mini-table warn-table" }, h("tbody", {}, rows.map((r) =>
      h("tr", { class: "warn-" + r.b }, h("td", {}, `اخطار ${r.label}`), h("td", {}, `${toPersianDigits(r.v.count)} مورد`), h("td", {}, `${formatMoney(r.v.amount)} ریال`)))));
  }

  function renderGroupReport() {
    result.replaceChildren();
    if (!gr) return;
    const { data } = gr;
    if (!data.count) { result.append(h("p", { class: "muted" }, "برای این فیلترها موردی در سرور نیست.")); return; }
    const key = currentGroup();
    const list = data.groups[key] || [];
    const all = data.all;
    result.append(h("div", { class: "report-body" },
      h("div", { class: "stat-grid" },
        stat("تعداد کل", data.count),
        statMoney("جمع وصول (ریال)", all.collectTotal),
        statMoney("جمع مبالغ پیگیری‌شده (ریال)", all.followedTotal),
        stat(`تعداد ${groupLabel(key)}`, list.length)
      ),
      gr.note && h("p", { class: "info-text" }, gr.note),
      h("h3", { class: "card-title section-title" }, "خلاصهٔ عملیات‌ها (کل)"),
      opsTable(all, true),
      h("h3", { class: "card-title section-title" }, "اخطارها (جدا از عملکرد)"),
      warnTable(all, true),
      h("p", { class: "info-text" }, "تعداد و مبلغ اخطارها جدا از عملکرد است و در «جمع وصول» و «جمع مبالغ پیگیری‌شده» نیست."),
      h("h3", { class: "card-title section-title" }, `به تفکیک ${groupLabel(key)}`),
      list.map((g) => h("div", { class: "grp-card" },
        h("div", { class: "grp-head" },
          h("b", {}, g.name),
          g.sub && h("span", { class: "muted" }, g.sub),
          h("span", { class: "grp-count" }, `${toPersianDigits(g.count)} مورد`)),
        opsTable(g, false),
        warnTable(g, false),
        h("div", { class: "muted grp-foot" }, `جمع پیگیری‌شده: ${formatMoney(g.followedTotal)} ریال`))),
      groupsDiffer(list, all) && h("p", { class: "info-text" }, DIFF_NOTE)
    ));
  }

  function reRenderGroup() { if (gr) renderGroupReport(); }

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

  /** خلاصهٔ گروه‌بندی‌شدهٔ کل ردیف‌ها (برای PDF و گزارش نمایشی) — خود سرور جمع می‌زند و فقط چند کیلوبایت برمی‌گرداند */
  let grCache = null;
  async function fetchGroupReport(j, step, fresh = false) {
    const p = readFilters();
    if (!p) return null;
    const key = JSON.stringify(p);
    if (!fresh && grCache && grCache.key === key && Date.now() - grCache.t < CACHE_MS) {
      j.step(step, `استفاده از خلاصهٔ دریافت‌شده (${toPersianDigits(Math.round((Date.now() - grCache.t) / 1000))} ثانیه پیش)…`);
      j.mark("خلاصه (از حافظه)");
      return { data: grCache.data, filters: p, note: grCache.note };
    }
    j.step(step, "دریافت خلاصهٔ گزارش از سرور…");
    let data = null, note = "";
    if (groupOk) {
      const res = await serverCall("groupReport", fresh ? { ...p, fresh: true } : p);
      j.srv(res);
      if (res.ok) {
        data = res;
        if (res.cached) j.add("خلاصهٔ آمادهٔ سرور", 0);
        const t = res.t || {}; // زمان مرحله‌های داخل سرور (برای پیدا کردن گلوگاه)
        for (const [k, n] of [["open", "سرور: باز کردن شیت"], ["scan", "سرور: خواندن ستون تاریخ"], ["read", "سرور: خواندن ردیف‌ها"], ["filter", "سرور: فیلتر"], ["agg", "سرور: جمع‌زدن"]]) if (t[k] >= 100) j.add(n, t[k]);
      }
      else if (/action نامعتبر/.test(String(res.error || ""))) groupOk = false; // سرور قدیمی است
      else { await failStage(j, "دریافت خلاصه از سرور", res); return null; }
    }
    if (!data) {
      j.detail("سرور قدیمی است؛ دریافت فهرست و محاسبه روی دستگاه…");
      const res = await serverCall("listRecords", { ...p, limit: 20000, noLinks: true });
      j.srv(res);
      if (!res.ok) { await failStage(j, "دریافت فهرست از سرور", res); return null; }
      data = aggregateRecords(res.records || []);
      if (res.truncated) note = `فقط ${toPersianDigits((res.records || []).length)} مورد اول از ${toPersianDigits(res.total)} مورد حساب شد؛ بازه را محدودتر کنید (با به‌روزرسانی اسکریپت سرور این محدودیت برداشته می‌شود).`;
      note = "سرور هنوز نسخهٔ جدید نیست؛ برای سرعت چند برابر، فایل server/apps-script.js جدید را در Apps Script بگذارید و Deploy ← Manage deployments ← New version بزنید." + (note ? " " + note : "");
    }
    j.mark("دریافت خلاصه");
    grCache = { key, t: Date.now(), data, note };
    return { data, filters: p, note };
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
  const FONT = `Vazirmatn, Tahoma, sans-serif`;
  function fit(ctx, text, maxW) {
    text = String(text ?? "");
    if (ctx.measureText(text).width <= maxW) return text;
    while (text.length > 1 && ctx.measureText(text + "…").width > maxW) text = text.slice(0, -1);
    return text + "…";
  }

  /** PDF خلاصه: جمع کل + خلاصهٔ ۶ عملیات + جدول گروه‌ها (امور / شهر-بخش / سرگروه)؛ بدون ردیف‌های ریز */
  async function buildAdminPdf(data, filters, onPage) {
    await ensureFonts();
    const key = currentGroup(), gLabel = groupLabel(key);
    const list = data.groups[key] || [];
    const all = data.all;
    const modes = opModes(); // ۵ عملیات؛ اخطارها جدا و در ستون‌های «اخطار در جریان / پایان مهلت»
    const showNote = groupsDiffer(list, all);

    const cols = [
      { h: gLabel, w: 270, a: "r" },
      { h: "تعداد کل", w: 100, a: "c" },
      ...modes.map((m) => ({ h: m.title, w: 170, a: "c", mode: m.title })),
      { h: "اخطار در جریان", w: 165, a: "c", warn: "open" },
      { h: "اخطار پایان مهلت", w: 165, a: "c", warn: "expired" },
      { h: "جمع پیگیری‌شده", w: 165, a: "c", follow: true },
    ];
    const M = 50;
    const tableW = PW - M * 2;
    const k = tableW / cols.reduce((t, c) => t + c.w, 0);
    cols.forEach((c) => (c.w *= k));

    const ROW = 64, HEAD = 58, TOP_FIRST = 475, TOP_NEXT = 100, BOTTOM = 120;
    const firstCap = Math.floor((PH - TOP_FIRST - BOTTOM - HEAD) / ROW);
    const nextCap = Math.floor((PH - TOP_NEXT - BOTTOM - HEAD) / ROW);
    const pagesRows = [];
    for (let i = 0; i < list.length;) {
      const cap = pagesRows.length === 0 ? firstCap : nextCap;
      pagesRows.push(list.slice(i, i + cap));
      i += cap;
    }
    if (!pagesRows.length) pagesRows.push([]);

    const rng = filters.fromDate ? `${filters.fromDate} تا ${filters.toDate}` : "همه بازه";
    const pages = [];
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
        ctx.fillText(`گروه‌بندی: ${gLabel}${filters.omoor ? "  |  امور: " + filters.omoor : ""}`, PW - M, 158);
        ctx.fillText(toPersianDigits(`تاریخ تولید: ${new Date().toLocaleDateString("fa-IR")}`), PW - M, 196);

        const by = 230, bh = 215;
        const box = (x, w, title, color = "#0d6efd") => {
          ctx.strokeStyle = "#c5cdd8";
          ctx.lineWidth = 2;
          ctx.strokeRect(x, by, w, bh);
          ctx.fillStyle = "#f4f7fb";
          ctx.fillRect(x + 1, by + 1, w - 2, bh - 2);
          ctx.fillStyle = color;
          ctx.font = `700 26px ${FONT}`;
          ctx.textAlign = "right";
          ctx.fillText(title, x + w - 20, by + 32);
        };
        // ۱) خلاصه (سمت راست)  ۲) خلاصهٔ ۵ عملیات (وسط)  ۳) اخطارها، جدا از عملکرد (سمت چپ)
        const w1 = 560, w2 = 600, w3 = PW - M * 2 - w1 - w2 - 48;
        const x1 = PW - M - w1, x2 = x1 - 24 - w2, x3 = M;
        box(x1, w1, "خلاصه");
        const sumRows = [["کل", `${toPersianDigits(data.count)} مورد`], ["جمع وصول", `${formatMoney(all.collectTotal)} ریال`], ["جمع مبالغ پیگیری‌شده", `${formatMoney(all.followedTotal)} ریال`]];
        sumRows.forEach(([lab, val], i) => {
          const ry = by + 72 + i * 44;
          ctx.fillStyle = "#222"; ctx.font = `700 23px ${FONT}`; ctx.textAlign = "right";
          ctx.fillText(lab, x1 + w1 - 20, ry);
          ctx.textAlign = "left"; ctx.font = `700 23px ${FONT}`;
          ctx.fillText(fit(ctx, val, w1 - 300), x1 + 22, ry);
        });
        ctx.fillStyle = "#555"; ctx.font = `400 20px ${FONT}`; ctx.textAlign = "right";
        ctx.fillText(toPersianDigits(`تعداد ${gLabel}: ${list.length}`), x1 + w1 - 20, by + 196);

        box(x2, w2, "خلاصهٔ عملیات‌ها");
        modes.forEach((m, mi) => {
          const v = modeVal(all, m.title);
          const ry = by + 72 + mi * 28;
          if (mi % 2 === 0) { ctx.fillStyle = "#e9eff8"; ctx.fillRect(x2 + 10, ry - 14, w2 - 20, 28); }
          ctx.fillStyle = "#222";
          ctx.font = `700 21px ${FONT}`;
          ctx.textAlign = "right";
          ctx.fillText(m.title, x2 + w2 - 20, ry);
          ctx.font = `400 21px ${FONT}`;
          ctx.textAlign = "center";
          ctx.fillText(`${toPersianDigits(v.count)} مورد`, x2 + w2 / 2 + 20, ry);
          ctx.textAlign = "left";
          ctx.fillText(`${formatMoney(v.amount)} ریال`, x2 + 22, ry);
        });

        box(x3, w3, "اخطارها (جدا از عملکرد)", "#b45309");
        WARN_BUCKETS.forEach(([b, label], i) => {
          const v = warnVal(all, b);
          const ry = by + 66 + i * 50;
          ctx.fillStyle = b === "expired" ? "#b91c1c" : "#222";
          ctx.font = `700 22px ${FONT}`; ctx.textAlign = "right";
          ctx.fillText(`اخطار ${label}`, x3 + w3 - 20, ry);
          ctx.textAlign = "left";
          ctx.fillText(`${toPersianDigits(v.count)} مورد`, x3 + 22, ry);
          ctx.font = `400 19px ${FONT}`; ctx.fillStyle = "#444"; ctx.textAlign = "right";
          ctx.fillText(`${formatMoney(v.amount)} ریال`, x3 + w3 - 20, ry + 25);
        });
        y = TOP_FIRST - 10;
      }

      ctx.fillStyle = "#0d6efd";
      ctx.fillRect(M, y, tableW, HEAD);
      ctx.fillStyle = "#fff";
      ctx.font = `700 20px ${FONT}`;
      let x = PW - M;
      for (const col of cols) {
        ctx.textAlign = col.a === "r" ? "right" : "center";
        ctx.fillText(fit(ctx, col.h, col.w - 12), col.a === "r" ? x - 10 : x - col.w / 2, y + HEAD / 2);
        x -= col.w;
      }
      y += HEAD;

      pagesRows[p].forEach((g, ri) => {
        ctx.fillStyle = ri % 2 ? "#f4f7fb" : "#ffffff";
        ctx.fillRect(M, y, tableW, ROW);
        ctx.fillStyle = "#222";
        let cx = PW - M;
        for (const col of cols) {
          if (col.a === "r") {
            ctx.textAlign = "right";
            ctx.font = `700 22px ${FONT}`;
            ctx.fillText(fit(ctx, g.name, col.w - 16), cx - 10, y + (g.sub ? ROW / 2 - 12 : ROW / 2));
            if (g.sub) {
              ctx.font = `400 17px ${FONT}`;
              ctx.fillStyle = "#666";
              ctx.fillText(fit(ctx, g.sub, col.w - 16), cx - 10, y + ROW / 2 + 15);
              ctx.fillStyle = "#222";
            }
          } else if (col.warn) {
            const v = warnVal(g, col.warn);
            ctx.textAlign = "center";
            ctx.font = `700 21px ${FONT}`;
            ctx.fillStyle = col.warn === "expired" && v.count ? "#b91c1c" : "#222";
            ctx.fillText(v.count ? `${toPersianDigits(v.count)} مورد` : "—", cx - col.w / 2, y + ROW / 2 - 12);
            if (v.count) {
              ctx.font = `400 18px ${FONT}`;
              ctx.fillStyle = "#444";
              ctx.fillText(fit(ctx, formatMoney(v.amount), col.w - 12), cx - col.w / 2, y + ROW / 2 + 15);
            }
            ctx.fillStyle = "#222";
          } else if (col.mode) {
            const v = modeVal(g, col.mode);
            ctx.textAlign = "center";
            ctx.font = `700 21px ${FONT}`;
            ctx.fillText(v.count ? `${toPersianDigits(v.count)} مورد` : "—", cx - col.w / 2, y + ROW / 2 - 12);
            if (v.count) {
              ctx.font = `400 18px ${FONT}`;
              ctx.fillStyle = "#444";
              ctx.fillText(fit(ctx, formatMoney(v.amount), col.w - 12), cx - col.w / 2, y + ROW / 2 + 15);
              ctx.fillStyle = "#222";
            }
          } else {
            ctx.textAlign = "center";
            ctx.font = `700 21px ${FONT}`;
            ctx.fillText(fit(ctx, col.follow ? formatMoney(g.followedTotal) : toPersianDigits(g.count), col.w - 12), cx - col.w / 2, y + ROW / 2);
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
      });

      if (!list.length) {
        ctx.fillStyle = "#666";
        ctx.textAlign = "center";
        ctx.font = `400 26px ${FONT}`;
        ctx.fillText("برای این فیلترها موردی ثبت نشده است", PW / 2, y + 50);
      }

      if (showNote && p === pagesRows.length - 1) {
        ctx.fillStyle = "#555";
        ctx.font = `400 19px ${FONT}`;
        ctx.textAlign = "right";
        const words = DIFF_NOTE.split(" ");
        let line = "", ly = y + 34;
        for (const w of words) {
          const t = line ? line + " " + w : w;
          if (ctx.measureText(t).width > tableW && line) { ctx.fillText(line, PW - M, ly); ly += 28; line = w; } else line = t;
        }
        if (line) ctx.fillText(line, PW - M, ly);
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
    const j = makeJob(3);
    let stage = "دریافت خلاصه از سرور";
    try {
      const got = await fetchGroupReport(j, 1);
      if (!got) return;
      if (!got.data.count) { j.done(); return toast("برای این فیلترها موردی در سرور نیست", "error"); }
      stage = "ساخت صفحه‌های PDF";
      j.step(2, "آماده‌سازی فونت و صفحه‌ها…");
      const blob = await buildAdminPdf(got.data, got.filters, (i, n) => { j.detail(`ساخت صفحهٔ ${toPersianDigits(i)} از ${toPersianDigits(n)}…`); j.progress(i / n); });
      j.mark("ساخت صفحه‌ها");
      stage = "ذخیره فایل";
      j.step(3, "ذخیرهٔ فایل روی دستگاه…");
      downloadBlob(blob, outName("pdf"));
      j.done();
      showSummary(j, got.note || "");
      toast(`فایل PDF ذخیره شد (${toPersianDigits(got.data.count)} مورد)`, "success");
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

  const POOL = { start: 4, min: 2, max: 6 }; // درخواست هم‌زمان عکس (تطبیقی؛ createAdaptivePool)
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
      const cachedSet = await cachedIds([...new Set(items.map((it) => it.id))]); // فقط وجود؛ خود عکس‌ها بخش‌به‌بخش خوانده می‌شوند (RAM کمتر)
      const nNeed = items.filter((it) => !cachedSet.has(it.id)).length;

      if (items.length > 80 || nParts > 1) {
        const prevJob = j;
        j.done();
        const mb = Math.round(nNeed * 0.15);
        const msg = `${toPersianDigits(items.length)} عکس` + (cachedSet.size ? ` (${toPersianDigits(items.filter((it) => cachedSet.has(it.id)).length)} عدد از قبل روی همین دستگاه است)` : "") +
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
      const needIds = [...new Set(items.filter((it) => !cachedSet.has(it.id)).map((it) => it.id))];
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
      let netBytes = 0, netOk = 0, netTried = 0, netMs = 0, lastSaveAt = 0; // آمار دریافت از سرور (برای سرعت و زمان باقی‌مانده)
      const saved = [];
      const pending = [];
      const pool = createAdaptivePool(POOL);
      const mbs = (x) => toPersianDigits(x.toFixed(1)).replace(".", "٫");
      const etaText = (sec) => (sec < 90 ? `${toPersianDigits(Math.max(5, Math.round(sec / 5) * 5))} ثانیه` : `${toPersianDigits(Math.round(sec / 60))} دقیقه`);

      /** دریافت یک بخش: عکس‌های کش‌شدهٔ همین بخش از حافظه + بقیه از سرور؛ → { entries, tag } */
      const fetchPart = async (k) => {
        const part = items.slice(k * PART_SIZE, (k + 1) * PART_SIZE);
        const tag = nParts > 1 ? `بخش ${toPersianDigits(k + 1)} از ${toPersianDigits(nParts)} — ` : "";
        const entries = k === 0 ? [excel] : [];

        // فقط عکس‌های کش‌شدهٔ همین بخش وارد حافظه می‌شوند (نه کل ۱۵۰۰ عکس یک‌جا)
        const inCache = [...new Set(part.filter((it) => cachedSet.has(it.id)).map((it) => it.id))];
        const partCache = inCache.length ? await getCached(inCache, { anyAge: true }) : new Map();
        const lost = inCache.filter((id) => !partCache.has(id)); // وسط کار از کش پاک شده؛ نادر
        if (lost.length && signed) {
          const s2 = await serverCall("signPhotos", { ...pick(filters), fileIds: lost });
          j.srv(s2);
          if (s2.ok && s2.sigs) Object.assign(sigs, s2.sigs);
        }

        const need = [];
        for (const it of part) {
          const c = partCache.get(it.id);
          if (c) { entries.push({ name: it.path, data: c }); gotN++; fromCache++; doneN++; }
          else if (signed && !sigs[it.id]) { failN++; doneN++; lastErr = lastErr || "عکس در شیت ثبت نشده است"; }
          else need.push(it);
        }

        stage = "دریافت عکس‌ها";
        j.step(3, `${tag}دریافت عکس‌ها: ${toPersianDigits(doneN)} از ${toPersianDigits(items.length)}`);
        j.progress(Math.min(doneN, items.length) / items.length);
        const byId = new Map();
        for (const it of need) { if (!byId.has(it.id)) byId.set(it.id, []); byId.get(it.id).push(it); }
        const uniq = [...byId.keys()];
        const batches = [];
        for (let i = 0; i < uniq.length; i += perCall) batches.push(uniq.slice(i, i + perCall));
        let next = 0;
        const tPhase = Date.now();
        const speedLine = () => {
          const secs = (netMs + Date.now() - tPhase) / 1000;
          if (secs < 3 || netBytes <= 0 || netOk < 2) return "";
          const rate = netBytes / secs;                       // بایت بر ثانیه
          const left = Math.max(0, needIds.length - netTried); // عکس‌های باقی‌مانده برای دریافت
          const eta = (left * (netBytes / netOk)) / rate;
          return `\nسرعت ${mbs(rate / 1048576)} مگابایت بر ثانیه` + (left ? ` — حدود ${etaText(eta)} مانده` : "");
        };
        pool.rest();
        const worker = async () => {
          for (;;) {
            await pool.acquire();
            if (fatal || next >= batches.length) { pool.done(null); return; }
            const ids = batches[next++];
            const files = ids.map((id) => ({ id, ...(signed ? { sig: sigs[id] } : {}) }));
            const count = ids.reduce((t, id) => t + byId.get(id).length, 0);
            let info = null;
            try {
              const res = await getBatch(j, filters, files, signed);
              let bytesIn = 0;
              if (res.ok) {
                streak = 0;
                fast += res.fast || 0;
                const toCache = [];
                const have = new Set();
                for (const ph of res.photos || []) {
                  const list = byId.get(ph.id);
                  if (!list) continue;
                  const bytes = b64ToBytes(ph.data);
                  bytesIn += bytes.length;
                  have.add(ph.id);
                  list.forEach((it) => { entries.push({ name: it.path, data: bytes }); gotN++; });
                  toCache.push({ id: ph.id, bytes });
                }
                ids.forEach((id) => { if (!have.has(id)) failN += byId.get(id).length; });
                netBytes += bytesIn; netOk += have.size;
                if (res.error) lastErr = res.error;
                if (toCache.length) pending.push(putCached(toCache));
                // «فشار» = سرور بخشی از عکس‌ها را با روش کند (DriveApp) خوانده؛ نشانهٔ محدودیت سرعت گوگل
                info = { ok: true, bytes: bytesIn, pressure: signed && res.fast > 0 && res.fast < ids.length * 0.7 };
              } else {
                failN += count;
                lastErr = res.error || lastErr;
                if (FATAL.test(String(res.error))) fatal = res.error;
                else if (++streak >= 4) fatal = "سرور چند بار پشت‌سرهم پاسخ نداد: " + String(res.error || "");
                info = { ok: false, bytes: 0, pressure: true };
              }
            } finally {
              pool.done(info);
            }
            netTried += ids.length;
            doneN += count;
            j.detail(`${tag}دریافت عکس‌ها: ${toPersianDigits(Math.min(doneN, items.length))} از ${toPersianDigits(items.length)}` + (failN ? `\n(${toPersianDigits(failN)} عکس دریافت نشد)` : "") + speedLine());
            j.progress(Math.min(doneN, items.length) / items.length);
          }
        };
        await Promise.all(Array.from({ length: Math.min(pool.max, batches.length) }, worker));
        netMs += Date.now() - tPhase;
        j.mark(`عکس‌ها${nParts > 1 ? " " + toPersianDigits(k + 1) : ""}`);
        return { entries, tag };
      };

      /** ساخت ZIP و ذخیرهٔ یک بخش؛ برای بخش‌های میانی هم‌زمان با دریافت بخش بعدی اجرا می‌شود */
      const finishPart = async (k, { entries, tag }) => {
        let st = "ساخت فایل ZIP";
        try {
          const photosInPart = entries.length - (k === 0 ? 1 : 0);
          if (!photosInPart) return; // این بخش عکسی نیاورد: ZIP خالی ساخته نمی‌شود
          const last = k === nParts - 1;
          if (last) { stage = st; j.step(4, `${tag}ساخت فایل ZIP (${toPersianDigits(photosInPart)} عکس${k === 0 ? " + Excel" : ""})…`); }
          await sleep(0);
          const tz = Date.now();
          const zip = await createZip(entries);
          j.add(`ZIP${nParts > 1 ? " " + toPersianDigits(k + 1) : ""}`, Date.now() - tz);
          st = "ذخیره فایل";
          if (last) { stage = st; j.step(5, `${tag}ذخیرهٔ فایل روی دستگاه…`); }
          const gap = lastSaveAt + 900 - Date.now(); // فاصله تا مرورگر دانلودهای پشت‌سرهم را بپذیرد
          if (lastSaveAt && gap > 0) await sleep(gap);
          downloadBlob(zip, dlName(k));
          lastSaveAt = Date.now();
          saved.push(dlName(k));
        } catch (e) {
          if (e && typeof e === "object") e.stage = e.stage || st;
          throw e;
        }
      };

      // بخش بعدی دریافت می‌شود در حالی که ZIP/ذخیرهٔ بخش قبلی در حال انجام است (حداکثر دو بخش هم‌زمان در حافظه)
      let prevFinish = null;
      for (let k = 0; k < nParts; k++) {
        const got = await fetchPart(k);
        if (prevFinish) await prevFinish;
        prevFinish = finishPart(k, got);
        prevFinish.catch(() => {}); // خطا هنگام await بعدی به catch اصلی می‌رسد
        if (fatal) break;
      }
      if (prevFinish) await prevFinish;
      await Promise.all(pending);
      j.done();

      if (!gotN) {
        await failStage(null, "دریافت عکس‌ها", { error: fatal || lastErr || "عکسی از سرور دریافت نشد (فایل‌ها در Drive پیدا نشدند)" });
        return;
      }
      failN = items.length - gotN; // شامل بخش‌هایی که به‌خاطر خطای قطعی اصلاً شروع نشدند
      const cacheNote = fromCache ? ` — ${toPersianDigits(fromCache)} عکس از حافظهٔ دستگاه` : "";
      const modeNote = !needIds.length ? "" : signed ? (fast ? " — دریافت سریع" : "") : " — روش قدیمی (اسکریپت سرور را به‌روز کنید)";
      const speedNote = netBytes > 0 && netMs > 0 ? ` — از سرور ${mbs(netBytes / 1048576)} مگابایت با سرعت ${mbs(netBytes / 1048576 / (netMs / 1000))} مگابایت بر ثانیه (تا ${toPersianDigits(pool.peak)} درخواست هم‌زمان)` : "";
      showSummary(j, `ذخیره شد: ${saved.join(" ، ")} — ${toPersianDigits(gotN)} عکس + Excel${cacheNote}${modeNote}${speedNote}` + (failN ? ` (${toPersianDigits(failN)} عکس دریافت نشد؛ دوباره امتحان کنید)` : ""));
      if (failN) {
        const x = explain({ error: fatal || lastErr });
        await alertBox(`ZIP ذخیره شد، اما ${toPersianDigits(failN)} عکس از ${toPersianDigits(items.length)} عکس دریافت نشد.\n\n` + (fatal || lastErr ? `علت: ${x.why}\nراه‌حل: ${x.tip}\n\nجزئیات فنی: ${x.raw}` : "علت: فایل آن عکس‌ها در Drive پیدا نشد یا دسترسی نداشت.") + "\n\nدوباره همین دانلود را بزنید؛ عکس‌های گرفته‌شده از حافظهٔ دستگاه می‌آیند و فقط عکس‌های ناموفق دوباره از سرور گرفته می‌شوند.", "ZIP ناقص ذخیره شد");
      } else toast(`${nParts > 1 ? "ZIPها" : "ZIP"} ذخیره شد — ${toPersianDigits(gotN)} عکس`, "success");
    } catch (e) { await failBuild(j, (e && e.stage) || stage, e); } finally { j.done(); }
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

  return {
    id: "admin",
    title: "گزارش سرور",
    icon: ICONS.admin,
    mount(container) {
      f.key = h("input", { type: "password", name: "admin-key", dir: "ltr", class: "ltr-in", autocomplete: "new-password", placeholder: "همان رمز ورود ادمین" });
      f.from = attachDatePicker(h("input", { type: "text", inputmode: "numeric", dir: "ltr", class: "ltr-in", placeholder: "1405/07/01" }));
      f.to = attachDatePicker(h("input", { type: "text", inputmode: "numeric", dir: "ltr", class: "ltr-in", placeholder: "1405/07/30" }));
      f.all = h("input", { type: "checkbox", onchange: () => { f.from.disabled = f.to.disabled = f.all.checked; } });
      f.user = h("input", { type: "text", inputmode: "numeric", dir: "ltr", class: "ltr-in", placeholder: "مثال: 05 (خالی = همه)" });
      f.mode = h("select", {}, h("option", { value: "" }, "همه عملیات‌ها"), Object.values(MODES).map((m) => h("option", { value: m.title }, m.title)));
      f.omoor = h("select", {}, h("option", { value: "" }, "همه امورها"), OMOORS.map((o) => h("option", { value: o }, o)));
      f.eshterak = h("input", { type: "text", inputmode: "numeric", dir: "ltr", class: "ltr-in", placeholder: "خالی = همه" });
      f.group = h("select", { onchange: reRenderGroup }, GROUPS.map((g) => h("option", { value: g.value }, g.label)));
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
          field("گروه‌بندی گزارش (PDF و گزارش نمایشی)", f.group),
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
