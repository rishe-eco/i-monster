// The deploy files, read as text (plan B2). Nginx and Docker are not run here.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

// A comment may name a directive ("No add_header"); only the live lines count.
const live = (text: string) =>
  text
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');

for (const file of ['deploy/nginx/imnstr.conf', 'deploy/nginx/imnstr.bootstrap.conf']) {
  describe(file, () => {
    const conf = live(read(file));

    it('sets no security headers (PD-18)', () => {
      expect(conf).not.toMatch(/\badd_header\b/);
    });

    it('claims no default_server', () => {
      expect(conf).not.toMatch(/default_server/);
    });

    it('proxies to the app on 127.0.0.1:4100', () => {
      expect(conf).toContain('proxy_pass http://127.0.0.1:4100');
    });
  });
}

describe('deploy/nginx/imnstr.conf', () => {
  const conf = live(read('deploy/nginx/imnstr.conf'));

  it('writes no access log', () => {
    expect(conf).toMatch(/access_log off;/);
    expect(conf).not.toMatch(/access_log\s+(?!off)/);
  });

  it('names every limit_req_zone imnstr_', () => {
    const zones = [...conf.matchAll(/limit_req_zone\s+\S+\s+zone=(\w+):/g)].map((m) => m[1]);
    expect(zones.length).toBeGreaterThan(0);
    for (const zone of zones) expect(zone).toMatch(/^imnstr_/);
  });

  it('limits the sign-in path with its own zone', () => {
    expect(conf).toMatch(/location \/admin\/api\/auth\/ \{[^}]*limit_req zone=imnstr_auth/);
  });

  // S-8 (B4a): a sign-in is two requests (options, verify), and so are a re-authentication and a
  // registration. The founder does a few of these a minute at most, so 30 a minute with a burst of 10
  // is room for several ceremonies at once and still stops a script. It is per address; the
  // app's own back-off (PD-15) is what bounds guessing across addresses.
  it('keeps the auth zone at a rate and burst that fit whole ceremonies, two requests each', () => {
    const rate = Number(/zone=imnstr_auth:\w+ rate=(\d+)r\/m/.exec(conf)?.[1]);
    const burst = Number(/limit_req zone=imnstr_auth burst=(\d+)/.exec(conf)?.[1]);
    expect(rate).toBeGreaterThanOrEqual(30);
    expect(burst).toBeGreaterThanOrEqual(10);
  });

  // In nginx 1.18, http2 on one listen line turns it on for every site on that port.
  it('listens on 443 over IPv4 and IPv6, without http2', () => {
    expect(conf).toContain('listen 443 ssl;');
    expect(conf).toContain('listen [::]:443 ssl;');
    expect(conf).not.toMatch(/\bhttp2\b/);
  });

  it('points at the imnstr.com certificate', () => {
    expect(conf).toContain('/etc/letsencrypt/live/imnstr.com/fullchain.pem');
  });
});

describe('deploy/nginx/imnstr.bootstrap.conf', () => {
  it('has no TLS and no zone, so it works before the certificate and never clashes', () => {
    const conf = live(read('deploy/nginx/imnstr.bootstrap.conf'));
    expect(conf).not.toMatch(/ssl_certificate|listen 443|limit_req_zone/);
  });
});

describe('the image', () => {
  it('moved tsx to dependencies, since the server runs through it and --omit=dev drops devDependencies', () => {
    const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
    expect(pkg.dependencies.tsx).toBeDefined();
    expect(pkg.devDependencies.tsx).toBeUndefined();
  });

  it('installs without scripts and without dev dependencies', () => {
    expect(read('Dockerfile')).toMatch(/npm ci --omit=dev --ignore-scripts/);
  });

  it('keeps the host node_modules out of the build context', () => {
    expect(read('.dockerignore')).toMatch(/^node_modules$/m);
  });
});

// The image is built in two stages (plan B4b, PD-21): Vite builds the admin bundle in the first, and
// the one that runs has no dev dependency. Docker isn't run here; the review builds and runs it.
describe('Dockerfile', () => {
  const dockerfile = live(read('Dockerfile'));
  const stages = dockerfile.split(/^FROM /m).slice(1);

  it('has a build stage and a runtime stage', () => {
    expect(stages).toHaveLength(2);
    expect(stages[0]).toMatch(/^node:24-slim AS build/);
    expect(stages[1]).toMatch(/^node:24-slim\n/);
  });

  it('builds the bundle in the first stage, with every dependency and no install scripts', () => {
    expect(stages[0]).toMatch(/RUN npm ci --ignore-scripts\n/);
    expect(stages[0]).toContain('RUN npm run build');
  });

  it('installs only runtime dependencies in the second, still without scripts, and runs as it did', () => {
    expect(stages[1]).toContain('RUN npm ci --omit=dev --ignore-scripts');
    expect(stages[1]).not.toContain('npm run build');
    expect(stages[1]).toContain('ENV NODE_ENV=production');
    expect(stages[1]).toContain('USER node');
    expect(stages[1]).toContain('CMD ["node", "--import", "tsx", "server.ts"]');
  });

  it('takes the bundle from the build stage, and never from the host', () => {
    expect(stages[1]).toContain('COPY --from=build /app/dist/admin ./dist/admin');
    expect(live(read('.dockerignore'))).toMatch(/^dist$/m);
  });
});
