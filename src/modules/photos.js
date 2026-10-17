/**
 * پردازش عکس: کوچک‌سازی + درج کادر اطلاعات در گوشه بالا-راست
 */
import { CONFIG } from "../../config/app.config.js";

export async function ensureFonts() {
  try {
    await Promise.all([document.fonts.load("700 32px Vazirmatn"), document.fonts.load("400 32px Vazirmatn")]);
  } catch { /* فونت سیستم جایگزین می‌شود */ }
}

/** خطای خواندن عکس با کد مشخص (برای پیام دقیق به کاربر) */
export class PhotoError extends Error {
  constructor(code, cause) { super(code); this.code = code; this.cause = cause; }
}

/** تشخیص فرمت واقعی از چند بایت ابتدای فایل */
async function sniff(file) {
  const buf = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const asc = (a, b) => String.fromCharCode(...buf.slice(a, b));
  if (buf[0] === 0xff && buf[1] === 0xd8) return "jpeg";
  if (buf[0] === 0x89 && asc(1, 4) === "PNG") return "png";
  if (asc(0, 4) === "RIFF" && asc(8, 12) === "WEBP") return "webp";
  if (asc(4, 8) === "ftyp") {
    const brand = asc(8, 12);
    if (/^(heic|heix|hevc|hevx|heim|heis|mif1|msf1|heif)$/.test(brand)) return "heic";
    if (brand === "avif" || brand === "avis") return "avif";
  }
  return "unknown";
}

const loadImg = (src) => new Promise((res, rej) => {
  const img = new Image();
  img.onload = () => res(img);
  img.onerror = () => rej(new Error("img onerror"));
  img.src = src;
});

const readDataUrl = (file) => new Promise((res, rej) => {
  const fr = new FileReader();
  fr.onload = () => res(fr.result);
  fr.onerror = () => rej(fr.error || new Error("FileReader"));
  fr.readAsDataURL(file);
});

/** چند روش پشت‌سرهم: createImageBitmap → همان بدون گزینه → Image با آدرس موقت → Image با FileReader */
async function decode(file) {
  if (!file || file.size === 0) throw new PhotoError("empty");
  let kind = "unknown";
  try {
    kind = await sniff(file);
  } catch (e) {
    // خود فایل خوانده نمی‌شود (مثلاً هنوز از ابر دانلود نشده، یا دسترسی/حافظه مشکل دارد)
    throw new PhotoError("unreadable", e);
  }
  if (window.createImageBitmap) {
    try { return await createImageBitmap(file, { imageOrientation: "from-image" }); } catch { /* بعدی */ }
    try { return await createImageBitmap(file); } catch { /* بعدی */ }
  }
  const url = URL.createObjectURL(file);
  try {
    return await loadImg(url);
  } catch { /* بعدی */ } finally {
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  try {
    return await loadImg(await readDataUrl(file));
  } catch (e) {
    throw new PhotoError(kind === "heic" || kind === "avif" ? "heic" : "decode", e);
  }
}

const toBlob = (canvas, type, q) =>
  new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), type, q));

/** کوچک‌کردن عکس دوربین (بدون مهر) — برای پیش‌نمایش و نگهداری موقت در فرم */
export async function downscale(file, maxSide = CONFIG.photos.maxSide, quality = 0.9) {
  const bmp = await decode(file);
  const w0 = bmp.width, h0 = bmp.height;
  if (!w0 || !h0) { bmp.close?.(); throw new PhotoError("decode"); }
  let side = maxSide;
  try {
    // اگر حافظه گوشی کم باشد، با ابعاد کوچک‌تر دوباره تلاش می‌شود
    for (let attempt = 0; attempt < 3; attempt++) {
      const k = Math.min(1, side / Math.max(w0, h0));
      const w = Math.max(1, Math.round(w0 * k)), h = Math.max(1, Math.round(h0 * k));
      try {
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        c.getContext("2d").drawImage(bmp, 0, 0, w, h);
        return { blob: await toBlob(c, "image/jpeg", quality), width: w, height: h };
      } catch (e) {
        if (attempt === 2) throw new PhotoError("memory", e);
        side = Math.round(side * 0.7);
      }
    }
  } finally {
    bmp.close?.();
  }
}

