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

/* ───────── تشخیص نصب بودن برنامه (PWA) ───────── */

function isAppInstalled() {
  // حالت standalone / fullscreen یعنی از آیکون صفحهٔ اصلی باز شده
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  if (window.matchMedia("(display-mode: fullscreen)").matches) return true;
  if (window.matchMedia("(display-mode: minimal-ui)").matches) return true;
  // iOS Safari
  if (window.navigator.standalone === true) return true;
  return false;
}

/**
 * پیام نصب در هر بار باز شدن در مرورگر نشان داده می‌شود (تا وقتی برنامه نصب نشده).
 * اگر برنامه نصب شده باشد (باز شدن از آیکون) یا مرورگر نصب را پیشنهاد ندهد، نمایش داده نمی‌شود.
 */
function setupInstallPrompt() {
  if (isAppInstalled()) return;

  let shown = false;

  // مرورگر رویداد نصب را می‌دهد؛ با زدن کلید «نصب»، خود مرورگر برنامه را نصب می‌کند (یا میان‌بر می‌سازد)
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    if (shown || isAppInstalled()) return;
    shown = true;
    setTimeout(async () => {
      const ok = await confirmBox("نصب برنامه روی گوشی", { yes: "نصب", no: "بعداً" });
      if (!ok) return; // «بعداً» → دفعه بعد که برنامه باز شد دوباره پیشنهاد می‌شود
      try {
        e.prompt();
        await e.userChoice;
      } catch (_) {
        /* کاربر ممکن است لغو کند */
      }
    }, 1200);
  });
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
    el.textContent = on ? "آنلاین" : "آفلاین — اطلاعات فقط روی گوشی ذخیره می‌شوند";
    el.className = "status " + (on ? "online" : "offline");
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
      h("span", {}, icon), h("span", {}, label));
  panel.append(
    h("div", { class: "hdr-menu-user" }, "👤 ", userLabel),
    item("⚙️", "تنظیمات", () => router.show("settings")),
    item("⬇️", "دانلودها", () => router.show("downloads")),
    item("🚪", "خروج از حساب", doLogout, "danger")
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
  setupInstallPrompt(); // پیام نصب فقط بار اول و فقط اگر هنوز نصب نشده باشد
  window.__app = { router, getUser };
}

start();
