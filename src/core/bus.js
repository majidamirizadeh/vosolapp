/** رویدادهای ساده بین ماژول‌ها (بدون وابستگی مستقیم) */
const target = new EventTarget();

export const bus = {
  on(name, fn) {
    const h = (e) => fn(e.detail);
    target.addEventListener(name, h);
    return () => target.removeEventListener(name, h);
  },
  emit(name, detail) {
    target.dispatchEvent(new CustomEvent(name, { detail }));
  },
};

/** نام رویدادها */
export const EV = {
  RECORDS_CHANGED: "records-changed",
  NET: "net-status",
  USER: "user-changed",
};
