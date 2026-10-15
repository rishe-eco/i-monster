# B4b · Auth screens — stage record

*Written by the reviewer (`verify B4b`, trial step 8c), 2026-10-15. Plan: build plan 0.5 §5 B4b. Card: `root-sot/imnstr/modules/01-website/briefs/B4b.md`. Lane report: `briefs/B4b.report.md` beside it. Branch `b4b-auth-screens`: the lane's `8e0e524`, `fafa366` and `8cb1e99`, then the review's `7676c6c`. Built on `main @ d29166b`, which had not moved, so the merge was a no-op. Fast-forwarded and pushed at the founder's word (`main @ 10c5463`), deployed, then this record's server section.*

## Built

- **The admin bundle (PD-21).** `admin/`, Preact with no router and no state library. `vite build --config admin/vite.config.ts` (`npm run build`) writes one `dist/admin/admin.js` and one `admin.css` under fixed names, with no code splitting. Vite's own JSX transform points at Preact, so there is no preset. `admin/tsconfig.json` gives the bundle its own `jsxImportSource`, and `npm run check` now runs `tsc -p admin` too.
- **Serving.** `lib/assets.ts` hashes the two files like every other asset (`admin/admin.js|css`). With `NODE_ENV=production` the server refuses to boot without them. `routes/admin.tsx` serves one shell at `/admin`, `/admin/` and `/admin/setup/:code`. The shell is public, reads no cookie, holds no inline script or style, and carries `noindex`, `<noscript>`, the site's zone in a `<meta>`, and the English font preloads. `app.ts` gains one line.
- **The image** has two stages. The build stage runs `npm ci --ignore-scripts` and `npm run build`; the runtime stage is as before and copies `dist/admin` from it. `.dockerignore` keeps the host's `dist` out.
- **Screens** (plates 5, 6, 10, 12, 15):
  - sign-in, with the empty, labelled eyes slot, the generic failure, and a 5 s pause after 3 failures in a row (`limits.signInPauseMs`);
  - setup from a token or an enrolment code, with the name defaulting to the device type;
  - the Passkeys section: the list (name in `<bdi>`, "added" date, "this device"), Remove with its dialog, absent on the last passkey, with the W8 note; "Add a passkey on this device"; "Enrol another device" with the code, QR, link and Copy, and "Expired. Make a new code." after 10 min; the independence note until dismissed;
  - the "Signed out" screen after removing this device's own passkey (J3.11);
  - Sign out, last.
- **Re-authentication** is `withReauth` plus `ReauthHost` in `admin/reauth.tsx`, exported for B6. It asks only when the API answers `REAUTH_REQUIRED`, then retries once.
- **Copy** is in `admin/copy.ts`, keyed by the API's codes plus five client codes (`NETWORK`, `UNEXPECTED`, `CANCELLED`, `ALREADY_REGISTERED`, `UNSUPPORTED`). `InvalidStateError` becomes "This device already has a passkey for this site".
- **Shared rules** the bundle imports from the server: `lib/limits.ts` (with the new `passkeyNameMax` and `signInPauseMs`), `lib/dates.ts` (new `formatAdminDay`) and, since the review, `lib/passkey-name.ts`.
- **Tests.**
  - e2e: `tests/e2e/admin-auth.spec.ts`, two virtual authenticators in two contexts, both schemes, 360 × 800 and 360 × 380.
  - Unit: `admin-copy.test.ts` pins the copy's keys to the API's `STATUS` table.
  - Additions to `assets`, `headers`, `pages`, `deploy`, `house-rules` (the admin sources store nothing in the browser, have no inline style, and keep prose in `copy.ts`), `dates` and `limits`.
  - `tests/globalSetup.ts` builds the bundle for Vitest when it is missing or stale.

