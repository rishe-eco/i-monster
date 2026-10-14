// What middleware leaves on the Hono context for the routes behind it.
import type { AssetManifest } from './assets.ts';
import type { Env } from './env.ts';
import type { Lang } from './i18n.ts';
import type { Session } from './sessions.ts';

export interface AppEnv {
  Variables: {
    /** From the path prefix, never from a cookie or a header (AC-41). */
    lang: Lang;
    assets: AssetManifest;
    env: Env;
    /** Set only by the /admin/api guard, never on a public route (D-8). */
    session: Session;
  };
}
