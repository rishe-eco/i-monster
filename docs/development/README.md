# Development

The build is nine stages, in the order of build plan §3 (`root-sot/imnstr/modules/01-website/07-build-plan.md`). Sizes are the plan's: **S** is about 1–2 h of lane time, **M** 2–4 h, **L** 4–6 h. A stage's record, `docs/development/<stage>.md`, is written by the reviewer when the stage merges: what was built, what was decided, what is owed, and how it was verified.

| Stage | What | Size | Depends on | Milestone | Status |
|---|---|---|---|---|---|
| B1 | Foundation: server, schema, dates, tokens and fonts, page shell in both languages, harness | L | P0-1 | MS1 (with B2) | planned |
| B2 | Deploy: image, compose, Nginx, TLS, backups, log retention | S | B1, P0-2, P0-3 | MS1 | planned |
| B3 | Public log and feed: doc schema, render, bidi, landing, `/log`, feed | L | B1 | MS2 | planned |
| B4a | Passkeys and sessions (server) | L | B1 | MS2 | planned |
| B4b | Auth screens: sign-in, setup, passkeys, codes | M | B4a | MS2 | planned |
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

Nothing yet. A stage that leaves something for a later one lists it in its own record, and it is copied here.
