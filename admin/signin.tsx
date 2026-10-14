// The sign-in view (plate 6): one button, no username, no password field (AC-9).
// This is the one admin view with the eyes, since it is the one seen most.
import { useEffect, useRef, useState } from 'preact/hooks';
import { limits } from '../lib/limits.ts';
import type { SessionInfo } from './api.ts';
import { copy, refusals } from './copy.ts';
import { signIn } from './passkey.ts';
import { Header, Heading, Notice } from './ui.tsx';

/** Failures in a row, here in this view, after which the button waits. Never shown. */
const PAUSE_AFTER = 3;

type Message = { kind: 'error' | 'neutral'; text: string };

export function SignIn({ ended, onSignedIn }: { ended: boolean; onSignedIn: (session: SessionInfo) => void }) {
  const [busy, setBusy] = useState(false);
  const [paused, setPaused] = useState(false);
  const [message, setMessage] = useState<Message | null>(ended ? { kind: 'neutral', text: refusals.UNAUTHENTICATED } : null);
  const failures = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const submit = async (event: Event) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const result = await signIn();
    if (result.ok) return onSignedIn(result.data);
    setBusy(false);
    if (result.code === 'CANCELLED') return setMessage({ kind: 'neutral', text: copy.signIn.cancelled });
    setMessage({ kind: 'error', text: refusals[result.code] });
    // The server slows repeated failures down (PD-15). Here that is a button that waits and comes
    // back: it says no number of tries and no time left (house rule 1).
    if (result.code === 'SIGNIN_FAILED' && ++failures.current >= PAUSE_AFTER) {
      setPaused(true);
      timer.current = window.setTimeout(() => setPaused(false), limits.signInPauseMs);
    }
  };

  return (
    <main class="screen">
      <Header />
      {/* B9 brings the eyes' script and motion; until then this is an empty, labelled place for them. */}
      <div class="eyes-slot" id="eyes" role="img" aria-label={copy.signIn.eyes} />
      <Heading>{copy.signIn.title}</Heading>
      <p class="lede">{copy.signIn.lede}</p>
      <form onSubmit={submit}>
        {busy ? <Notice kind="neutral">{copy.signIn.waiting}</Notice> : null}
        {message ? <Notice kind={message.kind}>{message.text}</Notice> : null}
        <button type="submit" class="btn btn--primary btn--block" disabled={busy || paused} aria-busy={busy}>
          {paused ? copy.signIn.pause : copy.signIn.button}
        </button>
        {paused ? <p class="hint">{copy.signIn.pauseNote}</p> : null}
      </form>
    </main>
  );
}
