/**
 * ورود کاربران — فهرست کاربران از فایل جداگانه config/users.json خوانده می‌شود.
 * پس از اولین بارگذاری، فهرست در گوشی کش می‌شود و ورود کاملاً آفلاین کار می‌کند.
 *
 * ساختار users.json:
 *   { "users": [ { "code": "01", "name": "اکیپ ۰۱", "passHash": "<sha256(code:password)>" } ] }
 * (برای تست می‌توان به‌جای passHash از "pass" متن ساده هم استفاده کرد.)
 *
 * فیلدهای اختیاری هر کاربر:
 *   "role": "test"   → حساب تست: همه‌چیز را می‌بیند ولی چیزی به سرور ارسال نمی‌شود
 *   "canSend": false → همان رفتار حساب تست
 *   "role": "admin"  → ادمین: تب «گزارش سرور» را هم می‌بیند
 * کاربر بدون این فیلدها رفتار عادی دارد (canSend = true).
 */
import { kv } from "../core/db.js";
import { fetchWithTimeout, sha256Hex, toLatinDigits, normalizeText } from "../core/utils.js";

const SESSION_KEY = "session";
let users = [];
let loginPass = ""; // رمز ورودِ همین نشست (فقط در حافظه؛ برای درخواست‌های ادمین به سرور)

export async function loadUsers() {
  try {
    const res = await fetchWithTimeout("config/users.json", { cache: "no-cache" }, 6000);
    if (!res.ok) throw new Error(res.status);
    const json = await res.json();
    users = json.users || [];
    await kv.set("users", users);
  } catch {
    users = (await kv.get("users", [])) || [];
  }
  return users;
}

export const userCount = () => users.length;

/** نقش و اجازه ارسال از روی تعریف کاربر */
function perms(u) {
  const role = u?.role ? String(u.role).toLowerCase() : "";
  const canSend = !(role === "test" || u?.canSend === false);
  return { role, canSend };
}

export const isTestUser = (u) => !!u && !perms(u).canSend;
export const canSend = (u) => !u || perms(u).canSend;
export const isAdmin = (u) => !!u && perms(u).role === "admin";
/** رمز ورودِ ادمین در همین نشست (اگر برنامه دوباره باز شده باشد خالی است) */
export const sessionPass = () => loginPass;

const normCode = (s) => toLatinDigits(normalizeText(s)).toLowerCase();

export async function login(codeInput, password) {
  const code = normCode(codeInput);
  const pass = toLatinDigits(String(password ?? "")).trim();
  const u = users.find((x) => normCode(x.code) === code);
  if (!u) return null;
  let ok = false;
  if (u.passHash) ok = (await sha256Hex(`${normCode(u.code)}:${pass}`)) === u.passHash;
  else if (u.pass != null) ok = toLatinDigits(String(u.pass)) === pass;
  if (!ok) return null;
  const { role, canSend } = perms(u);
  const session = { code: u.code, name: u.name || u.code, role, canSend, at: Date.now() };
  loginPass = pass;
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

export function currentUser() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    // اگر کاربر از فهرست حذف شده باشد، نشست باطل می‌شود (فقط وقتی فهرست بارگذاری شده است)
    if (s && users.length) {
      const u = users.find((x) => normCode(x.code) === normCode(s.code));
      if (!u) return null;
      // نقش را همیشه از آخرین فهرست کاربران بگیر (اگر ادمین نقش را عوض کند، نشست قدیمی هم به‌روز می‌شود)
      Object.assign(s, perms(u));
    } else if (s) {
      s.canSend = s.canSend !== false && s.role !== "test";
    }
    return s;
  } catch {
    return null;
  }
}

export function logout() {
  localStorage.removeItem(SESSION_KEY);
}
