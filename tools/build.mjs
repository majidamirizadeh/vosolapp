#!/usr/bin/env node
/**
 * ابزار ساخت — بعد از هر تغییر در پروژه اجرا کنید:   node tools/build.mjs
 *
 *  1) downloads/index.json را از روی فایل‌های داخل پوشه downloads/ می‌سازد
 *  2) نسخه و فهرست فایل‌های Service Worker (sw.js) را به‌روز می‌کند
 */
import { readdirSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const SKIP_DIRS = new Set(["node_modules", ".git", ".github", "tools", "server", "docs", "downloads"]);
const SKIP_FILES = new Set(["sw.js", "README.md", ".gitignore"]);
const posix = (p) => p.split(sep).join("/");

/* ───── 1) فهرست دانلودها ───── */
const dlDir = join(ROOT, "downloads");
const dl = readdirSync(dlDir)
  .filter((n) => !n.startsWith(".") && n !== "index.json" && n !== "README.txt" && statSync(join(dlDir, n)).isFile())
  .sort((a, b) => a.localeCompare(b, "fa"))
  .map((n) => {
    const s = statSync(join(dlDir, n));
    return { name: n, size: s.size, mtime: s.mtime.toISOString() };
  });
writeFileSync(join(dlDir, "index.json"), JSON.stringify({ files: dl }, null, 2) + "\n");
console.log(`downloads/index.json  ←  ${dl.length} فایل`);

/* ───── 2) فهرست و نسخه Service Worker ───── */
function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(n)) walk(p, out);
    } else if (!SKIP_FILES.has(n)) out.push(p);
  }
  return out;
}
const files = walk(ROOT).map((p) => posix(relative(ROOT, p))).sort();
const hash = createHash("sha256");
for (const f of files) {
  hash.update(f);
  hash.update(readFileSync(join(ROOT, f)));
}
const version = hash.digest("hex").slice(0, 10);
const list = ["./", ...files];

const swPath = join(ROOT, "sw.js");
let sw = readFileSync(swPath, "utf8");
const block = `/*BUILD:START*/\nconst VERSION = "${version}";\nconst FILES = ${JSON.stringify(list, null, 2)};\n/*BUILD:END*/`;
sw = sw.replace(/\/\*BUILD:START\*\/[\s\S]*?\/\*BUILD:END\*\//, block);
writeFileSync(swPath, sw);
console.log(`sw.js  ←  نسخه ${version} ، ${list.length} فایل در کش آفلاین`);
