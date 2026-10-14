// Small pieces every screen shares: the page header, a notice, a dialog, and
// the device's name. No state library and no router: the admin is a handful of
// screens, and Preact's own state is enough.
import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { copy } from './copy.ts';

/**
 * What to call this device by default (F3), from what the browser says it is.
 * It is only a suggested name for a field the person can change, so a wrong
 * guess costs one edit.
 */
export function deviceWord(): 'phone' | 'tablet' | 'computer' {
  const ua = navigator.userAgent;
  if (/iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return 'tablet';
  if (/iPhone|iPod|Android|Mobile/i.test(ua)) return 'phone';
  return 'computer';
}

/** The wordmark and the way back to the public site. The sign-in view has the eyes below it; no other view has them (HIG #9). */
export function Header({ signedIn }: { signedIn?: boolean }) {
  return (
    <header class="admin-header">
      <a class="wordmark" href="/">
        {copy.site.name}
      </a>
      {signedIn ? (
        <a class="admin-link" href="/">
          {copy.site.view}
        </a>
      ) : null}
    </header>
  );
}

/** A screen's heading takes focus when the screen appears, so a keyboard or screen-reader user starts at its top. */
export function Heading({ id, children }: { id?: string; children: ComponentChildren }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <h1 class="title" id={id} tabIndex={-1} ref={ref}>
      {children}
    </h1>
  );
}

type NoticeKind = 'success' | 'error' | 'neutral';

/**
 * A message in place. Errors are announced at once (`alert`); the rest wait for
 * a pause (`status`). A cancelled passkey sheet is neutral, not an error (plate 5).
 */
export function Notice({ kind, children }: { kind: NoticeKind; children: ComponentChildren }) {
  return (
    <p class={`notice notice--${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </p>
  );
}

/**
 * A modal dialog on the platform's own `<dialog>`: it traps focus, sits above an
 * inert page, and closes on Escape. It is mounted only while it is open. While
 * `locked`, Escape does nothing, because a passkey sheet is waiting on it.
 */
export function Modal({
  titleId,
  locked = false,
  onCancel,
  children,
}: {
  titleId: string;
  locked?: boolean;
  onCancel: () => void;
  children: ComponentChildren;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const latest = useRef({ locked, onCancel });
  latest.current = { locked, onCancel };

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return undefined;
    if (!dialog.open) dialog.showModal();
    const onEscape = (event: Event) => {
      event.preventDefault();
      if (!latest.current.locked) latest.current.onCancel();
    };
    dialog.addEventListener('cancel', onEscape);
    return () => {
      dialog.removeEventListener('cancel', onEscape);
      if (dialog.open) dialog.close();
    };
  }, []);

  return (
    <dialog class="modal" ref={ref} aria-labelledby={titleId}>
      {children}
    </dialog>
  );
}
