// The admin's screens and how they follow one another (plan B4b, PD-21):
//   /admin/setup/<code>  → Setup, then the shell, signed in
//   /admin               → the session decides: sign-in, or the shell
//   the shell            → the editor's slot, Entries, Podcast (B7), Passkeys, Sign out
// There is no router: two paths, and the rest is state.
import { useEffect, useState } from 'preact/hooks';
import { api, forgetSession, whenSignedOut, type Code, type SessionInfo } from './api.ts';
import { copy, refusals } from './copy.ts';
import { EntriesSection, EntryFrame } from './entries.tsx';
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
}: {
  session: SessionInfo;
  welcome: string | null;
  onSignedOut: () => void;
  onRemovedHere: (name: string) => void;
  onSessionEnded: () => void;
}) {
  const [signingOut, setSigningOut] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState<Code | null>(null);
  // The entry open in the editor's slot, if any; and a counter the list watches, so it reads again after the frame changed an entry.
  const [editing, setEditing] = useState<string | null>(null);
  const [entriesChanged, setEntriesChanged] = useState(0);

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
      {/* W1 order. The editor's slot: B5 puts the edit view's frame here, B6 the editor itself, new entries included. */}
      {editing ? <EntryFrame key={editing} id={editing} onClose={() => setEditing(null)} onChanged={() => setEntriesChanged((n) => n + 1)} /> : null}
      <EntriesSection onEdit={setEditing} refreshKey={entriesChanged} />
      {/* The Podcast section comes here in B7: it draws nothing until it exists. */}
      <PasskeysSection session={session} onRemovedHere={onRemovedHere} onSessionEnded={onSessionEnded} />
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
