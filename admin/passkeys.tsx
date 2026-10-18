// The Passkeys section (plates 10, 12 and 15): the list, adding a passkey on
// this device, enrolling another device by code, removing a passkey, and the
// one-time independence note. Every change that needs a fresh sign-in goes
// through `withReauth`, so the dialog appears only when the server asks (AC-11).
import { useEffect, useRef, useState } from 'preact/hooks';
import { formatAdminDay } from '../lib/dates.ts';
import { limits } from '../lib/limits.ts';
import { api, type Code, type EnrolmentCode, type Passkey, type SessionInfo } from './api.ts';
import { copy, refusals } from './copy.ts';
import { nameProblem, registerHere } from './passkey.ts';
import { withReauth } from './reauth.tsx';
import { Modal, Notice, deviceWord, siteTimeZone } from './ui.tsx';

type Message = { kind: 'success' | 'error' | 'neutral'; text: string };
type Panel = 'none' | 'add' | 'enrol';

interface Props {
  session: SessionInfo;
  /** This device's own passkey was removed, so this device is signed out (AC-45). */
  onRemovedHere: (name: string) => void;
  /**
   * The removed passkey opened this session but isn't this device's own: a sign-in from
   * another device's passkey, before this one had its own (AC-22). The session ended, and
   * this device can still sign in with its own passkey.
   */
  onSessionEnded: () => void;
}

