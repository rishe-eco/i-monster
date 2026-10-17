// The admin's screens and how they follow one another (plan B4b, PD-21):
//   /admin/setup/<code>  → Setup, then the shell, signed in
//   /admin               → the session decides: sign-in, or the shell
//   the shell            → the editor's slot, Entries, Podcast (B7), Passkeys, Sign out
// There is no router: two paths, and the rest is state.
import { useEffect, useRef, useState } from 'preact/hooks';
import { api, forgetSession, whenSignedOut, type Code, type SessionInfo } from './api.ts';
import { copy, refusals } from './copy.ts';
import { browserStorage } from './browser-storage.ts';
import { createBuffers, type EditBuffer } from './buffers.ts';
import { EditOffer, EntryFrame, LeaveDialog, NewEntry, type Returned } from './composer.tsx';
import { EntriesSection } from './entries.tsx';
import { PasskeysSection } from './passkeys.tsx';
import { ReauthHost } from './reauth.tsx';
import { SignIn } from './signin.tsx';
import { Setup } from './setup.tsx';
import { Header, Heading, Notice } from './ui.tsx';

type Screen =
  | { kind: 'loading' }
  | { kind: 'signin'; ended: boolean }
  | { kind: 'setup'; code: string }
  | { kind: 'home'; session: SessionInfo; welcome: string | null }
  /** This device's own passkey was removed (J3.11): there is nothing to sign in with here any more. */
  | { kind: 'removed'; name: string };

