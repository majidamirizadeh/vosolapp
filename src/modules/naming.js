/**
 * قانون نام‌گذاری عکس‌ها (تابع خالص — قابل تست)
 *
 * - اولین (و تنها) عکس یک اشتراک:          12345.jpg
 * - اگر در همان فرم بیش از یک عکس باشد:    12345_1.jpg ، 12345_2.jpg ، …
 * - اگر برای همان اشتراک قبلاً عکس ذخیره شده بود، شمارش ادامه می‌یابد (12345_2 ، 12345_3 ، …)
 *   تا هیچ فایلی روی فایل دیگر نوشته نشود. شمارنده با حذف رکورد هم عقب نمی‌رود.
 */
export function allocateNames(base, existingCount, newCount, sep = "_", ext = "jpg") {
  const names = [];
  if (existingCount === 0 && newCount === 1) {
    names.push(`${base}.${ext}`);
  } else {
    for (let i = 1; i <= newCount; i++) names.push(`${base}${sep}${existingCount + i}.${ext}`);
  }
  return { names, count: existingCount + newCount };
}
