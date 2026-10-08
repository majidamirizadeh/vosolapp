/**
 * ذخیره فایل‌ها در حافظه گوشی
 *
 * دو روش (به‌ترتیب اولویت):
 *  1) «پوشه» — اگر مرورگر File System Access API را داشته باشد و کاربر یک پوشه انتخاب کرده باشد،
 *     برنامه خودش زیرپوشه می‌سازد (CollectionApp/تاریخ/…) و فایل‌ها را بی‌صدا می‌نویسد.
 *  2) «دانلودها» — فایل‌ها با همان نام به پوشه Download گوشی ذخیره می‌شوند.
 *     (مرورگر اجازه ساخت زیرپوشه در Download را نمی‌دهد؛ برای دریافت پوشه‌بندی‌شده از «ZIP» در تب گزارش استفاده کنید.)
 *
 * نکته: نسخه اصلی داده‌ها همیشه در IndexedDB است؛ این ماژول فقط «نسخه پشتیبان قابل‌مشاهده» می‌سازد.
 */
import { CONFIG } from "../../config/app.config.js";
import { kv } from "../core/db.js";
import { downloadBlob, sleep } from "../core/utils.js";

const HANDLE_KEY = "deviceDirHandle";
let _handle = null;

export const folderApiSupported = () => typeof window.showDirectoryPicker === "function";

export async function loadHandle() {
  if (!folderApiSupported()) return null;
  try {
    _handle = await kv.get(HANDLE_KEY);
  } catch {
    _handle = null;
  }
  return _handle;
}

async function hasPermission(request) {
  if (!_handle) return false;
  try {
    const opts = { mode: "readwrite" };
    if ((await _handle.queryPermission(opts)) === "granted") return true;
    if (request && (await _handle.requestPermission(opts)) === "granted") return true;
  } catch { /* ignore */ }
  return false;
}

export async function pickFolder() {
  if (!folderApiSupported()) throw new Error("این مرورگر انتخاب پوشه را پشتیبانی نمی‌کند");
  const handle = await window.showDirectoryPicker({ id: "collection-app", mode: "readwrite" });
  _handle = handle;
  await kv.set(HANDLE_KEY, handle);
  return handle;
}

export async function clearFolder() {
  _handle = null;
  await kv.del(HANDLE_KEY);
}

export async function status() {
  const ok = await hasPermission(false);
  return {
    supported: folderApiSupported(),
    mode: _handle ? "folder" : "downloads",
    folderName: _handle?.name || null,
    permission: _handle ? ok : null,
  };
}

async function dirFor(root, parts) {
  let d = await root.getDirectoryHandle(CONFIG.device.folderName, { create: true });
  for (const p of parts) d = await d.getDirectoryHandle(p, { create: true });
  return d;
}

/**
 * @param {{name:string, blob:Blob}[]} files
 * @param {string[]} subdirs  مثل [date]
 * @returns {{method:"folder"|"downloads"|"none", saved:number, error?:string}}
 */
export async function saveFiles(files, subdirs = []) {
  if (!files.length) return { method: "none", saved: 0 };

  if (_handle) {
    try {
      if (await hasPermission(true)) {
        const dir = await dirFor(_handle, subdirs.map((s) => s.replace(/[\\/:*?"<>|]/g, "-")));
        for (const f of files) {
          const fh = await dir.getFileHandle(f.name, { create: true });
          const w = await fh.createWritable();
          await w.write(f.blob);
          await w.close();
        }
        return { method: "folder", saved: files.length };
      }
    } catch (e) {
      // به روش دانلود برمی‌گردیم
      console.warn("folder save failed", e);
    }
  }

  try {
    for (const f of files) {
      downloadBlob(f.blob, f.name);
      await sleep(450); // مرورگر چند دانلود پشت‌سرهم را راحت‌تر می‌پذیرد
    }
    return { method: "downloads", saved: files.length };
  } catch (e) {
    return { method: "downloads", saved: 0, error: String(e.message || e) };
  }
}

/** درخواست حافظه پایدار (جلوگیری از پاک‌شدن خودکار داده‌ها توسط مرورگر) */
export async function requestPersistence() {
  try {
    if (navigator.storage?.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch { /* ignore */ }
  return false;
}

export async function usage() {
  try {
    const e = await navigator.storage.estimate();
    return { usage: e.usage || 0, quota: e.quota || 0, persisted: await navigator.storage.persisted?.() };
  } catch {
    return { usage: 0, quota: 0, persisted: false };
  }
}
