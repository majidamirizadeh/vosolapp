/**
 * آیکون‌های برداری برنامه (SVG خطی، هم‌رنگ با متن اطراف: currentColor)
 * استفاده:  h("span", { class: "ico", html: ICONS.camera })
 */
const svg = (body, extra = "") =>
  `<svg class="ico-svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"${extra}>${body}</svg>`;

export const ICONS = {
  /* ناوبری پایین */
  form: svg('<rect x="5" y="4" width="14" height="17" rx="3"/><path d="M9 4.5V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v.5"/><path d="M12 9.5v7M8.5 13h7"/>'),
  archive: svg('<rect x="3.5" y="4" width="17" height="4.5" rx="1.6"/><path d="M5 8.5V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5"/><path d="M10 13h4"/>'),
  reports: svg('<path d="M5 20V11M12 20V4M19 20v-6"/><path d="M3 20h18"/>'),
  admin: svg('<rect x="3.5" y="4" width="17" height="6.5" rx="2"/><rect x="3.5" y="13.5" width="17" height="6.5" rx="2"/><path d="M7.5 7.25h.01M7.5 16.75h.01M12 7.25h5M12 16.75h5"/>'),
  downloads: svg('<path d="M12 4v11"/><path d="m7.5 11 4.5 4.5 4.5-4.5"/><path d="M5 19.5h14"/>'),
  settings: svg('<path d="M4 7h9M18 7h2M4 17h2M11 17h9"/><circle cx="15.5" cy="7" r="2.3"/><circle cx="8.5" cy="17" r="2.3"/>'),

  /* هدر و منو */
  menu: svg('<path d="M4.5 7h15M4.5 12h15M4.5 17h9"/>'),
  user: svg('<circle cx="12" cy="8.5" r="3.6"/><path d="M5 20c.6-3.6 3.4-5.6 7-5.6s6.4 2 7 5.6"/>'),
  logout: svg('<path d="M9.5 4.5H7a2.5 2.5 0 0 0-2.5 2.5v10A2.5 2.5 0 0 0 7 19.5h2.5"/><path d="m15 8 4 4-4 4M19 12H9.5"/>'),

  /* فرم */
  camera: svg('<path d="M4 8.5A2.5 2.5 0 0 1 6.5 6H8l1.1-1.5a1 1 0 0 1 .8-.4h4.2a1 1 0 0 1 .8.4L16 6h1.5A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z"/><circle cx="12" cy="12.4" r="3.3"/>'),
  pin: svg('<path d="M12 21s6.8-5.9 6.8-11.2a6.8 6.8 0 0 0-13.6 0C5.2 15.1 12 21 12 21z"/><circle cx="12" cy="9.8" r="2.4"/>'),
  close: svg('<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>', ' stroke-width="2.3"'),
  chevron: svg('<path d="m6 9 6 6 6-6"/>', ' stroke-width="2.2"'),
  check: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>', ' stroke-width="2.4"'),
  note: svg('<path d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v7a2.5 2.5 0 0 1-2.5 2.5H11l-4 3.5V16h-.5A1.5 1.5 0 0 1 5 14.5z"/>', ' stroke-width="1.8"'),

  /* گزارش و خروجی‌ها */
  sheet: svg('<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M4 9.5h16M4 14.5h16M10 9.5V20"/>'),
  pdf: svg('<path d="M7 3.5h7l4.5 4.5v11A1.5 1.5 0 0 1 17 20.5H7A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5z"/><path d="M14 3.8V8h4.2M8.5 14.5h7M8.5 17.5h4.5"/>'),
  zip: svg('<path d="M4.5 8 12 4l7.5 4v8L12 20l-7.5-4z"/><path d="m4.5 8 7.5 4 7.5-4M12 12v8"/>'),
  list: svg('<path d="M9 6.5h10M9 12h10M9 17.5h10"/><path d="M5 6.5h.01M5 12h.01M5 17.5h.01" stroke-width="2.6"/>'),
  share: svg('<circle cx="17.5" cy="6" r="2.4"/><circle cx="6.5" cy="12" r="2.4"/><circle cx="17.5" cy="18" r="2.4"/><path d="m8.6 10.8 6.8-3.6M8.6 13.2l6.8 3.6"/>'),
  file: svg('<path d="M7 3.5h7l4.5 4.5v11A1.5 1.5 0 0 1 17 20.5H7A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5z"/><path d="M14 3.8V8h4.2"/>'),
  send: svg('<path d="M20.5 4 10.5 14"/><path d="M20.5 4 14 20l-3.5-6L4.5 10.5z"/>'),
  calendar: svg('<rect x="4" y="5.5" width="16" height="14.5" rx="3"/><path d="M4 10.5h16M8.5 3.5v4M15.5 3.5v4"/>'),
};
