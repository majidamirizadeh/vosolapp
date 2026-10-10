/**
 * نقطه شروع برنامه — فقط ماژول‌ها را به‌هم وصل می‌کند.
 */
import { CONFIG } from "../config/app.config.js";
import { openDB } from "./core/db.js";
import { bus, EV } from "./core/bus.js";
import { loadPrefs, getPref } from "./core/prefs.js";
import { createRouter } from "./core/router.js";
import { toast, alertBox, confirmBox } from "./core/ui.js";
import { h } from "./core/utils.js";
import { ICONS } from "./core/icons.js";
import { loadUsers, currentUser, logout, canSend, isAdmin, isTestUser } from "./modules/auth.js";
import { showLogin } from "./modules/login.js";
import { migrateLegacy, listFor } from "./modules/records.js";
import { loadHandle, requestPersistence } from "./modules/storage.js";
import { ensureFonts } from "./modules/photos.js";
import { sendMany, serverConfigured } from "./modules/sync.js";
import { createFormModule } from "./modules/form.js";
import { createArchiveModule } from "./modules/archive.js";
import { createReportsModule } from "./modules/reports.js";
import { createDownloadsModule } from "./modules/downloads.js";
import { createSettingsModule } from "./modules/settings.js";
import { createAdminModule } from "./modules/admin.js";

let user = null;
const getUser = () => user;
let swReg = null;

/* ───────── نصب برنامه (PWA) ─────────
 * رویداد نصب مرورگر ممکن است خیلی زود (قبل از ورود کاربر) بیاید؛ پس همین‌جا در ابتدای ماژول گرفته می‌شود.
 */
let deferredInstall = null;
let installEventSeen;
const installEventPromise = new Promise((r) => (installEventSeen = r));
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstall = e;
  installEventSeen();
});
window.addEventListener("appinstalled", () => {
  deferredInstall = null;
  toast("برنامه نصب شد ✓ از این به بعد از آیکون صفحهٔ اصلی گوشی باز کنید", "success", { ms: 8000 });
});

function isAppInstalled() {
  // وقتی از آیکون صفحهٔ اصلی باز شده باشد (تمام‌صفحه / standalone)
  const dm = (q) => window.matchMedia(`(display-mode: ${q})`).matches;
  if (dm("fullscreen") || dm("standalone") || dm("minimal-ui")) return true;
  // iOS Safari
  if (window.navigator.standalone === true) return true;
  // اندروید TWA
  if (document.referrer.startsWith("android-app://")) return true;
  return false;
}

const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/** وقتی برنامه نصب است ولی در تب مرورگر باز شده، با این روش نصب بودن تشخیص داده می‌شود (کروم) */
async function hasInstalledCopy() {
  try {
    if (!navigator.getInstalledRelatedApps) return false;
    return (await navigator.getInstalledRelatedApps()).length > 0;
  } catch (_) {
    return false;
  }
}

async function offerInstall() {
  const ok = await confirmBox(
    "برنامه هنوز روی گوشی شما نصب نشده است.\nبا نصب، برنامه تمام‌صفحه و بدون نوار آدرس باز می‌شود و آفلاین هم کار می‌کند.",
    { yes: "نصب", no: "بعداً", title: "نصب برنامه" }
  );
  if (!ok) return; // «بعداً» → دفعهٔ بعد که برنامه باز شد دوباره پیشنهاد می‌شود

  if (deferredInstall) {
    const ev = deferredInstall;
    deferredInstall = null; // هر رویداد فقط یک بار قابل استفاده است
    try {
      await ev.prompt();
      await ev.userChoice;
    } catch (_) {
      /* کاربر ممکن است لغو کند */
    }
    return;
  }
  // مرورگر نصب خودکار نمی‌دهد (مثل iOS) → راهنمای دستی
  await alertBox(
    isIOS()
      ? "۱) در مرورگر Safari دکمهٔ اشتراک‌گذاری (□↑) را بزنید\n۲) گزینهٔ «Add to Home Screen» (افزودن به صفحهٔ آغاز) را انتخاب کنید\n۳) «Add» را بزنید و از آیکون باز کنید"
      : "۱) منوی مرورگر (⋮ بالا-گوشه) را باز کنید\n۲) «Install app» (نصب برنامه) یا «Add to Home screen» را بزنید\n۳) بعد از نصب، از آیکون صفحهٔ اصلی باز کنید",
    "راهنمای نصب"
  );
}

