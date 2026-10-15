# CD1 · Deploy on push to `main` — stage record

*Written by the reviewer (`verify CD1`, trial step 8c), 2026-10-15. Plan: change note `root-sot/imnstr/modules/01-website/changes/04-ci-deploy.md` 0.3, section CD1, which stands in for build plan §5. Card: `briefs/CD1.md` beside it; lane report `briefs/CD1.report.md`. Branch `cd1-ci-deploy`: the lane's `2ec5451` and `8fd95a9`, then the review's `faceda1`. Built on `main @ 4c2b9b2`, which had not moved, so the merge was a no-op. Pushed as `main @ faceda1`, deployed by hand, then switched on; this record's push is the first automatic deploy of a real commit (CI-11).*

## Built

- **`.github/workflows/deploy.yml`.** On a push to `main`, and by hand (`workflow_dispatch`).
  - `check`, on `ubuntu-24.04`, Node 24: `npm ci --ignore-scripts`, `shellcheck` on both deploy scripts (added at review), `npm run check`, `npm run build`, `npm test` with `TZ=UTC`. No Playwright.
  - `deploy`: needs `check`, only `refs/heads/main`, only while the repository variable `DEPLOY_ENABLED` is `true`; environment `production`; one at a time (`deploy-production`, never cancelled). It writes the key and the box's host key from secrets to `0600` files and makes one SSH connection as `imnstr-deploy` with no remote command (`StrictHostKeyChecking=yes`, no `ssh-keyscan`). It passes the remote exit code through and fails when no `DEPLOYED <sha>` comes back. It says whether that sha is the pushed commit or a newer one.
  - `permissions: contents: read`. Only `actions/checkout` v7.0.1 and `actions/setup-node` v7.1.0, each pinned by a full SHA from `git ls-remote` (checked again at review).
