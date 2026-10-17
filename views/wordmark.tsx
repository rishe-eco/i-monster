// The wordmark and the eyes (design: Components, Wordmark and eyes). The wordmark's
// hidden letters (i-MoNSTeR) are real spans that CSS reveals on hover, focus and
// the `.is-revealed` class; `assets/wordmark.js` adds the class for the intro and
// a tap on the landing hero. The letters are `aria-hidden`, and the link's name is
// given outright, so it stays "iMNSTR". No inline script and no style attribute
// (CSP, PD-18): the pupils are moved by that script through the CSSOM.
import type { FC } from 'hono/jsx';

const HIDDEN = (letter: string) => (
  <span class="wordmark__hid" aria-hidden="true">
    {letter}
  </span>
);

/**
 * The wordmark as a link: iMNSTR, with the hyphen and the o and e of i-MoNSTeR waiting inside. The hidden
 * letters are `aria-hidden`, but each is an inline-block, which a browser's name computation sets apart
 * with a space ("i M NST R"). So the name is given outright, in `name`, and a screen reader says the word.
 */
export const Wordmark: FC<{ href: string; name: string; class?: string; current?: boolean }> = ({ href, name, class: extra, current }) => (
  <a class={`wordmark ${extra ?? ''}`.trim()} href={href} aria-label={name} aria-current={current ? 'page' : undefined}>
    <span class="wordmark__text">
      i{HIDDEN('-')}M{HIDDEN('o')}NST{HIDDEN('e')}R
    </span>
  </a>
);

const EYE = (
  <span class="eye" data-eye>
    <span class="eye__pupil" />
  </span>
);

export type EyesSize = 'hero' | 'header' | 'empty' | 'big';

/** Two eyes that blink and follow the pointer. They carry no meaning, so assistive technology skips them. */
export const Eyes: FC<{ size: EyesSize }> = ({ size }) => (
  <span class={`eyes eyes--${size}`} aria-hidden="true">
    {EYE}
    {EYE}
  </span>
);
