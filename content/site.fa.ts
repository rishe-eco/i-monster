import type { SiteContent } from './site.ts';

// PLACEHOLDER (P0-6): the copy, the project links and the show links are
// stand-ins from the design (plate 13), not final, and the Persian was written
// for the layout rather than by the founder. The real ones come from the founder.
export const siteFa: SiteContent = {
  who: [
    { text: 'چیزهایی می‌سازم تا ' },
    { text: 'بفهمم‌شان', mark: true },
    { text: '. بعد ' },
    { text: 'آنچه یاد گرفتم را می‌نویسم', mark: true },
    { text: '، پیش از آنکه فراموشش کنم.' },
  ],
  projects: [
    {
      name: 'Root',
      latinName: true,
      line: 'مجموعه‌ای کوچک از ابزارها برای یاد گرفتن و سامان دادن به زندگی.',
      url: 'https://example.com/root',
    },
    {
      name: 'Tracker',
      latinName: true,
      line: 'جایی که ایده‌های Root اول روی خودم امتحان می‌شوند.',
    },
    {
      name: 'Root Studio',
      latinName: true,
      line: 'وب‌سایت Root، ساخته‌شده مثل یک اپ. اول فارسی.',
      url: 'https://example.com/root-studio',
    },
  ],
  show: {
    name: 'پادکست مانستر',
    links: [
      { label: 'YouTube', url: 'https://example.com/monster-podcast-fa/youtube' },
      { label: 'Castbox', url: 'https://example.com/monster-podcast-fa/castbox' },
    ],
  },
};
