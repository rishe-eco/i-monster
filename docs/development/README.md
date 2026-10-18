# Development

The build is nine stages, in the order of build plan §3 (`root-sot/imnstr/modules/01-website/07-build-plan.md`). Sizes are the plan's: **S** is about 1–2 h of lane time, **M** 2–4 h, **L** 4–6 h. A stage's record, `docs/development/<stage>.md`, is written by the reviewer when the stage merges: what was built, what was decided, what is owed, and how it was verified.

| Stage | What | Size | Depends on | Milestone | Status |
|---|---|---|---|---|---|
| B1 | Foundation: server, schema, dates, tokens and fonts, page shell in both languages, harness | L | P0-1 | MS1 (with B2) | verified 2026-10-11 · [record](B1.md) |
| B2 | Deploy: image, compose, Nginx, TLS, backups, log retention | S | B1, P0-2, P0-3 | MS1 | verified 2026-10-14 · [record](B2.md) |
| B3 | Public log and feed: doc schema, render, bidi, landing, `/log`, feed | L | B1 | MS2 | verified 2026-10-11 · [record](B3.md) |
| B4a | Passkeys and sessions (server) | L | B1 | MS2 | verified 2026-10-14 · [record](B4a.md) |
| B4b | Auth screens: sign-in, setup, passkeys, codes | M | B4a | MS2 | verified 2026-10-15 · [record](B4b.md) |
| CD1 | Deploy on push to `main`: workflow, root deploy script, `deploy/checks.sh` (change note 04, not in the plan's nine) | M | B2, B4b | — | verified 2026-10-15 · [record](CD1.md) |
| B5 | Entries API, admin shell, entries list | M | B3, B4b | MS3 | verified 2026-10-17 · [record](B5.md) |
| B6 | The editor: buffers, failures, in-place sign-in | L | B5 | MS3 | verified 2026-10-17 · [record](B6.md); E1 and the phone keyboard owed to V-7 |
| B7 | Podcast: public pages and the admin form | L | B6 | MS3 | verified 2026-10-17 · [record](B7.md); the phone and screen readers owed |
| B8 | Reader record | M | B3, B4a | MS3 | verified 2026-10-17 · [record](B8.md) |
| B9 | Motion, wordmark and the access sweep | M | B7 | MS4 | verified 2026-10-18 · [record](B9.md); a real phone tap and screen readers owed |

Milestones (plan §3). At each, the full suites run one at a time and the counts are recorded here.

- **MS1 (B1, B2):** the shell is live at `https://imnstr.com` with noindex; headers checked by `curl -I`; a backup restored once.
- **MS2 (B3, B4a, B4b):** the public log is readable, with entries seeded by the CLI; the founder signs in on a real phone and laptop.
- **MS3 (B5–B8):** every feature exists; E1 (M3, AC-15) has passed at B6.
- **MS4 (B9):** the launch gate: full suites and the access sweep pass.

### MS2 · 2026-10-15

Run in the main checkout on the milestone script (`root-sot/lifecycle/projects/imnstr/config.md` §6), one heavy runner at a time.

| Suite | Result | On |
|---|---|---|
| `npm run check` | clean | `main @ 4c2b9b2`, and again after CD1 |
| `npm test` | **32 files, 599 tests passed** (30 files, 549 tests before CD1's two test files) | after CD1 (`faceda1`) |
| `npm run e2e` | **213 passed, 9 skipped**, one worker (the skips are `auth.spec.ts`'s dark runs, by design) | `4c2b9b2` plus the one-worker fix; CD1 changed no app or e2e file |

**Fixed at the milestone:** the first full `npm run e2e` ran on two workers, the light and dark projects side by side against one server, database and test clock. Five enrolment-code tests in `admin-auth.spec.ts` failed on each other's state (208 passed, 5 failed). `playwright.config.ts` now sets `workers: 1`.

**By hand:**
- **Seeded on production by the CLI:** one English entry (titled) and one Persian (untitled), through `seed-entry` in the container. `/log`, `/fa/log` and both feeds answer `200` and list them. B8's `reset-content` clears them before launch.
- **Real passkeys, two computers:** the Windows desktop (Chrome, Google Password Manager) holds the first passkey, from B4b's setup token. The Ubuntu laptop (Chrome, Google Password Manager, a different Google account) was enrolled by code from the desktop's link. Each device signs in with its own passkey, and each list marks the right one "this device". The independence note shows.
- **`excludeCredentials` on Chrome with Google Password Manager,** Windows and Linux alike: "Add a passkey on this device" asks for the manager's PIN, then the page shows "This device already has a passkey for this site." Chrome shows no wording of its own.
- **Owed, with the phone (V-7):** a phone passkey; the hybrid (QR) sign-in, and "this device" after it (S-15); the QR scanned by a camera; the phone keyboard at 360 px; and **AC-24**, deferred by the founder (it runs again before launch anyway).

### MS3 · 2026-10-18

Run in the main checkout on the milestone script, one heavy runner at a time, all on `main @ ca1b2aa` (B7's deploy record, the last of B5–B8).

| Suite | Result | On |
|---|---|---|
| `npm ci --ignore-scripts` | 205 packages, 0 vulnerabilities | `ca1b2aa` |
| `npm run check` | clean | `ca1b2aa` |
| `npm test` | **45 files, 948 tests passed** (MS2: 32 files, 599), 62 s | `ca1b2aa` |
| `npm run e2e` | **445 passed, 9 skipped**, one worker, 12.4 min (MS2: 213 and 9). The skips are still `auth.spec.ts`'s dark runs, by design | `ca1b2aa` |

**Fixed at the milestone:** nothing. Every suite was green on the first run.

**By hand:**
- **Every feature is live,** checked by `curl` on 2026-10-18 (feeds by `HEAD`, so the reader record counts nothing): `/`, `/fa/`, `/log`, `/fa/log`, `/podcast`, `/fa/podcast` and `/admin` answer `200`; both feeds answer `200` as `application/atom+xml`; an unknown path answers each language's `404`; every response carries `X-Robots-Tag: noindex`, and `robots.txt` disallows all. Signed out, `/admin/api/session`, `…/entries` and `…/episodes` answer `401`; `/__test/clock` answers `404`. The admin bundle is served (`admin.8356b93061.js`, 310,540 B, uncompressed until F-17).
- **Content on production:** the founder published one episode from the admin on 2026-10-18 (B7's write path, live), and `/podcast` shows it. `/log` shows two English test entries dated 18 Oct (after the 10-17 `reset-content`); how they were made isn't recorded. `reset-content` clears all of it after E1, as plan §8 says.
- **Owed: E1 / M3 (AC-15), so MS3 is not closed.** The founder had no phone this session. E1, the phone keyboards and the episode form on a phone wait for the phone check (V-9, with V-7). MS3 closes when E1's warm median passes (eval plan §4.1).

Parallel lanes: never more than two at once. B2 and B3 can run together; B3 and B4a can run together; B5 and B8 can run together. The only shared file at risk is `app.ts`, which gains one line per stage.

## Owed

A stage that leaves something for a later one lists it in its own record, and it is copied here. Items for the founder are in `root-sot/imnstr/open-work.md`.

| What | To | From |
|---|---|---|
| ~~The 401 test that enumerates the admin router (house rule 7)~~ done | B4a | B1 |
| ~~Isolate inline Latin in the Persian copy through `lib/bidi.ts`; recheck the placeholder Persian~~ done | B3 | B1 |
| ~~Nav and 404 links to `/podcast` answer 404 until the route exists~~ done in B7 | B7 | B1 |
| ~~Insert an episode as a draft, add a link, then publish (extra trigger); supply `episode.date`, today in `SITE_TZ`~~ done in B7 (`createOrGet`'s `afterInsert`) | B7 | B1 |
| ~~Headers through Nginx and TLS, by `curl -I`~~ done | B2 | B1 |
| ~~Contrast of the dark colour pairs, measured~~ done (`tests/unit/contrast.test.ts`, V-2) | B9 | B1 |
| ~~Drop empty paragraphs before saving~~ done, on the server and in the client | B6 | B3 |
| ~~`docHasText` for `BODY_REQUIRED`~~ done | B5 | B3 |
| ~~Refuse XML-forbidden control characters in `DOC_INVALID`; strip them on paste~~ done | B6 | B3 |
| ~~Install with `npm ci --ignore-scripts` in the image~~ done | B2 | B3 |
| ~~`reset-content`; run it on production~~ done by the founder, 2026-10-17 | the founder | B3, B8 |
| ~~Tune `imnstr_auth`'s rate and burst against the real sign-in flow~~ kept at 30r/m burst 10, with a floor test | B4a | B2 |
| ~~Raise `client_max_body_size` (1m) if a request body needs more (S-9)~~ no change: entries 65,550 B (B6), episodes 159,392 B (B7) at most | B7 | B2 |
| Optional: `server_tokens off;` in `imnstr.conf` | any deploy | B2 |
| `gzip_types` for `text/javascript`, `text/css` and the feeds in `imnstr.conf` (only HTML is compressed; the editor's bundle goes out at 285 KB). A stop file: the founder's step | before E1's cold runs | B6 |
| ~~Contrast of B3's new dark pairs (dates, lede, empty state, feed link)~~ done in B9 | B9 | B3 |
| ~~JSON `NOT_FOUND` for an unknown `/admin/api` path when signed in~~ done | B5 | B4a |
| ~~Routers go inside `adminApiRoutes` after the guard, never under `auth/`~~ done in B5 and B7 | B5, B7 | B4a |
| ~~`@simplewebauthn/browser`; the `/admin/setup/<code>` page the CLI's link opens~~ done; each platform's `excludeCredentials` wording: Chrome with Google Password Manager done at MS2, the phone's owed | B4b, phone check (V-7) | B4a |
| "this device" after a hybrid sign-in names the other device's passkey (`device_credential` defaults to `opened_by`); look at it with a real hybrid sign-in | phone check (V-7) | B4b |
| Correct the stale "B4a puts routes here" comment in `imnstr.conf` | next conf change | B4a |
| Prune old `imnstr` images on the box, filtered by label or repository, never a global prune | any deploy | CD1 |
| ~~Copy link, Save and the editor in the edit-view frame~~ done; a session ends after a test-clock jump over an hour, so tests sign in after each jump | B6, B7 | B5 |
| Read `record_feed` after real subscriptions in two aggregators; correct `subscribersOf` and `aggregatorOf` (every format is a guess) | after MS3, MS4 at the latest | B8 |
| ~~`/podcast` and `/fa/podcast` count once they answer 200~~ done in B7, with a test | B7 | B8 |
| A stage that adds a deploy check adds it to `deploy/checks.sh`; a stop file (`imnstr.conf`, the compose file, `deploy/imnstr-deploy.sh`) or a new `.env` line in a stage's diff is planned before its push | every stage | CD1 |
| E1 / M3 (AC-15), warm and cold, five each per language; typing on real phone keyboards in both languages; the dock under a real keyboard; PD-7's fallback if typing fails | the phone check (V-7) | B6 |
| ~~B7's form reuses `buffers.ts` (kind `episode`), the failure notice and signing in over the text; its language stays fixed while a send is unanswered~~ done in B7 | B7 | B6 |
| Screen readers on the editor; ~~`forced-colors` for its `<mark>`~~ done in B9's sweep | step 9 | B6 |
| Real show links; platform marks for known platforms (every pill is the same until supplied); the episode form on a real phone (keyboard, native date picker); screen readers on the form | the founder (F-2), phone check (V-7), step 9 | B7 |
| A Persian name with `C++` or `.NET` in a plain `<input>` draws `++C` / `NET.` (no `<bdi>` in an input; the entry title too); ~~the date input clips its year at 180 px~~ done in B9 | V-4 | B7 |
| A real tap on the landing hero (iPhone and Android); screen readers on the wordmark; real browser text size and zoom in four browsers; Windows High Contrast | phone check (V-7, V-9), step 9 | B9 |
| A deploy check that `/` names a hashed `wordmark.js` that answers 200 | the next stage editing `deploy/checks.sh` | B9 |
