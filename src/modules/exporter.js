/**
 * خروجی گزارش: Excel ، PDF ، ZIP (عکس‌ها + اکسل + PDF) — کاملاً آفلاین
 */
import { createXlsx } from "../lib/xlsx.js";
import { createZip } from "../lib/zip.js";
import { createPdfFromJpegs } from "../lib/pdf.js";
import { summarize } from "./records.js";
import { ensureFonts } from "./photos.js";
import { formatMoney, toPersianDigits, safeFileName } from "../core/utils.js";

const dtFa = (iso) => {
  try { return new Date(iso).toLocaleString("fa-IR", { dateStyle: "short", timeStyle: "short" }); } catch { return iso || ""; }
};

const sortRecords = (list) => [...list].sort((a, b) => a.id - b.id);

/** نام فایل خروجی: Report_<from>_<to>_<user> */
export function baseName(meta) {
  const d = (s) => String(s).replace(/\//g, "-");
  const range = meta.from === meta.to ? d(meta.from) : `${d(meta.from)}_تا_${d(meta.to)}`;
  return safeFileName(`گزارش_${range}_${meta.userLabel || ""}${meta.modeTitle ? "_" + meta.modeTitle : ""}`).replace(/-+/g, "-").replace(/-$/, "");
}

/* ───────────────────────── Excel ───────────────────────── */
export async function buildXlsx(records, meta) {
  const list = sortRecords(records);
  const s = summarize(list);

  const data = {
    name: "داده‌ها",
    title: `گزارش ${meta.from === meta.to ? meta.from : `${meta.from} تا ${meta.to}`} — ${meta.userLabel}${meta.modeTitle ? " — " + meta.modeTitle : ""}`,
    columns: [
      { header: "ردیف", width: 7, type: "number" },
      { header: "تاریخ", width: 13 },
      { header: "نوع عملیات", width: 20 },
      { header: "شماره اشتراک", width: 15 },
      { header: "امور", width: 18 },
      { header: "شهر", width: 16 },
      { header: "سرگروه", width: 18 },
      { header: "مبلغ (ریال)", width: 16, type: "number" },
      { header: "تعداد عکس", width: 10, type: "number" },
      { header: "نام فایل عکس‌ها", width: 34 },
      { header: "عرض جغرافیایی", width: 14 },
      { header: "طول جغرافیایی", width: 14 },
      { header: "کاربر", width: 16 },
      { header: "وضعیت", width: 14 },
      { header: "زمان ثبت", width: 20 },
      { header: "توضیحات", width: 30 },
    ],
    rows: list.map((r, i) => [
      i + 1, r.date, r.modeTitle, r.eshterak, r.omoor, r.city, r.leader, r.amount,
      r.photos?.length || 0,
      (r.photos || []).map((p) => p.name).join(" ، "),
      r.gpsLat ?? "", r.gpsLng ?? "", r.userName || r.userCode,
      r.status === "sent" ? "ارسال شده" : "در انتظار ارسال",
      dtFa(r.createdAt),
      r.note || "",
    ]),
  };

  const summary = {
    name: "خلاصه",
    title: "خلاصه گزارش",
    columns: [
      { header: "نوع عملیات", width: 26 },
      { header: "تعداد", width: 12, type: "number" },
      { header: "جمع مبالغ (ریال)", width: 20, type: "number" },
    ],
    rows: [
      ...Object.entries(s.byMode).map(([k, v]) => [k, v.count, v.amount]),
      ["جمع وصول (بدون تکرار اشتراک)", s.collectUnique, s.collectTotal],
      ["جمع مبالغ پیگیری‌شده (بدون تکرار اشتراک)", s.followedUnique, s.followedTotal],
      ["کل ثبت‌ها", s.count, ""],
      ["ارسال شده", s.sent, ""],
      ["در انتظار ارسال", s.pending, ""],
      ["تعداد عکس‌ها", s.photos, ""],
    ],
  };
  return createXlsx([data, summary]);
}

/* ───────────────────────── PDF ───────────────────────── */
const PW = 1754, PH = 1240; // A4 افقی در ۱۵۰ dpi
const FONT = `Vazirmatn, Tahoma, sans-serif`;

function fit(ctx, text, maxW) {
  text = String(text ?? "");
  if (ctx.measureText(text).width <= maxW) return text;
  while (text.length > 1 && ctx.measureText(text + "…").width > maxW) text = text.slice(0, -1);
  return text + "…";
}

export async function buildPdf(records, meta) {
  await ensureFonts();
  const list = sortRecords(records);
  const s = summarize(list);

  const cols = [
    { h: "ردیف", w: 60, a: "c", v: (r, i) => toPersianDigits(i + 1) },
    { h: "تاریخ", w: 130, a: "c", v: (r) => toPersianDigits(r.date) },
    { h: "نوع عملیات", w: 200, v: (r) => r.modeTitle },
    { h: "شماره اشتراک", w: 160, a: "c", v: (r) => toPersianDigits(r.eshterak) },
    { h: "امور", w: 180, v: (r) => r.omoor },
    { h: "شهر", w: 150, v: (r) => r.city },
    { h: "سرگروه", w: 190, v: (r) => r.leader },
    { h: "مبلغ (ریال)", w: 190, a: "c", v: (r) => formatMoney(r.amount) },
    { h: "عکس", w: 70, a: "c", v: (r) => toPersianDigits(r.photos?.length || 0) },
    { h: "وضعیت", w: 120, a: "c", v: (r) => (r.status === "sent" ? "ارسال شده" : "در انتظار") },
  ];
  const M = 60;
  const tableW = PW - M * 2;
  const k = tableW / cols.reduce((t, c) => t + c.w, 0);
  cols.forEach((c) => (c.w *= k));

  const ROW = 46, HEAD = 56, TOP_FIRST = 480, TOP_NEXT = 120, BOTTOM = 80;
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
      // سرتیتر
      ctx.fillStyle = "#0d6efd";
      ctx.fillRect(0, 0, PW, 14);
      ctx.fillStyle = "#111";
      ctx.textAlign = "right";
      ctx.font = `700 48px ${FONT}`;
      ctx.fillText("گزارش فعالیت اکیپ‌های وصول مطالبات", PW - M, 80);
      ctx.font = `400 28px ${FONT}`;
      ctx.fillStyle = "#333";
      const range = meta.from === meta.to ? meta.from : `${meta.from} تا ${meta.to}`;
      ctx.fillText(toPersianDigits(`بازه گزارش: ${range}`), PW - M, 140);
      ctx.fillText(`کاربر: ${meta.userLabel}${meta.modeTitle ? "  |  نوع عملیات: " + meta.modeTitle : ""}`, PW - M, 182);
      ctx.fillText(toPersianDigits(`تاریخ تولید گزارش: ${new Date().toLocaleDateString("fa-IR")}`), PW - M, 224);

      // کادر خلاصه
      const modes = Object.entries(s.byMode);
      const bx = M, by = 110, bw = 760, bh = 330;
      ctx.strokeStyle = "#c5cdd8";
      ctx.lineWidth = 2;
      ctx.strokeRect(bx, by, bw, bh);
      ctx.fillStyle = "#f4f7fb";
      ctx.fillRect(bx + 1, by + 1, bw - 2, bh - 2);
      ctx.fillStyle = "#0d6efd";
      ctx.font = `700 28px ${FONT}`;
      ctx.textAlign = "right";
      ctx.fillText("خلاصه", bx + bw - 24, by + 34);
      ctx.fillStyle = "#222";
      ctx.font = `400 24px ${FONT}`;
      let sy = by + 76;
      for (const [name, v] of modes.slice(0, 4)) {
        ctx.textAlign = "right";
        ctx.fillText(`${name}: ${toPersianDigits(v.count)} مورد`, bx + bw - 24, sy);
        ctx.textAlign = "left";
        ctx.fillText(`${formatMoney(v.amount)} ریال`, bx + 24, sy);
        sy += 34;
      }
      ctx.font = `700 24px ${FONT}`;
      ctx.textAlign = "right";
      ctx.fillText(`کل: ${toPersianDigits(s.count)} مورد — ارسال‌شده ${toPersianDigits(s.sent)} / در انتظار ${toPersianDigits(s.pending)}`, bx + bw - 24, by + bh - 96);
      ctx.fillText(`جمع وصول: ${formatMoney(s.collectTotal)} ریال`, bx + bw - 24, by + bh - 60);
      ctx.fillText(`جمع مبالغ پیگیری‌شده: ${formatMoney(s.followedTotal)} ریال`, bx + bw - 24, by + bh - 24);
      y = TOP_FIRST - 20;
    }

    // سرستون جدول (از راست به چپ)
    ctx.fillStyle = "#0d6efd";
    ctx.fillRect(M, y, tableW, HEAD);
    ctx.fillStyle = "#fff";
    ctx.font = `700 24px ${FONT}`;
    let x = PW - M;
    for (const col of cols) {
      ctx.textAlign = "center";
      ctx.fillText(col.h, x - col.w / 2, y + HEAD / 2);
      x -= col.w;
    }
    y += HEAD;

    ctx.font = `400 23px ${FONT}`;
    pagesRows[p].forEach((r, ri) => {
      ctx.fillStyle = ri % 2 ? "#f4f7fb" : "#ffffff";
      ctx.fillRect(M, y, tableW, ROW);
      ctx.fillStyle = r.status === "sent" ? "#146c43" : "#222";
      let cx = PW - M;
      for (const col of cols) {
        const text = fit(ctx, col.v(r, rowIndex), col.w - 16);
        if (col.a === "c") {
          ctx.textAlign = "center";
          ctx.fillText(text, cx - col.w / 2, y + ROW / 2);
        } else {
          ctx.textAlign = "right";
          ctx.fillText(text, cx - 10, y + ROW / 2);
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
      ctx.font = `400 28px ${FONT}`;
      ctx.fillText("برای این بازه موردی ثبت نشده است", PW / 2, y + 60);
    }

    ctx.fillStyle = "#666";
    ctx.font = `400 22px ${FONT}`;
    ctx.textAlign = "center";
    ctx.fillText(toPersianDigits(`صفحه ${p + 1} از ${pagesRows.length}`), PW / 2, PH - 40);

    const blob = await new Promise((res) => c.toBlob(res, "image/jpeg", 0.88));
    pages.push({ jpeg: new Uint8Array(await blob.arrayBuffer()), width: PW, height: PH });
  }
  return createPdfFromJpegs(pages, { title: "Report" });
}

/* ───────────────────────── ZIP ───────────────────────── */
/**
 * ساختار داخل ZIP:
 *   <نام گزارش>/گزارش.xlsx
 *   <نام گزارش>/گزارش.pdf
 *   <نام گزارش>/عکس‌ها/<تاریخ>/<شماره‌اشتراک>.jpg
 */
export async function buildZip(records, meta, { onProgress } = {}) {
  const root = baseName(meta);
  const entries = [
    { name: `${root}/گزارش.xlsx`, data: await buildXlsx(records, meta) },
    { name: `${root}/گزارش.pdf`, data: await buildPdf(records, meta) },
  ];
  for (const r of sortRecords(records)) {
    for (const p of r.photos || []) {
      entries.push({ name: `${root}/عکس‌ها/${String(r.date).replace(/\//g, "-")}/${p.name}`, data: p.blob });
    }
  }
  return createZip(entries, { onProgress });
}
