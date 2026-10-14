// `/admin/setup/<code>` (plates 5 and 12): the code from the link, a name for the
// passkey, and one button. The same view serves the setup token from the server
// CLI (the first passkey) and an enrolment code from a signed-in device (a new
// one). The code is read from the path and the page then leaves it behind: on
// success the address becomes `/admin`, so the code isn't left in the history.
import { useState } from 'preact/hooks';
import { limits } from '../lib/limits.ts';
import type { SessionInfo } from './api.ts';
import { copy, refusals } from './copy.ts';
import { nameProblem, registerWithCode } from './passkey.ts';
import { Header, Heading, Notice, deviceWord } from './ui.tsx';

/** An enrolment code is three groups of four, as the server writes it; a setup token is far longer. */
const looksLikeEnrolmentCode = (value: string) => /^[0-9A-Za-z]{4}-[0-9A-Za-z]{4}-[0-9A-Za-z]{4}$/.test(value.trim());

type Message = { kind: 'error' | 'neutral'; text: string };

export function Setup({ code: fromLink, onRegistered }: { code: string; onRegistered: (session: SessionInfo, device: string) => void }) {
  const device = deviceWord();
  const [code, setCode] = useState(fromLink);
  const [name, setName] = useState<string>(device);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const enrol = looksLikeEnrolmentCode(code);

  const submit = async (event: Event) => {
    event.preventDefault();
    setMessage(null);
    const problem = nameProblem(name);
    if (problem) return setMessage({ kind: 'error', text: refusals[problem] });
    setBusy(true);
    const result = await registerWithCode(code.trim(), name);
    if (result.ok) return onRegistered(result.data, device);
    setBusy(false);
    setMessage(
      result.code === 'CANCELLED'
        ? { kind: 'neutral', text: copy.setup.cancelled }
        : { kind: 'error', text: refusals[result.code] },
    );
  };

  return (
    <main class="screen">
      <Header />
      <Heading>{copy.setup.title}</Heading>
      <p class="lede">{enrol ? copy.setup.enrolLede : copy.setup.tokenLede(device)}</p>
      {/* While the passkey sheet is open the page behind is inert and says what it is waiting for. */}
      <form onSubmit={submit} noValidate inert={busy}>
        <div class="field">
          <label class="field__label" for="setup-code">
            {copy.setup.codeLabel}
          </label>
          <input
            class="field__input field__input--code"
            id="setup-code"
            type="text"
            value={code}
            onInput={(event) => setCode(event.currentTarget.value)}
            autocomplete="off"
            autocapitalize="off"
            spellcheck={false}
            aria-describedby="setup-code-hint"
          />
          <p class="hint" id="setup-code-hint">
            {enrol ? copy.setup.enrolHint : copy.setup.tokenHint}
          </p>
        </div>
        <div class="field">
          <label class="field__label" for="setup-name">
            {copy.setup.nameLabel}
          </label>
          <input
            class="field__input"
            id="setup-name"
            type="text"
            value={name}
            maxLength={limits.passkeyNameMax}
            onInput={(event) => setName(event.currentTarget.value)}
            autocomplete="off"
            aria-describedby="setup-name-hint"
          />
          <p class="hint" id="setup-name-hint">
            {copy.setup.nameHint}
          </p>
        </div>
        {message ? <Notice kind={message.kind}>{message.text}</Notice> : null}
        <button type="submit" class="btn btn--primary btn--block">
          {copy.setup.button(device)}
        </button>
      </form>
      {busy ? <Notice kind="neutral">{copy.setup.waiting}</Notice> : null}
    </main>
  );
}
