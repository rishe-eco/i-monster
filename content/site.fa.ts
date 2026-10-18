import type { SiteContent } from './site.ts';

// PLACEHOLDER (P0-6): the copy, the project links and the show links are
// stand-ins from the design (plate 13), not final, and the Persian was written
// for the layout rather than by the founder. The real ones come from the founder.
export const siteFa: SiteContent = {
  who: [
    { text: 'چیزهایی می‌سازم تا ' },
    { text: 'دنیا را بفهمم', mark: true },
    { text: '. بعد ' },
    { text: 'آنچه یاد گرفتم را می‌نویسم', mark: true },
    { text: '، پیش از آنکه فراموشش کنم.' },
  ],
  projects: [
    {
      name: 'Root',
      line: 'مجموعه‌ای کوچک از ابزارها برای یاد گرفتن و سامان دادن به زندگی.',
      url: 'https://example.com/root',
    },
    {
      name: 'Tracker',
      line: 'جایی که ایده‌های Root امتحان می‌شوند.',
    },
    {
      name: 'Root Studio',
      line: 'وب‌سایت Root، ساخته‌شده مثل یک اپ. اول فارسی.',
      url: 'https://example.com/root-studio',
    },
  ],
  show: {
    name: 'تجربه زیسته یک هیولا',
    links: [
      { label: 'YouTube', url: 'https://example.com/monster-podcast-fa/youtube' },
      { label: 'Castbox', url: 'https://example.com/monster-podcast-fa/castbox' },
    ],
  },
};
