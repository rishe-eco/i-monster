#!/usr/bin/env bash
# The checks after every deploy: the one list (CI-8). Run by imnstr-deploy as an unprivileged
# user from the new checkout, and by hand from any machine:
#
#   bash deploy/checks.sh <prelaunch: 1|0> [origin] [root-app url]
#
# A stage that adds a deploy check adds it here, in its own diff, so nobody reinstalls the
# root-owned script to get it. It needs only bash, curl, grep, sed and tr. It never reads the server's environment file:
# imnstr-deploy tells it whether PRELAUNCH is set. It stops at the first failure and says which
# check failed, by function name, so the Actions log (which is public) names the step.
#
# It sends one POST (the sign-in options), which leaves a 5-minute challenge in the server's
# memory and nothing else. Everything else is a GET or HEAD.
set -uo pipefail

PRELAUNCH="${1:-}"
ORIGIN="${2:-https://imnstr.com}"
ROOT_APP_URL="${3:-https://m-root.com/}"

if [ "$PRELAUNCH" != 1 ] && [ "$PRELAUNCH" != 0 ]; then
  echo "usage: checks.sh <prelaunch: 1|0> [origin] [root-app url]" >&2
  exit 64
fi

# lib/headers.ts's CSP, byte for byte. tests/unit/ci-deploy.test.ts asserts the two agree.
CSP="default-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
HOST="${ORIGIN#https://}"
MAX_TIME=20

# ── Helpers ──

fail() {
  echo "FAILED $CHECK: $*"
  exit 1
}

# The last response, split into its headers and its body, with the carriage returns removed.
# Plain variables and here-strings, never a pipe into "grep -q": under pipefail, grep quitting on
# its first match would make the writer die of SIGPIPE and the check fail for no reason.
HEADERS=""
BODY=""

# fetch <curl args...>: -i so the headers come first. A transport failure is a failed check.
fetch() {
  local resp
  resp=$(curl -si --max-time "$MAX_TIME" "$@" | tr -d '\r') || fail "no answer from $*"
  [ -n "$resp" ] || fail "empty answer from $*"
  case "$resp" in
    *$'\n\n'*)
      HEADERS=${resp%%$'\n\n'*}
      BODY=${resp#*$'\n\n'}
      ;;
    *)
      HEADERS=$resp
      BODY=""
      ;;
  esac
}

status_of() { sed -n '1s/^HTTP\/[0-9.]* \([0-9][0-9]*\).*$/\1/p' <<<"$HEADERS"; }

# header <name>: the first value, or nothing. The name is matched case-insensitively.
header() { sed -n "/^$1:/I{s/^[^:]*:[[:space:]]*//;p;q}" <<<"$HEADERS"; }
has_header() { grep -qi "^$1:" <<<"$HEADERS"; }

expect_status() {
  local got
  got=$(status_of)
  [ "$got" = "$1" ] || fail "expected status $1, got '${got:-none}'"
}

expect_header() {
  local got
  got=$(header "$1")
  [ "$got" = "$2" ] || fail "header $1 is '${got:-absent}', expected '$2'"
}

expect_no_cookie() { ! has_header set-cookie || fail "a Set-Cookie header is present"; }

expect_body_has() { grep -qF -- "$1" <<<"$BODY" || fail "the body lacks $1"; }

# ── The checks ──

# check_public <path> <status>: the app's own security headers, no cookie, and noindex only
# while PRELAUNCH is set. Nginx adds no headers (PD-18), so these are the app's.
check_public() {
  CHECK="check_public $1"
  fetch -I "$ORIGIN$1"
  expect_status "$2"
  expect_header content-security-policy "$CSP"
  expect_header strict-transport-security "max-age=63072000"
  expect_header x-content-type-options "nosniff"
  has_header referrer-policy || fail "header referrer-policy is absent"
  has_header permissions-policy || fail "header permissions-policy is absent"
  expect_no_cookie
  if [ "$PRELAUNCH" = 1 ]; then
    expect_header x-robots-tag "noindex"
  else
    ! has_header x-robots-tag || fail "x-robots-tag is present, and PRELAUNCH is not set"
  fi
  echo "ok   $CHECK"
}