**The review changed** (`7676c6c`):
- **The passkey-name rule is in one file,** `lib/passkey-name.ts`. The lane had a second copy in the bundle, checked before the ceremony, beside the server's `cleanName` (house rule 4). Both now call `cleanPasskeyName`.
- **Removing the passkey that opened this session no longer says "This device can't sign in any more"** when the passkey isn't this device's own. The server signs the session out whenever the removed passkey opened it (AC-22). After a hybrid sign-in with another device's passkey and then "Add a passkey on this device", the device holds its own passkey and can still sign in. The screen now goes to sign-in with "You were signed out". New e2e test; it swaps the virtual authenticator to stand for the hybrid case.
- **Sign-out stays signed in when the server didn't hear it.** The lane's code showed the sign-in view whatever the answer was, so a network failure left a live session behind a screen that said otherwise. Now only success or 401 leave the shell; anything else shows the refusal. New e2e test; it aborts the request once.

## Decided

The lane's calls (report item 4), each accepted at review:

- **Vitest builds the real bundle** in a global setup (only when it is stale), so the integration tests read the bytes production serves. There is no stub manifest.
- **No wall clock in the bundle.** The 10 minutes, "Copied" and the sign-in pause are `setTimeout`s from `limits.ts`. The ban on `Date.now()` holds with no exemption. A device asleep past the 10 minutes can show the code a little longer; the server refuses it anyway, with the one `CODE_REFUSED` message.
- **The 401 on every signed-out visit stays.** The bundle probes `GET session`, which B4a answers with 401 by design, and the browser logs it. A `200 {signedIn:false}` would change the API for a console line.
- **No poll on the enrol panel.** A poll would be a heartbeat on the idle clock. The list reloads on Done; plate 12's "waiting…" row isn't built.
- **Remove's button says "Remove".** "Sign in again and remove" would be wrong while the session is still fresh.
- **The default name** is `phone`, `tablet` or `computer` from the user agent. "laptop" can't be told apart from a desktop.
- **The setup view reads the code's shape** only to pick its lede and hint. The address becomes `/admin` after success, so the code doesn't stay in the history.
- **`formatAdminDay` in `lib/dates.ts`,** with Vite's `define process.env = {}`, and the zone from the shell's `<meta>`.
- **Names in the list are wrapped in `<bdi>`,** not run through `lib/bidi.ts`. That file isolates entry bodies by language run; the admin is English, and a name is one isolated run.
- **`preact` stays in `dependencies`** as plan §6.6 lists it, though it is bundled; the runtime stage installs it for nothing.

**Where the card was wrong** (report item 5, answered here; nothing in the plan changes):
1. The header and no-`Set-Cookie` checks are in `headers.test.ts`, not `pages.test.ts`. The lane put them there.
2. `CLAUDE.md`'s "No Docker in development" was overridden by the card for the image check, which Docker Desktop then failed (below).

## Owed

| What | To | Why |
|---|---|---|
| "this device" after a hybrid sign-in names the other device's passkey: B4a's `device_credential` defaults to `opened_by`. Look at it with a real hybrid sign-in | MS2 | Review |
| Real providers and their `excludeCredentials` wording; a real phone at 360 px with its keyboard; the QR scanned by a camera | MS2 (V-7) | Ceiling |
| Contrast of the admin's dark pairs, measured | B9 (V-2) | Ceiling |
| ~~`@simplewebauthn/browser`; the `/admin/setup/<code>` page; the `excludeCredentials` refusal (S-13)~~ done; real wording moves to V-7 | B4b | B4a |

## Flagged for close-out *(canon this stage made stale)*

- None in the plan. `CLAUDE.md` (layout, `npm run build`, `check`) and `deploy/README.md` (the shell checks; the setup link now works) were updated by the lane.

## Verification

**Run at review**, on `b4b-auth-screens` after the fixes:
- `npm run check`: clean.
- `npx vitest run`, before the fixes: **30 files, 549 tests passed**. After them, the affected files (`tests/unit/*`, `assets`, `headers`, `pages`, `auth-guard`, `auth-passkeys`, `auth-ceremonies`, `auth-codes`): **21 files, 393 tests passed**.
- `PORT=4110 DB_PATH=.tmp/e2e.db E2E_CLOCK=1 npx playwright test tests/e2e/admin-auth.spec.ts tests/e2e/auth.spec.ts --workers=1`: **39 passed, 9 skipped.** The skips are `auth.spec.ts`'s dark runs, skipped by design. The 39 include the review's two new tests in both schemes.

**How the checklist was checked.**

