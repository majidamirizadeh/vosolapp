/** تنظیمات کاربر (ذخیره در IndexedDB) */
import { CONFIG } from "../../config/app.config.js";
import { kv } from "./db.js";

const DEFAULTS = {
  autoSavePhotos: true, // پیش‌فرض روشن
  autoSync: true, // پیش‌فرض روشن (کاربری که قبلاً دستی تغییر داده، انتخاب خودش حفظ می‌شود)
  allUsersOnPhone: false,
  sound: true, // صدا (بوق موفقیت/خطا/هشدار) پیش‌فرض روشن
  vibrate: false, // لرزش پیش‌فرض خاموش
};

let cache = null;

export async function loadPrefs() {
  cache = { ...DEFAULTS, ...((await kv.get("prefs", {})) || {}) };
  return cache;
}

/** گزینه‌هایی که برای کاربران غیرادمین همیشه روشن و غیرقابل‌تغییرند */
export const LOCKED_KEYS = ["autoSavePhotos", "autoSync"];
let locked = false;
export const setPrefsLocked = (v) => { locked = !!v; };
export const isPrefLocked = (k) => locked && LOCKED_KEYS.includes(k);

export const getPref = (k) => (isPrefLocked(k) ? true : cache ? cache[k] : DEFAULTS[k]);

export async function setPref(k, v) {
  if (isPrefLocked(k)) return; // کاربر عادی نمی‌تواند این گزینه را تغییر دهد
  cache = { ...(cache || DEFAULTS), [k]: v };
  await kv.set("prefs", cache);
}
