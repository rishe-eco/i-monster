// The contact page (change note 08, CT-2 to CT-7): the founder's links, then a form that posts to its own
// path with no script. The links come from the server's environment, so none is in the repo (CT-3). A refused
// post comes back as this same page with the values kept and the error next to each field (CT-5).
import { raw } from 'hono/html';
import type { FC } from 'hono/jsx';
import type { AssetManifest } from '../lib/assets.ts';
import { isolateLtr } from '../lib/bidi.ts';
import { CONTACT_FIELDS, CONTACT_MAX, type ContactField, type ContactInput, type ContactProblems } from '../lib/contact.ts';
import type { ContactLinks } from '../lib/env.ts';
import { formatNumber, localePath, strings, type Lang } from '../lib/i18n.ts';
import { ArrowIcon, ExternalIcon } from './icons.tsx';
import { Layout } from './layout.tsx';

/** What the page says above the form besides field errors: the thank-you, the daily cap, a post from elsewhere. */
export type ContactNotice = 'sent' | 'cap' | 'origin';

export interface ContactProps {
  lang: Lang;
  assets: AssetManifest;
  links: ContactLinks;
  /** What the fields start with: empty on a first visit and after a send, the typed text after a refusal. */
  values: ContactInput;
  problems: ContactProblems;
  notice: ContactNotice | null;
}

export const EMPTY_CONTACT: ContactInput = { subject: '', message: '', reach: '' };

const ID: Record<ContactField, string> = { subject: 'contact-subject', message: 'contact-message', reach: 'contact-reach' };

const Links: FC<{ lang: Lang; links: ContactLinks }> = ({ lang, links }) => {
  const t = strings(lang).contact;
  const rows: { key: string; label: string; href: string; value: string; external: boolean }[] = [];
  if (links.email) rows.push({ key: 'email', label: t.emailLabel, href: `mailto:${links.email}`, value: links.email, external: false });
  if (links.telegram) rows.push({ key: 'telegram', label: t.telegramLabel, href: `https://t.me/${links.telegram}`, value: `@${links.telegram}`, external: true });
  if (links.instagram) {
    rows.push({ key: 'instagram', label: t.instagramLabel, href: `https://www.instagram.com/${links.instagram}/`, value: `@${links.instagram}`, external: true });
  }
  // A link whose variable is unset isn't drawn, and nothing else on the page moves (CT-3).
  if (rows.length === 0) return null;
  return (
    <div class="rows rows--contact">
      {rows.map((row) => (
        // Outbound pages open in a new tab and carry rel="noopener" (AC-33); a mailto: link opens no page.
        <a class="big-row" href={row.href} target={row.external ? '_blank' : undefined} rel={row.external ? 'noopener' : undefined} data-link={row.key}>
          <span class="big-row__title">{row.label}</span>
          <span class="big-row__line">{raw(isolateLtr(row.value))}</span>
          {row.external ? <ExternalIcon class="big-row__arrow" /> : <ArrowIcon class="big-row__arrow" />}
        </a>
      ))}
    </div>
  );
};

export const Contact: FC<ContactProps> = ({ lang, assets, links, values, problems, notice }) => {
  const t = strings(lang).contact;
  const path = localePath(lang, '/contact');
  const label: Record<ContactField, string> = { subject: t.subjectLabel, message: t.messageLabel, reach: t.reachLabel };
  const emptyText: Record<ContactField, string> = { subject: t.subjectEmpty, message: t.messageEmpty, reach: t.reachEmpty };
  const problemText = (field: ContactField): string | null => {
    const problem = problems[field];
    if (!problem) return null;
    return problem === 'empty' ? emptyText[field] : t.tooLong.replace('{max}', formatNumber(CONTACT_MAX[field], lang));
  };
  const failed = CONTACT_FIELDS.filter((field) => problems[field]);

  const Field: FC<{ field: ContactField }> = ({ field }) => {
    const error = problemText(field);
    const hint = field === 'reach';
    // Each field is described by its hint and its error, so a screen reader reads them with it.
    const described = [hint ? `${ID[field]}-hint` : null, error ? `${ID[field]}-error` : null].filter(Boolean).join(' ') || undefined;
    const common = {
      id: ID[field],
      name: field,
      // The visitor may write in either language, whatever the page's.
      dir: 'auto' as const,
      'aria-required': 'true' as const,
      'aria-invalid': error ? ('true' as const) : undefined,
      'aria-describedby': described,
    };
    return (
      <div class="contact-field">
        <label class="contact-field__label" for={ID[field]}>
          {label[field]}
        </label>
        {hint ? (
          <p class="contact-field__hint" id={`${ID[field]}-hint`}>
            {t.reachHint}
          </p>
        ) : null}
        {field === 'message' ? (
          <textarea class="contact-field__input contact-field__input--message" rows={6} {...common}>
            {values[field]}
          </textarea>
        ) : (
          <input class="contact-field__input" type="text" value={values[field]} {...common} />
        )}
        {error ? (
          <p class="contact-field__error" id={`${ID[field]}-error`}>
            {error}
          </p>
        ) : null}
      </div>
    );
  };

  return (
    <Layout lang={lang} kind="contact" assets={assets} title={t.title} description={t.description} current="contact">
      <h1 class="page-title">{t.title}</h1>
      <p class="page-lede">{t.lede}</p>
      <Links lang={lang} links={links} />
      <section class="contact-form" aria-labelledby="contact-heading">
        <h2 class="contact-form__heading" id="contact-heading">
          {t.formHeading}
        </h2>
        {notice === 'sent' ? (
          <p class="contact-notice contact-notice--success" role="status">
            {t.sent}
          </p>
        ) : null}
        {notice === 'cap' || notice === 'origin' ? (
          <p class="contact-notice contact-notice--error" role="alert">
            {notice === 'origin' ? t.origin : links.email ? t.cap : t.capNoEmail}
          </p>
        ) : null}
        {failed.length > 0 ? (
          // The summary links to each field that needs a look; it takes focus on arrival, so a keyboard user starts there.
          <div class="contact-notice contact-notice--error contact-summary" role="alert" tabindex={-1} autofocus>
            <p>{t.errorSummary}</p>
            <ul class="contact-summary__list">
              {failed.map((field) => (
                <li>
                  <a href={`#${ID[field]}`}>{problemText(field)}</a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <form method="post" action={path} novalidate>
          <Field field="subject" />
          <Field field="message" />
          <Field field="reach" />
          {/* The honeypot: a field no visitor sees, so anything in it came from a script (CT-6). Hidden by a class. */}
          <div class="contact__trap" aria-hidden="true">
            <input type="text" name="website" tabindex={-1} autocomplete="off" />
          </div>
          <button class="contact-send" type="submit">
            {t.send}
          </button>
        </form>
      </section>
    </Layout>
  );
};
