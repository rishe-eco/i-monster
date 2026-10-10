// What middleware leaves on the Hono context for the routes behind it.
import type { AssetManifest } from './assets.ts';
import type { Env } from './env.ts';
import type { Lang } from './i18n.ts';

export interface AppEnv {
  Variables: {
    /** From the path prefix, never from a cookie or a header (AC-41). */
    lang: Lang;
    assets: AssetManifest;
    env: Env;
  };
}
