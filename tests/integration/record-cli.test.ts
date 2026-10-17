// The two CLIs, `report` and `reset-content` (plan B8, PD-20, AC-47).
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resetClock, setNow } from '../../lib/clock.ts';
import { clearEntries, insertPublished } from '../../lib/entries.ts';
import { countFeed, countReferrer, countView, report } from '../../lib/record.ts';
import { docFromText } from '../../shared/doc.ts';
import { runReport } from '../../scripts/report.ts';
import { resetContent } from '../../scripts/reset-content.ts';
import { NOW, tempDb } from '../helpers.ts';

const t = tempDb();
afterAll(() => {
  resetClock();
  t.cleanup();
});

const count = (table: string) => (t.db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

beforeEach(() => {
  setNow(NOW);
  clearEntries(t.db);
  t.db.exec('DELETE FROM episode; DELETE FROM record_view; DELETE FROM record_feed; DELETE FROM record_referrer;');
  t.db.exec('DELETE FROM session; DELETE FROM credential; DELETE FROM auth_code; DELETE FROM setting; UPDATE auth_throttle SET failures = 0;');
});

describe('report', () => {
  it('prints, per language, pages, entries (title or opening words), the highest subscribers and referrers, most first', () => {
    insertPublished(t.db, { lang: 'en', id: 'a000000001', title: 'A titled entry', body: docFromText('Body one.') });
    insertPublished(t.db, {
      lang: 'en',
      id: 'a000000002',
      body: docFromText('An untitled entry that goes on and on for rather more than sixty characters of opening words.'),
    });
    countView(t.db, '2026-11', 'en', 'landing');
    for (let i = 0; i < 3; i += 1) countView(t.db, '2026-11', 'en', 'a000000001');
    for (let i = 0; i < 5; i += 1) countView(t.db, '2026-12', 'en', 'a000000002');
    // An entry that is gone, in Persian.
    countView(t.db, '2026-11', 'fa', 'zzzzzzzzzz');
    countFeed(t.db, '2026-11', 'en', 'Feedly', 12);
    countFeed(t.db, '2026-12', 'en', 'Feedly', 9);
    countFeed(t.db, '2026-12', 'en', 'Inoreader', 3);
    countReferrer(t.db, '2026-11', 'en', 'a.example');
    countReferrer(t.db, '2026-12', 'en', 'a.example');
    countReferrer(t.db, '2026-12', 'en', 'b.example');

    const text = runReport(['--from', '2026-11', '--to', '2026-12'], t.db);
    expect(text).toMatch(/landing\s+1/);
    // Most viewed entry first.
    expect(text.indexOf('/log/a000000002')).toBeLessThan(text.indexOf('/log/a000000001'));
    expect(text).toMatch(/\/log\/a000000001\s+3\s+A titled entry/);
    expect(text).toMatch(/\/log\/a000000002\s+5\s+An untitled entry that goes on and on for rather more than…/);
    expect(text).toContain('/fa/log/zzzzzzzzzz  1  (no longer an entry)');
    // The highest, not the sum, and most first.
    expect(text).toMatch(/Feedly {2}12\n\s+Inoreader {2}3/);
    expect(text).toMatch(/a\.example {2}2\n\s+b\.example {2}1/);
    // Persian has no reader reporting subscribers: it says so and estimates nothing.
    expect(text).toContain('No feed reader reported subscribers in this period.');
  });

  it('says there is no estimate when R2 is empty', () => {
    countView(t.db, '2026-11', 'en', 'log');
    const text = runReport(['--from', '2026-11'], t.db, Date.UTC(2026, 10, 15));
    expect(text.match(/No feed reader reported subscribers in this period\./g)).toHaveLength(2);
  });

  it('includes both months and nothing outside them', () => {
    countView(t.db, '2026-10', 'en', 'log');
    countView(t.db, '2026-11', 'en', 'log');
    countView(t.db, '2027-01', 'en', 'log');
    countView(t.db, '2027-02', 'en', 'log');
    const r = report(t.db, '2026-11', '2027-01');
    expect(r.langs.en.pages).toEqual([{ page: 'log', views: 2 }]);
  });

  it('defaults --to to this month in the site timezone', () => {
    // 20:31 UTC on 31 Oct is November in Tehran.
    const at = Date.UTC(2026, 9, 31, 20, 31, 0);
    countView(t.db, '2026-11', 'en', 'log');
    countView(t.db, '2026-12', 'en', 'log');
    expect(runReport(['--from', '2026-10'], t.db, at)).toMatch(/2026-10 to 2026-11/);
    expect(runReport(['--from', '2026-10'], t.db, at)).toMatch(/log\s+1\b/);
  });

  it('says when a month reached the key cap', () => {
    t.db.transaction(() => {
      const insert = t.db.prepare('INSERT INTO record_referrer VALUES (?, ?, ?, 1)');
      for (let i = 0; i < 500; i += 1) insert.run('2026-11', 'fa', `d${i}.example`);
    })();
    expect(runReport(['--from', '2026-11', '--to', '2026-11'], t.db)).toMatch(/Note: 2026-11 \(fa\) reached the limit/);
  });

  it('prints the usage for a bad month, a missing --from, an unknown flag, or from after to', () => {
    for (const argv of [[], ['--from', '2026-13'], ['--from', '26-11'], ['--from', '2026-11', '--to', 'soon'], ['--from', '2026-12', '--to', '2026-11'], ['--nope'], ['--from']]) {
      expect(() => runReport(argv, t.db), argv.join(' ')).toThrow(/^Usage: report --from YYYY-MM/);
    }
  });
});

describe('reset-content', () => {
  function seed() {
    insertPublished(t.db, { lang: 'en', id: 'a000000001', body: docFromText('Hello.') });
    t.db.exec(`
      INSERT INTO episode (id, lang, name, description, tag1, date, state, first_published_at, created_at, updated_at)
        VALUES ('e000000001', 'en', 'Name', 'Description', 'tag', '2026-10-10', 'draft', NULL, 1, 1);
      INSERT INTO episode_link (episode_id, position, label, url) VALUES ('e000000001', 0, 'Listen', 'https://example.org/e');
      UPDATE episode SET state = 'published', first_published_at = 1 WHERE id = 'e000000001';
      INSERT INTO credential (id, public_key, name, created_at) VALUES ('c1', x'00', 'Laptop', 1);
      INSERT INTO session (id_hash, opened_by, device_credential, csrf, created_at, last_seen_at, auth_at) VALUES ('s1', 'c1', 'c1', 'x', 1, 1, 1);
      INSERT INTO auth_code (id, kind, hash, expires_at) VALUES ('k1', 'setup', 'h1', 1);
      INSERT INTO setting (key, value) VALUES ('k', 'v');
      UPDATE auth_throttle SET failures = 2;
    `);
    countView(t.db, '2026-10', 'en', 'log');
    countFeed(t.db, '2026-10', 'en', 'Feedly', 3);
    countReferrer(t.db, '2026-10', 'en', 'example.org');
  }

  const kept = () => ['credential', 'session', 'auth_code', 'setting'].map(count);

  it('without --yes prints row counts and changes nothing', () => {
    seed();
    const text = resetContent([], t.db);
    expect(text).toContain('entry: 1 rows');
    expect(text).toContain('episode: 1 rows');
    expect(text).toContain('episode_link: 1 rows');
    expect(text).toContain('record_view: 1 rows');
    expect(text).toContain('record_feed: 1 rows');
    expect(text).toContain('record_referrer: 1 rows');
    expect(text).toContain('nothing was changed');
    expect(['entry', 'episode', 'episode_link', 'record_view', 'record_feed', 'record_referrer'].map(count)).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it('with --yes deletes entries, a published episode with its link, and the record, and keeps the auth tables and settings', () => {
    seed();
    expect((t.db.prepare("SELECT state FROM episode WHERE id = 'e000000001'").get() as { state: string }).state).toBe('published');
    const keptBefore = kept();
    resetContent(['--yes'], t.db);
    expect(['entry', 'episode', 'episode_link', 'record_view', 'record_feed', 'record_referrer'].map(count)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(kept()).toEqual(keptBefore);
    expect(keptBefore).toEqual([1, 1, 1, 1]);
    expect((t.db.prepare('SELECT failures FROM auth_throttle').get() as { failures: number }).failures).toBe(2);
  });

  it('is all or nothing: a failure part-way leaves everything in place', () => {
    seed();
    // A trigger that refuses the record delete makes the last step fail after entries and episodes went.
    t.db.exec("CREATE TRIGGER block_record BEFORE DELETE ON record_feed BEGIN SELECT RAISE(ABORT, 'BLOCKED'); END");
    try {
      expect(() => resetContent(['--yes'], t.db)).toThrow(/BLOCKED/);
      expect([count('entry'), count('episode'), count('episode_link'), count('record_view')]).toEqual([1, 1, 1, 1]);
    } finally {
      t.db.exec('DROP TRIGGER block_record');
    }
  });

  it('prints the usage for an unknown flag', () => {
    expect(() => resetContent(['--now'], t.db)).toThrow(/^Usage: reset-content/);
  });
});
