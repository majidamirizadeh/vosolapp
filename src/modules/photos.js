/**
 * پردازش عکس: کوچک‌سازی + درج کادر اطلاعات در گوشه بالا-راست
 */
import { CONFIG } from "../../config/app.config.js";

export async function ensureFonts() {
  try {
    await Promise.all([document.fonts.load("700 32px Vazirmatn"), document.fonts.load("400 32px Vazirmatn")]);
  } catch { /* فونت سیستم جایگزین می‌شود */ }
}

async function decode(blob) {
  if (window.createImageBitmap) {
    try {
      return await createImageBitmap(blob, { imageOrientation: "from-image" });
    } catch { /* ادامه با Image */ }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}

const toBlob = (canvas, type, q) =>
  new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), type, q));

/** کوچک‌کردن عکس دوربین (بدون مهر) — برای پیش‌نمایش و نگهداری موقت در فرم */
export async function downscale(file, maxSide = CONFIG.photos.maxSide, quality = 0.9) {
  const bmp = await decode(file);
  const w0 = bmp.width, h0 = bmp.height;
  const k = Math.min(1, maxSide / Math.max(w0, h0));
  const w = Math.round(w0 * k), h = Math.round(h0 * k);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  c.getContext("2d").drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  return { blob: await toBlob(c, "image/jpeg", quality), width: w, height: h };
}

function wrapText(ctx, text, maxWidth) {
  const words = text.split(" ");
  const lines = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(t).width <= maxWidth || !cur) cur = t;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

/**
 * @param {Blob} blob عکس بدون مهر
 * @param {{title:string, rows:string[]}} info  title: خط اول (پررنگ/زرد)، rows: بقیه خطوط
 */
export async function stampPhoto(blob, info, opts = {}) {
  const st = { ...CONFIG.stamp, ...opts };
  const bmp = await decode(blob);
  const w = bmp.width, h = bmp.height;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d");
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();

  if (st.enabled !== false && (info.title || info.rows?.length)) {
    await ensureFonts();
    const fs = Math.max(22, Math.round(w * st.fontRatio));
    const family = `Vazirmatn, Tahoma, "Noto Naskh Arabic", "Noto Sans Arabic", sans-serif`;
    const pad = Math.round(fs * 0.6);
    const lineH = Math.round(fs * 1.55);
    const margin = Math.round(fs * 0.7);
    const maxBoxW = Math.round(w * st.maxWidthRatio);
    const innerMax = maxBoxW - pad * 2;

    ctx.direction = "rtl";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";

    const lines = [];
    if (info.title) {
      ctx.font = `700 ${Math.round(fs * 1.12)}px ${family}`;
      for (const l of wrapText(ctx, info.title, innerMax)) lines.push({ text: l, title: true });
    }
    ctx.font = `700 ${fs}px ${family}`;
    for (const r of info.rows || []) for (const l of wrapText(ctx, r, innerMax)) lines.push({ text: l });

    let textW = 0;
    for (const l of lines) {
      ctx.font = `700 ${l.title ? Math.round(fs * 1.12) : fs}px ${family}`;
      textW = Math.max(textW, ctx.measureText(l.text).width);
    }
    const boxW = Math.min(maxBoxW, Math.ceil(textW + pad * 2));
    const boxH = lines.length * lineH + pad * 1.2;
    const x = w - margin - boxW;
    const y = margin;

    // کادر
    const r = fs * 0.5;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + boxW, y, x + boxW, y + boxH, r);
    ctx.arcTo(x + boxW, y + boxH, x, y + boxH, r);
    ctx.arcTo(x, y + boxH, x, y, r);
    ctx.arcTo(x, y, x + boxW, y, r);
    ctx.closePath();
    ctx.fillStyle = "rgba(0,0,0,0.78)";
    ctx.fill();
    ctx.lineWidth = Math.max(3, fs * 0.1);
    ctx.strokeStyle = "#ffd54a";
    ctx.stroke();

    // متن
    let ty = y + pad * 0.6 + lineH / 2;
    for (const l of lines) {
      ctx.font = `700 ${l.title ? Math.round(fs * 1.12) : fs}px ${family}`;
      ctx.fillStyle = l.title ? "#ffd54a" : "#ffffff";
      ctx.fillText(l.text, x + boxW - pad, ty, innerMax);
      ty += lineH;
    }
  }
  return { blob: await toBlob(c, "image/jpeg", CONFIG.photos.quality), width: w, height: h };
}
