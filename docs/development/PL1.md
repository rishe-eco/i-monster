# PL1 · Live-review polish — stage record

*Written by the reviewer (`verify PL1`, trial step 8c), 2026-10-18. A Change, not a plan stage: change note `root-sot/imnstr/modules/01-website/changes/05-live-review-polish.md` 0.2, whose PL1 section stands in for plan §5. Card: `briefs/PL1.md`. Lane report: `briefs/PL1.report.md` beside it. Branch `pl1-live-polish`: the lane's three commits on `main @ b894598` (`d0778c2` public pages, `49344a8` admin look, `29d92c7` admin rules and words), then the review's two commits. `main` had not moved, so there was nothing to merge in.*

## Built

The eleven step-9 findings: UX pass 2 F1–F5 (`05-ux-review.md` 0.2) and design review D1, D2, P1–P4 (`08-design-review.md` 0.1). **All eleven are fixed** by this stage; those review files stay as written.

**Public pages** (`d0778c2`)
- **P1 (PL-3).** The 404's owner line is "This is iMNSTR’s site." / "این سایت iMNSTR است.". The cookie joke is said once, by the footer.
- **P2 (PL-4).** `.big-row__title` and `.big-row--small .big-row__title` take `min(size, --fit-row-title)`. `--fit-row-title` in `tokens.css` is the container (`.wrap`) less the row's padding, gap and arrow, over 5.25 em (the widest word, "آموخته‌های"). It bites only when zoomed: an English row title keeps 34 px at 360. `base.css`'s `overflow-wrap` is untouched.
- **P4 (PL-6).** A skip link first in `<body>` (`views/layout.tsx`), key `skip`, full size and moved out of view by `translateY` (not clipped, so the tap-size check still measures it). `<main id="main" tabindex="-1">`.
- **F4 (PL-10).** `listPublished` and `listPublishedEpisodes` also return `newer`: `null` on the first page, `'first'` for the bare path, else a cursor, by the note's rule (read up to a page of items newer than the cursor, nearest first). `views/log.tsx` and `views/podcast.tsx` draw a Newer row (`rel="prev"`, `BackArrowIcon`, mirrored in Persian) before the Older row. `?before=` stays the only paging parameter. Keys `log.newer`, `podcast.newer`.

**Admin look** (`49344a8`)
- **D1 (PL-1).** `.btn--primary` is solid ink (`--button-fill` / `--button-ink`); `.btn--solid` is gone. The highlighter fills only a `<mark>` and a pressed Highlight tool. The passkey's Remove confirm is `btn--primary` (52 px); "Sign in again" turns ink.
- **D2 (PL-2).** Below `48em`, `.modal` is a bottom sheet: full width, bottom edge, top corners rounded, the page gutter as inline padding, `max(space-3, safe-area)` at the end. From `48em`, today's centred box.
- **P3 (PL-5).** One link has no caption row; with two or more, "Link 1", "Link 2"… (`copy.episode.link(n)`).
- **F5 (PL-11).** Every success notice sits directly above the actions, where `<FailureNotice>` is. A success shows only while the writer is idle and nothing failed. An edit that closes on success says so in the new-entry dock or directly above New episode, which `PodcastSection` scrolls into view. **Inside a dock, the "Published." notice drops its address line** (head, Open and Copy link on one row), at every width; outside a dock it keeps it.

