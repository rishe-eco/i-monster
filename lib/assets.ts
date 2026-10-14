// Static assets with hashed names, built once at startup (PD-4: no build step).
// A file `fonts/x.woff2` is served at `/assets/fonts/x.<hash>.woff2` with a
// year of caching; the hash is of the file's bytes, so a changed file gets a
// new address and a stale one can never be served. The stylesheet is the CSS
// parts joined, with each font url() rewritten to its hashed address before
// the stylesheet itself is hashed.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Asset {
  body: Buffer;
  type: string;
}

export interface AssetManifest {
  /** The public path of an asset by its source name, e.g. `css/site.css`. */
  url(name: string): string;
  /** The asset served at a public path, or undefined. */
  get(path: string): Asset | undefined;
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS_DIR = join(ROOT, 'assets');
/** Where `npm run build` puts the admin bundle: one script and one stylesheet, under fixed names (PD-21). */
const ADMIN_DIR = join(ROOT, 'dist', 'admin');
const ADMIN_FILES = ['admin.js', 'admin.css'] as const;

export interface AssetOptions {
  /** Where the built admin bundle is. Tests point it at a stub. */
  adminDir?: string;
  /** Refuse to build the manifest when the bundle is missing: production boots only with it. */
  requireAdmin?: boolean;
}

/** The stylesheet's parts, in cascade order. Together they are `css/site.css`. */
const CSS_PARTS = ['fonts.css', 'tokens.css', 'base.css', 'components.css'];

const TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function hashOf(body: Buffer): string {
  return createHash('sha256').update(body).digest('hex').slice(0, 10);
}

function hashedPath(name: string, body: Buffer): string {
  const ext = extname(name);
  return `/assets/${name.slice(0, name.length - ext.length)}.${hashOf(body)}${ext}`;
}

function walk(dir: string, prefix = ''): string[] {
  const names: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const name = prefix ? `${prefix}/${entry}` : entry;
    if (statSync(full).isDirectory()) names.push(...walk(full, name));
    else names.push(name);
  }
  return names;
}

export function buildAssets(dir: string = ASSETS_DIR, options: AssetOptions = {}): AssetManifest {
  const byName = new Map<string, string>();
  const byPath = new Map<string, Asset>();

  const add = (name: string, body: Buffer): void => {
    const type = TYPES[extname(name)];
    if (!type) return;
    const path = hashedPath(name, body);
    byName.set(name, path);
    byPath.set(path, { body, type });
  };

  // Everything except the stylesheet's parts and licence text: fonts, and later scripts and images.
  for (const name of walk(dir)) {
    if (name.startsWith('css/')) continue;
    add(name, readFileSync(join(dir, name)));
  }

  const css = CSS_PARTS.map((part) => readFileSync(join(dir, 'css', part), 'utf8')).join('\n');
  const rewritten = css.replace(/url\(\s*(['"]?)\.\.\/([^'")]+)\1\s*\)/g, (_match, _quote, target: string) => {
    const path = byName.get(posix.normalize(target));
    if (!path) throw new Error(`The stylesheet refers to an asset that does not exist: ${target}`);
    return `url(${path})`;
  });
  add('css/site.css', Buffer.from(rewritten, 'utf8'));

  // Vite writes the admin bundle under fixed names; it is hashed here like every other
  // asset, so there is one hashing scheme and the shell always names the bytes it serves.
  const adminDir = options.adminDir ?? ADMIN_DIR;
  const missing = ADMIN_FILES.filter((file) => !existsSync(join(adminDir, file)));
  if (missing.length > 0 && options.requireAdmin) {
    throw new Error(`The admin bundle is missing (${missing.join(', ')} in ${adminDir}). Run \`npm run build\` first.`);
  }
  for (const file of ADMIN_FILES) {
    if (!missing.includes(file)) add(`admin/${file}`, readFileSync(join(adminDir, file)));
  }

  return {
    url(name) {
      const path = byName.get(name);
      if (!path) throw new Error(`Unknown asset: ${name}`);
      return path;
    },
    get(path) {
      return byPath.get(path);
    },
  };
}