check_www_redirects_to_apex() {
  CHECK="check_www_redirects_to_apex"
  fetch -I "https://www.$HOST/"
  expect_status 301
  case "$(header location)" in
    "$ORIGIN"/*) ;;
    *) fail "location is '$(header location)', expected $ORIGIN/" ;;
  esac
  echo "ok   $CHECK"
}

check_http_redirects_to_https() {
  CHECK="check_http_redirects_to_https"
  fetch -I "http://$HOST/"
  expect_status 301
  case "$(header location)" in
    "$ORIGIN"/*) ;;
    *) fail "location is '$(header location)', expected $ORIGIN/" ;;
  esac
  echo "ok   $CHECK"
}

# The four admin API checks (B4a). The third also proves the server runs with ORIGIN set: a 403
# there would mean no passkey could ever sign in.
check_admin_session_unauthenticated() {
  CHECK="check_admin_session_unauthenticated"
  fetch "$ORIGIN/admin/api/session"
  expect_status 401
  expect_body_has '"code":"UNAUTHENTICATED"'
  expect_no_cookie
  echo "ok   $CHECK"
}

# The entry routes (B5) and the episode routes (B7) are behind the guard: signed out, each list and an
# unknown path under /admin/api are all the one 401 body, and none sets a cookie.
check_admin_entries_unauthenticated() {
  CHECK="check_admin_entries_unauthenticated $1"
  fetch "$ORIGIN$1"
  expect_status 401
  expect_body_has '"code":"UNAUTHENTICATED"'
  expect_no_cookie
  echo "ok   $CHECK"
}

check_admin_origin_refused() {
  CHECK="check_admin_origin_refused"
  fetch -X POST -H 'Origin: https://evil.example' "$ORIGIN/admin/api/auth/signin/options"
  expect_status 403
  expect_body_has '"code":"ORIGIN_REFUSED"'
  expect_no_cookie
  echo "ok   $CHECK"
}

check_admin_signin_options() {
  CHECK="check_admin_signin_options"
  fetch -X POST -H "Origin: $ORIGIN" "$ORIGIN/admin/api/auth/signin/options"
  expect_status 200
  expect_body_has "\"rpId\":\"$HOST\""
  expect_body_has '"userVerification":"required"'
  expect_no_cookie
  echo "ok   $CHECK"
}

# The /__test routes exist only with E2E_CLOCK=1, which the server refuses in production.
check_test_routes_absent() {
  CHECK="check_test_routes_absent"
  fetch "$ORIGIN/__test/auth"
  expect_status 404
  expect_no_cookie
  echo "ok   $CHECK"
}

# The two shell checks (B4b): one HTML shell for every admin path, never cached.
check_admin_shell() {
  CHECK="check_admin_shell $1"
  fetch -I "$ORIGIN$1"
  expect_status 200
  expect_header content-security-policy "$CSP"
  expect_header cache-control "no-store"
  expect_no_cookie
  echo "ok   $CHECK"
}

# The bundle's two (B4b): the script and the stylesheet the shell names, read from the shell.
check_admin_bundle() {
  CHECK="check_admin_bundle $1"
  local page url
  page=$(curl -s --max-time "$MAX_TIME" "$ORIGIN/admin") || fail "no answer from $ORIGIN/admin"
  url=$(printf '%s\n' "$page" | grep -oE "/assets/admin/[A-Za-z0-9._-]+\\.$1" | head -1 || true)
  [ -n "$url" ] || fail "the shell names no .$1 under /assets/admin/"
  fetch -I "$ORIGIN$url"
  expect_status 200
  expect_header cache-control "public, max-age=31536000, immutable"
  echo "ok   $CHECK"
}

# root-app is a tenant of the same box and nothing here may take it down.
check_root_app_answers() {
  CHECK="check_root_app_answers"
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time "$MAX_TIME" "$ROOT_APP_URL") || fail "no answer from $ROOT_APP_URL"
  [ "$code" = 200 ] || fail "$ROOT_APP_URL answered $code, expected 200"
  echo "ok   $CHECK"
}

CHECK="start"
check_public / 200
check_public /fa/ 200
check_public /podcast 200
check_public /fa/podcast 200
check_public /no-such-page 404
check_www_redirects_to_apex
check_http_redirects_to_https
check_admin_session_unauthenticated
check_admin_entries_unauthenticated /admin/api/entries
check_admin_entries_unauthenticated /admin/api/episodes
check_admin_entries_unauthenticated /admin/api/no-such-route
check_admin_origin_refused
check_admin_signin_options
check_test_routes_absent
check_admin_shell /admin
check_admin_shell /admin/setup/x
check_admin_bundle js
check_admin_bundle css
check_root_app_answers

echo "checks passed (PRELAUNCH=$PRELAUNCH)"
