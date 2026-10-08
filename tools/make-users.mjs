#!/usr/bin/env node
/**
 * ساخت فایل کاربران (config/users.json) از روی فایل متنی tools/users-source.csv
 *
 *   node tools/make-users.mjs --generate 50   ← ساخت ۵۰ کاربر نمونه با رمز تصادفی ۶ رقمی (users-source.csv)
 *   node tools/make-users.mjs                 ← تبدیل users-source.csv به config/users.json (رمزها به‌صورت هش)
 *
 * فرمت هر خط users-source.csv:   کد,نام نمایشی,رمز[,نقش]
 *   نقش اختیاری: test (حساب تست — بدون ارسال به سرور) یا admin (ادمین — تب «گزارش سرور»)
 *   مثال:  99,تست,1234,test   و   00,ادمین,MyStrongPass,admin
 * ⚠️ فایل users-source.csv رمزها را به‌صورت متن ساده دارد؛ آن را روی هاست/GitHub قرار ندهید
 *    (در .gitignore همراه پروژه هست) و فقط برای توزیع رمز بین کاربران نگه دارید.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomInt } from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const SRC = join(ROOT, "tools", "users-source.csv");
const OUT = join(ROOT, "config", "users.json");

const FA = "۰۱۲۳۴۵۶۷۸۹";
const latin = (s) => String(s).replace(/[۰-۹]/g, (d) => FA.indexOf(d)).replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d));
const norm = (c) => latin(String(c).replace(/ي/g, "ی").replace(/ك/g, "ک").replace(/\s+/g, " ").trim()).toLowerCase();
const toFa = (s) => String(s).replace(/\d/g, (d) => FA[d]);

const gi = process.argv.indexOf("--generate");
if (gi > -1) {
  const n = Number(process.argv[gi + 1]) || 50;
  if (existsSync(SRC) && !process.argv.includes("--force")) {
    console.error("users-source.csv از قبل وجود دارد. برای بازنویسی --force بدهید.");
    process.exit(1);
  }
  const lines = ["# کد,نام نمایشی,رمز"];
  for (let i = 1; i <= n; i++) {
    const code = String(i).padStart(2, "0");
    lines.push(`${code},اکیپ ${toFa(code)},${randomInt(100000, 999999)}`);
  }
  writeFileSync(SRC, lines.join("\n") + "\n");
  console.log(`${SRC}  ←  ${n} کاربر`);
}

if (!existsSync(SRC)) {
  console.error("tools/users-source.csv وجود ندارد. ابتدا با --generate بسازید.");
  process.exit(1);
}

const users = [];
const seen = new Set();
for (const raw of readFileSync(SRC, "utf8").split(/\r?\n/)) {
  const line = raw.trim();
  if (!line || line.startsWith("#")) continue;
  const parts = line.split(",");
  const code = parts[0], name = parts[1];
  // اگر آخرین ستون test/admin باشد نقش است، وگرنه بخشی از رمز
  let rest = parts.slice(2), role = "";
  if (rest.length > 1 && /^(test|admin)$/i.test(rest[rest.length - 1].trim())) role = rest.pop().trim().toLowerCase();
  const pass = rest.join(",").trim();
  if (!code || !pass) { console.warn("خط نامعتبر:", line); continue; }
  const c = norm(code);
  if (seen.has(c)) { console.error("کد تکراری:", c); process.exit(1); }
  seen.add(c);
  users.push({ code: code.trim(), name: (name || code).trim(), passHash: createHash("sha256").update(`${c}:${latin(pass)}`).digest("hex"), ...(role ? { role } : {}) });
}
writeFileSync(OUT, JSON.stringify({ users }, null, 2) + "\n");
console.log(`config/users.json  ←  ${users.length} کاربر (رمزها هش شده‌اند)`);