export function PasskeysSection({ session, onRemovedHere, onSessionEnded }: Props) {
  const [open, setOpen] = useState(true);
  const [passkeys, setPasskeys] = useState<Passkey[] | null>(null);
  const [loadFailed, setLoadFailed] = useState<Code | null>(null);
  const [panel, setPanel] = useState<Panel>('none');
  const [confirm, setConfirm] = useState<Passkey | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [noteDismissed, setNoteDismissed] = useState(session.independenceNoteDismissed);

  const load = async () => {
    const result = await api<{ passkeys: Passkey[] }>('GET', 'passkeys');
    if (result.ok) {
      setPasskeys(result.data.passkeys);
      setLoadFailed(null);
    } else {
      setLoadFailed(result.code);
    }
  };
  useEffect(() => void load(), []);

  const remove = async (target: Passkey) => {
    setConfirm(null);
    setMessage(null);
    setRemoving(target.id);
    const result = await withReauth(() => api<{ signedOut: boolean }>('DELETE', `passkeys/${encodeURIComponent(target.id)}`));
    setRemoving(null);
    if (!result.ok) {
      setMessage({ kind: result.code === 'REAUTH_REQUIRED' ? 'neutral' : 'error', text: refusals[result.code] });
      return;
    }
    if (result.data.signedOut) return target.thisDevice ? onRemovedHere(target.name) : onSessionEnded();
    setMessage({ kind: 'success', text: copy.passkeys.removeDialog.removed(target.name) });
    await load();
  };

  const dismissNote = async () => {
    const result = await api('POST', 'settings/independence-note/dismiss', {});
    if (result.ok) setNoteDismissed(true);
    else setMessage({ kind: 'error', text: refusals[result.code] });
  };

  const canRemove = passkeys !== null && passkeys.length > 1;
  const zone = siteTimeZone();

  return (
    <section class="section" aria-labelledby="passkeys-heading">
      <h2 class="section__heading" id="passkeys-heading">
        <button type="button" class="disclosure" aria-expanded={open} aria-controls="passkeys-body" onClick={() => setOpen(!open)}>
          <span>{copy.passkeys.title}</span>
          <span aria-hidden="true">{open ? '−' : '+'}</span>
        </button>
      </h2>
      <div id="passkeys-body" hidden={!open}>
        {loadFailed ? (
          <div>
            <Notice kind="error">{copy.passkeys.loadFailed}</Notice>
            <button type="button" class="btn" onClick={() => void load()}>
              {copy.passkeys.retry}
            </button>
          </div>
        ) : null}

        {passkeys && passkeys.length === 1 ? <p class="next">{copy.home.next}</p> : null}

        {passkeys ? (
          <ul class="passkey-list">
            {passkeys.map((passkey) => (
              <li class="passkey">
                <div class="passkey__text">
                  {/* A name is whatever the founder typed, in either script, so it keeps its own direction. */}
                  <bdi class="passkey__name">{passkey.name}</bdi>
                  <span class="passkey__meta">
                    {copy.passkeys.added(formatAdminDay(passkey.addedAt, zone))}
                    {passkey.thisDevice ? ` · ${copy.passkeys.thisDevice}` : ''}
                  </span>
                </div>
                {/* The last passkey has no Remove: that would lock the founder out (AC-23, W8). */}
                {canRemove ? (
                  <button
                    type="button"
                    class="btn btn--quiet"
                    disabled={removing !== null}
                    aria-label={`${copy.passkeys.remove} ${passkey.name}`}
                    onClick={() => setConfirm(passkey)}
                  >
                    {removing === passkey.id ? copy.passkeys.removing : copy.passkeys.remove}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {passkeys ? <p class="hint">{copy.passkeys.lastNote}</p> : null}

        {message ? <Notice kind={message.kind}>{message.text}</Notice> : null}

        {panel === 'none' && passkeys ? (
          <div class="actions">
            <button type="button" class="btn" onClick={() => setPanel('add')}>
              {copy.passkeys.addHere}
            </button>
            <button type="button" class="btn" onClick={() => setPanel('enrol')}>
              {copy.passkeys.enrol}
            </button>
          </div>
        ) : null}

        {panel === 'add' ? (
          <AddPanel
            onCancel={() => setPanel('none')}
            onAdded={(name) => {
              setPanel('none');
              setMessage({ kind: 'success', text: copy.passkeys.add.added(name) });
              void load();
            }}
          />
        ) : null}
        {panel === 'enrol' ? (
          <EnrolPanel
            onClose={() => {
              setPanel('none');
              // Whoever enrolled with the code is in the list now.
              void load();
            }}
          />
        ) : null}

        {!noteDismissed && passkeys ? (
          <aside class="note" aria-labelledby="independence-title">
            <h3 class="note__title" id="independence-title">
              {copy.passkeys.independence.title}
            </h3>
            <p>{copy.passkeys.independence.body}</p>
            <p>{copy.passkeys.independence.refusal}</p>
            <button type="button" class="btn btn--quiet" onClick={() => void dismissNote()}>
              {copy.passkeys.independence.dismiss}
            </button>
          </aside>
        ) : null}
      </div>

      {confirm ? (
        <Modal titleId="remove-title" onCancel={() => setConfirm(null)}>
          <h2 class="modal__title" id="remove-title">
            {copy.passkeys.removeDialog.title(confirm.name)}
          </h2>
          <p class="modal__body">{confirm.thisDevice ? copy.passkeys.removeDialog.own : copy.passkeys.removeDialog.other}</p>
          <div class="modal__actions">
            <button type="button" class="btn btn--primary" onClick={() => void remove(confirm)}>
              {copy.passkeys.removeDialog.confirm}
            </button>
            <button type="button" class="btn" onClick={() => setConfirm(null)}>
              {copy.passkeys.removeDialog.cancel}
            </button>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}

/** Add a passkey on this device: show it's you (only if the server asks), name it, create it (plate 10). */
function AddPanel({ onAdded, onCancel }: { onAdded: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState<string>(deviceWord());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  const submit = async (event: Event) => {
    event.preventDefault();
    setMessage(null);
    const problem = nameProblem(name);
    if (problem) return setMessage({ kind: 'error', text: refusals[problem] });
    setBusy(true);
    const result = await withReauth(() => registerHere(name));
    setBusy(false);
    if (result.ok) return onAdded(name.replace(/\s+/g, ' ').trim());
    // Giving up on a sheet, or on the sign-in dialog, is the person's choice, not a fault.
    const gaveUp = result.code === 'CANCELLED' || result.code === 'REAUTH_REQUIRED';
    setMessage({ kind: gaveUp ? 'neutral' : 'error', text: result.code === 'CANCELLED' ? copy.setup.cancelled : refusals[result.code] });
  };

  return (
    <form class="panel" onSubmit={submit} noValidate inert={busy} aria-labelledby="add-title">
      <h3 class="panel__title" id="add-title">
        {copy.passkeys.add.title}
      </h3>
      <div class="field">
        <label class="field__label" for="add-name">
          {copy.passkeys.add.nameLabel}
        </label>
        <input
          class="field__input"
          id="add-name"
          type="text"
          value={name}
          maxLength={limits.passkeyNameMax}
          onInput={(event) => setName(event.currentTarget.value)}
          autocomplete="off"
          aria-describedby="add-name-hint"
        />
        <p class="hint" id="add-name-hint">
          {copy.passkeys.add.nameHint}
        </p>
      </div>
      {message ? <Notice kind={message.kind}>{message.text}</Notice> : null}
      <div class="actions">
        <button type="submit" class="btn btn--primary">
          {copy.passkeys.add.create}
        </button>
        <button type="button" class="btn" onClick={onCancel}>
          {copy.passkeys.add.cancel}
        </button>
      </div>
      {busy ? <Notice kind="neutral">{copy.passkeys.add.waiting}</Notice> : null}
    </form>
  );
}

type Enrolment = { kind: 'issuing' } | { kind: 'live'; issued: EnrolmentCode } | { kind: 'expired' } | { kind: 'failed'; code: Code };

/**
 * Enrol another device (plate 10, F2): the code, the QR, the link with Copy, and
 * the code's 10-minute life stated in words, with no countdown (house rule 1).
 * When the life is up the code, QR and link are taken away and it says so. The
 * server refuses a dead code whatever this screen shows; this only stops it
 * showing one that won't work.
 */
function EnrolPanel({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<Enrolment>({ kind: 'issuing' });
  const [copied, setCopied] = useState(false);
  const expiry = useRef<number | undefined>(undefined);
  const copiedTimer = useRef<number | undefined>(undefined);
  const link = useRef<HTMLInputElement>(null);

  const issue = async () => {
    clearTimeout(expiry.current);
    setState({ kind: 'issuing' });
    const result = await withReauth(() => api<EnrolmentCode>('POST', 'enrolment-codes', {}));
    if (!result.ok) return setState({ kind: 'failed', code: result.code });
    setState({ kind: 'live', issued: result.data });
    // The code lives ten minutes from the moment the server made it; this fires a round trip after that.
    expiry.current = window.setTimeout(() => setState({ kind: 'expired' }), limits.enrolmentCodeMs);
  };

  useEffect(() => {
    void issue();
    return () => {
      clearTimeout(expiry.current);
      clearTimeout(copiedTimer.current);
    };
  }, []);

  const copyLink = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // No clipboard here (or it was refused): select the link so the person can copy it by hand.
      link.current?.select();
      return;
    }
    setCopied(true);
    clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopied(false), limits.copiedMs);
  };

  const t = copy.passkeys.enrolPanel;
  return (
    <section class="panel" aria-labelledby="enrol-title">
      <h3 class="panel__title" id="enrol-title">
        {t.title}
      </h3>
      {state.kind === 'issuing' ? <p class="hint" role="status">{t.issuing}</p> : null}
      {state.kind === 'failed' ? <Notice kind={state.code === 'REAUTH_REQUIRED' ? 'neutral' : 'error'}>{refusals[state.code]}</Notice> : null}
      {state.kind === 'live' ? (
        <div>
          <p>{t.lede}</p>
          <img class="qr" src={state.issued.qr} alt={t.qrAlt} />
          <p class="code" aria-label={t.codeLabel}>
            {state.issued.code}
          </p>
          <div class="field">
            <label class="field__label" for="enrol-link">
              {t.linkLabel}
            </label>
            <input class="field__input field__input--code" id="enrol-link" type="text" readOnly value={state.issued.link} ref={link} />
          </div>
          <button type="button" class="btn" onClick={() => void copyLink(state.issued.link)}>
            {copied ? t.copied : t.copy}
          </button>
          {/* Said politely, so a screen reader hears "Copied" without it taking focus. */}
          <span class="visually-hidden" role="status">
            {copied ? t.copied : ''}
          </span>
          <p class="hint">{t.serverNote}</p>
        </div>
      ) : null}
      {state.kind === 'expired' ? <Notice kind="neutral">{t.expired}</Notice> : null}
      <div class="actions">
        {state.kind === 'expired' || state.kind === 'failed' ? (
          <button type="button" class="btn btn--primary" onClick={() => void issue()}>
            {t.again}
          </button>
        ) : null}
        <button type="button" class="btn" onClick={onClose}>
          {t.done}
        </button>
      </div>
    </section>
  );
}
