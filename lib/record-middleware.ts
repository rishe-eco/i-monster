// The reader record's middleware (plan B8, PD-20). It runs after the handler,
// so it sees the status the handler chose, and it is mounted inside the ETag
// middleware: a conditional request that leaves as a 304 is still counted,
// as the 200 it stands for, because feed readers mostly poll conditionally.
//
// It must never change or break a response, so every failure is swallowed
// after logging the error alone (house rule 9: never the request).
import type { MiddlewareHandler } from 'hono';
import { now } from './clock.ts';
import type { AppEnv } from './context.ts';
import { recordMonth } from './dates.ts';
import type { Db } from './db.ts';
import type { Env } from './env.ts';
import { langFromPath } from './i18n.ts';
import { aggregatorOf, countFeed, countReferrer, countView, isBot, refererDomain, subscribersOf, targetOf } from './record.ts';
import { SESSION_COOKIE } from './sessions.ts';

// The cookie's name is looked for, never its value: the founder's own views
// aren't counted (D-8), and the session table is not touched.
const SESSION_COOKIE_NAME = new RegExp(`(?:^|;\\s*)__Host-${SESSION_COOKIE}=`);

export function recordMiddleware(db: Db, env: Env): MiddlewareHandler<AppEnv> {
  const ownHost = new URL(env.origin).hostname;
  return async (c, next) => {
    await next();
    try {
      if (c.req.method !== 'GET' || c.res.status !== 200) return;
      if (SESSION_COOKIE_NAME.test(c.req.header('cookie') ?? '')) return;
      const target = targetOf(langFromPath(c.req.path).path);
      if (!target) return;
      const lang = c.get('lang');
      const month = recordMonth(now(), env.siteTz);
      const userAgent = c.req.header('user-agent');
      if (target.kind === 'feed') {
        // Every feed reader is a bot, so R2 ignores the bot pattern.
        const subscribers = subscribersOf(userAgent);
        if (subscribers !== null) countFeed(db, month, lang, aggregatorOf(userAgent ?? ''), subscribers);
        return;
      }
      if (isBot(userAgent)) return;
      countView(db, month, lang, target.page);
      const domain = refererDomain(c.req.header('referer'), ownHost);
      if (domain) countReferrer(db, month, lang, domain);
    } catch (error) {
      console.error(error);
    }
  };
}
