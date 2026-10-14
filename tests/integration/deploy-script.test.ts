// The deploy script, run for real against a local bare "origin", a clone standing in for
// /srv/imnstr, a live conf and an installed copy of itself, with stub docker, nginx, runuser and
// flock (change note 04, CD1, "Tests"). No root, no Docker, no network: everything is under
// .tmp/deploy-harness/ and removed after each case.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..');
const HARNESS = join(ROOT, '.tmp', 'deploy-harness');
const SCRIPT = join(ROOT, 'deploy', 'imnstr-deploy.sh');

// Git Bash has no flock, and `bash` from Node on Windows can resolve to System32's WSL launcher.
// So Windows gets Git's own bash, found from `git --exec-path`; anything else gets plain bash.
// A missing bash fails the suite with a message: it does not skip quietly.
function findBash(): string {
  if (process.platform !== 'win32') return 'bash';
  const candidates: string[] = [];
  if (process.env.IMNSTR_TEST_BASH) candidates.push(process.env.IMNSTR_TEST_BASH);
  const exec = spawnSync('git', ['--exec-path'], { encoding: 'utf8' });
  if (exec.status === 0) candidates.push(resolve(exec.stdout.trim(), '..', '..', '..', 'bin', 'bash.exe'));
  candidates.push('C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files (x86)\\Git\\bin\\bash.exe');
  const found = candidates.find((path) => existsSync(path));
  if (!found) {
    throw new Error(`No Git Bash found for the deploy harness. Looked in: ${candidates.join(', ')}. Set IMNSTR_TEST_BASH to bash.exe.`);
  }
  return found;
}

const BASH = findBash();

// Forward slashes: Git Bash reads them, and so does bash anywhere else.
const posix = (path: string) => path.replaceAll('\\', '/');

// Identity and settings through the environment, so no repository's own config is touched.
const GIT_ENV = {
  GIT_AUTHOR_NAME: 'harness',
  GIT_AUTHOR_EMAIL: 'harness@example.invalid',
  GIT_COMMITTER_NAME: 'harness',
  GIT_COMMITTER_EMAIL: 'harness@example.invalid',
  GIT_CONFIG_COUNT: '2',
  GIT_CONFIG_KEY_0: 'core.autocrlf',
  GIT_CONFIG_VALUE_0: 'false',
  GIT_CONFIG_KEY_1: 'init.defaultBranch',
  GIT_CONFIG_VALUE_1: 'main',
};

function git(cwd: string, ...args: string[]): string {
  const run = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...GIT_ENV } });
  if (run.status !== 0) throw new Error(`git ${args.join(' ')} in ${cwd}: ${run.stderr}`);
  return run.stdout.trim();
}

// The stubs log every call, one line each, and return the codes the case sets in its environment.
const STUBS: Record<string, string> = {
  docker: `#!/usr/bin/env bash
echo "docker $*" >> "$STUB_LOG"
case "$1" in
  compose)
    for arg in "$@"; do
      if [ "$arg" = build ]; then exit "\${STUB_BUILD_RC:-0}"; fi
      if [ "$arg" = up ]; then exit "\${STUB_UP_RC:-0}"; fi
    done ;;
  inspect) echo "\${STUB_HEALTH:-healthy}" ;;
esac
`,
  nginx: `#!/usr/bin/env bash
echo "nginx $*" >> "$STUB_LOG"
exit "\${STUB_NGINX_RC:-0}"
`,
  // The real deploy/checks.sh needs the network, so the stub stands in for it and says what it was
  // asked: user, script and flag. When told to fail it prints a line naming a check, as checks.sh does.
  runuser: `#!/usr/bin/env bash
echo "runuser $*" >> "$STUB_LOG"
if [ "\${STUB_CHECKS_RC:-0}" != 0 ]; then
  echo "FAILED check_stubbed_example: expected status 200, got '500'"
  exit "$STUB_CHECKS_RC"
fi
echo "checks passed (stub)"
`,
  // Git Bash ships no flock. A case that holds the lock makes the stub fail, as \`flock -n\` does.
  flock: `#!/usr/bin/env bash
echo "flock $*" >> "$STUB_LOG"
exit "\${STUB_FLOCK_RC:-0}"
`,
};

