/**
 * تب «گزارش»: بازه تاریخ، خلاصه، خروجی Excel / PDF / ZIP
 */
import { h, downloadBlob, toPersianDigits, formatMoney } from "../core/utils.js";
import { parseJalali, todayJalali, jalaliKey, rangePreset, PRESETS } from "../core/jalali.js";
import { toast, busy } from "../core/ui.js";
import { getPref } from "../core/prefs.js";
import { listFor, summarize } from "./records.js";
import { buildXlsx, buildPdf, buildZip, baseName } from "./exporter.js";

export function createReportsModule({ getUser }) {
  let from, to, result, scopeNote;

  async function collect() {
    const f = parseJalali(from.value), t = parseJalali(to.value);
    if (!f || !t) { toast("تاریخ‌ها را به شکل 1405/07/15 وارد کنید", "error"); return null; }
    const user = getUser();
    const all = await listFor(user, { allUsers: getPref("allUsersOnPhone") });
    const fk = jalaliKey(f.text), tk = jalaliKey(t.text);
    const records = all.filter((r) => { const k = jalaliKey(r.date); return k >= Math.min(fk, tk) && k <= Math.max(fk, tk); });
    const meta = {
      from: fk <= tk ? f.text : t.text,
      to: fk <= tk ? t.text : f.text,
      userLabel: getPref("allUsersOnPhone") ? "همه کاربران این گوشی" : user.name,
    };
    return { records, meta };
  }

  async function showSummary() {
    const c = await collect();
    if (!c) return;
    const s = summarize(c.records);
    result.replaceChildren();
    if (!s.count) { result.append(h("p", { class: "muted" }, "برای این بازه موردی ثبت نشده است.")); return; }
    result.append(
      h("div", { class: "stat-grid" },
        stat("کل موارد", s.count), stat("ارسال شده", s.sent), stat("در انتظار", s.pending), stat("عکس‌ها", s.photos)
      ),
      h("table", { class: "mini-table" },
        h("tbody", {}, Object.entries(s.byMode).map(([k, v]) =>
          h("tr", {}, h("td", {}, k), h("td", {}, `${toPersianDigits(v.count)} مورد`), h("td", {}, `${formatMoney(v.amount)} ریال`)))),
        h("tfoot", {}, h("tr", {}, h("td", {}, "جمع"), h("td", {}, `${toPersianDigits(s.count)} مورد`), h("td", {}, `${formatMoney(s.total)} ریال`)))
      )
    );
  }

  const stat = (label, n) => h("div", { class: "stat" }, h("b", {}, toPersianDigits(n)), h("span", {}, label));

  async function exportAs(kind) {
    const c = await collect();
    if (!c) return;
    if (!c.records.length) return toast("برای این بازه موردی ثبت نشده است", "error");
    const b = busy("در حال ساخت فایل…");
    try {
      const name = baseName(c.meta);
      let blob, file;
      if (kind === "xlsx") { blob = await buildXlsx(c.records, c.meta); file = `${name}.xlsx`; }
      else if (kind === "pdf") { blob = await buildPdf(c.records, c.meta); file = `${name}.pdf`; }
      else { blob = await buildZip(c.records, c.meta, { onProgress: (r) => b.progress(r) }); file = `${name}.zip`; }
      b.done();
      downloadBlob(blob, file);
      toast(`ذخیره شد: ${file}`, "success");
      if (navigator.canShare?.({ files: [new File([blob], file, { type: blob.type })] })) {
        lastShare = { blob, file };
        shareBtn.classList.remove("hidden");
      }
    } catch (e) {
      b.done();
      console.error(e);
      toast("ساخت فایل ناموفق بود: " + (e.message || e), "error");
    }
  }

  let lastShare = null, shareBtn;

  return {
    id: "reports",
    title: "گزارش",
    icon: "📊",
    async mount(container) {
      from = h("input", { type: "text", inputmode: "numeric", dir: "ltr", class: "ltr-in", placeholder: "1405/07/15" });
      to = h("input", { type: "text", inputmode: "numeric", dir: "ltr", class: "ltr-in", placeholder: "1405/07/15" });
      result = h("div", { class: "report-result" });
      scopeNote = h("div", { class: "info-text" });
      shareBtn = h("button", { type: "button", class: "btn btn-secondary btn-sm hidden", onclick: () => lastShare && navigator.share({ files: [new File([lastShare.blob], lastShare.file, { type: lastShare.blob.type })] }).catch(() => {}) }, "اشتراک‌گذاری آخرین فایل (واتساپ، ایتا، …)");

      container.append(
        h("div", { class: "card" },
          h("h3", { class: "card-title" }, "بازه گزارش"),
          // انتخاب سریع بازه؛ بعد از انتخاب، تاریخ‌ها قابل ویرایش دستی هم هستند
          h("div", { class: "chips" }, PRESETS.map(([k, label]) =>
            h("button", { type: "button", class: "chip", onclick: () => { const r = rangePreset(k); from.value = r.from; to.value = r.to; showSummary(); } }, label))),
          h("div", { class: "row2" },
            h("div", { class: "field" }, h("label", {}, "از تاریخ"), from),
            h("div", { class: "field" }, h("label", {}, "تا تاریخ"), to)
          ),
          scopeNote,
          h("button", { type: "button", class: "btn btn-secondary", onclick: showSummary }, "نمایش خلاصه"),
          result
        ),
        h("div", { class: "card" },
          h("h3", { class: "card-title" }, "خروجی گرفتن"),
          h("button", { type: "button", class: "btn btn-success", onclick: () => exportAs("xlsx") }, "📗 گزارش Excel"),
          h("button", { type: "button", class: "btn btn-danger", onclick: () => exportAs("pdf") }, "📕 گزارش PDF"),
          h("button", { type: "button", class: "btn btn-primary", onclick: () => exportAs("zip") }, "🗂 ZIP کامل (عکس‌ها + Excel + PDF)"),
          h("div", { class: "info-text" }, "فایل‌ها در پوشه دانلود گوشی ذخیره می‌شوند. ZIP هنگام باز شدن یک پوشه مرتب با عکس‌هایی به نام شماره اشتراک می‌سازد."),
          shareBtn
        )
      );
    },
    onShow() {
      const t = todayJalali();
      if (!from.value) from.value = t;
      if (!to.value) to.value = t;
      scopeNote.textContent = getPref("allUsersOnPhone") ? "گزارش همه کاربرانی که روی این گوشی ثبت کرده‌اند." : `گزارش فقط برای ${getUser().name}.`;
      result.replaceChildren();
    },
  };
}
