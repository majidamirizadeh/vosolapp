/**
 * تب «دانلودها»
 *
 * هر فایلی که داخل پوشه downloads/ بگذارید در این بخش با «همان نام فایل» فهرست می‌شود.
 * فهرست از downloads/index.json خوانده می‌شود (با دستور `node tools/build.mjs` یا
 * GitHub Action همراه پروژه خودکار ساخته می‌شود).
 *
 * هر فایل بعد از اولین دانلود در گوشی کش می‌شود و دفعات بعد حتی بدون اینترنت قابل دانلود است.
 */
import { h, downloadBlob, fetchWithTimeout, formatBytes } from "../core/utils.js";
import { kv } from "../core/db.js";
import { toast, busy } from "../core/ui.js";

const CACHE = "app-downloads-v1";
const base = "downloads/";
const url = (name) => base + encodeURIComponent(name);

async function loadIndex() {
  try {
    const res = await fetchWithTimeout(base + "index.json", { cache: "no-cache" }, 6000);
    if (!res.ok) throw new Error(res.status);
    const json = await res.json();
    await kv.set("downloadsIndex", json);
    return { files: json.files || [], offline: false };
  } catch {
    const json = await kv.get("downloadsIndex", { files: [] });
    return { files: json.files || [], offline: true };
  }
}

async function cached(name) {
  try { return !!(await (await caches.open(CACHE)).match(url(name))); } catch { return false; }
}

async function getBlob(name) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(url(name));
  if (hit) return hit.blob();
  const res = await fetchWithTimeout(url(name), { cache: "no-cache" }, 120000);
  if (!res.ok) throw new Error("فایل پیدا نشد");
  await cache.put(url(name), res.clone());
  return res.blob();
}

export function createDownloadsModule() {
  let listEl, noteEl;

  async function download(name, btn) {
    btn.disabled = true;
    const b = busy(`در حال دریافت ${name}…`);
    try {
      const blob = await getBlob(name);
      downloadBlob(blob, name);
      toast(`ذخیره شد: ${name}`, "success");
    } catch (e) {
      toast(navigator.onLine ? "دریافت فایل ناموفق بود" : "برای اولین دانلود این فایل باید آنلاین باشید", "error");
    } finally {
      b.done();
      btn.disabled = false;
      render(false);
    }
  }

  async function prefetchAll(files) {
    if (!navigator.onLine) return toast("آنلاین نیستید", "error");
    const b = busy("ذخیره فایل‌ها برای استفاده آفلاین…");
    let ok = 0;
    for (let i = 0; i < files.length; i++) {
      try { await getBlob(files[i].name); ok++; } catch { /* ادامه */ }
      b.progress((i + 1) / files.length);
    }
    b.done();
    toast(`${ok} از ${files.length} فایل برای آفلاین ذخیره شد`, ok === files.length ? "success" : "info");
    render(false);
  }

  async function render(refresh = true) {
    const { files, offline } = await loadIndex();
    noteEl.textContent = offline ? "آفلاین — آخرین فهرست ذخیره‌شده نمایش داده می‌شود." : "";
    listEl.replaceChildren();
    if (!files.length) {
      listEl.append(h("p", { class: "empty" }, "فایلی برای دانلود وجود ندارد"));
      return;
    }
    const rows = [];
    for (const f of files) {
      const isCached = await cached(f.name);
      const btn = h("button", { type: "button", class: "btn btn-primary btn-sm", disabled: offline && !isCached, onclick: (e) => download(f.name, e.currentTarget) }, "دانلود");
      rows.push(
        h("div", { class: "dl-item" },
          h("div", { class: "dl-icon" }, "📄"),
          h("div", { class: "dl-meta" },
            h("div", { class: "dl-name", dir: "auto" }, f.name),
            h("div", { class: "info-text" }, [f.size != null ? formatBytes(f.size) : "", isCached ? "• آماده برای دانلود آفلاین" : ""].filter(Boolean).join(" "))
          ),
          btn
        )
      );
    }
    listEl.append(...rows);
    if (!offline) {
      listEl.append(h("button", { type: "button", class: "btn btn-secondary btn-sm", onclick: () => prefetchAll(files) }, "ذخیره همه برای استفاده آفلاین"));
    }
  }

  return {
    id: "downloads",
    title: "دانلودها",
    icon: "⬇️",
    mount(container) {
      listEl = h("div", { class: "dl-list" });
      noteEl = h("div", { class: "info-text" });
      container.append(h("div", { class: "card" }, h("h3", { class: "card-title" }, "فایل‌های آماده دانلود"), noteEl, listEl));
    },
    onShow: render,
  };
}
