/**
 * تب «بایگانی»: فهرست رکوردهای ذخیره‌شده در گوشی، ارسال، ذخیره مجدد عکس‌ها، حذف
 */
import { CONFIG } from "../../config/app.config.js";
import { h, toPersianDigits, formatMoney } from "../core/utils.js";
import { alertBox, confirmBox, toast, busy } from "../core/ui.js";
import { bus, EV } from "../core/bus.js";
import { getPref } from "../core/prefs.js";
import * as db from "../core/db.js";
import { listFor, remove, markDeviceSaved } from "./records.js";
import { sendRecord, sendMany, serverConfigured, TEST_USER_MSG } from "./sync.js";
import { canSend } from "./auth.js";
import { saveFiles } from "./storage.js";

export function createArchiveModule({ getUser, onEdit }) {
  let listEl, filter = "all", urls = [], tabs, testNote, sendAllBtn;
  const openIds = new Set(); // موردهای بازشده در لیست

  const revoke = () => { urls.forEach(URL.revokeObjectURL); urls = []; };

  async function pendingIds() {
    const list = await listFor(getUser(), { allUsers: getPref("allUsersOnPhone") });
    return list.filter((r) => r.status === "pending").map((r) => r.id);
  }

  async function render() {
    revoke();
    testNote.classList.toggle("hidden", allowed());
    sendAllBtn.disabled = !allowed();
    const all = await listFor(getUser(), { allUsers: getPref("allUsersOnPhone") });
    const items = all.filter((r) => filter === "all" || r.status === filter);
    listEl.replaceChildren();
    const pend = all.filter((r) => r.status === "pending").length;
    tabs.forEach((t) => {
      const n = t.dataset.f === "all" ? all.length : t.dataset.f === "pending" ? pend : all.length - pend;
      t.querySelector("b").textContent = toPersianDigits(n);
      t.classList.toggle("active", t.dataset.f === filter);
    });

    if (!items.length) {
      listEl.append(h("p", { class: "empty" }, "موردی وجود ندارد"));
      return;
    }
    for (const r of items) listEl.append(card(r));
  }

  /** هر مورد یک سطر جمع‌شده؛ با کلیک جزئیات باز/بسته می‌شود */
  function card(r) {
    const sent = r.status === "sent";
    const open = openIds.has(r.id);
    const wrap = h("div", { class: "rec " + (sent ? "sent " : "") + (open ? "open" : "") });

    const toggle = () => {
      open ? openIds.delete(r.id) : openIds.add(r.id);
      wrap.replaceWith(card(r));
    };

    wrap.append(
      h("div", { class: "rec-row", onclick: toggle },
        h("div", { class: "rec-main" },
          h("div", { class: "rec-l1" }, h("b", { dir: "ltr" }, toPersianDigits(r.eshterak)), "  ·  ", r.modeTitle, r.note && h("span", { class: "rec-note-ico", title: "دارای توضیحات" }, " 💬")),
          h("div", { class: "rec-l2" }, `${toPersianDigits(r.date)}  ·  ${formatMoney(r.amount)} ریال${r.omoor ? "  ·  " + r.omoor : ""}`)
        ),
        sent
          ? h("span", { class: "rec-ok" }, "✓ ارسال شد")
          : h("button", { type: "button", class: "btn btn-success btn-xs", disabled: !allowed() || null, title: allowed() ? "" : TEST_USER_MSG,
              onclick: (e) => { e.stopPropagation(); sendOne(r.id); } }, "ارسال"),
        h("span", { class: "chev" }, "▼")
      )
    );

    if (open) {
      // عکس‌ها فقط وقتی باز شد ساخته می‌شوند (سبک‌تر برای لیست‌های بلند)
      const thumbs = (r.photos || []).map((p) => {
        const u = URL.createObjectURL(p.blob);
        urls.push(u);
        return h("figure", { class: "thumb", onclick: () => alertBox(h("div", { class: "lightbox" }, h("img", { src: u, alt: p.name }), h("div", { class: "info-text" }, p.name)), r.modeTitle) },
          h("img", { src: u, alt: p.name, loading: "lazy" }), h("figcaption", { dir: "ltr" }, p.name));
      });
      wrap.append(
        h("div", { class: "rec-detail" },
          h("div", {}, `امور: ${r.omoor || "—"}  |  شهر: ${r.city || "—"}`),
          h("div", {}, `سرگروه: ${r.leader || "—"}`),
          getPref("allUsersOnPhone") && h("div", {}, `کاربر: ${r.userName || r.userCode}`),
          r.note && h("div", { class: "rec-note" }, "توضیحات: " + r.note),
          r.lastError && !sent && h("div", { class: "err" }, "آخرین خطا: " + r.lastError),
          h("div", { class: "thumbs" }, thumbs),
          h("div", { class: "rec-acts" },
            !sent && h("button", { type: "button", class: "btn btn-warning btn-xs", onclick: () => onEdit?.(r) }, "ویرایش"),
            h("button", { type: "button", class: "btn btn-secondary btn-xs", onclick: () => resave(r) }, "ذخیره عکس‌ها در گوشی"),
            (sent || CONFIG.rules.allowDeletePending) && h("button", { type: "button", class: "btn btn-danger btn-xs", onclick: () => del(r) }, "حذف")
          )
        )
      );
    }
    return wrap;
  }

  /** حساب تست اجازه ارسال به سرور ندارد */
  const allowed = () => canSend(getUser());

  async function sendOne(id) {
    if (!allowed()) return alertBox(TEST_USER_MSG);
    if (!serverConfigured()) return alertBox("آدرس/توکن سرور هنوز در config/app.config.js تنظیم نشده است.");
    const b = busy("در حال ارسال به سرور…");
    const res = await sendRecord(id);
    b.done();
    if (res.ok) toast(res.duplicate ? "این مورد قبلاً در سرور ثبت شده بود ✓" : "با موفقیت ارسال شد ✓", "success");
    else await alertBox(res.error, "ارسال ناموفق");
  }

  async function sendAll() {
    if (!allowed()) return alertBox(TEST_USER_MSG);
    const ids = await pendingIds();
    if (!ids.length) return toast("موردی برای ارسال نیست");
    if (!serverConfigured()) return alertBox("آدرس/توکن سرور هنوز در config/app.config.js تنظیم نشده است.");
    if (!navigator.onLine) return alertBox("دستگاه آفلاین است. وقتی اینترنت وصل شد دوباره تلاش کنید.");
    if (!(await confirmBox(`${toPersianDigits(ids.length)} مورد ارسال شود؟`, { yes: "ارسال" }))) return;
    const b = busy("در حال ارسال…");
    const out = await sendMany(ids, ({ index, total }) => { b.text(`ارسال ${toPersianDigits(index)} از ${toPersianDigits(total)}`); b.progress(index / total); });
    b.done();
    const msg = `${toPersianDigits(out.ok)} مورد ارسال شد` + (out.failed ? `\n${toPersianDigits(out.failed)} مورد ناموفق ماند\n${out.lastError}` : "");
    await alertBox(msg, out.failed ? "ارسال ناقص" : "ارسال کامل");
  }

  async function resave(r) {
    const res = await saveFiles(r.photos.map((p) => ({ name: p.name, blob: p.blob })), [r.date.replace(/\//g, "-")]);
    await markDeviceSaved(r.id, res.saved === r.photos.length);
    toast(res.saved ? `${toPersianDigits(res.saved)} فایل ذخیره شد` : "ذخیره نشد", res.saved ? "success" : "error");
  }

  async function del(r) {
    const sent = r.status === "sent";
    const first = await confirmBox(
      sent ? "این مورد حذف شود؟ (قبلاً در سرور ثبت شده است)" : "⚠️ این مورد هنوز به سرور ارسال نشده است!\nبا حذف، اطلاعات و عکس‌ها برای همیشه از گوشی پاک می‌شود.",
      { yes: "حذف", danger: true }
    );
    if (!first) return;
    if (!sent && !(await confirmBox("مطمئن هستید؟ این کار قابل بازگشت نیست.", { yes: "بله، حذف شود", danger: true }))) return;
    await remove(r.id);
    toast("حذف شد");
  }

  return {
    id: "archive",
    title: "بایگانی",
    icon: "🗃",
    badge: async () => (await pendingIds()).length,
    async mount(container) {
      listEl = h("div", { class: "records" });
      tabs = [["all", "همه"], ["pending", "در انتظار"], ["sent", "ارسال‌شده"]].map(([f, label]) =>
        h("button", { type: "button", class: "seg", "data-f": f, onclick: () => { filter = f; render(); } }, label, " ", h("b", {}, "۰"))
      );
      testNote = h("div", { class: "test-banner hidden" }, TEST_USER_MSG);
      sendAllBtn = h("button", { type: "button", class: "btn btn-success btn-sm", onclick: sendAll }, "ارسال همه موارد در انتظار");
      container.append(
        h("div", { class: "card" },
          testNote,
          sendAllBtn,
          h("div", { class: "segs" }, tabs),
          listEl
        )
      );
      bus.on(EV.RECORDS_CHANGED, () => container.classList.contains("active") && render());
    },
    onShow: render,
    onHide: revoke,
  };
}