*By test:* §4 as B4a left it (`auth.spec.ts` and the integration files, untouched), plus the screens' side: no storage of any kind in the bundle; `CODE_REFUSED` and `SIGNIN_FAILED` shown as one message each; re-authentication only when asked; the last passkey has no Remove and the server refuses it; AC-45 and now the opened-by case. §5: 360 px with no sideways scroll, 44 px targets and a label on every input, both schemes, the shorter viewport, no third-party request, no CSP violation (any console error but a 4xx load fails a test). The shell's headers: CSP, `no-store`, no `Set-Cookie`, the same bytes with and without a session cookie.

*By reading:* the diff against §1–§3, §5 and §7. Nothing counts: "added" is a date, and the code's life is stated, not counted down. No `console.` calls, no client address. No migration. Dependencies as §6.6 and the card name them. Nothing from B5 is built ahead; the editor, Entries and Podcast slots render nothing. Logical properties and tokens in `admin.css`, also asserted by `house-rules.test.ts`.

*By hand in Edge* (a script driving the branch's server at 360 px, light and dark): the sign-in view, a refused code, setup from a token, the shell after setup, and the enrol panel with QR and link. All read as the plates draw them, in both schemes.

*By hand on this machine (Docker Desktop):* the image built from the branch, both stages, and ran as in production (`NODE_ENV=production`, `/data` on tmpfs as uid 1000, `--memory 256m`):
- `/admin` and `/admin/setup/x`: `200`, `cache-control: no-store`, the CSP, `x-robots-tag: noindex`, no `Set-Cookie`;
- `/assets/admin/admin.<hash>.js`: `200`, `public, max-age=31536000, immutable`, `text/javascript`;
- `/`: unchanged;
- with `dist/admin` removed, boot exits 1 with "The admin bundle is missing … Run `npm run build` first";
- the running container used 61 MiB of its 256 MiB.

A second run, to measure the build stage under a 384 MiB cap, failed. Docker Desktop's VM disk went read-only again (`meta.db: read-only file system`). The cause is the build machine's `C:` drive, which has 0 GB free. That is also why the lane's build failed. The build stage's memory on the VPS is checked at this deploy instead.

*On the server* (pasted output, 2026-10-14 22:43–22:45 UTC; `main @ 10c5463`; image rebuilt in 19.5 s; no conf change):
- **The build stage fits.** After the build, `free -m` showed 1,209 MiB available of 7,951 MiB, with no swap. The reading from before the build wasn't in the paste.
- `curl -sI` on `/admin` and `/admin/setup/x`: `200`, `cache-control: no-store`, the CSP, HSTS, `nosniff`, `x-robots-tag: noindex`, no `Set-Cookie`. Both have the same ETag, so it is one shell for both paths.
- The shell names `/assets/admin/admin.0f06f373c2.js` and `admin.2609849a29.css`. Both return `200` with `public, max-age=31536000, immutable` and the right content type.
- `/` and `/fa/`: `200`, `no-cache`, the same CSP and headers as B4a's deploy, no `Set-Cookie`.
- `/admin/api/session`: `401`, 26 bytes of JSON, `no-store`.
- `npm run setup-token` in the container printed the `https://imnstr.com/admin/setup/…` link with a 30-minute expiry.
- **The first real passkey (V-7 starts).** The founder opened the link on their Windows desktop (Chrome, Google Password Manager), created the passkey, signed out, and signed back in. All of it worked. *Corrected at MS2, 2026-10-15: this record first said "phone".*
- Not in the pasted output: the container's health after `starting`, and root-app's own URL. Nothing outside `/srv/imnstr` changed at this deploy.

**The ceiling** (review checklist §8):

| Item | Status |
|---|---|
| Headers through Nginx | **done**, above |
| Real passkeys on the founder's phone and laptop; hybrid sign-in; enrolment by code | **desktop: done** (setup, sign-out, sign-in; first recorded as the phone, corrected at MS2); laptop and enrolment by code done at MS2; phone and hybrid sign-in owed (V-7) |
| AC-24, independent credentials | owed, MS2 and before launch |
| Contrast of the dark pairs | owed, B9 |

Everything else on the list doesn't apply to B4b.

**Verified; on `main` and deployed.**
