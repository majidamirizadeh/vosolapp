/**
 * کش عکس‌های دانلود‌شدهٔ ادمین (IndexedDB جداگانه — به دیتابیس اصلی برنامه دست نمی‌زند)
 *
 * عکس‌های Drive بعد از ثبت تغییر نمی‌کنند؛ پس اگر ادمین امروز بازه‌ای را دانلود کند و فردا بازهٔ هم‌پوشان را،
 * فقط عکس‌های جدید از سرور گرفته می‌شوند. همین کش باعث می‌شود «دوباره امتحان» فقط عکس‌های ناموفق را بگیرد.
 * همهٔ توابع بدون خطا کار می‌کنند: اگر IndexedDB در دسترس نباشد کش خالی حساب می‌شود و دانلود عادی ادامه می‌یابد.
 */
const DB_NAME = "vosol-admin-photos";
const STORE = "p";
const MAX_ITEMS = 1500;           // سقف تعداد عکس نگه‌داری‌شده (حدود ۱۵۰ مگابایت)
const MAX_AGE_MS = 30 * 24 * 3600 * 1000; // ۳۰ روز

let dbPromise = null;
function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: "id" }); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return dbPromise;
}

const wrap = (req) => new Promise((resolve) => { req.onsuccess = () => resolve(req.result); req.onerror = () => resolve(undefined); });
const txDone = (tx) => new Promise((resolve) => { tx.oncomplete = () => resolve(true); tx.onerror = tx.onabort = () => resolve(false); });

/**
 * فقط «وجود» شناسه‌ها در کش را می‌سنجد (خودِ عکس‌ها خوانده نمی‌شوند → سبک و سریع، RAM مصرف نمی‌شود).
 * سن عکس مهم نیست: عکس Drive تغییر نمی‌کند و پاک‌سازی قدیمی‌ها هنگام ذخیره انجام می‌شود.
 */
export async function cachedIds(ids) {
  const out = new Set();
  try {
    const db = await open();
    if (!db || !ids.length) return out;
    const store = db.transaction(STORE, "readonly").objectStore(STORE);
    const keys = await Promise.all(ids.map((id) => wrap(store.getKey(id))));
    keys.forEach((k) => { if (k !== undefined) out.add(k); });
  } catch { /* کش خالی */ }
  return out;
}

/** شناسه‌ها → Map(id → Uint8Array) برای عکس‌هایی که در کش هستند؛ anyAge=true: بدون بررسی سن (هماهنگ با cachedIds) */
export async function getCached(ids, { anyAge = false } = {}) {
  const out = new Map();
  try {
    const db = await open();
    if (!db) return out;
    const store = db.transaction(STORE, "readonly").objectStore(STORE);
    const now = Date.now();
    const rows = await Promise.all(ids.map((id) => wrap(store.get(id))));
    rows.forEach((r) => { if (r && r.bytes && (anyAge || now - r.t < MAX_AGE_MS)) out.set(r.id, r.bytes); });
  } catch { /* کش خالی */ }
  return out;
}

/** ذخیرهٔ چند عکس: [{id, bytes}] ؛ در صورت زیاد شدن، قدیمی‌ترها حذف می‌شوند */
export async function putCached(list) {
  if (!list.length) return;
  try {
    const db = await open();
    if (!db) return;
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const t = Date.now();
    list.forEach((x) => store.put({ id: x.id, bytes: x.bytes, t }));
    await txDone(tx);
    await trim(db);
  } catch { /* مهم نیست */ }
}

async function trim(db) {
  try {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const keys = [];
    await new Promise((resolve) => {
      const c = store.openCursor();
      c.onsuccess = () => {
        const cur = c.result;
        if (!cur) return resolve();
        keys.push({ id: cur.key, t: cur.value.t });
        cur.continue();
      };
      c.onerror = () => resolve();
    });
    const now = Date.now();
    const old = keys.filter((k) => now - k.t >= MAX_AGE_MS);
    const keep = keys.filter((k) => now - k.t < MAX_AGE_MS).sort((a, b) => a.t - b.t);
    const extra = keep.length > MAX_ITEMS ? keep.slice(0, keep.length - MAX_ITEMS) : [];
    [...old, ...extra].forEach((k) => store.delete(k.id));
    await txDone(tx);
  } catch { /* مهم نیست */ }
}

export async function cacheCount() {
  try {
    const db = await open();
    if (!db) return 0;
    return (await wrap(db.transaction(STORE, "readonly").objectStore(STORE).count())) || 0;
  } catch { return 0; }
}

export async function clearCache() {
  try {
    const db = await open();
    if (!db) return false;
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    return await txDone(tx);
  } catch { return false; }
}