const CONF = '# a stand-in for deploy/nginx/imnstr.conf\nserver { listen 443 ssl; }\n';
const COMPOSE = 'name: imnstr\nservices:\n  imnstr:\n    build: .\n';
const ENV_FILE = 'DB_PATH=/data/imnstr.db\nPRELAUNCH=1\nSECRET_TOKEN=do-not-print-this-value\n';

interface Box {
  dir: string;
  origin: string;
  srv: string;
  work: string;
  liveConf: string;
  installed: string;
  log: string;
}

let base: string;
let counter = 0;
const made: string[] = [];

beforeAll(() => {
  rmSync(HARNESS, { recursive: true, force: true });
  mkdirSync(HARNESS, { recursive: true });
  // One bare repository with the first commit, cloned afresh for each case.
  base = join(HARNESS, 'base.git');
  const seed = join(HARNESS, 'seed');
  git(HARNESS, 'init', '--quiet', seed);
  mkdirSync(join(seed, 'deploy', 'nginx'), { recursive: true });
  writeFileSync(join(seed, 'deploy', 'nginx', 'imnstr.conf'), CONF);
  writeFileSync(join(seed, 'docker-compose.prod.yml'), COMPOSE);
  writeFileSync(join(seed, 'app.txt'), 'one\n');
  // The real script, byte for byte, so "installed copy equals the new commit's" holds as it does on the box.
  copyFileSync(SCRIPT, join(seed, 'deploy', 'imnstr-deploy.sh'));
  git(seed, 'add', 'deploy/nginx/imnstr.conf', 'docker-compose.prod.yml', 'app.txt', 'deploy/imnstr-deploy.sh');
  git(seed, 'commit', '--quiet', '-m', 'first');
  git(HARNESS, 'clone', '--quiet', '--bare', seed, base);
  rmSync(seed, { recursive: true, force: true, maxRetries: 3 });
});

afterAll(() => {
  rmSync(HARNESS, { recursive: true, force: true, maxRetries: 3 });
});

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
});

function makeBox(): Box {
  const dir = join(HARNESS, `case-${(counter += 1)}`);
  made.push(dir);
  mkdirSync(join(dir, 'bin'), { recursive: true });
  const origin = join(dir, 'origin.git');
  const srv = join(dir, 'srv');
  const work = join(dir, 'work');
  git(dir, 'clone', '--quiet', '--bare', base, origin);
  git(dir, 'clone', '--quiet', origin, srv);
  git(dir, 'clone', '--quiet', origin, work);
  writeFileSync(join(srv, '.env'), ENV_FILE);
  const liveConf = join(dir, 'live-imnstr.conf');
  const installed = join(dir, 'installed-imnstr-deploy');
  writeFileSync(liveConf, CONF);
  copyFileSync(SCRIPT, installed);
  for (const [name, body] of Object.entries(STUBS)) writeFileSync(join(dir, 'bin', name), body);
  return { dir, origin, srv, work, liveConf, installed, log: join(dir, 'calls.log') };
}

// Commit to origin from the work clone: `change` writes files, and the new tip's hash is returned.
function pushCommit(box: Box, change: (work: string) => void, force = false): string {
  change(box.work);
  git(box.work, 'add', '-A');
  git(box.work, 'commit', '--quiet', '-m', 'next');
  git(box.work, 'push', '--quiet', ...(force ? ['--force'] : []), 'origin', 'main');
  return git(box.work, 'rev-parse', 'HEAD');
}

interface Result {
  code: number | null;
  out: string;
  calls: string[];
}

