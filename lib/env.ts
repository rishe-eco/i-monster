// Every environment variable the server reads, in one place. `.env.example`
// lists them. Nothing else in the app touches `process.env`.

export type NodeEnv = 'development' | 'test' | 'production';

export interface Env {
  port: number;
  dbPath: string;
  /** IANA timezone for every date the site shows (PD-9). */
  siteTz: string;
  /** Adds the test-only clock route. Never with NODE_ENV=production. */
  e2eClock: boolean;
  /** Asks search engines not to index the site (PD-22). */
  prelaunch: boolean;
  nodeEnv: NodeEnv;
  /** The one origin the site is served from, with no path: `https://imnstr.com` in production. Sign-in is bound to it (PD-14). */
  origin: string;
  /** The WebAuthn relying-party id: the origin's hostname. Passkeys are bound to it. */
  rpId: string;
  /**
   * The founder's own links, shown on the contact page. They live in the server's environment, not in the repo,
   * so a public repository carries no personal data (house rule 10). A key is absent when its variable is unset or invalid.
   */
  contact: ContactLinks;
}

export interface ContactLinks {
  /** A plain address, shown as a `mailto:` link. */
  email?: string;
  /** A channel handle without the `@`: the link is `https://t.me/<handle>`. */
  telegram?: string;
  /** A handle without the `@`: the link is `https://www.instagram.com/<handle>/`. */
  instagram?: string;
}

type Source = Record<string, string | undefined>;

// A plain `local@domain.tld`: no display name, no quotes, no comments. It is shown as a link, so it is kept narrow.
const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
const HANDLE = /^[A-Za-z0-9_.]{1,64}$/;

/**
 * The three contact links. An unset or empty variable is simply absent; an invalid one is dropped too, with one
 * warning that names the variable and never its value (the value is the founder's own address).
 */
function contactLinks(source: Source, warn: (message: string) => void): ContactLinks {
  const contact: ContactLinks = {};
  const email = source.CONTACT_EMAIL?.trim();
  if (email) {
    if (EMAIL.test(email) && email.length <= 254) contact.email = email;
    else warn('CONTACT_EMAIL is not a plain address such as name@example.com, so the contact page leaves it out.');
  }
  for (const [name, key] of [
    ['CONTACT_TELEGRAM', 'telegram'],
    ['CONTACT_INSTAGRAM', 'instagram'],
  ] as const) {
    // A leading @ is what people paste; the link is built without it.
    const handle = source[name]?.trim().replace(/^@/, '');
    if (!handle) continue;
    if (HANDLE.test(handle)) contact[key] = handle;
    else warn(`${name} is not a handle (letters, digits, "_" and "." only, up to 64), so the contact page leaves it out.`);
  }
  return contact;
}

// Only the exact string "1" switches a flag on, so "0", "false" and "" are all off.
function flag(value: string | undefined): boolean {
  return value === '1';
}

function nodeEnvOf(value: string | undefined): NodeEnv {
  return value === 'production' || value === 'test' ? value : 'development';
}

/**
 * Read and check the environment. Throws, with a message, on anything the server must not boot with.
 * `warn` takes the one-line warnings for values that are dropped rather than refused.
 */
export function loadEnv(source: Source, warn: (message: string) => void = console.warn): Env {
  const nodeEnv = nodeEnvOf(source.NODE_ENV);
  const e2eClock = flag(source.E2E_CLOCK);
  if (e2eClock && nodeEnv === 'production') {
    // The clock route lets anyone rewrite time; it must never exist in production.
    throw new Error('E2E_CLOCK=1 is refused when NODE_ENV=production');
  }

  const portText = source.PORT?.trim() || '4100';
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be a whole number from 1 to 65535, got "${portText}"`);
  }

  // The founder's timezone, confirmed 2026-10-11 (P0-5).
  const siteTz = source.SITE_TZ?.trim() || 'Asia/Tehran';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: siteTz });
  } catch {
    throw new Error(`SITE_TZ is not a timezone this runtime knows: "${siteTz}"`);
  }

  // The origin defaults to the real site in production, so the server's .env
  // needs no new line, and to the dev server elsewhere. Passkeys and the Origin
  // check both rest on it, so a value that isn't a bare origin is refused.
  const originText = source.ORIGIN?.trim() || (nodeEnv === 'production' ? 'https://imnstr.com' : `http://localhost:${port}`);
  let originUrl: URL;
  try {
    originUrl = new URL(originText);
  } catch {
    throw new Error(`ORIGIN is not a URL: "${originText}"`);
  }
  if (originUrl.origin !== originText || (originUrl.protocol !== 'https:' && originUrl.protocol !== 'http:')) {
    throw new Error(`ORIGIN must be a bare http(s) origin such as https://imnstr.com, got "${originText}"`);
  }
  if (nodeEnv === 'production' && originUrl.protocol !== 'https:') {
    throw new Error('ORIGIN must be https when NODE_ENV=production');
  }

  return {
    port,
    dbPath: source.DB_PATH?.trim() || '.tmp/dev.db',
    siteTz,
    e2eClock,
    prelaunch: flag(source.PRELAUNCH),
    nodeEnv,
    origin: originUrl.origin,
    rpId: originUrl.hostname,
    contact: contactLinks(source, warn),
  };
}

export const env: Env = loadEnv(process.env);
