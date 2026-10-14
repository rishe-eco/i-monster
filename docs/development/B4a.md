# B4a · Passkeys and sessions (server) — stage record

*Written by the reviewer (`verify B4a`, trial step 8c), 2026-10-14. Plan: build plan 0.4 §5 B4a. Card: `root-sot/imnstr/modules/01-website/briefs/B4a.md`. Lane report: `briefs/B4a.report.md` beside it. Branch `b4a-auth-server`: the lane's `43cc2b3` and `2433e91`, then the review's `39d363e` and `19c6202`. Built on `main @ 76727e4`; fast-forwarded and pushed at the founder's word (`main @ 19c6202`), deployed, then this record.*

## Built

- **WebAuthn.** `lib/webauthn.ts` wraps `@simplewebauthn/server`. Attestation is `none`. Registration requires a resident key and `userVerification: 'required'`, and sends `excludeCredentials` for every stored passkey. Sign-in is discoverable, with no `allowCredentials`. Algorithms are pinned to ES256, RS256 and EdDSA. Challenges are kept in memory for 5 min and work once. Each is bound to its kind (sign-in, re-authentication, registration) and to a code's hash or a session's id hash, and the map is capped at 200. One WebAuthn user handle is kept in `setting.webauthn_user_handle`. The sign count and BE/BS are stored, and BS is updated at each assertion. Every library failure becomes `null`, so nothing quotes a challenge.
- **Sessions.** `lib/sessions.ts`, PD-13. The cookie is `__Host-imnstr_session` (`Secure; HttpOnly; SameSite=Strict; Path=/`, with no `Max-Age`) and holds 128 bits from `randomBytes`; only its SHA-256 is stored. The limits are 1 h idle and 24 h absolute, checked on the server. A re-authentication rotates the id and the CSRF token, moves `auth_at` and keeps `created_at`. `isFresh` is `< 5 min`. Expired rows are swept at sign-in.
- **Codes.** `lib/codes.ts`, PD-16:
  - the setup token is 128 bits of base64url, from the CLI;
  - the enrolment code is 60 bits of Crockford base32, `XXXX-XXXX-XXXX`, issued only from a fresh session;
  - both are hashed in `auth_code`;
  - `peekCode`/`redeemCode` do one lookup and always run `timingSafeEqual`, and the spend is one atomic `UPDATE`;
  - every refusal counts toward back-off.
- **Back-off, CSRF, Origin.** `lib/throttle.ts` (PD-15, on the clock), `lib/csrf.ts` and `lib/origin.ts` (PD-14).
- **Env.** `ORIGIN` in `lib/env.ts`: `https://imnstr.com` by default in production, `http://localhost:<PORT>` otherwise. The RP ID is its hostname. It must be a bare http(s) origin, and https in production.
- **The admin API.** `routes/admin-api.ts`, mounted by one line in `app.ts`:
  - the ceremonies under `auth/`;
  - `GET session`, `GET passkeys`, `DELETE passkeys/:id`, `POST enrolment-codes` (with the QR as an SVG data URL), `POST settings/independence-note/dismiss`.

  The guard is two `use('*')` steps: Origin on every write, then the session on everything outside `auth/`, then CSRF on writes, then `touch`.
- **CLI.** `scripts/setup-token.ts`, `npm run setup-token`. It prints the link and the expiry and writes nothing else. The README's *The CLIs* section gives the server command.
- **Test page.** `/__test/auth` and `/__test/auth.js` (`routes/test-auth.ts`, served from `routes/test.ts`), plus `POST /__test/auth/setup-token` and `DELETE /__test/auth`. All exist only with `E2E_CLOCK=1`.
- **Tests.**
  - `tests/softAuthenticator.ts` is an ES256 authenticator with UP, UV, BE and BS set on purpose and a rising sign count. `tests/authHelpers.ts` holds the cookie-carrying client.
  - Integration: `auth-ceremonies`, `auth-codes`, `auth-guard`, `auth-passkeys`, `auth-test-page`, `setup-token`.
  - e2e: `auth.spec.ts`, on Edge's virtual authenticator, one context per device.
  - `deploy.test.ts` pins the auth zone as a floor.

