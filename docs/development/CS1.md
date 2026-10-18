# CS1 · Copy and longer sessions — stage record

*Written by the reviewer, 2026-10-18, in the session that verified PL1. A Change: change note `root-sot/imnstr/modules/01-website/changes/06-copy-and-sessions.md` 0.1, whose CS1 section stands in for plan §5. **No lane and no card:** the founder asked for "one more dev round before we close this session" and chose to have it built and verified here. Branch `cs1-copy-sessions` from `main @ d886160`.*

## Built

- **Sessions last 7 days idle and 30 days at most** (CS-1): `lib/limits.ts` `sessionIdleMs` and `sessionAbsoluteMs`, the founder's choice. `lib/sessions.ts` is unchanged: it already reads both from `limits`.
- **The cookie outlives the browser** (CS-2): `setSessionCookie` in `routes/admin-api.ts` adds `Max-Age` equal to the absolute limit (2,592,000 s). Without it the cookie was the browser's session cookie, and a browser that quits would have ended a 30-day session. The server still decides: an idle or old session is refused whatever the browser keeps. Sign-out and a refused session still clear it.
- **User verification stays required.** The PIN prompt (Windows Hello, Google Password Manager) still comes at each sign-in; there are just far fewer sign-ins. Re-authentication before passkey changes (5 min fresh) is unchanged.
- **The copy** (CS-3 to CS-7), in `locales/en.ts`, `locales/fa.ts`, `content/site.en.ts`, `content/site.fa.ts`:
  - "understand them" → "understand the world" / "بفهمم‌شان" → "دنیا را بفهمم", and the landing's meta description;
  - "Things I figured out…" → "Monster wrote…" on the landing row, the log's lede and its meta description, in both languages;
  - the Persian footer's "خوردشان" → "خوردشون";
  - the Tracker line without "on me first" / "اول روی خودم";
  - the Persian podcast name "تجربه زیسته یک هیولا" on the landing row, the podcast page (title and meta), the 404's link and the empty log's link. English stays "Monster Podcast"; the Persian nav stays "پادکست".
- **Tests** read the limits instead of "an hour": the integration tests from `limits`; the e2e tests through a new `PAST_IDLE` (8 days) in `tests/e2e/support.ts`. The cookie tests assert `Max-Age` (integration) and a 30-day `expires` on the browser's own clock (e2e, through `performance.timeOrigin`, since the repo bans `Date.now()`). The copy tests pin the new strings.

## Decided

- **`Max-Age`, not only longer limits.** The founder asked for the passkey "only once in a while". Longer server limits alone wouldn't do it, because the cookie died with the browser. Recorded in note 06 as part of CS-2.
- **`userVerification` stays `'required'`.** `'preferred'` would weaken the floor and wouldn't stop the platform authenticators asking.
- **A stolen, signed-in device** can now hold a session for up to 30 days, not 24 h. The answer stays the same: remove its passkey from another device, which ends its sessions at once (AC-22, AC-45).

**Seen, not changed:** the Persian strings are the reviewer's, from the founder's words, and the founder accepted them as previewed. Real Persian copy is still F-2.

## Owed

| What | To | Why |
|---|---|---|
| The spec, plan and checklist lines note 06 lists (*What this makes stale*) | a later `revise` (F-21) | The spec stays at 0.4 |
| The founder signs in once on each device after the deploy: sessions opened before it have browser-session cookies | the founder | Old cookies have no `Max-Age` |

## Flagged for close-out *(canon this stage made stale)*

- Spec 0.4 §4.3 and AC-10 (1 h / 24 h, NIST AAL2) → 7 days / 30 days and the cookie's `Max-Age`; the §4 risk table's two session rows.
- Build plan 0.8 §5 B4a (`validate`, AC-10's test line, "No 'remember me'"), §6.4's limits row.
- Review checklist 0.4 §4, "Expiry on the server".
- The design export's copy on plates 1, 2 and 13.

## Verification

**Run**, in the worktree, slot A, one heavy runner at a time:
- `npm run check`: clean.
- Vitest: **46 files, 1,013 passed**, with the new limits and the new cookie assertion.
- e2e, the full suite, one worker, both schemes: **680 passed, 3 failed, 9 skipped** (23.9 min). All three failures were tests I had edited while the run was going, and Playwright had loaded them before the edit: `admin-auth.spec.ts:588` (a 2 h jump to end a session; now `PAST_IDLE`), both schemes, and `auth.spec.ts:79` (the cookie's `expires: -1`, now 30 days). Rerun afterwards, `admin-auth.spec.ts` and `auth.spec.ts`: **39 passed, 9 skipped** (the skips are `auth.spec.ts`'s dark runs, by design). So every test passed on the final code, in the full run or the rerun.
- The sweeps (axe, tap sizes, 360 and 180 px with the broken-word check, 200% text, forced colours, reduced motion) ran over the landing, log and podcast pages with the new copy in both languages, inside the full run. The longer Persian podcast name keeps its words whole at 180 px.

**By reading:** house rule 4 (the two limits live only in `lib/limits.ts`; no test hard-codes an hour); §4 of the review checklist except the numbers this note changes (the cookie's attributes, CSRF, re-authentication, removal ending sessions, nothing on public routes); no stop file, migration, `.env` line or dependency in the diff.

*The deploy* (2026-10-18, `main @ 0d72f8a`): pushed by the reviewer with the founder's word in chat (`d886160..0d72f8a`). Run [39159994468](https://github.com/rishe-eco/i-monster/actions/runs/39159994468): `check` green 19:42:32–19:43:03 UTC, `deploy` green 19:43:07–19:43:37 UTC, which ran `deploy/checks.sh`. From this machine afterwards:
- `/`, `/fa/`, `/log`, `/fa/log`, `/podcast`, `/fa/podcast`, `/admin`: `200`; `/no-such-page`: `404`; each with the CSP and noindex and no `Set-Cookie` (`HEAD`). root-app's `https://m-root.com/`: `200`.
- The copy is live (`GET` with a curl user agent, a bot to the record): "understand the world", "Monster wrote, newest on top", "Where Root’s ideas get tried." on `/`; "دنیا را بفهمم", "هیولا نوشت، تازه‌ترین بالا", "تجربه زیسته یک هیولا", "هیولا خوردشون" and the Tracker line without "اول روی خودم" on `/fa/`; `/fa/podcast`'s title and description, and `/log`'s lede and description, as CS-4 and CS-7 say.
- The session change can't be seen without signing in. The founder's next sign-in on each device gets the 30-day cookie.
