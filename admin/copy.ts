// Every word the admin shows, in English, in one file (house rule 3; spec §4.5:
// the admin is English only). The server sends codes, never prose, so the
// refusals are keyed by those codes; a code with no message here fails to compile.
// The words come from the 4b design's plates 5, 6, 8, 10, 12 and 15.
import type { Lang } from '../lib/i18n.ts';
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
  BODY_REQUIRED: "There's nothing to save yet. Write something first.",
  DOC_INVALID: "That text can't be saved. Check it for odd characters or a link that isn't a web or email address, then try again.",
  LANG_INVALID: 'Choose a language, English or Persian.',
  // A language is changed only until the first publish: the page, the feed and the link have carried it since (PL-8).
  LANG_FIXED: 'This was published, so its language stays.',
  // An episode's date can't be a day that hasn't come (PL-9).
  DATE_FUTURE: "That day hasn't come yet. Pick today or an earlier day.",
  // What publishing an episode asks for (PD-23), and the one thing a link may not be (AC-17).
  DESCRIPTION_REQUIRED: 'Add a description before publishing.',
  TAGS_ONE_OR_TWO: 'Give the episode one or two tags before publishing.',
  LINK_REQUIRED: 'Add a link to listen before publishing.',
  LINK_NOT_HTTPS: 'A link needs to start with https://. Everything else you typed is still here.',
  LAST_LINK: 'A published episode keeps at least one link. Add the right one, then remove this.',
  // One message for a passkey and an entry alike: the code is the same, and so is what happened.
  NOT_FOUND: "That isn't there any more.",
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

  // Plate 8. Nothing here counts: no total, no "n of m", no time since.
  entries: {
    title: 'Entries',
    empty: 'Entries you write will be listed here.',
    loadFailed: "Couldn't load the entries.",
    retry: 'Try again',
    older: 'Older',
    // A never-published draft has no date (AC-14).
    noDate: '—',
    draft: 'draft',
    wasLive: 'was live',
    persian: 'Persian',
    edit: 'Edit',
    editing: (name: string) => `Edit ${name}`,
    // An untitled entry is called by its opening words, in quotes (J2.6): the entry's own language's quotes,
    // since English quotes around a right-to-left run read as closing the text before it opens.
    opening: (words: string, lang: Lang) => (lang === 'fa' ? `«${words}»` : `“${words}”`),
  },

  // The editor (plates 7, 8, 9, 12, 14): the same one writes a new entry and edits an old one.
  editor: {
    language: 'Language',
    english: 'English',
    // Each language's name in that language, as on the public switch.
    persian: 'فارسی',
    titleLabel: 'Title (optional)',
    // Read by assistive technology only: the plate draws no label over the body, only its prompt (AC-18).
    bodyLabel: 'Entry text',
    placeholder: 'What did you learn? Say it so someone else would get it.',
    toolbar: 'Formatting',
    // HIG #6: the words, not icons.
    link: 'Link',
    highlight: 'Highlight',
    linkAddress: 'Link address',
    removeLink: 'Remove link',
    done: 'Done',
    linkRefused: "That address can't be used. It has to start with https://, http:// or mailto:.",
    linkNeedsSelection: 'Select the words to link first.',
    saveDraft: 'Save draft',
    saved: 'Saved',
    save: 'Save',
    publish: 'Publish',
    publishing: 'Publishing…',
    // "Published. It's out there." with where it is; Copy link turns to "Copied" for a moment (F16).
    published: { head: "Published. It's out there.", open: 'Open', copy: 'Copy link', copied: 'Copied' },
    savedLive: { head: 'Saved.', body: "The live entry shows this now. Its link and date haven't changed." },
    savedDraft: { head: 'Draft saved.', body: "It's in Entries, not on the site. Open it from any signed-in device." },
    // The only draft signal (W7): no count, no words, no "saving…", no "saved 2 min ago".
    kept: 'Kept on this phone',

    // When a write fails, the one fact first: it is not done. The text is kept and still editable (AC-16, W5).
    failure: {
      heads: { publish: 'Not published yet.', save: 'Not saved.', unpublish: 'Not unpublished.' },
      network: {
        text: 'The connection dropped. Your text is kept on this phone.',
        edit: "The connection dropped. Your changes are kept here, and the live entry hasn't changed.",
        stillLive: "It's still live.",
        // The browser refused to store the text, so "kept on this phone" would be untrue.
        notKept: "The connection dropped. Your text is still here, but this browser isn't keeping a copy, so leave this page open.",
      },
      // No reason given: an hour idle is the usual one (typing alone doesn't keep a session alive, J3.4), but the 24 h limit
      // and a passkey removed elsewhere end a session too, and a 401 doesn't say which (the founder's call, F-16).
      signedOut: 'You were signed out. Sign in to finish. Your text stays right here.',
      retry: 'Try again',
      signInAnd: { publish: 'Sign in and publish', save: 'Sign in and save', unpublish: 'Sign in and unpublish' },
    },

    // Nothing unsent is ever dropped (AC-43, J3.3). Each of these is said before anything is replaced.
    left: { head: 'You left something here.', body: "Unsent text from earlier on this phone. It isn't published.", put: 'Put it back', discard: 'Discard' },
    leftEdit: {
      head: 'You left changes here.',
      body: "Edits to an entry, from earlier on this phone. They aren't saved, and the entry hasn't changed.",
      put: 'Put them back',
      discard: 'Discard',
    },
    keptNote: { head: 'Your unsent entry is kept.', body: 'It comes back when you save or cancel here.' },
    back: { head: 'Back to your unsent entry.', body: "It isn't published.", discard: 'Discard' },
    // Discard asks once more.
    discardDialog: {
      title: 'Discard this text?',
      body: "It's only on this phone. Once it's discarded, it can't be brought back.",
      keep: 'Keep it',
      discard: 'Discard',
    },
    leaveDialog: {
      title: 'Leave without saving?',
      body: "The changes to this entry aren't saved yet. If you leave, they're dropped, and the entry stays as it is.",
      stay: 'Keep editing',
      leave: 'Leave',
    },
  },

  // The edit view's frame (plate 8): the editor sits in it.
  entry: {
    editingPublished: (date: string) => `Editing · published ${date}`,
    draftWasLive: (date: string) => `Draft · first published ${date}`,
    draft: 'Draft',
    cancel: 'Cancel',
    loading: 'Opening…',
    loadFailed: "Couldn't open that entry.",
    retry: 'Try again',
    unpublish: 'Unpublish',
    unpublishing: 'Unpublishing…',
    confirm: {
      title: 'Take this entry off the site?',
      body: 'It leaves the log and the feed, and its link stops working. It stays here as a draft.',
      keep: 'Keep it live',
      unpublish: 'Unpublish',
    },
    unpublished: "Unpublished. It's in your entries as a draft.",
    // The date is drawn on the highlighter between the two halves (AC-34, G9).
    republish: {
      before: 'Publishing puts it back at ',
      after: ", its original date. It won't be at the top of the log.",
    },
    published: (date: string) => `Published, at ${date}.`,
  },

  // Plate 11's list and plate 12's populated list. Nothing here counts: "No … yet" is a fact, not a number.
  podcast: {
    title: 'Podcast',
    newEpisode: 'New episode',
    empty: 'No episodes yet.',
    loadFailed: "Couldn't load the episodes.",
    retry: 'Try again',
    older: 'Older',
    // A draft that was never published has no date in the list (AC-14).
    noDate: '—',
    // A draft saved before it was named: the list says so rather than showing a blank.
    noName: 'No name yet',
    draft: 'draft',
    wasLive: 'was live',
    persian: 'Persian',
    edit: 'Edit',
    editing: (name: string) => `Edit ${name}`,
  },

  // The episode form (plates 11 and 12): the same one adds an episode and edits one.
  episode: {
    nameLabel: 'Name',
    descriptionLabel: 'Description',
    tagLabel: 'Tag',
    secondTagLabel: 'Second tag (optional)',
    dateLabel: 'Date',
    links: 'Links',
    // A link's caption when there are two or more, so a row is told from the next (PL-5). A lone link has none: "Links" says it.
    link: (n: number) => `Link ${n}`,
    labelLabel: 'Label',
    addressLabel: 'Address',
    addressPlaceholder: 'https://youtu.be/…',
    // The two platforms the plate offers as one-tap labels; any other label is typed.
    chips: ['YouTube', 'Castbox'],
    addLink: '+ Another link',
    remove: 'Remove',
    removeNamed: (label: string) => `Remove ${label}`,
    thisLink: 'this link',
    // A published episode's only link has no Remove, and says why (AC-17).
    lastLink: 'A published episode keeps at least one link. Add the right one, then remove this.',
    // Refused at the field, with the fix built from the person's own text (AC-17). Never added to the field itself.
    notHttps: (suggestion: string | null) =>
      `This link needs to start with https://, like ${suggestion ?? 'https://youtu.be/abc123'}. Everything else you typed is still here.`,
    needsLabel: 'Name this link, like YouTube, so people know where it goes.',
    saveDraft: 'Save draft',
    saved: 'Saved',
    save: 'Save',
    publish: 'Publish',
    publishing: 'Publishing…',
    unpublish: 'Unpublish',
    unpublishing: 'Unpublishing…',
    cancel: 'Cancel',
    loading: 'Opening…',
    loadFailed: "Couldn't open that episode.",
    retry: 'Try again',
    // The frame's status line (plate 11, 12).
    editingPublished: (date: string) => `Editing · published ${date}`,
    draftWasLive: (date: string) => `Draft · first published ${date}`,
    draft: 'Draft',
    published: { head: "Published. It's on the podcast page." },
    // Republishing names the date it returns to, and says its place is kept (plate 12, F13).
    republished: (date: string) => ({ head: `Published, at ${date}.`, body: "It's back in its place on the podcast page." }),
    savedLive: { head: 'Saved.', body: 'The episode keeps its date and its place.' },
    savedDraft: { head: 'Draft saved.', body: "It's in Podcast, not on the site. Open it from any signed-in device." },
    unpublished: "Unpublished. It's in your podcast list as a draft.",
    republish: {
      before: 'Publishing puts it back at ',
      after: ', its date. It keeps its place on the podcast page.',
    },
    confirm: {
      title: 'Take this episode off the site?',
      body: 'It leaves the podcast page. It stays here as a draft.',
      keep: 'Keep it live',
      unpublish: 'Unpublish',
    },
    // The failure's words for an episode: "everything you typed", not "your text" (plate 12, F-16).
    failure: {
      heads: { publish: 'Not published yet.', save: 'Not saved.', unpublish: 'Not unpublished.' },
      network: {
        text: 'The connection dropped. Everything you typed is kept on this phone.',
        edit: "The connection dropped. Your changes are kept here, and the live episode hasn't changed.",
        stillLive: "It's still live.",
        notKept: "The connection dropped. Everything you typed is still here, but this browser isn't keeping a copy, so leave this page open.",
      },
      signedOut: 'You were signed out. Sign in to finish. Your episode stays right here.',
      retry: 'Try again',
      signInAnd: { publish: 'Sign in and publish', save: 'Sign in and save', unpublish: 'Sign in and unpublish' },
      // Two codes whose shared message is about a passkey: said here in the episode's terms.
      refusals: {
        NAME_REQUIRED: 'Give the episode a name before publishing.',
        REQUEST_INVALID: "That couldn't be saved. Check the fields for text that is too long or a line break in a one-line field, then try again.",
      },
    },
    // Nothing unsent is ever dropped (AC-43, J3.3), in episode words.
    left: { head: 'You left something here.', body: "An unsent episode from earlier on this phone. It isn't published.", put: 'Put it back', discard: 'Discard' },
    leftEdit: {
      head: 'You left changes here.',
      body: "Edits to an episode, from earlier on this phone. They aren't saved, and the episode hasn't changed.",
      put: 'Put them back',
      discard: 'Discard',
    },
    keptNote: { head: 'Your unsent episode is kept.', body: 'It comes back when you save or cancel here.' },
    back: { head: 'Back to your unsent episode.', body: "It isn't published.", discard: 'Discard' },
    leaveDialog: {
      title: 'Leave without saving?',
      body: "The changes to this episode aren't saved yet. If you leave, they're dropped, and the episode stays as it is.",
      stay: 'Keep editing',
      leave: 'Leave',
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