**The review changed** (`39d363e`, `19c6202`):
- **Enrolling by code now ends the session the request arrived with,** as sign-in already did. Before, the old row lived on until idle expiry, and anyone holding that id kept a live session (AC-10). New test, mutation-checked.
- **The browser's ceremony timeout is 5 min** (`limits.webauthnChallengeMs`), not the library's 60 s. 60 s is tight for a phone reached by QR (PD-17's hybrid sign-in, J3), and WebAuthn advises 5–10 min when user verification is required. Both options tests assert it.
- **The unguarded `auth/` prefix is pinned** to its seven ceremonies, so a route added there fails a test until a review places it. The four ceremonies that check a session themselves are proven to answer 401 without one. This answers the 8b block's question whether the enumeration stays complete with them outside it: yes, now.
- **The deploy checks gain a correct-Origin POST** (`deploy/README.md`): 200 with `"rpId":"imnstr.com"`. A wrong `NODE_ENV` or `ORIGIN` on the server would pass every other check and still break every sign-in.

## Decided

The lane's calls (report item 4), each accepted at review:

- **`__Host-` on `http://localhost` works in Edge,** so the cookie is the same everywhere, with no development exception. The card's "production keeps both" test has nothing to test.
- **S-8: `imnstr_auth` kept at `30r/m burst=10 nodelay`.** A ceremony is two requests. No conf change, so no reload. `deploy.test.ts` pins the numbers as a floor.
- **The guard covers unregistered paths,** so `/admin/api/<anything>` answers 401 signed out. Signed in, an unknown path gets the public HTML 404 (owed to B5).
- **`auth/reauth/*`, `auth/register/*` without a code, and `auth/signout`** check the session (and CSRF) themselves and don't `touch`; only the guard moves the idle clock. Sign-out with no session answers `{ok: true}`.
- **Back-off:** an attempt inside the wait is refused unchecked and changes nothing. Re-authentication failures and code refusals count; a redeemed code resets the count; a valid `peekCode` doesn't. A failed attestation doesn't spend the code and isn't counted (it needs a live code first).
- **Codes:** issuing an enrolment code voids the unused ones, so at most one is live. Issuing any code sweeps used and expired rows, so a used code then reads as unknown, with the same refusal. Setup tokens aren't voided by a new one. A typed code is read as Crockford base32.
- **Refusal codes beyond §6.2:** `REGISTRATION_FAILED` 400 (attestation, challenge or flags; one body), `REQUEST_INVALID` 400 (a name over 60 characters, or with control characters), and `NAME_REQUIRED` 400, from B7's list. Into the plan as 0.5 at the founder's word.
- **Delete order:** `REAUTH_REQUIRED`, `NOT_FOUND`, `LAST_PASSKEY`. A delete answers `{signedOut}` and clears the cookie if it ended this session.
- **`GET session`** answers 401 when signed out; signed in, it carries `csrf`, `fresh`, `deviceCredentialId` and `independenceNoteDismissed`.
- **The challenge cap (200, oldest dropped),** accepted at review. Options are open to anyone, so a flood from many addresses within 5 min could push out a pending challenge. The founder's attempt then fails once, and counts. Nginx bounds each address at 30 a minute, and the cost is a retry.
- **The CLI prints the expiry in UTC ISO** (`…Z`). That is unambiguous on a server; `lib/dates.ts` is for the site's own pages.

**Where the plan, card or brief was wrong** (report item 5, answered; build plan 0.5, 2026-10-14):
1. §6.2 lacked the codes for a failed registration and a bad name: added.
2. §6.1's `auth/*` row said "pre-session", but re-authentication, registration from a session and sign-out check a session inside it. The row now says so.
3. The plan wrote `test/softAuthenticator.ts`; it lives in `tests/`.
4. `npm run setup-token` prints npm's two banner lines first. The README says to ignore them.
5. No `/admin/setup/<token>` page exists yet, so the CLI's link 404s until B4b. No token is issued in production before then.
6. `imnstr.conf` still says "B4a puts routes here". Left as is, to avoid a conf change at this deploy; correct it at the next one.

## Owed

| What | To | Why |
|---|---|---|
| JSON `NOT_FOUND` for an unknown `/admin/api` path when signed in (`app.notFound` by prefix), rather than the public HTML 404 | B5 | The guard design; report item 5 |
| Later routers go inside `adminApiRoutes`, after the guard, and never under `auth/`: `auth-guard.test.ts` lists that prefix exactly | B5, B7 | Review |
| `@simplewebauthn/browser`; the `/admin/setup/<code>` page the CLI and enrolment links open | B4b | Card |
| How each platform words the `excludeCredentials` refusal (PD-17's unknown) | B4b | Plan |
| Real providers (iCloud, Google, Windows Hello, a hardware key): AAGUIDs, transports, sign count 0 on synced passkeys | MS2 | Ceiling |
| The stale "B4a puts routes here" comment in `imnstr.conf` | next conf change | Review |
| ~~The 401 test that enumerates the admin router (S-1)~~ done | B4a | B1 |
| ~~Tune `imnstr_auth` (S-8)~~ kept, with a floor test | B4a | B2 |

## Flagged for close-out *(canon this stage made stale)*

- Build plan 0.4 **§5 B4a** (`ORIGIN`; `GET session` 401; `tests/`; `routes/admin-api.ts`; the 5-min ceremony timeout; S-8 kept), **§6.1** (the `auth/*` row), **§6.2** (three codes): **done in build plan 0.5**, at the founder's word, 2026-10-14.
- `CLAUDE.md`: `ORIGIN` added to the variable list (done by the lane).

## Verification

**Run at review**, on `b4a-auth-server` after the fixes; `main` had not moved, so the merge was a no-op:
- `npm run check`: clean.
- `npx vitest run`: **29 files, 499 tests passed.** That includes the lane's 16 files and every file asserting a shared rule (`house-rules`, `headers`, `pages`, `env`, `deploy`, `test-routes`, `boot`, `db`). It also includes the review's 3 new tests and 2 new assertions.
- `PORT=4110 DB_PATH=.tmp/e2e.db E2E_CLOCK=1 npx playwright test tests/e2e/auth.spec.ts --workers=1`: **9 passed**; the 9 dark-scheme runs are skipped on purpose (no screens).
- The mutant for the enrolment fix (the old session left alive) fails the new test.

**How checklist §4 was checked.**

*By test:*
- registration and sign-in options;
- challenge expiry at 5 min, and a challenge working once;
- the token's and the code's lifetimes, single use, a race with one winner, and hashes only in the table;
- `CODE_REFUSED` and `SIGNIN_FAILED` compared by bytes, across every branch;
- the cookie's attributes and its rotation at sign-in, at re-authentication and now at enrolment;
- 1 h idle and 24 h absolute; server-side sign-out;
- CSRF and Origin, by bytes;
- back-off from the 4th failure, the 30 s cap, reset on success, and code refusals counted;
- freshness at 4:59 and 5:01;
- AC-22 and AC-45, with the cascade by direct SQL; AC-23;
- D-8: public pages identical with and without a cookie, and `last_seen_at` untouched;
- UV off is refused;
- nothing written to the console across a run of ceremonies.

*By reading:*
- the diff against checklist §1–§4, §6 and §7. Nothing counts: `addedAt` and the code's expiry are a date and a deadline the plan asks for. No cookie read on public routes. The only `console.` calls are the CLI's own output. No client address read. No `new Date()` without an argument. No migration. Dependencies as the card named them. Nothing from B4b or B5 built ahead.
- **Timing of `redeemCode`:** the same lookup and the same `timingSafeEqual` on equal-length hashes, hit or miss. Checked by reading only, not measured.
- The guard through the real Node server, not `app.request()`: `/admin/api/auth/../session`, `%2e%2e`, `..%2f`, `AUTH/..`, `./`, `//` and `%61uth/..` each gave 401 or the 404 page. None reached a guarded handler.

*By hand on this machine (Docker Desktop):* the image built from the branch and run as in production (`NODE_ENV=production`, `/data` on tmpfs as uid 1000):
- `npm run setup-token` inside the container printed the `https://imnstr.com/admin/setup/…` link and its expiry, and left one `setup` row holding a 64-character hash;
- the four API checks below, and the public headers.

*On the server* (pasted output, 2026-10-14 18:52 UTC; `main @ 19c6202`; image rebuilt; container `healthy`; no conf change):
- `curl -si /admin/api/session`: `401`, `{"code":"UNAUTHENTICATED"}`, `cache-control: no-store`, the CSP, no `Set-Cookie`.
- POST `auth/signin/options` with `Origin: https://evil.example`: `403`, `{"code":"ORIGIN_REFUSED"}`.
- The same with `Origin: https://imnstr.com`: `200`, `"rpId":"imnstr.com"`, `"timeout":300000`, `"userVerification":"required"`.
- `/__test/auth`: `404`.
- `curl -sI` on `/` and `/fa/`: `200`, CSP `default-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`, HSTS `max-age=63072000`, `nosniff`, `referrer-policy`, `permissions-policy`, `x-robots-tag: noindex`, no `Set-Cookie`. Unchanged from B2.
- root-app's own URL: not in the pasted output. Nothing on the box outside `/srv/imnstr` changed at this deploy.

**The ceiling** (review checklist §8):

| Item | Status |
|---|---|
| Headers through Nginx | **done**, above |
| Real passkeys on the founder's phone and laptop; hybrid sign-in; enrolment by code | owed, MS2 (needs B4b) |
| AC-24, independent credentials | owed, MS2 and before launch |
| Timing equality of `redeemCode`, measured | not measured; by reading |

Everything else on the list is not applicable to B4a.

**Verified; on `main` and deployed.**
