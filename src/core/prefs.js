/** تنظیمات کاربر (ذخیره در IndexedDB) */
import { CONFIG } from "../../config/app.config.js";
import { kv } from "./db.js";

const DEFAULTS = {
  autoSavePhotos: CONFIG.device.autoSavePhotos,
  autoSync: true, // پیش‌فرض روشن (کاربری که قبلاً دستی تغییر داده، انتخاب خودش حفظ می‌شود)
  allUsersOnPhone: false,
};

let cache = null;

export async function loadPrefs() {
  cache = { ...DEFAULTS, ...((await kv.get("prefs", {})) || {}) };
  return cache;
}

export const getPref = (k) => (cache ? cache[k] : DEFAULTS[k]);

export async function setPref(k, v) {
  cache = { ...(cache || DEFAULTS), [k]: v };
  await kv.set("prefs", cache);
}
