// Every word the admin shows, in English, in one file (house rule 3; spec §4.5:
// the admin is English only). The server sends codes, never prose, so the
// refusals are keyed by those codes; a code with no message here fails to compile.
// The words come from the 4b design's plates 5, 6, 10, 12 and 15.
import { limits } from '../lib/limits.ts';
import type { Code } from './api.ts';

const minutes = (ms: number) => `${ms / 60_000} minutes`;

/** One message per refusal or client code. */
export const refusals: Record<Code, string> = {
  UNAUTHENTICATED: 'You were signed out. Sign in to carry on.',
  CSRF_INVALID: 'That was refused. Reload this page and try again.',
  ORIGIN_REFUSED: 'That was refused. Reload this page and try again.',
  REAUTH_REQUIRED: 'Sign in again to do that.',
  // One message for every sign-in failure, so it never says which part was wrong (AC-11).
  SIGNIN_FAILED: "Sign-in didn't work. Try again.",
  // One message for a code that is used, expired or unknown, naming both ways to recover (F2, AC-20, AC-21).
  CODE_REFUSED:
    "This code can't be used. It works once, and only for a while. Make a new code from a signed-in device, or issue a setup token on the server.",
  REGISTRATION_FAILED: "The passkey wasn't created. Try again.",
  NAME_REQUIRED: 'Give this passkey a name, so you can tell it apart later.',
  REQUEST_INVALID: `That name can't be used. Use up to ${limits.passkeyNameMax} characters, on one line.`,
  LAST_PASSKEY: 'This is the only passkey. Removing it would lock you out.',
  NOT_FOUND: 'That passkey is already gone.',
  NETWORK: "Couldn't reach the server. Check the connection and try again.",
  UNEXPECTED: 'Something went wrong. Try again.',
  // The passkey sheet closing is neutral, not an error; each ceremony says what didn't happen.
  CANCELLED: "Cancelled. Try again when you're ready.",
  // What InvalidStateError means here: the authenticator already holds this site's passkey (PD-17).
  ALREADY_REGISTERED: 'This device already has a passkey for this site.',
  UNSUPPORTED: "This browser can't make or use passkeys.",
};

export const copy = {
  site: { name: 'iMNSTR', view: 'View site' },

  signIn: {
    title: "It's you, right?",
    lede: "This admin has one user. There's nothing to sign up for.",
    button: 'Sign in with a passkey',
    waiting: 'Waiting for the passkey prompt…',
    // After repeated failures the button waits, then comes back (plate 6). No number of tries is shown.
    pause: 'Try again in a moment',
    pauseNote: 'After repeated failures the button waits, then comes back.',
    cancelled: "Not signed in. Try again when you're ready.",
    eyes: 'The eyes',
  },

  setup: {
    title: 'Register this device',
    tokenLede: (device: string) => `This ${device} will sign in to the admin with a passkey. There's no password, ever.`,
    enrolLede: 'Another signed-in device made this code. No server needed.',
    codeLabel: 'Setup token or code',
    tokenHint: `Filled in from the link. Works once, within ${minutes(limits.setupTokenMs)}.`,
    enrolHint: `Filled in from the link. Works once, for ${minutes(limits.enrolmentCodeMs)}.`,
    nameLabel: 'Name this passkey',
    nameHint: 'So you can tell it apart later. Change it if you like.',
    button: (device: string) => `Create a passkey on this ${device}`,
    waiting: 'Waiting for the passkey prompt…',
    cancelled: "Not created. Try again when you're ready.",
    done: (device: string) => `Passkey created. You're signed in on this ${device}.`,
  },

  home: {
    // The pointer shows only while one passkey exists: a step to take, not a count (plate 6).
    next: "Next: add your other device, so losing this one never locks you out.",
  },

  passkeys: {
    title: 'Passkeys',
    thisDevice: 'this device',
    added: (date: string) => `added ${date}`,
    remove: 'Remove',
    removing: 'Removing…',
    // W8: why the last passkey has no Remove.
    lastNote: 'Any passkey can be removed while another exists. The last one has no Remove: that would lock you out.',
    addHere: 'Add a passkey on this device',
    enrol: 'Enrol another device',
    loadFailed: "Couldn't load the passkeys.",
    retry: 'Try again',
    add: {
      title: 'Add a passkey on this device',
      nameLabel: 'Name this passkey',
      nameHint: 'So you can tell it apart later.',
      create: 'Create the passkey',
      waiting: 'Waiting for the passkey prompt…',
      cancel: 'Cancel',
      added: (name: string) => `Passkey "${name}" added.`,
    },
    removeDialog: {
      title: (name: string) => `Remove "${name}"?`,
      other: "It won't sign in any more, and anywhere it's signed in now is signed out at once.",
      own: "It's this device. This device signs out at once and can't sign in again. Your other passkey still signs in.",
      confirm: 'Remove',
      cancel: 'Cancel',
      removed: (name: string) => `Passkey "${name}" removed.`,
    },
    enrolPanel: {
      title: 'Enrol a new device',
      issuing: 'Making a code…',
      lede: `On the new device, scan this code or open the link. It works once, for the next ${minutes(limits.enrolmentCodeMs)}. No server needed.`,
      qrAlt: 'QR code that opens the enrolment link',
      codeLabel: 'Code',
      linkLabel: 'Link',
      copy: 'Copy link',
      copied: 'Copied',
      // When the code's life is up, by the clock (F2). The link and the QR stop being shown.
      expired: 'Expired. Make a new code.',
      again: 'Make a new code',
      done: 'Done',
      serverNote: 'If both devices are lost, the server route still works: issue a setup token and start again. No content is touched.',
    },
    // AC-24: the one-time check, kept until it is dismissed.
    independence: {
      title: 'Check that your passkeys are independent',
      body: 'Before launch: remove one, sign in with the other, then add it back. If both stop working, they were one synced passkey.',
      refusal:
        'If adding a passkey on a second device is refused with "This device already has a passkey for this site", the two devices share one synced passkey. That is the same signal, so use a device or a provider that keeps its own.',
      dismiss: 'Dismiss this note',
    },
  },

  reauth: {
    title: "Show it's you",
    // The default reason; B6 passes its own for an in-place sign-in.
    reason: 'Sign in again before changing passkeys.',
    button: 'Sign in again',
    waiting: 'Waiting for the passkey prompt…',
    cancel: 'Cancel',
    cancelled: "Not signed in. Try again when you're ready.",
  },

  removed: {
    title: 'Signed out',
    body: (name: string) => `Passkey "${name}" removed. This device can't sign in any more.`,
  },

  signOut: 'Sign out',
} as const;
