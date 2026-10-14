// Re-authentication: one dialog, one wrapper, for every action the server
// guards with a fresh sign-in (AC-11). `withReauth` runs the action; if the
// server answers REAUTH_REQUIRED it asks the person to show it's them with a
// passkey, then retries the action once. B6 reuses both for the editor's
// in-place sign-in, so the dialog takes its own reason and knows nothing about
// passkeys.
import { useEffect, useState } from 'preact/hooks';
import type { Result } from './api.ts';
import { copy, refusals } from './copy.ts';
import { reauthenticate } from './passkey.ts';
import { Modal, Notice } from './ui.tsx';

interface Pending {
  reason: string;
  /** True once the person has shown it's them; false if they gave up. */
  settle: (signedIn: boolean) => void;
}

let ask: ((pending: Pending) => void) | null = null;

/**
 * Run `action`. If the server wants a fresh sign-in first, show the dialog and,
 * once the person has signed in again, run the action one more time and answer
 * with that. Cancelling answers with the refusal the first run got.
 */
export async function withReauth<T>(action: () => Promise<Result<T>>, reason: string = copy.reauth.reason): Promise<Result<T>> {
  const first = await action();
  if (first.ok || first.code !== 'REAUTH_REQUIRED' || !ask) return first;
  const open = ask;
  const signedIn = await new Promise<boolean>((settle) => open({ reason, settle }));
  return signedIn ? action() : first;
}

/** Mounted once, beside the screens. It renders nothing until `withReauth` asks. */
export function ReauthHost() {
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'neutral'; text: string } | null>(null);

  useEffect(() => {
    ask = (next) => {
      setMessage(null);
      setPending(next);
    };
    return () => {
      ask = null;
    };
  }, []);

  if (!pending) return null;

  const finish = (signedIn: boolean) => {
    pending.settle(signedIn);
    setPending(null);
    setBusy(false);
  };

  const signInAgain = async () => {
    setBusy(true);
    setMessage(null);
    const result = await reauthenticate();
    if (result.ok) return finish(true);
    // The session itself is gone: the app is already showing the sign-in view.
    if (result.code === 'UNAUTHENTICATED') return finish(false);
    setBusy(false);
    setMessage(
      result.code === 'CANCELLED'
        ? { kind: 'neutral', text: copy.reauth.cancelled }
        : { kind: 'error', text: refusals[result.code] },
    );
  };

  return (
    <Modal titleId="reauth-title" locked={busy} onCancel={() => finish(false)}>
      <h2 class="modal__title" id="reauth-title">
        {copy.reauth.title}
      </h2>
      <p class="modal__body">{pending.reason}</p>
      {busy ? <Notice kind="neutral">{copy.reauth.waiting}</Notice> : null}
      {message ? <Notice kind={message.kind}>{message.text}</Notice> : null}
      <div class="modal__actions">
        <button type="button" class="btn btn--primary" disabled={busy} onClick={signInAgain}>
          {copy.reauth.button}
        </button>
        <button type="button" class="btn" disabled={busy} onClick={() => finish(false)}>
          {copy.reauth.cancel}
        </button>
      </div>
    </Modal>
  );
}
