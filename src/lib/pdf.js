/**
 * ساخت PDF از تصاویر JPEG (هر صفحه = یک تصویر) — آفلاین و بدون کتابخانه.
 * متن فارسی در Canvas توسط خود مرورگر شکل‌دهی می‌شود، بنابراین حروف به‌هم‌چسبیده و راست‌به‌چپ درست درمی‌آیند.
 *
 * createPdfFromJpegs([{ jpeg: Uint8Array, width, height }], { pageWidth, pageHeight }) → Blob
 */
const enc = new TextEncoder();

export function createPdfFromJpegs(pages, { pageWidth = 841.89, pageHeight = 595.28, title = "Report" } = {}) {
  const chunks = [];
  const offsets = [];
  let length = 0;
  const push = (data) => {
    const b = typeof data === "string" ? enc.encode(data) : data;
    chunks.push(b);
    length += b.length;
  };
  const beginObj = (n) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
  };

  // شماره‌گذاری: 1 Catalog، 2 Pages، 3 Info، سپس برای هر صفحه 3 شیء (Page, Content, Image)
  const pageObj = (i) => 4 + i * 3;
  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");

  beginObj(1);
  push("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

  beginObj(2);
  push(`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(" ")}] >>\nendobj\n`);

  beginObj(3);
  push(`<< /Title (${title.replace(/[^\x20-\x7e]/g, "").replace(/[()\\]/g, "")}) /Producer (CollectionApp) >>\nendobj\n`);

  pages.forEach((p, i) => {
    const po = pageObj(i);
    beginObj(po);
    push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im0 ${po + 2} 0 R >> /ProcSet [/PDF /ImageC] >> /Contents ${po + 1} 0 R >>\nendobj\n`
    );
    const content = `q ${pageWidth} 0 0 ${pageHeight} 0 0 cm /Im0 Do Q`;
    beginObj(po + 1);
    push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);
    beginObj(po + 2);
    push(
      `<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`
    );
    push(p.jpeg);
    push("\nendstream\nendobj\n");
  });

  const total = 4 + pages.length * 3;
  const xrefPos = length;
  push(`xref\n0 ${total}\n0000000000 65535 f \n`);
  for (let n = 1; n < total; n++) push(`${String(offsets[n]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${total} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`);

  return new Blob(chunks, { type: "application/pdf" });
}