- **`deploy/imnstr-deploy.sh`,** the reference copy of `/usr/local/sbin/imnstr-deploy` (root, 0755). The steps are the note's twelve. The test overrides (`IMNSTR_*`) are all in one block at the top, and sudo's `env_reset` strips them on the box. Exit **0** deployed; **2** stopped with nothing changed (lock held, dirty tree, not a fast-forward, `imnstr.conf` differs from the live copy, the compose file changed, the installed script differs); **1** failed at a named step (`build`, `up`, `health`, `nginx`, `checks`), with no rollback.
- **`deploy/checks.sh`,** the one list of post-deploy checks: 14, one function each, stopping at the first `FAILED <check>: <why>`. It runs as `nobody` from the new checkout, never reads `.env`, and takes `PRELAUNCH` as its first argument (`1`/`0`). Its CSP string is pinned to `lib/headers.ts` by a unit test.
- **`deploy/README.md`:** *Routine deploys* is now "a push to `main`"; *Deploying by hand*; *What each exit code means*; *Rolling back by hand*; the checks section points at `checks.sh`; *Server setup for CI*, nine steps for a sudo user.
- **`CLAUDE.md`:** "A push to `main` deploys. Only `verify` pushes `main`. A new deploy check goes in `deploy/checks.sh`."
- **Tests:** `tests/unit/ci-deploy.test.ts` (the workflow and both scripts as text) and `tests/integration/deploy-script.test.ts` (the script run under bash against a local bare origin, a clone, a live conf, an installed copy, and stub `docker`, `nginx`, `runuser` and `flock`; every case in the note's *Tests*, plus "a failed build is not a deploy on re-run" and "all stop files named at once").

**The review changed** (`faceda1`):
- **The lock moved from `/run/lock/imnstr-deploy.lock` to `/run/imnstr-deploy.lock`.** `/run/lock` is world-writable, so another account on the shared box could create the file first and hold every deploy off with exit 2. Only root writes `/run`. A deviation from the note's step 1, for that reason.
- **The harness's stubs are written with mode 0755.** The script runs them by path; Git Bash ran them without a mode, and Linux, where CI runs the suite, would have refused them.
- **`shellcheck` runs in CI.** Docker Desktop was down for the lane and the review, so it had never run. The runner image ships it. Clean on the first run.

## Decided

- **An "already current" run still builds and runs `up -d`, and skips only the merge** (lane report item 5, accepted). The note said "checks only". But the checkout moves before the build, so after a failed build a re-run would find it current, check the old container and print `DEPLOYED <new sha>`: a false green. With the image cached, the build takes about a second (0.8 s on the box). The harness pins it.
- **Stop files are compared even when current,** and all that differ are named before exit 2.
- **Untracked files are ignored** by the clean-tree check: `.env`, `data/`, `backups/`.
- **A failed build leaves the checkout moved** (the merge comes first, as the note orders it), and the old container serving. The README says so.
- **The test text bans `reset --hard` and an unfiltered prune anywhere in the script, comments included.** Kept: a comment that names them is the easiest place for one to come back.
- **The `.ssh` directory and `authorized_keys` belong to root**, so the deploy user can't rewrite its own forced command. The sudoers file is made with `mktemp`.
- **`DEPLOY_HOST` is the box's address** and `DEPLOY_KNOWN_HOSTS` its ed25519 host key, made on the box.

**Where the note was wrong** (answered here; for the founder in F-10):
1. "Already current: skip steps 6–8" (above).
2. The lock's directory (above).
3. **The Actions log is not readable without signing in,** although the repository is public. The note's trap says the verify watches the run in the in-app browser. The run's and jobs' status do read from the public API (`api.github.com/repos/rishe-eco/i-monster/actions/runs`), and the founder can download a run's logs. This review used both.
4. **`DEPLOY_ENABLED` must be a repository variable.** Added first as a variable of the `production` environment, it left run 2's `deploy` skipped: a job's `if` is decided before its environment loads. The README's step 7 now says so.

## Owed

| What | To | Why |
|---|---|---|
| Prune old `imnstr` images on the box, filtered by label or repository, never a global prune | any deploy (S-16) | Note, *Not here* |
| The canon this change made stale (below) | founder (F-10) | Note |

## Flagged for close-out *(canon this stage made stale)*

From the note's list, for the founder to accept as **F-10**:
- **Config 0.3 §7:** *Routine deploy* and *Who deploys* (a push to `main`; the founder only for stop files, `.env` lines and one-off steps); *Checks after each deploy* (`deploy/checks.sh`, run by the script); the verify reads a run through the API or the founder's log download, not the browser.
- **Review checklist 0.3 §6:** the deploy user (CI-4: no groups, one sudoers command with `""`, root-owned `authorized_keys`); no global prune; "a stage that adds a deploy check edits `checks.sh`"; "before the push, check the diff for a stop file or a new `.env` line".
- **Build plan 0.5:** B2's goal ("redeployable with one command") and *Not here* ("each later stage deploys at its own verify"); §7's list of what is on the box (add `imnstr-deploy`, `/etc/sudoers.d/imnstr-deploy`, `/usr/local/sbin/imnstr-deploy`).
- **`brief-common.md`:** lanes never push, now also because a push to `main` deploys.

## Verification

**Run at review**, on `cd1-ci-deploy` after the fixes, on this machine (Windows, Git Bash):
- `npx vitest run tests/unit/ci-deploy.test.ts tests/integration/deploy-script.test.ts tests/unit/deploy.test.ts`: **3 files, 70 tests passed**.
- `npm run check`: clean. `bash -n` on both scripts: OK.
- `bash deploy/checks.sh 1` against the live site: **14 checks ok**, exit 0.
- The two pinned action SHAs, again with `git ls-remote --tags`: both match, and both are the newest tags.
- Not run here: `shellcheck` and the Linux `node:24` run. Docker Desktop still doesn't answer (`docker info` timed out). CI ran both instead (below).

**In CI** (`main @ faceda1`):
- [Run 1](https://github.com/rishe-eco/i-monster/actions/runs/38658195343), on the push: `check` green, with `shellcheck` clean, `npm run check`, `npm run build`, and `npm test` at **32 files, 599 tests passed** on `ubuntu-24.04` in UTC. This is the first Linux and UTC run of the whole suite, harness included. `deploy` skipped, since `DEPLOY_ENABLED` was unset (CI-2).
- [Run 2](https://github.com/rishe-eco/i-monster/actions/runs/38660955098), by hand: `deploy` skipped, because the variable had been set on the environment (above).
- [Run 3](https://github.com/rishe-eco/i-monster/actions/runs/38662284121), by hand, after the variable moved to the repository: **`check` and `deploy` green**. `deploy` took 26 s. It connected with the forced-command key, the box found the checkout current, built from cache, upped, and the checks passed. The job's verdict passed, so `DEPLOYED` equalled `faceda1` (CI-9).

**On the server** (pasted output, 2026-10-15, the founder as the sudo user `deploy`):
- `faceda1` deployed by hand with the three lines, which brought the scripts onto the box.
- Setup as *Server setup for CI* steps 2–5: `adduser` made `imnstr-deploy` (uid 1002, `/bin/sh`); `.ssh` and `authorized_keys` are root's, with the `restrict,command="sudo -n /usr/local/sbin/imnstr-deploy"` line; the sudoers file `parsed OK` under `visudo -cf` before `install -m 0440`, and the founder's own `sudo` still worked after; the script was installed as root 0755.
- **CI-4:** `id imnstr-deploy` shows `groups=1002(imnstr-deploy)`, so no `docker`. `sudo -l -U imnstr-deploy` lists `(root) NOPASSWD: /usr/local/sbin/imnstr-deploy ""`, with `env_reset` among the defaults. `sudo -u imnstr-deploy docker ps` is refused: `permission denied … docker.sock`.
- **`nobody` runs the checks:** `sudo runuser -u nobody -- bash /srv/imnstr/deploy/checks.sh 1` printed all 14 `ok` lines.
- **The installed script, by hand** (CI-10): `sudo /usr/local/sbin/imnstr-deploy` with the real `flock` and `runuser` printed `checkout already at faceda1…`. Then the cached build (0.8 s), `Container imnstr-imnstr-1 Healthy` (16.3 s), `nginx -t` OK, the 14 checks, `checks passed (PRELAUNCH=1)`, and `DEPLOYED faceda11c5b61eecbc1bca13402e5f837c7c9da1`.
- Compose `--wait --wait-timeout` and the `docker inspect` health string work against the box's Compose, which the stubs couldn't prove.

**How the checklist was checked.** §6 by reading and on the box: no Nginx reload anywhere in the script (`nginx -t` only), no prune, the conf and compose untouched (stop files), `E2E_CLOCK` untouched, commands for a sudo user. §2 rule 10 by reading and by test: no secret or `.env` line printed (the harness's `.env` holds a marker that must not reach the output), no `set -x`. §1, §3 to §5: the diff touches no app code, route, schema or UI.

**CI-11, the first automatic deploy of a real commit:** this record's push, `0cbfdc1`. [Run 4](https://github.com/rishe-eco/i-monster/actions/runs/38662817219), on the push, with no one at the box: `check` green in 29 s (00:56:00–00:56:29 UTC), then `deploy` green in 29 s (00:56:33–00:57:02). The job passes only when a `DEPLOYED` line comes back and equals the pushed commit or a newer one, and `main` held nothing newer, so the box deployed `0cbfdc1`. Its 14 checks passed, or the script would have exited 1. The log itself needs a signed-in viewer, so the `checks.sh` lines are the server paste above, from the same script. `https://imnstr.com/` answered 200 afterwards. This commit deploys again, harmlessly.

**Verified; on `main`, deployed by hand and by CI (CI-1 to CI-11).**
