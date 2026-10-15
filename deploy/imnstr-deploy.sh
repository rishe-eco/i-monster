#!/usr/bin/env bash
# The reference copy of /usr/local/sbin/imnstr-deploy: the one script the deploy user may run, as
# root, through sudo, with no arguments. A push to main reaches it over SSH; the founder can run it
# by hand with `sudo /usr/local/sbin/imnstr-deploy`, which takes the same lock.
#
# It deploys origin/main as it finds it: fast-forward the checkout, build the image on this box,
# `up -d`, wait for healthy, `nginx -t`, then run deploy/checks.sh as an unprivileged user.
# It never changes Nginx, the compose file or itself. If any of the three changed it stops
# before it changes anything, and the founder does that part by hand (deploy/README.md).
#
# Exit codes
#   0  deployed, every check passed
#   2  stopped, and nothing was changed: the lock is held, the tree is dirty, main was rewritten,
#      or a file this script never installs changed (README: "What each exit code means")
#   1  failed after the checkout or the containers may have changed; the site is left as it is
#      (no rollback: migrations run at boot, so old code against a migrated database is worse)
#
# Nothing here prints a secret, because the log of the run is public. It never sources .env, never
# prints a line of it, and never traces its commands.
set -euo pipefail

# ── Overrides, for the test harness only ──
# Every path and command the script takes from its environment is in this block. On the box
# sudo's env_reset strips the environment of the deploy user, so none of these can be set from
# outside the SSH session; the defaults below are what runs there.
DIR="${IMNSTR_DIR:-/srv/imnstr}"
LOCK="${IMNSTR_LOCK:-/run/imnstr-deploy.lock}"
LIVE_CONF="${IMNSTR_LIVE_CONF:-/etc/nginx/sites-available/imnstr}"
INSTALLED="${IMNSTR_INSTALLED:-/usr/local/sbin/imnstr-deploy}"
CONTAINER="${IMNSTR_CONTAINER:-imnstr-imnstr-1}"
CHECK_USER="${IMNSTR_CHECK_USER:-nobody}"
FLOCK="${IMNSTR_FLOCK:-flock}"
DOCKER="${IMNSTR_DOCKER:-docker}"
NGINX="${IMNSTR_NGINX:-nginx}"
RUNUSER="${IMNSTR_RUNUSER:-runuser}"
BASH_BIN="${IMNSTR_BASH:-bash}"
# ── end of overrides ──

COMPOSE=(-f docker-compose.prod.yml)
HEALTH_WAIT=120
# Compose and git never ask a question: a prompt would hang a job with no terminal.
export GIT_TERMINAL_PROMPT=0

# stop <reason> <manual step>: exit 2. Nothing has been changed when this is called.
STOPPED=0
stop() {
  echo "STOP (exit 2, nothing changed): $1"
  echo "  By hand: $2"
  STOPPED=1
}

die() {
  echo "FAILED (exit 1): $1" >&2
  exit 1
}

# ── 1. The lock ──
# One deploy at a time, whether it came from CI or from the founder's shell. The file is in /run,
# which only root can write, not in the world-writable /run/lock, where another account on this
# shared box could plant it first and hold it.
exec 9>"$LOCK"
if ! "$FLOCK" -n 9; then
  echo "STOP (exit 2, nothing changed): another deploy holds $LOCK"
  echo "  By hand: wait for it to finish, then run this again"
  exit 2
fi

cd "$DIR"

# ── 2. A clean tree ──
# Untracked files (.env's neighbours, data/, backups/) are ignored on purpose: they are not
# the repository's, and a merge that would overwrite one refuses on its own.
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "STOP (exit 2, nothing changed): the checkout in $DIR has uncommitted changes"
  echo "  By hand: look at \`git status\` there, then commit, stash or discard them"
  exit 2
fi

# ── 3. Fetch ──
# Anonymous HTTPS; the repository is public.
if ! git fetch --quiet origin main; then
  echo "STOP (exit 2, nothing changed): git fetch origin main failed"
  echo "  By hand: check the box's network, then run this again"
  exit 2
fi
OLD=$(git rev-parse HEAD)
NEW=$(git rev-parse 'FETCH_HEAD^{commit}')

