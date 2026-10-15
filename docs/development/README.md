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
| B5 | Entries API, admin shell, entries list | M | B3, B4b | MS3 | planned |
| B6 | The editor: buffers, failures, in-place sign-in | L | B5 | MS3 | planned |
| B7 | Podcast: public pages and the admin form | L | B6 | MS3 | planned |
| B8 | Reader record | M | B3, B4a | MS3 | planned |
| B9 | Motion, wordmark and the access sweep | M | B7 | MS4 | planned |

Milestones (plan §3). At each, the full suites run one at a time and the counts are recorded here.

- **MS1 (B1, B2):** the shell is live at `https://imnstr.com` with noindex; headers checked by `curl -I`; a backup restored once.
- **MS2 (B3, B4a, B4b):** the public log is readable, with entries seeded by the CLI; the founder signs in on a real phone and laptop.
- **MS3 (B5–B8):** every feature exists; E1 (M3, AC-15) has passed at B6.
- **MS4 (B9):** the launch gate: full suites and the access sweep pass.

Parallel lanes: never more than two at once. B2 and B3 can run together; B3 and B4a can run together; B5 and B8 can run together. The only shared file at risk is `app.ts`, which gains one line per stage.

## Owed

A stage that leaves something for a later one lists it in its own record, and it is copied here. Items for the founder are in `root-sot/imnstr/open-work.md`.

| What | To | From |
|---|---|---|
| ~~The 401 test that enumerates the admin router (house rule 7)~~ done | B4a | B1 |
| ~~Isolate inline Latin in the Persian copy through `lib/bidi.ts`; recheck the placeholder Persian~~ done | B3 | B1 |
| Nav and 404 links to `/podcast` answer 404 until the route exists (`/log` and the feed done in B3) | B7 | B1 |
| Insert an episode as a draft, add a link, then publish (extra trigger); supply `episode.date`, today in `SITE_TZ` | B7 | B1 |
| ~~Headers through Nginx and TLS, by `curl -I`~~ done | B2 | B1 |
| Contrast of the dark colour pairs, measured | B9 | B1 |
| Drop empty paragraphs before saving, or loosen `text+` in `shared/doc.ts` | B5, B6 | B3 |
| `docHasText` for `BODY_REQUIRED` | B5 | B3 |
| Refuse XML-forbidden control characters in `DOC_INVALID`, or strip them on paste (they are dropped at render now) | B5, B6 | B3 |
| ~~Install with `npm ci --ignore-scripts` in the image~~ done | B2 | B3 |
| Clear rows seeded on production with `reset-content` | B8 | B3 |
| ~~Tune `imnstr_auth`'s rate and burst against the real sign-in flow~~ kept at 30r/m burst 10, with a floor test | B4a | B2 |
| Raise `client_max_body_size` (1m) if a request body needs more | B5, B7 | B2 |
| Optional: `server_tokens off;` in `imnstr.conf` | any deploy | B2 |
| Contrast of B3's new dark pairs (dates, lede, empty state, feed link) | B9 | B3 |
| JSON `NOT_FOUND` for an unknown `/admin/api` path when signed in (now the public HTML 404) | B5 | B4a |
| Routers go inside `adminApiRoutes` after the guard, never under `auth/` (`auth-guard.test.ts` lists that prefix exactly) | B5, B7 | B4a |
| ~~`@simplewebauthn/browser`; the `/admin/setup/<code>` page the CLI's link opens~~ done; each platform's `excludeCredentials` wording moves to MS2 | B4b, MS2 | B4a |
| "this device" after a hybrid sign-in names the other device's passkey (`device_credential` defaults to `opened_by`); look at it with a real hybrid sign-in | MS2 | B4b |
| Correct the stale "B4a puts routes here" comment in `imnstr.conf` | next conf change | B4a |
| Prune old `imnstr` images on the box, filtered by label or repository, never a global prune | any deploy | CD1 |
| A stage that adds a deploy check adds it to `deploy/checks.sh`; a stop file (`imnstr.conf`, the compose file, `deploy/imnstr-deploy.sh`) or a new `.env` line in a stage's diff is planned before its push | every stage | CD1 |
