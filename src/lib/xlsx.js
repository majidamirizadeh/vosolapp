/**
 * تولید فایل Excel (.xlsx) بدون هیچ کتابخانه خارجی — آفلاین.
 *
 * createXlsx([
 *   { name: "گزارش", rtl: true, title: "عنوان اختیاری",
 *     columns: [{ header: "تاریخ", width: 14, type: "text" | "number" }],
 *     rows: [[...], ...] }
 * ]) → Blob
 */
import { createZip } from "./zip.js";

const esc = (s) =>
  String(s ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function colName(i) {
  let s = "";
  i++;
  while (i > 0) {
    const m = (i - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}

// استایل‌ها: 0 پیش‌فرض | 1 سرستون | 2 متن با خط | 3 عدد با خط | 4 عنوان
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0"/></numFmts>
<fonts count="4">
<font><sz val="11"/><name val="Tahoma"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Tahoma"/></font>
<font><sz val="11"/><name val="Tahoma"/></font>
<font><b/><sz val="14"/><name val="Tahoma"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF0D6EFD"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFB0B7C3"/></left><right style="thin"><color rgb="FFB0B7C3"/></right><top style="thin"><color rgb="FFB0B7C3"/></top><bottom style="thin"><color rgb="FFB0B7C3"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1" readingOrder="2"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center" wrapText="1" readingOrder="2"/></xf>
<xf numFmtId="164" fontId="2" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="right" vertical="center" readingOrder="2"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function sheetXml(sheet) {
  const cols = sheet.columns;
  const hasTitle = !!sheet.title;
  const headerRow = hasTitle ? 3 : 1;
  const rows = [];

  if (hasTitle) {
    rows.push(`<row r="1" ht="26" customHeight="1"><c r="A1" s="4" t="inlineStr"><is><t xml:space="preserve">${esc(sheet.title)}</t></is></c></row>`);
  }
  rows.push(
    `<row r="${headerRow}" ht="30" customHeight="1">` +
      cols.map((c, i) => `<c r="${colName(i)}${headerRow}" s="1" t="inlineStr"><is><t xml:space="preserve">${esc(c.header)}</t></is></c>`).join("") +
      "</row>"
  );

  sheet.rows.forEach((r, ri) => {
    const rn = headerRow + 1 + ri;
    const cells = cols.map((c, i) => {
      const v = r[i];
      const ref = `${colName(i)}${rn}`;
      if (c.type === "number" && v !== "" && v != null && Number.isFinite(Number(v))) {
        return `<c r="${ref}" s="3"><v>${Number(v)}</v></c>`;
      }
      return `<c r="${ref}" s="2" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
    });
    rows.push(`<row r="${rn}">${cells.join("")}</row>`);
  });

  const lastRow = headerRow + sheet.rows.length;
  const lastCol = colName(cols.length - 1);
  const colsXml = `<cols>${cols.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width || 14}" customWidth="1"/>`).join("")}</cols>`;
  const pane = `<pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/>`;

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView ${sheet.rtl !== false ? 'rightToLeft="1" ' : ""}workbookViewId="0">${pane}</sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="18"/>
${colsXml}
<sheetData>${rows.join("")}</sheetData>
${sheet.rows.length ? `<autoFilter ref="A${headerRow}:${lastCol}${lastRow}"/>` : ""}
<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>
<pageSetup orientation="landscape" paperSize="9" fitToHeight="0"/>
</worksheet>`;
}

export async function createXlsx(sheets) {
  const safeNames = sheets.map((s, i) => String(s.name || `Sheet${i + 1}`).replace(/[\\/?*\[\]:]/g, " ").slice(0, 31));
  const entries = [
    {
      name: "[Content_Types].xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets
        .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
        .join("")}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    },
    {
      name: "_rels/.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${safeNames
        .map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join("")}</sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
        .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
        .join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    { name: "xl/styles.xml", data: STYLES },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) })),
  ];
  const zip = await createZip(entries);
  return new Blob([zip], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
