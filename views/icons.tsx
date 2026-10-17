// Arrows are SVG, not text: none of the four families has the arrow glyphs, and
// a fallback font is what AC-40 rules out. CSS mirrors them in Persian
// (`icon--flip`): the forward arrow points the other way and ↗ becomes ↖.
import type { FC } from 'hono/jsx';

export const ArrowIcon: FC<{ class?: string }> = ({ class: extra }) => (
  <svg class={`icon icon--flip ${extra ?? ''}`.trim()} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M5 12h14" />
    <path d="m12 5 7 7-7 7" />
  </svg>
);

export const ExternalIcon: FC<{ class?: string }> = ({ class: extra }) => (
  <svg class={`icon icon--flip icon--small ${extra ?? ''}`.trim()} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M7 7h10v10" />
    <path d="M7 17 17 7" />
  </svg>
);

/** The feed mark, which flips in Persian like the arrows. */
export const FeedIcon: FC = () => (
  <svg class="icon icon--flip icon--small" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M4 11a9 9 0 0 1 9 9" />
    <path d="M4 4a16 16 0 0 1 16 16" />
    <circle cx="5" cy="19" r="1" />
  </svg>
);
