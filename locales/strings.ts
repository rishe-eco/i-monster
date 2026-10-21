// The one type both languages' public strings satisfy. Add a key here and the
// compiler fails in whichever of en.ts and fa.ts is missing it (house rule 3).
export interface Strings {
  /** The site's owner, as pages name them (AC-26). A name, not a translation. */
  owner: string;
  /** The text in the browser tab for pages that have no title of their own. */
  siteTitle: string;
  /** The skip link, first on every public page (PL-6). */
  skip: string;
  nav: {
    label: string;
    footerLabel: string;
    learnings: string;
    podcast: string;
    feed: string;
    contact: string;
  };
  /** The title the feed advertises in `<link rel="alternate">`. */
  feedTitle: string;
  landing: {
    description: string;
    learningsTitle: string;
    learningsLine: string;
    podcastTitle: string;
    podcastLine: string;
    buildingHeading: string;
  };
  notFound: {
    title: string;
    body: string;
    readLearnings: string;
    podcast: string;
    goHome: string;
    /** Holds {owner}, where the owner's name goes (it is isolated from the surrounding text). */
    ownerLine: string;
  };
  log: {
    title: string;
    lede: string;
    description: string;
    older: string;
    /** The row back to the previous page; shown only past the first page (PL-10). */
    newer: string;
    empty: string;
    /** Holds {who} and {podcast}, each a link. */
    emptyMeanwhile: string;
    whoLink: string;
    podcastLink: string;
  };
  podcast: {
    /** Under the show's name, on every page of it. */
    lede: string;
    description: string;
    /** A show-level link's text; holds {platform}, the platform's name as the content file gives it. */
    showOn: string;
    older: string;
    /** The row back to the previous page; shown only past the first page (PL-10). */
    newer: string;
    empty: string;
    /** What stands between an episode's tags. */
    tagSeparator: string;
  };
  entry: {
    more: string;
    /** Holds {owner} and {podcast}, each a link. */
    writtenBy: string;
    podcastLink: string;
  };
  contact: {
    /** The page's heading and its tab title; the nav link's text is `nav.contact`. */
    title: string;
    lede: string;
    description: string;
    emailLabel: string;
    telegramLabel: string;
    instagramLabel: string;
    formHeading: string;
    subjectLabel: string;
    messageLabel: string;
    reachLabel: string;
    reachHint: string;
    send: string;
    /** The thank-you after a send (`?sent=1`). */
    sent: string;
    errorSummary: string;
    subjectEmpty: string;
    messageEmpty: string;
    reachEmpty: string;
    /** Holds {max}, the field's limit written in the language's own digits. */
    tooLong: string;
    /** The 24-hour cap (429). Points at the email link above the form. */
    cap: string;
    /** A post from another origin (403). */
    origin: string;
  };
  footer: {
    noCookies: string;
  };
}
