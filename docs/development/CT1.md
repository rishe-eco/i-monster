# CT1 · Writings, and the Contact page — stage record

*Written by the reviewer (`verify`, Opus), 2026-10-21. A Change: change note `root-sot/imnstr/modules/01-website/changes/08-change-contact-and-writings.md` 0.1, whose CT1 section stands in for plan §5; card `briefs/CT1.md`; lane report `briefs/CT1.report.md`. Built by a Sonnet lane on `ct1-contact-writings` from `main @ 6828da3`, reviewed and fixed in the same session.*

## Built

- **The log is "Writings" / «نوشته‌ها»** (CT-1): every place the section is named, in `locales/en.ts` and `fa.ts`, values only. `/log` and the feed's path are unchanged. The sentence on the landing page about what the site "learned" stays, as the note says.
- **A Contact page**, `/contact` and `/fa/contact` (CT-2): `routes/contact.tsx`, `views/contact.tsx`, a `contact` page kind in `lib/switch.ts`. Linked from the footer on every page, and from the header from 48em (the Feed link's breakpoint), so 360 px still fits.
- **The founder's links come from the server's environment** (CT-3): `CONTACT_EMAIL`, `CONTACT_TELEGRAM`, `CONTACT_INSTAGRAM` in `lib/env.ts`. An invalid value is dropped with one boot warning that names the variable, never its value. No real value is in the repo.
- **The form** (CT-4 to CT-7): subject, message, how to reach you, all required, posting to its own path with no script. Checks in order: origin, honeypot, fields, the site-wide cap (30 per rolling 24 h), store. Answers 303 (sent, or honeypot), 400, 403, 413 (over 128 KiB), 429. No cookie on any answer. `lib/contact.ts`, `lib/limits.ts`, `lib/origin.ts`.
- **Storage:** `migrations/002_contact_message.sql`, the three typed fields, language and time, nothing else (CT-7, CT-10).
- **Admin Messages** (CT-8, CT-9): `routes/admin-messages.ts` behind the guard (`GET`, `DELETE`), `admin/messages.tsx`, a section between Podcast and Passkeys, 20 at a time with "Older", no count.

## Decided

The lane's calls (report part 4), all **accepted**:
- lengths counted in code points, as SQLite's `length()` counts them, so code and CHECK agree;
- control characters dropped and CRLF normalised before the checks, so a crafted post can't reach a CHECK as a 500;
- `novalidate` and `aria-required` rather than native `required`/`maxlength`, so errors come in the page's language and a paste is never truncated;
- the 413 body limit through `hono/body-limit` (in Hono; no new dependency);
- `aria-current` in the footer for all three sections, not only Contact;
- `formatNumber` in `lib/i18n.ts` and `isolateLtr` in `lib/bidi.ts` (one rule, one file);
- a test route `DELETE /__test/messages` and `resetAdmin` calling it, and invented links in `playwright.config.ts`, needed because the e2e database persists and the cap would carry over.

The card's *Decided here* 1–6 stand as written.

**Changed at the review:** two e2e tests (see *Verification*); and the 429 notice pointed to "the email above" even when the server has no email link. It now says only "Try again tomorrow" then (`capNoEmail`), tested failing first (`fcc823e`).

**Accepted risk:** the honeypot field is named `website`, inside a `display: none` block with `autocomplete="off"`. A password manager that fills hidden fields would make a real message look sent and drop it. Not seen in Edge; noted, not changed.

## Owed

- **`deploy/checks.sh` has no `/contact` check.** `ci-deploy.test.ts` pins the script; adding one is a later Change. Checked by hand after this deploy instead.
- **The spec catch-up:** `revise --catch-up 08` (the note's *What this makes stale*).

## Flagged for close-out *(canon this stage made stale)*

- `02-spec.md`: §2 (pages), §3 "Not kept" (the form keeps what a visitor types), §4.1 (the admin), out of scope (comments, newsletter), and the section's name.
- `03-journeys.md`: no journey reaches the founder.
- `assets/css/tokens.css` quotes «آموخته‌های» in a comment as the longest row title (zoom fitting); harmless, but stale.

## Verification

| Item | How | Result |
|---|---|---|
| §1 nothing counts, public pages, auth floor, record | tests (`contact.test.ts` CT-7, `admin-messages.test.ts`, `auth-guard.test.ts`), reading | pass |
| §2 rules 1–10 | reading the diff (no `console.` of fields, no `new Date`, no `style=`, no address), tests | pass |
| §3 scope, dependencies, routes, schema | reading: `app.ts` gains one mount; one migration, which the note and card name | pass |
| §5 UI | the lane's screenshots at 360 px, both languages and schemes, looked at by the reviewer; the lane's access sweep (axe, targets, forced colours, zoom, reduced motion) | pass |
| Exercised | a server from the branch, by `curl`: valid post 303; cross-origin and `Sec-Fetch-Site: cross-site` 403; honeypot 303 with nothing stored; empty Persian post 400 with three `aria-invalid`; 5,001-character message 400; JSON 400; multipart 303; control characters dropped, markup stored as text; an invalid Instagram handle dropped with a warning naming only the variable | pass |

**Tests at the review** (fixed clock):
- `npm run check`: clean.
- Vitest: `tests/unit` and 9 integration files (contact, admin-messages, auth-guard, pages, log, feed, db, headers, podcast): **33 files, 759 passed**.
- Playwright (Edge, slot A, one worker, both schemes): `contact.spec.ts`, `admin-auth.spec.ts`, `admin-entries.spec.ts`: **91 passed, 3 failed**. Two failures were `admin-entries.spec.ts`'s list of admin sections, a test that changes on purpose (Messages joins it) that the lane hadn't run. The third was a race in `contact.spec.ts`'s CT-8 order check, which read the page straight after a reload, before the shell drew (light failed, dark passed). Both fixed in the tests; the two tests then ran three times each in both schemes: **18 passed**.
- The lane: 39 Vitest files, 965 passed; Playwright 416 + 130 passed across 10 specs.
- No full suites: a Change isn't a milestone. Flakes: none.