/**
 * در هر بار باز شدن بررسی می‌کند برنامه نصب است یا نه؛ اگر نصب نبود پیام نصب نشان می‌دهد.
 * (کروم وقتی برنامه نصب باشد رویداد نصب نمی‌دهد؛ برای iOS هم راهنمای دستی نشان داده می‌شود.)
 */
async function setupInstallPrompt() {
  if (isAppInstalled()) return;
  if (!isIOS()) {
    // تا ۳ ثانیه منتظر رویداد نصب مرورگر می‌مانیم
    await Promise.race([installEventPromise, new Promise((r) => setTimeout(r, 3000))]);
    if (!deferredInstall && (await hasInstalledCopy())) return;
  }
  if (isAppInstalled()) return;
  await offerInstall();
}

/* ───────── به‌روزرسانی برنامه (Service Worker) ───────── */
async function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  try {
    swReg = await navigator.serviceWorker.register("sw.js");
    const offer = (worker) =>
      toast("نسخه جدید برنامه آماده است", "info", {
        sticky: true,
        action: { label: "به‌روزرسانی", run: () => worker.postMessage({ type: "SKIP_WAITING" }) },
      });
    if (swReg.waiting && navigator.serviceWorker.controller) offer(swReg.waiting);
    swReg.addEventListener("updatefound", () => {
      const w = swReg.installing;
      w?.addEventListener("statechange", () => w.state === "installed" && navigator.serviceWorker.controller && offer(w));
    });
    let reloading = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (!reloading) { reloading = true; location.reload(); } });
  } catch (e) {
    console.warn("SW", e);
  }
}

async function checkUpdate() {
  if (!swReg) return toast("به‌روزرسانی در این مرورگر پشتیبانی نمی‌شود", "error");
  if (!navigator.onLine) return toast("آنلاین نیستید", "error");
  await swReg.update();
  toast(swReg.waiting || swReg.installing ? "نسخه جدید پیدا شد" : "برنامه به‌روز است ✓", "success");
}

/* ───────── وضعیت شبکه و ارسال خودکار ───────── */
function setupNetwork() {
  const el = document.getElementById("netStatus");
  const update = () => {
    const on = navigator.onLine;
    // چراغ گوشهٔ راست هدر: سبز + «آنلاین» / قرمز + «آفلاین»
    el.classList.toggle("online", on);
    el.classList.toggle("offline", !on);
    el.querySelector(".net-lbl").textContent = on ? "آنلاین" : "آفلاین";
    el.title = on ? "آنلاین" : "آفلاین — اطلاعات فقط روی گوشی ذخیره می‌شوند";
    bus.emit(EV.NET, on);
  };
  window.addEventListener("online", async () => {
    update();
    if (user && getPref("autoSync") && serverConfigured() && canSend(user)) { // حساب تست هرگز ارسال خودکار ندارد
      const list = await listFor(user, { allUsers: getPref("allUsersOnPhone") });
      const ids = list.filter((r) => r.status === "pending").map((r) => r.id);
      if (ids.length) {
        const out = await sendMany(ids);
        toast(`ارسال خودکار: ${out.ok} موفق${out.failed ? "، " + out.failed + " ناموفق" : ""}`, out.failed ? "error" : "success");
      }
    }
  });
  window.addEventListener("offline", update);
  update();
}

/* ───────── منوی همبرگری (بالا-چپ): نام کاربر، تنظیمات، دانلودها، خروج ───────── */
function setupMenu({ router, userLabel, doLogout }) {
  const btn = document.getElementById("menuBtn");
  const panel = document.getElementById("menuPanel");
  const backdrop = document.getElementById("menuBackdrop");
  const close = () => {
    panel.classList.add("hidden");
    backdrop.classList.add("hidden");
    btn.setAttribute("aria-expanded", "false");
  };
  const item = (icon, label, run, cls = "") =>
    h("button", { type: "button", class: "hdr-menu-item " + cls, role: "menuitem", onclick: () => { close(); run(); } },
      h("span", { class: "mi", html: icon }), h("span", {}, label));
  btn.innerHTML = ICONS.menu;
  panel.append(
    h("div", { class: "hdr-menu-user" }, h("span", { class: "mu-av", html: ICONS.user }), h("span", { class: "mu-name" }, userLabel)),
    item(ICONS.settings, "تنظیمات", () => router.show("settings")),
    item(ICONS.downloads, "دانلودها", () => router.show("downloads")),
    item(ICONS.logout, "خروج از حساب", doLogout, "danger")
  );
  btn.addEventListener("click", () => {
    const open = panel.classList.contains("hidden");
    panel.classList.toggle("hidden", !open);
    backdrop.classList.toggle("hidden", !open);
    btn.setAttribute("aria-expanded", String(open));
  });
  backdrop.addEventListener("click", close);
  window.__closeMenu = close;
}

