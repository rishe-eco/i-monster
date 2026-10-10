// The one type both languages' public strings satisfy. Add a key here and the
// compiler fails in whichever of en.ts and fa.ts is missing it (house rule 3).
export interface Strings {
  /** The site's owner, as pages name them (AC-26). A name, not a translation. */
  owner: string;
  /** The text in the browser tab for pages that have no title of their own. */
  siteTitle: string;
  nav: {
    label: string;
    footerLabel: string;
    learnings: string;
    podcast: string;
    feed: string;
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
  footer: {
    noCookies: string;
  };
}
