// The wordmark's reveal and the eyes (plan B9; design: Components, Wordmark and eyes).
// Plain browser JavaScript with no dependencies, served hashed like any asset and loaded
// with `<script defer src>` by the public pages and the admin's shell. It sets no
// attribute named `style`: pupils move through the CSSOM, which the CSP allows (PD-18).
(() => {
  'use strict';

  // First line of work: with reduced motion asked for, bind nothing at all (AC-38). The CSS
  // kill-switch in base.css covers the rest, so the page shows its final state.
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  // ── The eyes follow the pointer ──
  // One listener on the window, one update per animation frame. The eyes are looked up at
  // move time, so eyes the admin's bundle draws after this script ran follow the pointer too.
  let latest = null;
  let frame = 0;

  function lookAt(x, y) {
    for (const eye of document.querySelectorAll('[data-eye]')) {
      const pupil = eye.firstElementChild;
      if (!pupil) continue;
      const box = eye.getBoundingClientRect();
      const dx = x - (box.left + box.width / 2);
      const dy = y - (box.top + box.height / 2);
      const angle = Math.atan2(dy, dx);
      // The design's own numbers: the pupil leans a fortieth of the distance, never past a fifth of the eye.
      const reach = Math.min(box.width * 0.2, Math.hypot(dx, dy) / 40);
      pupil.style.setProperty('--eye-x', `${Math.cos(angle) * reach}px`);
      pupil.style.setProperty('--eye-y', `${Math.sin(angle) * reach}px`);
    }
  }

  window.addEventListener(
    'pointermove',
    (event) => {
      latest = event;
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        if (latest) lookAt(latest.clientX, latest.clientY);
        latest = null;
      });
    },
    { passive: true },
  );

  // ── The wordmark's reveal, on the landing hero only ──
  // Everywhere else the wordmark is a plain link and a tap navigates; CSS reveals the letters
  // on hover and focus. The hero's link is the page you are on, so a tap there reveals instead.
  const hero = document.querySelector('[data-intro]');
  const mark = hero && hero.querySelector('.wordmark');
  if (!mark) return;

  // The intro: the letters appear 0.9s after load and go again at 2.9s, once.
  let tapped = false;
  const on = window.setTimeout(() => {
    if (!tapped) mark.classList.add('is-revealed');
  }, 900);
  const off = window.setTimeout(() => {
    if (!tapped) mark.classList.remove('is-revealed');
  }, 2900);

  // What pressed the link is read from its `pointerdown`, not from the click: Safari before 18.2 gives
  // a click no `pointerType`, and later versions call a tap "mouse" there (WebKit bug 282988), so an
  // iPhone's tap would do nothing. A keyboard's Enter has no pointerdown, so it is never a tap.
  let pressedBy = '';
  mark.addEventListener('pointerdown', (event) => {
    pressedBy = event.pointerType;
  });

  mark.addEventListener('click', (event) => {
    // The link points at this very page: following it would only reload.
    event.preventDefault();
    const by = pressedBy;
    pressedBy = '';
    // A mouse already has hover and a keyboard has focus; a finger or a pen has neither.
    if (by !== 'touch' && by !== 'pen') return;
    // A tap takes over from the intro, so the intro's timer never hides what the person asked to see.
    tapped = true;
    window.clearTimeout(on);
    window.clearTimeout(off);
    mark.classList.toggle('is-revealed');
  });
})();