/** The code in `/admin/setup/<code>`, or null on any other path. */
function setupCode(): string | null {
  const match = /^\/admin\/setup\/([^/]+)\/?$/.exec(location.pathname);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export function App() {
  const [screen, setScreen] = useState<Screen>(() => {
    const code = setupCode();
    return code === null ? { kind: 'loading' } : { kind: 'setup', code };
  });

  useEffect(() => {
    const handler = () => {
      forgetSession();
      setScreen({ kind: 'signin', ended: true });
    };
    if (setupCode() !== null) {
      whenSignedOut(handler);
      return () => whenSignedOut(null);
    }
    let live = true;
    void api<SessionInfo>('GET', 'session').then((result) => {
      if (!live) return;
      // A 401 here is the ordinary signed-out state, not an ended session, so it says nothing.
      if (result.ok) setScreen({ kind: 'home', session: result.data, welcome: null });
      else setScreen({ kind: 'signin', ended: false });
      // From here on, any call that finds the session gone sends the person to sign in, wherever they are.
      whenSignedOut(handler);
    });
    return () => {
      live = false;
      whenSignedOut(null);
    };
  }, []);

  const signedIn = (session: SessionInfo, welcome: string | null = null) => {
    // The setup link's code has done its work: leave it out of the address bar and the history.
    if (location.pathname !== '/admin') history.replaceState(null, '', '/admin');
    setScreen({ kind: 'home', session, welcome });
  };

  let view;
  switch (screen.kind) {
    case 'loading':
      view = null;
      break;
    case 'signin':
      view = <SignIn ended={screen.ended} onSignedIn={(session) => signedIn(session)} />;
      break;
    case 'setup':
      view = <Setup code={screen.code} onRegistered={(session, device) => signedIn(session, copy.setup.done(device))} />;
      break;
    case 'removed':
      view = <Removed name={screen.name} />;
      break;
    case 'home':
      view = (
        <Home
          session={screen.session}
          welcome={screen.welcome}
          onSignedOut={() => {
            forgetSession();
            setScreen({ kind: 'signin', ended: false });
          }}
          onRemovedHere={(name) => {
            forgetSession();
            setScreen({ kind: 'removed', name });
          }}
          onSessionEnded={() => {
            forgetSession();
            setScreen({ kind: 'signin', ended: true });
          }}
          // The editor signed in again over the text (W6): the new session replaces the old one here, so "this device" stays right.
          onSessionRenewed={(renewed) => setScreen((current) => (current.kind === 'home' ? { ...current, session: renewed } : current))}
        />
      );
      break;
  }

  return (
    <>
      {view}
      <ReauthHost />
    </>
  );
}

function Home({
  session,
  welcome,
  onSignedOut,
  onRemovedHere,
  onSessionEnded,
  onSessionRenewed,
}: {
  session: SessionInfo;
  welcome: string | null;
  onSignedOut: () => void;
  onRemovedHere: (name: string) => void;
  onSessionEnded: () => void;
  onSessionRenewed: (session: SessionInfo) => void;
}) {
  const [signingOut, setSigningOut] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState<Code | null>(null);
  // The entry open in the editor's slot, if any; and a counter the list watches, so it reads again after the frame changed an entry.
  const [editing, setEditing] = useState<{ id: string; resume: EditBuffer | null; keptNote: boolean } | null>(null);
  const [entriesChanged, setEntriesChanged] = useState(0);

  // The three text buffers (PD-12). The page has just opened, so unsent text found in the buffer is set aside:
  // it is offered back, and typing in the empty editor can't write over it (J3.3).
  const [buffers] = useState(() => createBuffers(browserStorage(), 'entry'));
  const [opened] = useState(() => buffers.apply({ type: 'opened' }).snapshot);
  // Changes to an entry that were left in the edit buffer, offered back until they are put back or discarded.
  const [editOffer, setEditOffer] = useState<EditBuffer | null>(opened.edit);
  // What the last edit leaves to say above the new entry: set-aside text came back (AC-43), and what the edit did.
  const [returned, setReturned] = useState<Returned | null>(null);
  // An action that would leave an edit with unsaved changes waits here for the person's word.
  const [leaving, setLeaving] = useState<(() => void) | null>(null);
  const unsaved = useRef(false);

  const startEdit = (id: string, resume: EditBuffer | null = null) => {
    // Unsent text, if there is any, is set aside before the entry opens, and says so (AC-43).
    const snapshot = buffers.apply({ type: 'edit-started' }).snapshot;
    unsaved.current = false;
    setReturned(null);
    setEditing({ id, resume, keptNote: snapshot.kept.length > 0 });
  };

  /** Run `then` now, or after the person has said they mean to leave changes that are not saved. */
  const guard = (then: () => void) => {
    if (unsaved.current || editOffer) setLeaving(() => then);
    else then();
  };

  const closeFrame = () => {
    const keptBefore = buffers.read().kept.length > 0;
    const snapshot = buffers.apply({ type: 'edit-cancelled' }).snapshot;
    unsaved.current = false;
    setEditing(null);
    // What was set aside comes back into the editor, and says so.
    setReturned({ restored: keptBefore && snapshot.unsent !== null, said: null });
  };

  const signOut = async () => {
    setSigningOut(true);
    setSignOutFailed(null);
    const result = await api('POST', 'auth/signout', {});
    // A 401 means the session had already ended. Any other failure (the network, a refused
    // token) may leave it alive on the server, so the screen must not claim it is signed out.
    if (!result.ok && result.code !== 'UNAUTHENTICATED') {
      setSigningOut(false);
      setSignOutFailed(result.code);
      return;
    }
    onSignedOut();
  };

  return (
    <main class="screen screen--wide">
      <Header signedIn />
      {welcome ? <Notice kind="success">{welcome}</Notice> : null}
      {/* W1 order. The editor's slot: the editor is first, empty, whenever nothing is being edited; Edit puts an entry in the same editor, in its frame. */}
      {editOffer && !editing ? (
        <EditOffer
          onPut={() => {
            setEditOffer(null);
            startEdit(editOffer.id, editOffer);
          }}
          onDiscard={() => {
            buffers.apply({ type: 'discarded', which: 'edit' });
            setEditOffer(null);
          }}
        />
      ) : null}
      {editing ? (
        <EntryFrame
          key={editing.id}
          id={editing.id}
          buffers={buffers}
          resume={editing.resume}
          keptNote={editing.keptNote}
          onCancel={() => guard(closeFrame)}
          onDone={(said) => {
            unsaved.current = false;
            setEditing(null);
            setReturned({ restored: buffers.read().unsent !== null, said });
          }}
          onChanged={() => setEntriesChanged((n) => n + 1)}
          onSession={onSessionRenewed}
          onDirty={(dirty) => {
            unsaved.current = dirty;
          }}
        />
      ) : (
        <NewEntry buffers={buffers} returned={returned} onChanged={() => setEntriesChanged((n) => n + 1)} onSession={onSessionRenewed} />
      )}
      <EntriesSection onEdit={(id) => guard(() => startEdit(id))} refreshKey={entriesChanged} />
      {/* The Podcast section comes here in B7: it draws nothing until it exists. */}
      <PasskeysSection session={session} onRemovedHere={onRemovedHere} onSessionEnded={onSessionEnded} />
      {leaving ? (
        <LeaveDialog
          onStay={() => setLeaving(null)}
          onLeave={() => {
            const then = leaving;
            setLeaving(null);
            // The changes are dropped by the person's own word, the one way an edit's text is ever let go.
            if (editOffer) {
              buffers.apply({ type: 'discarded', which: 'edit' });
              setEditOffer(null);
            }
            if (editing) buffers.apply({ type: 'edit-cancelled' });
            unsaved.current = false;
            then();
          }}
        />
      ) : null}
      <div class="section section--last">
        {signOutFailed ? <Notice kind="error">{refusals[signOutFailed]}</Notice> : null}
        <button type="button" class="btn btn--quiet" disabled={signingOut} onClick={() => void signOut()}>
          {copy.signOut}
        </button>
      </div>
    </main>
  );
}

/** After removing this device's own passkey (J3.11, plate 12). It needs no session. */
function Removed({ name }: { name: string }) {
  return (
    <main class="screen">
      <Header />
      <Heading>{copy.removed.title}</Heading>
      <p class="lede">{copy.removed.body(name)}</p>
      <a class="btn btn--block" href="/">
        {copy.site.view}
      </a>
    </main>
  );
}
