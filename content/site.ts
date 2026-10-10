// The shape of the landing page's content, which lives in the code repo, not
// in the admin (spec §4.1). `site.en.ts` and `site.fa.ts` each fill it.

/** A run of the "who" paragraph; `mark` runs are drawn with the highlighter. */
export interface Segment {
  text: string;
  mark?: boolean;
}

export interface Project {
  name: string;
  line: string;
  /** Optional outbound link. Always https. */
  url?: string;
}

export interface Link {
  label: string;
  url: string;
}

export interface SiteContent {
  /** Who this is: one paragraph. */
  who: Segment[];
  /** The projects list on the landing page. */
  projects: Project[];
  /** The podcast's name and its show-level links (platform pages), for B7. */
  show: {
    name: string;
    links: Link[];
  };
}
