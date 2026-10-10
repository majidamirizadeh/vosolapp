/**
 * Service Worker — اجرای کامل برنامه بدون اینترنت
 *
 * بخش BUILD را دستور `node tools/build.mjs` خودکار می‌سازد (نسخه + فهرست فایل‌ها).
 * با هر تغییر در فایل‌های برنامه، نسخه عوض می‌شود و گوشی‌ها پیام «نسخه جدید» می‌گیرند.
 *
 *  - فایل‌های برنامه: اول کش (stale-while-revalidate)
 *  - config/*.json ، downloads/index.json: اول شبکه، در صورت قطعی کش
 *  - درخواست‌های خارج از دامنه (سرور گوگل) دست‌نخورده می‌مانند
 */
/*BUILD:START*/
const VERSION = "821f8fab76";
const FILES = [
  "./",
  ".gitattributes",
  ".nojekyll",
  "assets/fonts/OFL.txt",
  "assets/fonts/Vazirmatn-Bold.woff2",
  "assets/fonts/Vazirmatn-Regular.woff2",
  "assets/icons/icon-192.png",
  "assets/icons/icon-512.png",
  "assets/icons/icon-maskable-512.png",
  "config/app.config.js",
  "config/cities.js",
  "config/modes.js",
  "config/omoors.js",
  "config/users.json",
  "index.html",
  "manifest.json",
  "src/core/bus.js",
  "src/core/db.js",
  "src/core/icons.js",
  "src/core/jalali.js",
  "src/core/prefs.js",
  "src/core/router.js",
  "src/core/ui.js",
  "src/core/utils.js",
  "src/lib/pdf.js",
  "src/lib/xlsx.js",
  "src/lib/zip.js",
  "src/main.js",
  "src/modules/admin.js",
  "src/modules/archive.js",
  "src/modules/auth.js",
  "src/modules/downloads.js",
  "src/modules/exporter.js",
  "src/modules/form.js",
  "src/modules/login.js",
  "src/modules/naming.js",
  "src/modules/photos.js",
  "src/modules/records.js",
  "src/modules/reports.js",
  "src/modules/settings.js",
  "src/modules/storage.js",
  "src/modules/sync.js",
  "src/styles/app.css"
];
/*BUILD:END*/

const CACHE = "app-shell-" + VERSION;
const PREFIX = "app-shell-";
const NETWORK_FIRST = [/\/config\//, /\/downloads\/index\.json$/];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // یکی‌یکی؛ اگر یک فایل پیدا نشد کل نصب خراب نشود
      for (const f of FILES) {
        try { await cache.add(new Request(f, { cache: "reload" })); } catch (e) { /* ادامه */ }
      }
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const k of await caches.keys()) {
        if (k.startsWith(PREFIX) && k !== CACHE) await caches.delete(k);
      }
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // کش فایل‌های بخش دانلودها را خود برنامه مدیریت می‌کند
  if (url.pathname.includes("/downloads/") && !url.pathname.endsWith("index.json")) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const isNav = req.mode === "navigate";

      if (NETWORK_FIRST.some((re) => re.test(url.pathname))) {
        try {
          const ctl = new AbortController();
          const t = setTimeout(() => ctl.abort(), 5000);
          const res = await fetch(req, { signal: ctl.signal, cache: "no-cache" });
          clearTimeout(t);
          if (res.ok) cache.put(req, res.clone());
          return res;
        } catch {
          return (await cache.match(req, { ignoreSearch: true })) || new Response("{}", { status: 503, headers: { "Content-Type": "application/json" } });
        }
      }

      const hit = await cache.match(isNav ? "index.html" : req, { ignoreSearch: true });
      const refresh = fetch(req)
        .then((res) => { if (res.ok) cache.put(isNav ? "index.html" : req, res.clone()); return res; })
        .catch(() => null);
      if (hit) { event.waitUntil(refresh); return hit; }
      return (await refresh) || new Response("آفلاین", { status: 503 });
    })()
  );
});