**Admin rules and words** (`29d92c7`)
- **F1 (PL-7).** Each offer of kept text names it (`OfferName` in `writer.tsx`): an entry by its title or its opening words in its own quotes (`excerpt`, now in `shared/excerpt.ts`), an episode by its name or "No name yet". In the text's language and direction, through `Runs`.
- **F2 (PL-8).** `PUT entries/<id>` and `PUT episodes/<id>` read an optional `lang` (`LANG_INVALID` first). `updateEntry` and `updateEpisode` refuse a change on a row whose `first_published_at` is set with **`LANG_FIXED` (409)**, inside the transaction, and remember the language the save leaves (AC-42). The new forms' language lock is `busy || unanswered`; opened never-published drafts show the language control; edit buffers carry `lang`, and a buffer without one reads as the row's own.
- **F3 (PL-9).** `dateRefusal(date, today, current?)` in `lib/episodes.ts`: **`DATE_FUTURE` (400)** on POST and PUT for a date after today in `SITE_TZ`, except a PUT that sends the date the episode already has. The date field has `max`, `aria-invalid`, `aria-describedby` and the refusal under it; the dock stays quiet for it (`FailureNotice`'s `atField`).

**The review changed** (`2512cfe` fixes 1–4 and 6; `ce31487` fix 5):
1. **After the skip link, a focus ring framed the whole page.** `<main tabindex="-1">` takes focus, and `base.css`'s `:focus-visible` drew its 3 px ring round all of `main` (seen in the review's screenshots, both languages). `main:focus-visible` now draws none: the target isn't a control, and the next Tab starts inside it. The skip-link test asserts `outline-style: none` on `main`; it fails without the rule (`solid`) and passes with it (32 of 32, both schemes).
2. **`guessLang` moved into `lib/bidi.ts`** (house rule 4: bidi in one file). The lane wrote a second script test in `admin/writer.tsx` with narrower ranges (U+0600 to U+06FF, and A to Z) than the bidi runs use. It now counts the same `ARABIC` and `LATIN` ranges as `isolateRuns`. Four unit tests in `tests/unit/bidi.test.ts`.
3. **One `EpisodeName`.** `admin/episodes.tsx` drew the kept episode's name with its own copy of `EpisodeName`'s rule; it imports it from `episode-form.tsx` now.
5. **The landing page's sweep flaked** (`ce31487`, a test fix, not a page fix). It ran axe whenever the page was ready. Inside the intro's window (0.9 s to 2.9 s after load, then the letters' CSS transition) the hero shows i-MoNSTeR while its name is iMNSTR, and axe reports `label-content-name-mismatch`. The English landing sweep failed in two of the three full runs and passed alone. A throwaway check confirmed the cause: axe flags `.wordmark` while the intro shows the letters, and again just after the class goes, because CSS transitions run on real time, not on the page clock. The test now plays the intro out with `page.clock.runFor(3000)` and waits for the hidden letters to reach zero width. 20 of 20 on repeat, and the whole sweep file passes, 126 of 126. The test was B9's; PL1 only made the run long enough to hit the window more often.
6. **Two comments corrected:** `admin.css` said the highlighter also fills "a row under the pointer" (no such rule exists; the lane said so in item 5); `tokens.css` said 5 em where the fit divides by 5.25.

## Decided

The lane's calls (report item 4), accepted at review:
- **F5's URL line is dropped inside the dock at every width,** not only at 360 × 400. One rule is simpler than a height query, and Copy link still copies the address. With it dropped the dock is about 241 px of 400, leaving room for five editor lines.
- **F5 is a render rule** ("success only while idle and nothing failed"), not cleared state. Its "Saved" buttons keep their meaning.
- **`PodcastSection` scrolls New episode into view** (`block: 'end'`) when a closed form's notice appears there, so it isn't above the top at 360 × 400. The note didn't foresee the closed form.
- **P2 also fits `.big-row--small`** (the entry page's "More learnings"), the row that actually broke. The note's *Files* named only `.big-row__title`.
- **F1's guess for an old buffer** names the offer only. Resuming always uses the row's language (`resume.lang ?? loaded.lang`, and only for a never-published row).
- **F2's order in PUT:** `LANG_INVALID`, then the body, then `LANG_FIXED`. `lang` is sent only for a never-published row.
- **The Newer target for a hand-typed cursor** follows the rule as written and may not align with the pages a reader walks. Every page still has one URL.
- **AC-13's two tests no longer send `lang`** to a published row: it is read now, and PL-8's own tests cover the refusal. The leap-day test moved from 2028 to 2024 (PL-9).

**Where the note, card or brief was wrong** (report item 5, answered here):
1. The note's *Tests* said the lane runs the full suites; the card said the verify does (brief-common). The verify ran them (*Verification*).
2. The note's D1 named "row hover" as a place for the highlighter; no admin rule draws one. The sweep's new check allows only the pressed tool. For the spec revise: drop "row hover" from PL-1.
3. P2's *Files* missed `.big-row--small`; F5's trap gave no measure for "two lines in view"; F5 missed the closed new-episode form; `EditOffer`'s new prop touches `app.tsx` and `episodes.tsx`. All handled in the lane.
4. `brief-common` says every rendering test runs both languages and both schemes. For the admin, "language" is the entry's or episode's; the admin's chrome is English. The lane looped the item's language; the schemes are the two Playwright projects. That matches B5–B9.

**Seen at review, not changed:**
- **A lost answer, then a language change, on a row the form knows.** The new forms lock the language only while an unanswered send left no row known. If a Publish to a known row went unanswered and in fact landed, a switch then Publish gives `LANG_FIXED`, with the text kept and the refusal said. No second row and no second publish (AC-25 holds); the person switches back. Left as is: rare, safe, and said.
- **The wordmark's name while it is revealed.** B9 named the link "iMNSTR", the resting text. Revealed (the intro, hover, keyboard focus, a tap), the visible word is i-MoNSTeR, which doesn't contain the name, and axe calls that `label-content-name-mismatch` (WCAG 2.5.3). The sweep checks only the page at rest. A speech-input user is most likely to say the resting word, but the revealed state is what a keyboard user sees on focus. A design call, not PL1's: for the founder with V-3.
- **Two single failures with no fault found.** In the first full run, `polish.spec.ts` "an episode's frame … in Persian (PL-11)", dark, failed once (its error was cut from the output); it then passed 6 of 6 on repeat, and in the third full run. In the second run, light only, `sweep.spec.ts` "the podcast, empty" stalled in `expectNoMotion`'s `mouse.move` in the fresh reduced-motion context and hit the 30 s timeout. Each sweep test takes about 4 s, and it passed in the third full run and in the sweep file's rerun. Both are recorded as flakes; neither touches PL1's code paths.
- Two test helpers build dates with `new Date(Date.UTC(…))` / `Date.parse(today)`: pure arithmetic on fixed or server-given days, not the wall clock (house rule 5 holds; lint passes).

## Owed

| What | To | Why |
|---|---|---|
| Real Persian for `skip` (پرش به محتوا), `log.newer` (نوشته‌های تازه‌تر), `podcast.newer` (قسمت‌های تازه‌تر), `notFound.ownerLine` (این سایت {owner} است.) | the founder (F-2) | Placeholder, as all of `fa.ts` |
| The spec revise the note lists (*What this makes stale*): AC-42, §4.4's episode date, AC-30's Newer link; and PL-1 without "row hover" | a later `revise` (F-20) | The founder kept the spec at 0.4 |
| The skip link with VoiceOver and TalkBack; the bottom sheet on a real phone (browser bar, notch); the named offers read aloud | V-3, the phone check (V-7/V-9) | Past the ceiling |
| The 21 Oct episode on production keeps its date by PL-9's exception; from 21 Oct it is no longer in the future | nothing to do | The note's trap: PL1 landed on 18 Oct |

## Flagged for close-out *(canon this stage made stale)*

- Spec 0.4: AC-42 (a never-published draft may change language; a published or was-live one may not, `LANG_FIXED`); §4.4 Episode row (date not after today; an edit may keep its own, `DATE_FUTURE`); AC-30 (a Newer link past the first page).
- Build plan 0.8 §6.2: the codes gain `LANG_FIXED` (409) and `DATE_FUTURE` (400).
- Design README 0.2 *Components*: the primary button is solid ink everywhere in the admin (D1); dialogs are bottom sheets below 48em (D2); the skip link (P4).
- Change note 05 PL-1: "row hover" names a place the admin doesn't have.

## Verification

**Run at review** (PL-12), in the stage worktree, slot A (`PORT=4110`, `.tmp/e2e.db`), one heavy runner at a time:

| Run | On | `check` | Vitest | e2e (one worker, both schemes) |
|---|---|---|---|---|
| 1 | the lane's `29d92c7` | clean | **46 files, 1,009 passed** | **680 passed, 3 failed, 9 skipped**, 29.4 min. Failed: the English landing sweep, light and dark (fix 5), and `polish.spec` episode frame, Persian, dark (*Seen at review*) |
| 2 | the same, light project only | — | — | **353 passed, 1 failed**, 14.3 min. Failed: `sweep` "the podcast, empty", a stall (*Seen at review*). The English landing sweep passed |
| 3 | `2512cfe` (fixes 1–4, 6) | clean | **46 files, 1,013 passed** (+4 `guessLang`) | **682 passed, 1 failed, 9 skipped**, 29.1 min. Failed: the English landing sweep, light, with its error: `label-content-name-mismatch` on `.wordmark` (fix 5) |
| after fix 5 | `ce31487` | clean | — | `sweep.spec.ts:28` 20 of 20 (`--repeat-each=5`); the whole `sweep.spec.ts`, **126 passed** (4.3 min) |

So every e2e test has passed on the final code: 682 in run 3, and the one that failed there afterwards. The 9 skips are `auth.spec.ts`'s dark runs, by design. MS4 for comparison: 563 passed, 22.9 min. **No full run is wholly green in one go**; the run-1 and run-2 failures are recorded as flakes above. Other targeted runs: the skip-link tests, 32 of 32 (and failing without fix 1); `polish.spec.ts:118` dark 6 of 6; `polish.spec` plus the landing sweep in one run, 14 of 14; `bidi`, `house-rules`, `admin-copy` unit files, 44 passed.

**How the checklist was checked.**

*By test:*
- §1 nothing counts: no digits in the Newer/Older rows (`log.test`, `podcast.test`); AC-25: a draft that changes language keeps its row and key (`admin-entries.test` PL-8, one row); the two "lost answer, then another language" e2e tests pass unchanged; AC-43: an old buffer without `lang` opens in the row's language, and an unsaved language change comes back with Put them back (`polish-rules`).
- §2 rule 2 (CSP): no `style` attribute, no inline script, on every swept page and state, the skip link included. Rule 3: `LANG_FIXED` and `DATE_FUTURE` asserted by the bytes of the body (`admin-entries.test`, `admin-episodes.test`); every code has copy (`admin-copy.test`). Rule 5: PL-9 at the day boundary in `SITE_TZ`, on the fixed clock. Rule 7: no route added. Rule 8: both languages and both schemes.
- §5: axe, tap targets, no sideways scroll at 360 and 180, 200% text, forced colours and reduced motion on every public page (now with the middle pages of `/log` and `/podcast`) and every admin state; `brokenWords` at 180 on every row title; the highlighter only on the pressed tool (`highlightedButtons`); dialogs placed at 360 and 1280 (`expectDialogPlace`); primaries solid ink (`expectSolidInk`).

*By reading:*
- §2 rule 4 (fix 2 found the one breach); rule 9 (no `console.` or logging in the diff); §3 scope (inside note 05's PL1 and its *Not here*: no stop file, no migration, no `.env` line, no dependency, no route); §5 logical properties and tokens in the new CSS (`translateY` is a vertical move, not a side); the publish key and the language lock in both new forms (*Seen at review*, the lost-answer case).

*By hand, in Edge* (a throwaway `tests/e2e/zz-review.spec.ts`, deleted before commit; screenshots read by the reviewer, both schemes): the skip link focused and after Enter (fix 1 found here), both languages; `/log` and `/fa/log`'s middle page at 180 px (Newer and Older whole, arrows mirrored in Persian); both 404s; the Unpublish sheet at 360 × 800 and the centred box at 1280; "Unpublished", "Published" and the republish notice in the dock at 360 × 400; a new entry's "Published." in the dock (one row, no address); a named kept-text offer at 180 px in Persian («…»); the date refusal at its field; two links captioned Link 1 and Link 2 at 180 px.

**The ceiling** (review checklist §8): headers through Nginx at the deploy; screen readers, the sheet on a real phone and the named offers read aloud go to V-3; Persian copy to F-2.

*The deploy:* TBD
