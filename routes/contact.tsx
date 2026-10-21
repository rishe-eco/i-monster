// The contact page and its form, in both languages (change note 08, CT-2 to CT-7). GET draws the page; POST to the
// same path reads the form and answers with a redirect, or with the page and the reason it refused. No script, no
// cookie, and nothing about the sender is read or logged (house rule 9): the cap is site-wide for that reason.
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { now } from '../lib/clock.ts';
import { readContact, storeMessage, type ContactInput, type ContactProblems } from '../lib/contact.ts';
import type { AppEnv } from '../lib/context.ts';
import type { Db } from '../lib/db.ts';
import type { Env } from '../lib/env.ts';
import { localePath, type Lang } from '../lib/i18n.ts';
import { limits } from '../lib/limits.ts';
import { formOriginAllowed } from '../lib/origin.ts';
import { Contact, EMPTY_CONTACT, type ContactNotice } from '../views/contact.tsx';
import { page } from '../views/render.ts';

export function contactRoutes(db: Db, env: Env): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  const draw = (
    c: Context<AppEnv>,
    lang: Lang,
    state: { notice: ContactNotice | null; values?: ContactInput; problems?: ContactProblems },
    status: ContentfulStatusCode = 200,
  ) =>
    page(
      c,
      <Contact
        lang={lang}
        assets={c.get('assets')}
        links={env.contact}
        values={state.values ?? EMPTY_CONTACT}
        problems={state.problems ?? {}}
        notice={state.notice}
      />,
      status,
    );

  // `?sent=1` is the page after a send. It is the same page with a notice above the form, so it carries the same
  // headers as `/contact` and is never cached as the bare form (the headers middleware sets both the same way).
  const show = (lang: Lang) => (c: Context<AppEnv>) => draw(c, lang, { notice: c.req.query('sent') === '1' ? 'sent' : null });

  const send = (lang: Lang) => async (c: Context<AppEnv>) => {
    const sent = () => c.redirect(`${localePath(lang, '/contact')}?sent=1`, 303);

    // 1. Origin. The body isn't read for a post from elsewhere.
    if (!formOriginAllowed(env.origin, { origin: c.req.header('Origin'), secFetchSite: c.req.header('Sec-Fetch-Site') })) {
      return draw(c, lang, { notice: 'origin' }, 403);
    }

    // A body that isn't a form reads as no fields at all, and is refused as empty ones.
    const form: Record<string, unknown> = await c.req.parseBody().catch(() => ({}));

    // 2. The honeypot. A script that filled it is told it worked, and nothing is stored (CT-6).
    if (form.website !== undefined && form.website !== '') return sent();

    // 3. The fields. The typed values come back with the refusal, so nothing has to be written again (CT-5).
    const { input, problems } = readContact(form);
    if (Object.keys(problems).length > 0) return draw(c, lang, { notice: null, values: input, problems }, 400);

    // 4. The daily cap, and 5. the store, in one transaction.
    const stored = storeMessage(db, lang, input, now());
    if (!stored.stored) return draw(c, lang, { notice: 'cap', values: input }, 429);
    return sent();
  };

  // Past this the post is refused before it is read: far more than the three fields can hold (`limits.ts`).
  const small = bodyLimit({ maxSize: limits.contactBodyMaxBytes, onError: (c) => c.text('REQUEST_TOO_LARGE', 413) });

  routes.get('/contact', show('en'));
  routes.get('/fa/contact', show('fa'));
  routes.post('/contact', small, send('en'));
  routes.post('/fa/contact', small, send('fa'));
  return routes;
}