/**
 * مهر: دو نوار نیمه‌شفاف — بالای عکس (عملیات، اشتراک، تاریخ، امور، شهر) و پایین عکس (بقیه). هر گروه = دو سطر (عنوان‌ها بالا، مقدارها پایین).
 * فونت درشت است؛ اگر همه ستون‌ها در یک گروه جا نشوند، به ۲ یا ۳ گروه (نوار چندطبقه) تقسیم می‌شوند.
 * @param {Blob} blob عکس بدون مهر
 * @param {{cols:{label:string,value:string}[]}} info
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

  const allCols = (info.cols || []).filter((x) => x.value !== "" && x.value != null);
  if (st.enabled !== false && allCols.length) {
    await ensureFonts();
    const family = `Vazirmatn, Tahoma, "Noto Naskh Arabic", "Noto Sans Arabic", sans-serif`;
    const avail = w - 12;
    ctx.direction = "rtl";
    ctx.textBaseline = "middle";

    // دو نوار با یک قالب و رنگ: بالای عکس (عملیات، اشتراک، تاریخ، امور، شهر) و پایین عکس (بقیه)
    const TOP_LABELS = ["عملیات", "اشتراک", "تاریخ", "امور", "شهر/بخش"];
    const topCols = allCols.filter((x) => TOP_LABELS.includes(x.label));
    const botCols = allCols.filter((x) => !TOP_LABELS.includes(x.label));

    const colWidths = (cols, size) => {
      ctx.font = `700 ${size}px ${family}`;
      const gap = Math.round(size * 1.0);
      return cols.map((x) => Math.ceil(Math.max(ctx.measureText(x.label).width, ctx.measureText(String(x.value)).width)) + gap);
    };
    // تقسیم ستون‌ها به g گروه پشت‌سرهم
    const layout = (cols, size, g) => {
      const widths = colWidths(cols, size);
      const per = Math.ceil(cols.length / g);
      const groups = [];
      for (let a = 0; a < cols.length; a += per) {
        const idx = [];
        for (let k = a; k < Math.min(a + per, cols.length); k++) idx.push(k);
        groups.push({ idx, total: idx.reduce((t, k) => t + widths[k], 0) });
      }
      const worst = Math.max(...groups.map((x) => x.total));
      return { widths, groups, worst };
    };
    const maxGroups = st.maxGroups || 3;
    const target = Math.max(12, Math.round(w * st.fontRatio));
    // بزرگ‌ترین فونتی که همهٔ ستون‌های یک نوار در آن جا شود
    const fitSize = (cols) => {
      for (let f = target; f >= 12; f--) {
        for (let g = 1; g <= maxGroups; g++) if (layout(cols, f, g).worst <= avail) return f;
      }
      return 12;
    };
    // فونت هر دو نوار یکسان است (کوچک‌تر از دو اندازه)
    const fs = Math.min(...[topCols, botCols].filter((x) => x.length).map(fitSize));
    const lineH = Math.round(fs * 1.5);
    const groupH = lineH * 2 + Math.round(fs * 0.5);

    const drawBar = (cols, atTop) => {
      if (!cols.length) return;
      let L = null;
      for (let g = 1; g <= maxGroups && !L; g++) {
        const t = layout(cols, fs, g);
        if (t.worst <= avail) L = t;
      }
      if (!L) L = layout(cols, fs, maxGroups);
      const k = L.worst > avail ? avail / L.worst : 1; // آخرین چاره: فشرده‌سازی افقی
      const barH = groupH * L.groups.length + Math.round(fs * 0.2);
      const y0 = atTop ? 0 : h - barH;
      ctx.fillStyle = `rgba(0,0,0,${st.bgOpacity ?? 0.6})`;
      ctx.fillRect(0, y0, w, barH);

      ctx.textAlign = "center";
      L.groups.forEach((grp, gi) => {
        const total = grp.total * k;
        let x = (w + total) / 2; // وسط‌چین؛ ستون اول سمت راست
        const yL = y0 + gi * groupH + Math.round(fs * 0.3) + lineH / 2;
        const yV = yL + lineH;
        if (gi > 0) {
          ctx.fillStyle = "rgba(255,255,255,0.2)";
          ctx.fillRect(w * 0.03, y0 + gi * groupH, w * 0.94, 1);
        }
        grp.idx.forEach((ci, n) => {
          const cw = L.widths[ci] * k;
          const cx = x - cw / 2;
          ctx.font = `700 ${fs}px ${family}`;
          ctx.fillStyle = "#ffd54a";
          ctx.fillText(cols[ci].label, cx, yL, cw - 2);
          ctx.fillStyle = "#ffffff";
          ctx.fillText(String(cols[ci].value), cx, yV, cw - 2);
          if (n < grp.idx.length - 1) {
            ctx.fillStyle = "rgba(255,255,255,0.25)";
            ctx.fillRect(x - cw, y0 + gi * groupH + fs * 0.4, 1, groupH - fs * 0.6);
          }
          x -= cw;
        });
      });
    };
    drawBar(topCols, true);
    drawBar(botCols, false);
  }
  return { blob: await toBlob(c, "image/jpeg", CONFIG.photos.quality), width: w, height: h };
}
