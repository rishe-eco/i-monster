// What the entry editor and the episode form share (plan B6, B7, S-19): one write at a time, its
// failures, and signing in over the text; the language control; the notices and the dialog that
// say a text is kept, set aside or about to be dropped. Nothing here knows what is being written: the
// callers send, and say in their own words what happened.
//
// Nothing is lost (AC-16, AC-43, PD-12). A failed write says plainly that it did not happen, keeps the
// text where it is, and waits for a tap: nothing is sent again by itself. A session that ended is
// signed back in over the text, once, and never in a loop (W6, J3.4).
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { dirOf, type Lang } from '../lib/i18n.ts';
import { limits } from '../lib/limits.ts';
import type { Code, Result, SessionInfo } from './api.ts';
import { copy, refusals } from './copy.ts';
import { Runs } from './doc.tsx';
import { signIn } from './passkey.ts';
import { Modal, Notice } from './ui.tsx';

/** What a person can ask a form to do. It decides the label, the copy of a failure, and what is sent. */
export type Action = 'publish' | 'save' | 'saveDraft' | 'unpublish';

/** A UUID for a new composition's publish key (PD-11). `randomUUID` needs a secure context; the fallback builds the same thing from random bytes. */
export function newKey(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ── Writing: one write at a time, its failures, and signing in over the text ──

interface Failure {
  action: Action;
  code: Code;
}

/** Failures that wait for a tap: the one button that carries on is still right there. */
export const NEEDS_TAP = new Set<Code>(['NETWORK', 'UNEXPECTED', 'CSRF_INVALID', 'ORIGIN_REFUSED']);

/** Failures that leave it unknown whether the server made the row: the request may have landed and only the answer been lost. */
export const UNANSWERED = new Set<Code>(['NETWORK', 'UNEXPECTED']);

/**
 * The state every write shares. `attempt` runs one write, once: a second call while one is in flight
 * does nothing (a double tap is one write). `signInHere` is the passkey sign-in, run over the form:
 * not re-authentication, which needs a live session and answers 401 when there is none.
 */
export function useWriter(onSession: (session: SessionInfo) => void) {
  const [busy, setBusy] = useState<Action | 'signin' | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [signInProblem, setSignInProblem] = useState<Code | null>(null);
  const running = useRef(false);

  const clear = () => {
    setFailure(null);
    setSignInProblem(null);
  };

  /**
   * The person changed the text. A refusal about the text is stale now and goes. But "not published" and "not saved" stay:
   * they are still true until a write succeeds, and the button that carries on is still right there.
   */
  const edited = () => {
    setFailure((current) => (current && (current.code === 'UNAUTHENTICATED' || NEEDS_TAP.has(current.code)) ? current : null));
    setSignInProblem(null);
  };

  const attempt = async <T extends Result<unknown>>(action: Action, send: () => Promise<T>): Promise<T | null> => {
    // Synchronous, so a second tap in the same frame finds this one still running: one tap, one write.
    if (running.current) return null;
    running.current = true;
    setBusy(action);
    clear();
    const result = await send();
    running.current = false;
    setBusy(null);
    if (!result.ok) setFailure({ action, code: result.code });
    return result;
  };

  const signInHere = async (): Promise<boolean> => {
    if (running.current) return false;
    running.current = true;
    setBusy('signin');
    setSignInProblem(null);
    const result = await signIn();
    running.current = false;
    setBusy(null);
    if (result.ok) {
      // The new session and its CSRF token are in place; the caller learns of them so "this device" stays right.
      onSession(result.data);
      return true;
    }
    setSignInProblem(result.code);
    return false;
  };

  return { busy, failure, signInProblem, clear, edited, attempt, signInHere };
}

export type Writer = ReturnType<typeof useWriter>;

/** The words of a failure, in one kind's own terms: an entry's "text" is an episode's "everything you typed". */
export interface FailureWords {
  heads: { publish: string; save: string; unpublish: string };
  network: { text: string; edit: string; stillLive: string; notKept: string };
  signedOut: string;
  retry: string;
  signInAnd: { publish: string; save: string; unpublish: string };
  /** What a refusal says for this kind, where the one message every kind shares would be wrong. */
  refusals?: Partial<Record<Code, string>>;
}

/**
 * A failure, in the one place the eye already is: just above the actions (W5). It says first that the
 * thing did not happen, then what is true of the text, then the one button that carries on. The form
 * is still editable; nothing here sends again by itself.
 */
export function FailureNotice({
  writer,
  words,
  kept,
  atField,
  onRetry,
  onSignIn,
}: {
  writer: Writer;
  words: FailureWords;
  kept: boolean;
  /** A refusal the form says at its own field, so this notice stays quiet for it (a date after today). */
  atField?: Code;
  onRetry: () => void;
  onSignIn: () => void;
}) {
  const { failure: raised, signInProblem, busy } = writer;
  const failure = raised && raised.code === atField ? null : raised;
  const t = words;
  if (!failure && !signInProblem) return null;
  const action = failure?.action;
  const head = action === 'publish' ? t.heads.publish : action === 'unpublish' ? t.heads.unpublish : t.heads.save;
  let body = '';
  if (failure?.code === 'NETWORK') {
    if (action === 'unpublish') body = t.network.stillLive;
    else if (!kept) body = t.network.notKept;
    else body = action === 'save' ? t.network.edit : t.network.text;
  } else if (failure?.code === 'UNAUTHENTICATED') {
    body = t.signedOut;
  } else if (failure) {
    body = t.refusals?.[failure.code] ?? refusals[failure.code];
  }
  const signInLabel = action === 'publish' ? t.signInAnd.publish : action === 'unpublish' ? t.signInAnd.unpublish : t.signInAnd.save;
  return (
    <>
      {failure ? (
        <div class="notice notice--error failure" role="alert">
          <p>
            {failure.code === 'BODY_REQUIRED' ? null : <strong>{head} </strong>}
            {body}
          </p>
          {failure.code === 'UNAUTHENTICATED' ? (
            <button type="button" class="btn btn--primary" disabled={busy !== null} onClick={onSignIn}>
              {signInLabel}
            </button>
          ) : NEEDS_TAP.has(failure.code) ? (
            <button type="button" class="btn" disabled={busy !== null} onClick={onRetry}>
              {t.retry}
            </button>
          ) : null}
        </div>
      ) : null}
      {busy === 'signin' ? <Notice kind="neutral">{copy.signIn.waiting}</Notice> : null}
      {signInProblem === 'CANCELLED' ? <Notice kind="neutral">{copy.signIn.cancelled}</Notice> : null}
      {signInProblem && signInProblem !== 'CANCELLED' ? <Notice kind="error">{refusals[signInProblem]}</Notice> : null}
    </>
  );
}

// ── Pieces both forms share ──

/** The language, two options. `name` keeps this control's radios a group of their own when two forms are on the page at once. */
export function LanguageControl({ lang, onChange, locked, name }: { lang: Lang; onChange: (lang: Lang) => void; locked: boolean; name: string }) {
  const t = copy.editor;
  return (
    <fieldset class="segmented" disabled={locked}>
      <legend class="field__label">{t.language}</legend>
      <div class="segmented__options">
        {(['en', 'fa'] as const).map((option) => (
          <label class="segmented__option" key={option}>
            <input type="radio" name={name} value={option} checked={lang === option} onChange={() => onChange(option)} />
            <span lang={option}>{option === 'en' ? t.english : t.persian}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** "Published. It's out there.", with where it is, and Open and Copy link (J1.9; F16: Copy link says "Copied" for a moment, then goes back). */
export function PublishedNotice({ path, head }: { path: string; head: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const where = useRef<HTMLSpanElement>(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const t = copy.editor.published;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${location.origin}${path}`);
    } catch {
      // No clipboard here, or it was refused: select the address so the person can copy it by hand.
      if (where.current) window.getSelection()?.selectAllChildren(where.current);
      return;
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), limits.copiedMs);
  };

  return (
    <div class="notice notice--success published" role="status">
      <strong>{head}</strong>
      <span class="published__where" dir="ltr" ref={where}>
        {location.host}
        {path}
      </span>
      <span class="published__actions">
        <a class="btn" href={path}>
          {t.open}
        </a>
        <button type="button" class="btn" onClick={() => void copyLink()}>
          {copied ? t.copied : t.copy}
        </button>
      </span>
      {/* Said politely, so a screen reader hears "Copied" without it taking focus. */}
      <span class="visually-hidden" aria-live="polite">
        {copied ? t.copied : ''}
      </span>
    </div>
  );
}

/** A confirmation with its first words in bold: "Saved." and what it means. */
export function Said({ head, body }: { head: string; body: string }) {
  return (
    <Notice kind="success">
      <strong>{head}</strong> {body}
    </Notice>
  );
}

/** The language of some words, by their script: Persian when more of the letters are Arabic-script than Latin. For a buffer that kept no language. */
export function guessLang(text: string): Lang {
  const arabic = (text.match(/[\u0600-\u06FF]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  return arabic > latin ? 'fa' : 'en';
}

/**
 * What a kept text is called, so an offer says which text Put it back restores (PL-7): in the text's own language and
 * direction whatever the admin's is, with the runs of the other script isolated. `placeholder` is a name the text
 * doesn't have yet ("No name yet"), drawn quieter.
 */
export function OfferName({ text, lang, placeholder = false }: { text: string; lang: Lang; placeholder?: boolean }) {
  return (
    <p class={placeholder ? 'offer__name offer__name--placeholder' : 'offer__name'} lang={lang} dir={dirOf(lang)}>
      {placeholder ? text : <Runs text={text} lang={lang} />}
    </p>
  );
}

/** A notice about text that is set aside or found again, with the choices it offers, and the name of the text when there is one. */
export function Offer({ head, body, name, children }: { head: string; body: string; name?: ComponentChildren; children?: ComponentChildren }) {
  return (
    <div class="notice notice--neutral offer" role="status">
      <p>
        <strong>{head}</strong> {body}
      </p>
      {name}
      {children ? <div class="offer__actions">{children}</div> : null}
    </div>
  );
}

/** Discard asks once more: the text is only on this phone, and it can't come back. */
export function DiscardDialog({ onKeep, onDiscard }: { onKeep: () => void; onDiscard: () => void }) {
  const t = copy.editor.discardDialog;
  return (
    <Modal titleId="discard-title" onCancel={onKeep}>
      <h2 class="modal__title" id="discard-title">
        {t.title}
      </h2>
      <p class="modal__body">{t.body}</p>
      <div class="modal__actions">
        <button type="button" class="btn" onClick={onKeep}>
          {t.keep}
        </button>
        <button type="button" class="btn" onClick={onDiscard}>
          {t.discard}
        </button>
      </div>
    </Modal>
  );
}