# ── 4. A fast-forward ──
# A rewritten main (as on 2026-10-14) is the founder's decision: the checkout is never reset.
if ! git merge-base --is-ancestor "$OLD" "$NEW"; then
  echo "STOP (exit 2, nothing changed): origin/main is not a fast-forward of the checkout (history was rewritten, or the checkout is ahead)"
  echo "  By hand: look at \`git log\` in $DIR against origin/main, and decide there"
  exit 2
fi

# ── 5. The three files this script never changes ──
# Each is compared with what is live, not with the last commit, so a manual fix followed by a
# re-run passes. The compose file has no live copy: it is compared between the two commits.
if ! git show "$NEW:deploy/nginx/imnstr.conf" | cmp -s - "$LIVE_CONF"; then
  stop "deploy/nginx/imnstr.conf in $NEW differs from the live $LIVE_CONF" \
    "copy it over the live file, \`nginx -t\`, reload (README, Routine deploys), then re-run the job"
fi
if ! git diff --quiet "$OLD" "$NEW" -- docker-compose.prod.yml; then
  stop "docker-compose.prod.yml changed between $OLD and $NEW" \
    "deploy by hand (README, Routine deploys), then re-run the job"
fi
if ! git show "$NEW:deploy/imnstr-deploy.sh" | cmp -s - "$INSTALLED"; then
  stop "deploy/imnstr-deploy.sh in $NEW differs from the installed $INSTALLED" \
    "reinstall it with \`install -o root -g root -m 0755\` (README, Server setup for CI), then re-run the job"
fi
if [ "$STOPPED" = 1 ]; then
  exit 2
fi

# ── 6. Move the checkout ──
# When it is already current this is skipped, and the rest still runs: the build is cached and
# `up -d` changes nothing, so a re-run gives a verdict on what is running, and a build that
# failed earlier cannot be mistaken for a deploy.
if [ "$OLD" != "$NEW" ]; then
  git merge --quiet --ff-only "$NEW" || die "git merge --ff-only $NEW"
  echo "checkout moved: $OLD -> $NEW"
else
  echo "checkout already at $NEW"
fi

# ── 7. Build ──
# A failed build leaves the running container untouched: nothing is stopped before it succeeds.
"$DOCKER" compose "${COMPOSE[@]}" build || die "step build: docker compose build failed; the old container keeps serving"

# ── 8. Up, and wait ──
"$DOCKER" compose "${COMPOSE[@]}" up -d --wait --wait-timeout "$HEALTH_WAIT" \
  || die "step up: docker compose up -d --wait did not finish within ${HEALTH_WAIT}s"

# ── 9. Health, then Nginx ──
HEALTH=$("$DOCKER" inspect --format '{{.State.Health.Status}}' "$CONTAINER") \
  || die "step health: docker inspect $CONTAINER failed"
[ "$HEALTH" = healthy ] || die "step health: $CONTAINER is '$HEALTH', not healthy"
"$NGINX" -t || die "step nginx: nginx -t failed (this script only reads it, and never reloads)"

# ── 10. PRELAUNCH ──
# Read with grep, never sourced, and never printed: checks.sh only needs to know whether to
# expect noindex. compose strips quotes in an env_file, so the value is stripped of them too.
PRELAUNCH=0
if [ -r "$DIR/.env" ]; then
  VALUE=$(grep -E '^[[:space:]]*PRELAUNCH=' "$DIR/.env" | tail -n 1 | cut -d= -f2- | tr -d "\"' \r" || true)
  if [ "$VALUE" = 1 ]; then PRELAUNCH=1; fi
fi

# ── 11. The checks, as an unprivileged user ──
# Repository code runs here, so it runs without any right of its own. They live in the repo, so
# a new check needs no reinstall of this script.
"$RUNUSER" -u "$CHECK_USER" -- "$BASH_BIN" "$DIR/deploy/checks.sh" "$PRELAUNCH" \
  || die "step checks: deploy/checks.sh failed (see the FAILED line above); the site is left on the new image"

# ── 12. The verdict ──
echo "DEPLOYED $(git rev-parse HEAD)"
