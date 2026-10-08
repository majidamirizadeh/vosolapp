/**
 * نقطه شروع برنامه — فقط ماژول‌ها را به‌هم وصل می‌کند.
 */
import { CONFIG } from "../config/app.config.js";
import { openDB } from "./core/db.js";
import { bus, EV } from "./core/bus.js";
import { loadPrefs, getPref } from "./core/prefs.js";
import { createRouter } from "./core/router.js";
import { toast, alertBox, confirmBox } from "./core/ui.js";
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
  document.getElementById("userChip").textContent = user.name + (isTestUser(user) ? " (تست)" : isAdmin(user) ? " (ادمین)" : "");
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
  document.getElementById("logoutBtn").addEventListener("click", doLogout);
  await router.show("form");
  router.refreshBadges();
  window.__app = { router, getUser };
}

start();
