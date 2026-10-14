# IMNSTR.com: house rules for the code

A bilingual personal site, English and Persian (right to left under `/fa/`). One Node 24 process: Hono server-rendered public pages, a Preact admin with a ProseMirror editor (later stages), `better-sqlite3`, passkeys through `@simplewebauthn`. It is **not part of Root**: no Root brand, code or conventions.

The plan, the spec and the design live in `E:\_root\root-sot\imnstr\modules\01-website\` (`07-build-plan.md`, `02-spec.md`, `04b-design/`). On what the site does, the spec wins. On the order and shape of the code, the plan wins. On what the code is now, the repository wins.

## The ten house rules (binding)

1. **Nothing counts.** No template, admin view or API response the admin renders carries a count, total, page number or elapsed time. Ids are not sequential (PD-6).
2. **Public pages:** no `Set-Cookie`, no third-party request, no inline `<script>` or `style` attribute in markup (CSP, PD-18), and no difference between a signed-in and a signed-out request.
3. **The API returns codes, never prose** (§6.2). The admin maps codes to English copy. Public strings live in `locales/en.ts` and `locales/fa.ts`, typed so a missing key fails to compile.
4. **One rule, one file:**
   - time limits in `lib/limits.ts`;
   - publish idempotency in `lib/publish.ts`;
   - dates in `lib/dates.ts`;
   - bidirectional isolation in `lib/bidi.ts`;
   - the body schema in `shared/doc.ts`;
   - the reader record in `lib/record.ts`, imported only by its middleware and the CLI.
5. **Time comes from `clock.now()`.** Tests run on a fixed clock, and fixtures are relative to it (lifecycle README §6, rule 8).
6. **Every CHECK and trigger is proven by a direct SQL statement** in the integration suite, not only through a route.
7. **Every admin API route is in the 401 test (AC-8).** The test enumerates the router, so a route added without the guard fails it.
8. **Both languages, and both colour modes,** in every test that renders a page.
9. **Never log** client addresses, user agents, codes, tokens, cookies or entry text. The app never reads the client address at all.
10. **Secrets never enter the repo.** It is public **[F]**: `.env.example` only, and setup tokens are printed, never written to a file.

## Code style

- TypeScript, strict. No `any` without a comment saying why. Imports carry their `.ts` / `.tsx` extension.
- Comments explain why, in full sentences. Match the surrounding code.
- CSS: **logical properties only** (`margin-inline-start`, never `left`), sizes in `rem`, colours, type and spacing from the tokens in `assets/css/tokens.css`. Breakpoints are in `em`.
- Time is `now()` from `lib/clock.ts`. Never `new Date()` or `Date.now()` anywhere else (lint and a test both enforce it).
- No new runtime dependency beyond plan §6.6.
- Each stage mounts its routes from its own `routes/<area>.ts`; `app.ts` gains one line per stage.

## Layout

`server.ts` boots; `app.ts` assembles. `lib/` holds the one-rule files, `routes/` the routes, `views/` the JSX pages, `locales/` the public strings, `content/` the landing content (placeholder until P0-6), `migrations/` the numbered SQL, `assets/` the CSS and self-hosted fonts (served hashed, built at startup, no build step), `admin/` the Preact admin bundle (the one thing that is built: Vite writes `dist/admin/admin.js` and `admin.css`, which the server hashes and serves like any asset), `tests/{unit,integration,e2e}/`, `docs/development/` the stage list and records.

## Commands

| | |
|---|---|
| `npm install --ignore-scripts` | once, at the repo root and in every new worktree (see *Environment*) |
| `npm run dev` / `npm start` | the server, on `PORT` (default 4100) |
| `npm run build` | the admin bundle, into `dist/admin/`. Production refuses to boot without it; Vitest and Playwright build it themselves when it is missing or stale. `npm run dev` doesn't, so run it once, and again after changing `admin/` |
| `npm test` | Vitest: unit and integration, one temporary SQLite file per test file |
| `npx vitest run tests/unit/dates.test.ts` | one file. A lane runs only its own files |
| `npm run e2e` | Playwright on Edge, both colour schemes, 360 px |
| `npm run check` | `tsc --noEmit` (the server, then `admin/`, which is Preact and has its own `tsconfig.json`) and ESLint. Cheap; run it before every commit |

An e2e run sets its server in the same Bash command (shell state does not persist between calls):
`PORT=4110 DB_PATH=.tmp/e2e.db E2E_CLOCK=1 npx playwright test tests/e2e/landing.spec.ts -g "name" --workers=1`

Environment variables are read only in `lib/env.ts` and listed in `.env.example`: `PORT`, `DB_PATH`, `SITE_TZ`, `E2E_CLOCK`, `PRELAUNCH`, `NODE_ENV`, `ORIGIN`. The server refuses to boot with `E2E_CLOCK=1` and `NODE_ENV=production`. `PRELAUNCH=1` adds `X-Robots-Tag: noindex` and a disallow-all `robots.txt`.

## Environment (the build machine)

Windows 10. The Bash tool runs Git Bash; npm runs package scripts through **cmd.exe**.

- **Install with `--ignore-scripts`** (`npm install` and `npm ci` alike). better-sqlite3 has a `binding.gyp`, so npm runs `node-gyp rebuild` for it, and that fails here: there is no Windows SDK. The package ships its own prebuilt binaries (`prebuilds/win32-x64.node`), which it loads at run time, so nothing needs compiling.
- Node 24. **No `VAR=value cmd` prefixes inside `package.json` scripts**: cmd.exe cannot run them. Set variables in the Bash command that runs the suite.
- **There is no Chrome.** Playwright runs on Edge (`channel: 'msedge'`). Do not install Playwright's Chromium.
- **No Docker in development.** SQLite is a file. The one exception is a deploy stage's review, which builds and runs the image once (Docker Desktop) before it reaches the server.
- **Background Bash commands ignore a leading `cd`.** Wrap them as `bash -c 'cd <worktree> && …'` and check the paths in the output.
- No access to the server from a lane: anything that needs the VPS is written as files and a README.

## Git

Work on your stage's branch from `main`. Add files by name, never `git add -A`. The repo is public: no secrets, no `.env`, no personal data in any commit.
