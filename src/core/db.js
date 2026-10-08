/**
 * لایه IndexedDB — تمام داده‌ها (به‌همراه عکس‌ها به‌صورت Blob) تا لحظه ارسال موفق به سرور
 * در حافظه گوشی می‌مانند.
 *
 * stores:
 *   records   رکوردهای فرم (keyPath: id, autoIncrement)
 *   counters  شمارنده نام عکس‌ها به‌ازای هر شماره اشتراک
 *   kv        تنظیمات و داده‌های کمکی (کاربران، handle پوشه، ...)
 */
const DB_NAME = "CollectionAppDB";
const DB_VERSION = 4;

let _db = null;

const wrap = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

export async function openDB() {
  if (_db) return _db;
  _db = await new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      let records;
      if (!db.objectStoreNames.contains("records")) {
        records = db.createObjectStore("records", { keyPath: "id", autoIncrement: true });
      } else {
        records = e.target.transaction.objectStore("records");
      }
      if (!records.indexNames.contains("status")) records.createIndex("status", "status");
      if (!records.indexNames.contains("eshterak")) records.createIndex("eshterak", "eshterak");
      if (!records.indexNames.contains("uid")) records.createIndex("uid", "uid", { unique: false });
      if (!db.objectStoreNames.contains("counters")) db.createObjectStore("counters", { keyPath: "eshterak" });
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv", { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("DB blocked"));
  });
  _db.onversionchange = () => {
    _db.close();
    _db = null;
  };
  return _db;
}

/** اجرای چند عملیات در یک تراکنش. fn(stores) باید فقط روی درخواست‌های IDB await کند. */
export async function tx(storeNames, mode, fn) {
  const db = await openDB();
  const names = Array.isArray(storeNames) ? storeNames : [storeNames];
  const t = db.transaction(names, mode);
  const done = new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error("tx aborted"));
  });
  const stores = Object.fromEntries(names.map((n) => [n, t.objectStore(n)]));
  let result;
  try {
    result = await fn(stores, t);
  } catch (e) {
    try { t.abort(); } catch {}
    await done.catch(() => {});
    throw e;
  }
  await done;
  return result;
}

export const req = wrap;

/* ───────── kv ───────── */
export const kv = {
  async get(key, fallback = null) {
    const row = await tx("kv", "readonly", ({ kv }) => wrap(kv.get(key)));
    return row ? row.value : fallback;
  },
  async set(key, value) {
    await tx("kv", "readwrite", ({ kv }) => wrap(kv.put({ key, value })));
  },
  async del(key) {
    await tx("kv", "readwrite", ({ kv }) => wrap(kv.delete(key)));
  },
};

/* ───────── records ───────── */
export const records = {
  all: () => tx("records", "readonly", ({ records }) => wrap(records.getAll())),
  get: (id) => tx("records", "readonly", ({ records }) => wrap(records.get(id))),
  async update(id, patch) {
    return tx("records", "readwrite", async ({ records }) => {
      const rec = await wrap(records.get(id));
      if (!rec) throw new Error("رکورد پیدا نشد");
      Object.assign(rec, patch);
      await wrap(records.put(rec));
      return rec;
    });
  },
  remove: (id) => tx("records", "readwrite", ({ records }) => wrap(records.delete(id))),
};

/**
 * ذخیره اتمیک رکورد + تخصیص نام عکس‌ها.
 * buildRecord(counter) باید رکورد کامل را برگرداند؛ شمارنده بعد از آن به‌روزرسانی می‌شود.
 */
export async function addRecordWithCounter(eshterak, photoCount, allocate, buildRecord) {
  return tx(["records", "counters"], "readwrite", async ({ records, counters }) => {
    const row = (await wrap(counters.get(eshterak))) || { eshterak, count: 0 };
    const { names, count } = allocate(row.count, photoCount);
    const record = buildRecord(names);
    row.count = count;
    await wrap(counters.put(row));
    const id = await wrap(records.add(record));
    record.id = id;
    return record;
  });
}

/**
 * جایگزینی یک رکورد «در انتظار ارسال» (ویرایش) با حفظ id و uid.
 * allocate(count, n) نام‌های جدید را از شمارنده همان اشتراک می‌گیرد؛ buildRecord(oldRecord, names) رکورد نهایی را می‌سازد.
 */
export async function replaceRecordWithCounter(id, eshterak, newPhotoCount, allocate, buildRecord) {
  return tx(["records", "counters"], "readwrite", async ({ records, counters }) => {
    const old = await wrap(records.get(id));
    if (!old) throw new Error("رکورد پیدا نشد");
    if (old.status !== "pending") throw new Error("این مورد در این فاصله ارسال شده و دیگر قابل ویرایش نیست");
    const row = (await wrap(counters.get(eshterak))) || { eshterak, count: 0 };
    const { names, count } = allocate(row.count, newPhotoCount);
    const record = buildRecord(old, names);
    row.count = count;
    await wrap(counters.put(row));
    await wrap(records.put(record));
    return record;
  });
}
