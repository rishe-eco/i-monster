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
}

type Source = Record<string, string | undefined>;

// Only the exact string "1" switches a flag on, so "0", "false" and "" are all off.
function flag(value: string | undefined): boolean {
  return value === '1';
}

function nodeEnvOf(value: string | undefined): NodeEnv {
  return value === 'production' || value === 'test' ? value : 'development';
}

/** Read and check the environment. Throws, with a message, on anything the server must not boot with. */
export function loadEnv(source: Source): Env {
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

  // P0-5 (the founder's timezone) isn't confirmed yet; Tehran is the plan's placeholder.
  const siteTz = source.SITE_TZ?.trim() || 'Asia/Tehran';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: siteTz });
  } catch {
    throw new Error(`SITE_TZ is not a timezone this runtime knows: "${siteTz}"`);
  }

  return {
    port,
    dbPath: source.DB_PATH?.trim() || '.tmp/dev.db',
    siteTz,
    e2eClock,
    prelaunch: flag(source.PRELAUNCH),
    nodeEnv,
  };
}

export const env: Env = loadEnv(process.env);
