/**
 * تعریف فیلدها و حالت‌های فرم (ماژولار)
 * برای افزودن «حالت» یا «فیلد» جدید فقط همین فایل را ویرایش کنید.
 *
 * type:
 *   text    متن ساده
 *   shamsi  تاریخ شمسی  (YYYY/MM/DD)
 *   digits  فقط ارقام (مثل شماره اشتراک)
 *   money   مبلغ (ریال) با جداکننده هزارگان
 *   textarea توضیحات چندخطی (اختیاری)
 *   select  لیست انتخابی (گزینه‌ها در options؛ فهرست امور از config/omoors.js)
 */
import { OMOORS } from "./omoors.js";

export const FIELDS = [
  { key: "date",     label: "تاریخ شمسی", type: "shamsi", required: true, hint: "خودکار پر می‌شود — قابل ویرایش" },
  { key: "omoor",    label: "امور",       type: "select", required: true, sticky: true, options: OMOORS },
  { key: "city",     label: "شهر",        type: "text",   required: true, sticky: true },
  { key: "leader",   label: "سرگروه",     type: "text",   required: true, sticky: true },
  { key: "eshterak", label: "شماره اشتراک", type: "digits", required: true, hint: "نام فایل عکس‌ها از همین شماره ساخته می‌شود" },
  { key: "amount",   label: "مبلغ",       type: "money",  required: true, labelByMode: true },
  // توضیحات اختیاری برای هر ۴ عملیات (wide = تمام‌عرض در چیدمان دو ستونی)
  { key: "note",     label: "توضیحات",    type: "textarea", required: false, wide: true, placeholder: "اختیاری" },
];

export const MODES = {
  warning: {
    title: "صدور اخطار",
    amountLabel: "مبلغ بدهی (ریال)",
    photoSlots: ["عکس اخطار ۱", "عکس اخطار ۲"],
    minPhotos: 1,
  },
  collect: {
    title: "وصول مطالبات",
    amountLabel: "مبلغ وصول (ریال)",
    photoSlots: ["عکس ۱", "عکس ۲"],
    minPhotos: 1,
  },
  cut_meter: {
    title: "قطع از محل کنتور",
    amountLabel: "مبلغ بدهی (ریال)",
    photoSlots: ["عکس قبل", "عکس حین", "عکس بعد", "عکس اضافی"],
    minPhotos: 1,
  },
  cut_belt: {
    title: "قطع از محل کمربند",
    amountLabel: "مبلغ بدهی (ریال)",
    photoSlots: ["عکس قبل", "عکس حین", "عکس بعد", "عکس اضافی"],
    minPhotos: 1,
  },
};
