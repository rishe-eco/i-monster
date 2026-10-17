// The CI workflow and the two deploy scripts, read as text (change note 04, CD1; CI-1 to CI-10).
// Nothing is run here: the harness in tests/integration/deploy-script.test.ts runs the script.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CSP } from '../../lib/headers.ts';

const ROOT = join(import.meta.dirname, '..', '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

// A comment may name what it forbids ("never from ssh-keyscan"); only the live lines count.
const live = (text: string) =>
  text
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');

const workflow = live(read('.github/workflows/deploy.yml'));
const deployScript = read('deploy/imnstr-deploy.sh');
const checksScript = read('deploy/checks.sh');
const deployLive = live(deployScript);
const checksLive = live(checksScript);

// The two jobs, split on their top-level keys, so a line can be asserted in the right one.
const jobs = Object.fromEntries(
  workflow
    .split(/^ {2}(?=[a-z]+:\n)/m)
    .slice(1)
    .map((block) => [block.slice(0, block.indexOf(':')), block]),
);

describe('the workflow: the check job (CI-1)', () => {
  const check = jobs.check ?? '';

  it('runs on a push to main, and by hand for a re-run', () => {
    expect(workflow).toMatch(/^on:\n {2}push:\n {4}branches: \[main\]\n {2}workflow_dispatch:/m);
    expect(workflow).not.toMatch(/pull_request/);
  });

  it('installs without scripts, checks, builds the bundle and runs Vitest, on Node 24', () => {
    expect(check).toContain('runs-on: ubuntu-24.04');
    expect(check).toContain('node-version: 24');
    expect(check).toContain('run: npm ci --ignore-scripts');
    expect(check).toContain('run: npm run check');
    expect(check).toContain('run: npm run build');
    expect(check).toContain('run: npm test');
    // The runner image ships shellcheck; Docker Desktop, for the local run, often isn't up.
    expect(check).toContain('run: shellcheck deploy/imnstr-deploy.sh deploy/checks.sh');
    const order = ['npm ci', 'npm run check', 'npm run build', 'npm test'].map((s) => check.indexOf(s));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('runs no Playwright and no e2e', () => {
    expect(workflow).not.toMatch(/playwright|e2e/i);
  });
});

describe('the workflow: the deploy job (CI-2, CI-3, CI-9)', () => {
  const deploy = jobs.deploy ?? '';

  it('runs only after check, only for main, only while DEPLOY_ENABLED is true', () => {
    expect(deploy).toContain('needs: check');
    expect(deploy).toContain("if: github.ref == 'refs/heads/main' && vars.DEPLOY_ENABLED == 'true'");
    expect(deploy).toContain('environment: production');
  });

  it('runs one deploy at a time and never cancels one in progress', () => {
    expect(deploy).toMatch(/concurrency:\n {6}group: deploy-production\n {6}cancel-in-progress: false/);
  });

  it('has read-only permissions for the whole workflow', () => {
    expect(workflow).toMatch(/^permissions:\n {2}contents: read$/m);
    expect(workflow).not.toMatch(/contents: write|id-token|packages:/);
  });

  it('uses only checkout and setup-node, each pinned by a full commit SHA', () => {
    const uses = [...workflow.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1] as string);
    expect(uses.length).toBeGreaterThanOrEqual(3);
    for (const use of uses) {
      expect(use).toMatch(/^actions\/(checkout|setup-node)@[0-9a-f]{40}$/);
    }
  });

  it('trusts the host key from a secret, never one fetched at run time', () => {
    expect(workflow).toContain('StrictHostKeyChecking=yes');
    expect(workflow).toContain('UserKnownHostsFile=');
    expect(workflow).toContain('secrets.DEPLOY_KNOWN_HOSTS');
    expect(workflow).not.toMatch(/ssh-keyscan/);
    expect(workflow).not.toMatch(/StrictHostKeyChecking=(no|accept-new)/);
  });

  it('connects as the deploy user with the key from a secret, in a private file, and sends no command', () => {
    expect(deploy).toContain('imnstr-deploy@$DEPLOY_HOST');
    expect(deploy).toContain('umask 077');
    expect(deploy).toContain('BatchMode=yes');
    for (const name of ['DEPLOY_HOST', 'DEPLOY_PORT', 'DEPLOY_KEY', 'DEPLOY_KNOWN_HOSTS']) {
      expect(deploy).toContain(`secrets.${name}`);
    }
  });

  it('prints no secret, and runs nothing under set -x', () => {
    expect(workflow).not.toMatch(/set -\w*x|bash -\w*x|ACTIONS_STEP_DEBUG/);
    for (const line of workflow.split('\n')) {
      if (/\b(echo|printf)\b/.test(line) && !/>\s*"\$(key|known_hosts)"/.test(line)) {
        expect(line).not.toMatch(/DEPLOY_KEY|DEPLOY_KNOWN_HOSTS|secrets\./);
      }
    }
  });

  it('fails when no DEPLOYED line comes back, and says whether it equals the pushed commit or is newer', () => {
    expect(deploy).toContain('^DEPLOYED ');
    expect(deploy).toContain('No DEPLOYED line came back');
    expect(deploy).toContain('GITHUB_SHA');
    expect(deploy).toContain('is the pushed commit');
    expect(deploy).toContain('is newer than the pushed commit');
    expect(deploy).toContain('pipefail');
  });
});

describe('deploy/imnstr-deploy.sh (CI-5, CI-6, CI-7, CI-10)', () => {
  it('stops on any error and any unset variable', () => {
    expect(deployLive).toMatch(/^set -euo pipefail$/m);
  });

  it('takes a non-blocking flock on the one lock file, and only fast-forwards', () => {
    expect(deployLive).toMatch(/"\$FLOCK" -n 9/);
    expect(deployLive).toContain('FLOCK="${IMNSTR_FLOCK:-flock}"');
    expect(deployLive).toContain('LOCK="${IMNSTR_LOCK:-/run/imnstr-deploy.lock}"');
    expect(deployLive).toContain('--ff-only');
    expect(deployLive).toContain('merge-base --is-ancestor');
  });

  it('defaults to the live locations on the box', () => {
    expect(deployLive).toContain('DIR="${IMNSTR_DIR:-/srv/imnstr}"');
    expect(deployLive).toContain('LIVE_CONF="${IMNSTR_LIVE_CONF:-/etc/nginx/sites-available/imnstr}"');
    expect(deployLive).toContain('INSTALLED="${IMNSTR_INSTALLED:-/usr/local/sbin/imnstr-deploy}"');
  });

  it('never resets, never prunes, never reloads or restarts Nginx', () => {
    expect(deployScript).not.toMatch(/reset --hard/);
    expect(deployScript).not.toMatch(/\bprune\b/);
    expect(deployLive).not.toMatch(/systemctl|nginx -s|NGINX" -s|service nginx/);
    expect(deployLive).not.toMatch(/\bgit (checkout|clean|stash)\b/);
  });

  it('runs no step under set -x, and never sources .env', () => {
    expect(deployScript).not.toMatch(/set -\w*x|bash -\w*x/);
    expect(deployLive).not.toMatch(/\bsource\b|^\s*\. /m);
    expect(deployLive).toContain("grep -E '^[[:space:]]*PRELAUNCH='");
  });

  it('runs the checks as an unprivileged user, from the new checkout, passing only the PRELAUNCH flag', () => {
    expect(deployLive).toContain('CHECK_USER="${IMNSTR_CHECK_USER:-nobody}"');
    expect(deployLive).toContain('"$RUNUSER" -u "$CHECK_USER" -- "$BASH_BIN" "$DIR/deploy/checks.sh" "$PRELAUNCH"');
  });

  it('waits for health for 120 s and names the step in each failure', () => {
    expect(deployLive).toContain('HEALTH_WAIT=120');
    expect(deployLive).toContain('--wait --wait-timeout "$HEALTH_WAIT"');
    for (const step of ['step build', 'step up', 'step health', 'step nginx', 'step checks']) {
      expect(deployLive).toContain(step);
    }
  });

  it('compares the three stop files against what is live, or between commits for the compose file', () => {
    expect(deployLive).toContain('git show "$NEW:deploy/nginx/imnstr.conf" | cmp -s - "$LIVE_CONF"');
    expect(deployLive).toContain('git show "$NEW:deploy/imnstr-deploy.sh" | cmp -s - "$INSTALLED"');
    expect(deployLive).toContain('git diff --quiet "$OLD" "$NEW" -- docker-compose.prod.yml');
  });

  it('ends with the DEPLOYED line', () => {
    expect(deployLive.trimEnd()).toMatch(/echo "DEPLOYED \$\(git rev-parse HEAD\)"$/);
  });
});

describe('deploy/checks.sh (CI-8)', () => {
  it('never names .env', () => {
    expect(checksScript).not.toMatch(/\.env\b/);
  });

  it('runs no step under set -x', () => {
    expect(checksScript).not.toMatch(/set -\w*x|bash -\w*x/);
  });

  it('expects the CSP the app sets, byte for byte', () => {
    expect(checksLive).toContain(`CSP="${CSP}"`);
  });

  it('takes the PRELAUNCH flag as its first argument, and refuses to guess it', () => {
    expect(checksLive).toContain('PRELAUNCH="${1:-}"');
    expect(checksLive).toContain('ORIGIN="${2:-https://imnstr.com}"');
    expect(checksLive).toContain('ROOT_APP_URL="${3:-https://m-root.com/}"');
    expect(checksLive).toContain('exit 64');
  });

  // Every item of deploy/README.md's "Checks after every deploy", as of B4b, by what it requests.
  it('covers each check the README listed', () => {
    const wanted = [
      'check_public / 200',
      'check_public /fa/ 200',
      'check_public /podcast 200',
      'check_public /fa/podcast 200',
      'check_public /no-such-page 404',
      'check_www_redirects_to_apex',
      'check_http_redirects_to_https',
      'check_admin_session_unauthenticated',
      'check_admin_entries_unauthenticated /admin/api/entries',
      'check_admin_entries_unauthenticated /admin/api/episodes',
      'check_admin_entries_unauthenticated /admin/api/no-such-route',
      'check_admin_origin_refused',
      'check_admin_signin_options',
      'check_test_routes_absent',
      'check_admin_shell /admin',
      'check_admin_shell /admin/setup/x',
      'check_admin_bundle js',
      'check_admin_bundle css',
      'check_root_app_answers',
    ];
    const calls = checksLive.slice(checksLive.indexOf('CHECK="start"')).split('\n');
    for (const call of wanted) expect(calls).toContain(call);
    expect(checksLive).toContain('"code":"UNAUTHENTICATED"');
    expect(checksLive).toContain('"code":"ORIGIN_REFUSED"');
    expect(checksLive).toContain('Origin: https://evil.example');
    expect(checksLive).toContain('"userVerification":"required"');
    expect(checksLive).toContain('/__test/auth');
    expect(checksLive).toContain('public, max-age=31536000, immutable');
    expect(checksLive).toContain('no-store');
  });

  it('names the failed check in its failure line, and stops at the first', () => {
    expect(checksLive).toMatch(/fail\(\) \{\n {2}echo "FAILED \$CHECK: \$\*"\n {2}exit 1\n\}/);
  });
});

describe('deploy/README.md and CLAUDE.md (CI-10)', () => {
  const readme = read('deploy/README.md');

  it('points the checks at checks.sh as the one list', () => {
    const section = readme.slice(readme.indexOf('### Checks after every deploy'));
    expect(section).toContain('deploy/checks.sh');
    expect(section).toMatch(/the one list/i);
  });

  it('keeps the manual path, and gains the rollback, the server setup and the exit codes', () => {
    expect(readme).toContain('sudo /usr/local/sbin/imnstr-deploy');
    expect(readme).toMatch(/^## Server setup for CI/m);
    expect(readme).toMatch(/^### Rolling back by hand/m);
    expect(readme).toMatch(/^### What each exit code means/m);
  });

  it('writes the sudoers file through /tmp and visudo -cf, never straight into /etc/sudoers.d', () => {
    expect(readme).toContain('visudo -cf');
    expect(readme).toMatch(/install -m 0440/);
    expect(readme).not.toMatch(/tee\s+\/etc\/sudoers\.d/);
  });

  it('names no secret: no private key, token or .env line', () => {
    expect(readme).not.toMatch(/BEGIN (OPENSSH|RSA|EC) PRIVATE KEY|ghp_|github_pat_/);
  });

  it('adds the one house line to CLAUDE.md', () => {
    expect(read('CLAUDE.md')).toContain('A push to `main` deploys. Only `verify` pushes `main`. A new deploy check goes in `deploy/checks.sh`.');
  });
});