function run(box: Box, env: Record<string, string> = {}): Result {
  const bin = (name: string) => posix(join(box.dir, 'bin', name));
  const proc = spawnSync(BASH, [posix(SCRIPT)], {
    encoding: 'utf8',
    timeout: 60_000,
    env: {
      ...process.env,
      ...GIT_ENV,
      IMNSTR_DIR: posix(box.srv),
      IMNSTR_LOCK: posix(join(box.dir, 'lock')),
      IMNSTR_LIVE_CONF: posix(box.liveConf),
      IMNSTR_INSTALLED: posix(box.installed),
      IMNSTR_FLOCK: bin('flock'),
      IMNSTR_DOCKER: bin('docker'),
      IMNSTR_NGINX: bin('nginx'),
      IMNSTR_RUNUSER: bin('runuser'),
      STUB_LOG: posix(box.log),
      ...env,
    },
  });
  const calls = existsSync(box.log) ? readFileSync(box.log, 'utf8').split('\n').filter(Boolean) : [];
  return { code: proc.status, out: `${proc.stdout}${proc.stderr}`, calls };
}

const head = (box: Box) => git(box.srv, 'rev-parse', 'HEAD');
const touchedDocker = (r: Result) => r.calls.some((c) => c.startsWith('docker '));

// Each case makes three clones and runs bash and git a dozen times; Git Bash on Windows is slow at that.
describe('imnstr-deploy.sh, run under bash against stubs', { timeout: 90_000 }, () => {
  it('uses a bash that is not WSL, and the real script exists', () => {
    expect(existsSync(SCRIPT)).toBe(true);
    expect(BASH.toLowerCase()).not.toContain('system32');
  });

  it('deploys: moves the checkout, builds, ups, checks health and nginx, runs the checks, prints DEPLOYED', () => {
    const box = makeBox();
    const tip = pushCommit(box, (w) => writeFileSync(join(w, 'app.txt'), 'two\n'));
    const r = run(box);
    expect(r.code).toBe(0);
    expect(r.out).toContain(`DEPLOYED ${tip}`);
    expect(head(box)).toBe(tip);
    // Order matters: nothing is started before the build, and the checks come last.
    const names = r.calls.map((c) => c.split(' ').slice(0, 3).join(' '));
    const at = (prefix: string) => names.findIndex((n) => n.startsWith(prefix));
    expect(at('docker compose -f')).toBeGreaterThanOrEqual(0);
    const build = r.calls.findIndex((c) => / build$/.test(c));
    const up = r.calls.findIndex((c) => c.includes(' up -d --wait --wait-timeout 120'));
    const inspect = r.calls.findIndex((c) => c.startsWith('docker inspect'));
    const nginx = r.calls.findIndex((c) => c === 'nginx -t');
    const checks = r.calls.findIndex((c) => c.startsWith('runuser'));
    expect(build).toBeGreaterThan(-1);
    expect([build, up, inspect, nginx, checks]).toEqual([build, up, inspect, nginx, checks].sort((a, b) => a - b));
    expect(up).toBeGreaterThan(build);
    expect(inspect).toBeGreaterThan(up);
    expect(r.calls[inspect]).toContain('imnstr-imnstr-1');
    // The flag comes from .env, read with grep; the checks run as nobody; only the flag is passed.
    expect(r.calls[checks]).toMatch(/^runuser -u nobody -- \S*bash \S*\/deploy\/checks\.sh 1$/);
    // The log of the run is public: no .env line may reach it.
    expect(r.out).not.toContain('do-not-print-this-value');
    expect(r.out).not.toContain('SECRET_TOKEN');
    expect(r.out).not.toContain('PRELAUNCH');
  });

  it('passes 0 when .env has no PRELAUNCH, and understands a quoted 1', () => {
    const noFlag = makeBox();
    writeFileSync(join(noFlag.srv, '.env'), 'DB_PATH=/data/imnstr.db\n');
    expect(run(noFlag).calls.find((c) => c.startsWith('runuser'))).toMatch(/ 0$/);

    const quoted = makeBox();
    writeFileSync(join(quoted.srv, '.env'), 'PRELAUNCH="1"\n');
    expect(run(quoted).calls.find((c) => c.startsWith('runuser'))).toMatch(/ 1$/);

    const unset = makeBox();
    writeFileSync(join(unset.srv, '.env'), 'PRELAUNCH=\n');
    expect(run(unset).calls.find((c) => c.startsWith('runuser'))).toMatch(/ 0$/);
  });

  it('is already current: moves nothing, still builds, ups and checks, and prints DEPLOYED', () => {
    const box = makeBox();
    const before = head(box);
    const r = run(box);
    expect(r.code).toBe(0);
    expect(head(box)).toBe(before);
    expect(r.out).toContain('checkout already at');
    expect(r.out).toContain(`DEPLOYED ${before}`);
    expect(r.calls.some((c) => c.startsWith('runuser'))).toBe(true);
    expect(r.calls.some((c) => / build$/.test(c))).toBe(true);
  });

  it('exits 2 when another deploy holds the lock, before touching anything', () => {
    const box = makeBox();
    const tip = pushCommit(box, (w) => writeFileSync(join(w, 'app.txt'), 'two\n'));
    const before = head(box);
    const r = run(box, { STUB_FLOCK_RC: '1' });
    expect(r.code).toBe(2);
    expect(r.out).toContain('another deploy holds');
    expect(r.calls).toEqual([expect.stringMatching(/^flock -n 9$/)]);
    expect(head(box)).toBe(before);
    expect(head(box)).not.toBe(tip);
  });

  it('exits 2 on a dirty tree', () => {
    const box = makeBox();
    pushCommit(box, (w) => writeFileSync(join(w, 'app.txt'), 'two\n'));
    const before = head(box);
    writeFileSync(join(box.srv, 'app.txt'), 'edited by hand\n');
    const r = run(box);
    expect(r.code).toBe(2);
    expect(r.out).toContain('uncommitted changes');
    expect(head(box)).toBe(before);
    expect(touchedDocker(r)).toBe(false);
  });

  it('ignores untracked files, such as .env, data/ and backups/', () => {
    const box = makeBox();
    mkdirSync(join(box.srv, 'data'));
    writeFileSync(join(box.srv, 'data', 'imnstr.db'), 'x');
    expect(run(box).code).toBe(0);
  });

  it('exits 2 when history was rewritten, and moves nothing', () => {
    const box = makeBox();
    const first = git(box.work, 'rev-parse', 'HEAD');
    pushCommit(box, (w) => writeFileSync(join(w, 'app.txt'), 'two\n'));
    // The checkout takes the second commit, then main is rewritten to a sibling of it.
    git(box.srv, 'pull', '--quiet', '--ff-only');
    const before = head(box);
    git(box.work, 'reset', '--quiet', '--hard', first);
    pushCommit(box, (w) => writeFileSync(join(w, 'app.txt'), 'rewritten\n'), true);
    const r = run(box);
    expect(r.code).toBe(2);
    expect(r.out).toContain('not a fast-forward');
    expect(head(box)).toBe(before);
    expect(touchedDocker(r)).toBe(false);
  });

  it('exits 2 when the conf differs from the live one, with the checkout unmoved', () => {
    const box = makeBox();
    pushCommit(box, (w) => writeFileSync(join(w, 'deploy', 'nginx', 'imnstr.conf'), `${CONF}# new line\n`));
    const before = head(box);
    const r = run(box);
    expect(r.code).toBe(2);
    expect(r.out).toContain('deploy/nginx/imnstr.conf');
    expect(r.out).toContain('By hand');
    expect(head(box)).toBe(before);
    expect(touchedDocker(r)).toBe(false);
  });

  it('passes once the live conf has been copied by hand (a manual fix, then a re-run)', () => {
    const box = makeBox();
    const tip = pushCommit(box, (w) => writeFileSync(join(w, 'deploy', 'nginx', 'imnstr.conf'), `${CONF}# new line\n`));
    expect(run(box).code).toBe(2);
    writeFileSync(box.liveConf, `${CONF}# new line\n`);
    const again = run(box);
    expect(again.code).toBe(0);
    expect(again.out).toContain(`DEPLOYED ${tip}`);
  });

  it('exits 2 when docker-compose.prod.yml changed, with the checkout unmoved', () => {
    const box = makeBox();
    pushCommit(box, (w) => writeFileSync(join(w, 'docker-compose.prod.yml'), `${COMPOSE}    mem_limit: 512m\n`));
    const before = head(box);
    const r = run(box);
    expect(r.code).toBe(2);
    expect(r.out).toContain('docker-compose.prod.yml');
    expect(head(box)).toBe(before);
    expect(touchedDocker(r)).toBe(false);
  });

  it('exits 2 when the installed script differs from the new commit\'s', () => {
    const box = makeBox();
    pushCommit(box, (w) => writeFileSync(join(w, 'app.txt'), 'two\n'));
    writeFileSync(box.installed, '#!/usr/bin/env bash\n# an older install\n');
    const before = head(box);
    const r = run(box);
    expect(r.code).toBe(2);
    expect(r.out).toContain('deploy/imnstr-deploy.sh');
    expect(head(box)).toBe(before);
    expect(touchedDocker(r)).toBe(false);
  });

  it('names every stop file at once when several differ', () => {
    const box = makeBox();
    pushCommit(box, (w) => {
      writeFileSync(join(w, 'deploy', 'nginx', 'imnstr.conf'), `${CONF}# new line\n`);
      writeFileSync(join(w, 'docker-compose.prod.yml'), `${COMPOSE}    mem_limit: 512m\n`);
    });
    const r = run(box);
    expect(r.code).toBe(2);
    expect(r.out).toContain('deploy/nginx/imnstr.conf');
    expect(r.out).toContain('docker-compose.prod.yml');
  });

  it('exits 1 when the build fails, and never runs up', () => {
    const box = makeBox();
    pushCommit(box, (w) => writeFileSync(join(w, 'app.txt'), 'two\n'));
    const r = run(box, { STUB_BUILD_RC: '1' });
    expect(r.code).toBe(1);
    expect(r.out).toContain('step build');
    expect(r.calls.some((c) => c.includes(' up '))).toBe(false);
    expect(r.out).not.toContain('DEPLOYED');
  });

  it('does not take a failed build for a deploy when it is run again', () => {
    const box = makeBox();
    pushCommit(box, (w) => writeFileSync(join(w, 'app.txt'), 'two\n'));
    expect(run(box, { STUB_BUILD_RC: '1' }).code).toBe(1);
    // The checkout moved before the build failed. The re-run must build again, not just check.
    const again = run(box, { STUB_BUILD_RC: '1' });
    expect(again.code).toBe(1);
    expect(again.out).not.toContain('DEPLOYED');
  });

  it('exits 1 when up does not finish, naming the step', () => {
    const box = makeBox();
    pushCommit(box, (w) => writeFileSync(join(w, 'app.txt'), 'two\n'));
    const r = run(box, { STUB_UP_RC: '1' });
    expect(r.code).toBe(1);
    expect(r.out).toContain('step up');
    expect(r.calls.some((c) => c.startsWith('runuser'))).toBe(false);
  });

  it('exits 1 when the container is not healthy', () => {
    const box = makeBox();
    pushCommit(box, (w) => writeFileSync(join(w, 'app.txt'), 'two\n'));
    const r = run(box, { STUB_HEALTH: 'unhealthy' });
    expect(r.code).toBe(1);
    expect(r.out).toContain('step health');
    expect(r.out).toContain("'unhealthy'");
    expect(r.calls.some((c) => c.startsWith('runuser'))).toBe(false);
  });

  it('exits 1 when nginx -t fails', () => {
    const box = makeBox();
    pushCommit(box, (w) => writeFileSync(join(w, 'app.txt'), 'two\n'));
    const r = run(box, { STUB_NGINX_RC: '1' });
    expect(r.code).toBe(1);
    expect(r.out).toContain('step nginx');
    expect(r.calls.some((c) => c.startsWith('runuser'))).toBe(false);
  });

  it('exits 1 when a check fails, naming it, and prints no DEPLOYED', () => {
    const box = makeBox();
    pushCommit(box, (w) => writeFileSync(join(w, 'app.txt'), 'two\n'));
    const r = run(box, { STUB_CHECKS_RC: '1' });
    expect(r.code).toBe(1);
    expect(r.out).toContain('FAILED check_stubbed_example');
    expect(r.out).toContain('step checks');
    expect(r.out).not.toContain('DEPLOYED');
  });
});