/* ───────── کلید برگشت گوشی: بستن پنجره/منو → رفتن به فرم → تأیید خروج ───────── */
function setupBackGuard(router) {
  let asking = false;
  const guard = () => history.pushState({ guard: true }, "");
  guard();
  const onPop = async () => {
    // ۱) پنجره بازِ پیام/تأیید → بسته شود
    const overlay = document.querySelector(".modal-overlay");
    if (overlay) { overlay.click(); guard(); return; }
    // ۲) منو باز است → بسته شود
    const menu = document.getElementById("menuPanel");
    if (menu && !menu.classList.contains("hidden")) { window.__closeMenu?.(); guard(); return; }
    // ۳) در حین کار (ارسال/ساخت فایل) کاری نکند
    if (document.querySelector(".busy-overlay")) { guard(); return; }
    // ۴) تب دیگر → برگشت به صفحه اصلی (فرم)
    if (router.current && router.current !== "form") { await router.show("form"); guard(); return; }
    // ۵) صفحه اصلی → تأیید خروج
    if (asking) return;
    asking = true;
    const ok = await confirmBox("از برنامه خارج می‌شوید؟", { yes: "خروج", no: "ماندن", title: "خروج از برنامه" });
    asking = false;
    if (ok) {
      window.removeEventListener("popstate", onPop);
      history.back();
      setTimeout(() => window.close(), 150);
    } else guard();
  };
  window.addEventListener("popstate", onPop);
}

async function start() {
  document.title = CONFIG.appName;
  document.getElementById("appTitle").textContent = CONFIG.appName;

  try {
    await openDB();
    await migrateLegacy();
    await loadPrefs();
    await loadHandle();
    await loadUsers();
  } catch (e) {
    console.error(e);
    return alertBox("راه‌اندازی دیتابیس گوشی ممکن نشد:\n" + (e.message || e) + "\n\nاگر در حالت ناشناس (Incognito) هستید، خارج شوید.", "خطا");
  }
  registerSW();
  setupInstallPrompt(); // هر بار باز شدن: اگر نصب نشده بود پیام نصب (بدون انتظار برای ورود)
  ensureFonts();
  setupNetwork();

  user = currentUser();
  if (!user) user = await showLogin(document.body);
  const userLabel = user.name + (isTestUser(user) ? " (تست)" : isAdmin(user) ? " (ادمین)" : "");
  requestPersistence();

  const doLogout = async () => {
    if (await confirmBox("از حساب خارج می‌شوید؟\n(اطلاعات ذخیره‌شده روی گوشی پاک نمی‌شود)", { yes: "خروج" })) {
      logout();
      location.reload();
    }
  };

  let router;
  // ویرایش از بایگانی → باز شدن فرم با اطلاعات همان رکورد؛ بعد از ذخیره/انصراف برگشت به بایگانی
  const form = createFormModule({ getUser, onEditDone: () => router.show("archive") });
  const onEdit = async (rec) => { if (await form.startEdit(rec)) router.show("form"); };

  const modules = [
    form,
    createArchiveModule({ getUser, onEdit }),
    createReportsModule({ getUser }),
    ...(isAdmin(user) ? [createAdminModule({ getUser })] : []), // فقط ادمین
    createDownloadsModule(),
    createSettingsModule({ getUser, onLogout: doLogout, checkUpdate }),
  ];
  router = createRouter(modules, document.getElementById("nav"), document.getElementById("view"));
  await router.mountAll();
  document.getElementById("app").hidden = false;
  setupMenu({ router, userLabel, doLogout });
  setupBackGuard(router);
  await router.show("form");
  router.refreshBadges();
  window.__app = { router, getUser };
}

start();
