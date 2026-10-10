// Every CHECK and both triggers, proven by direct SQL, not through a route
// (house rule 6). Instants are relative to a fixed NOW.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../../lib/db.ts';
import { newId } from '../../lib/ids.ts';
import { NOW, tempDb } from '../helpers.ts';

const t = tempDb();
const { db } = t;
afterAll(() => t.cleanup());

beforeEach(() => {
  // Deleting an episode cascades to its links, which a delete of the links alone
  // could not do for a published one (the trigger would refuse).
  for (const table of ['episode', 'entry', 'session', 'credential', 'auth_code', 'setting', 'record_view']) {
    db.exec(`DELETE FROM ${table}`);
  }
});

function addCredential(id = newId()): string {
  db.prepare("INSERT INTO credential (id, public_key, name, created_at) VALUES (?, x'00', 'phone', ?)").run(id, NOW);
  return id;
}

function entry(overrides: Record<string, unknown> = {}) {
  const row = {
    id: newId(),
    lang: 'en',
    title: null,
    body: '{}',
    state: 'draft',
    first_published_at: null,
    publish_key: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
  db.prepare(
    `INSERT INTO entry (id, lang, title, body, state, first_published_at, publish_key, created_at, updated_at)
     VALUES (@id, @lang, @title, @body, @state, @first_published_at, @publish_key, @created_at, @updated_at)`,
  ).run(row);
  return row.id;
}

function episode(overrides: Record<string, unknown> = {}) {
  const row = {
    id: newId(),
    lang: 'en',
    date: '2026-10-10',
    state: 'draft',
    first_published_at: null,
    publish_key: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
  db.prepare(
    `INSERT INTO episode (id, lang, date, state, first_published_at, publish_key, created_at, updated_at)
     VALUES (@id, @lang, @date, @state, @first_published_at, @publish_key, @created_at, @updated_at)`,
  ).run(row);
  return row.id;
}

function addLink(episodeId: string, position: number, url = 'https://example.com/x') {
  db.prepare('INSERT INTO episode_link (episode_id, position, label, url) VALUES (?, ?, ?, ?)').run(
    episodeId,
    position,
    'YouTube',
    url,
  );
}

describe('the connection', () => {
  it('has foreign keys on and WAL mode', () => {
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
  });

  it('has them on every connection, not just the first', () => {
    const second = openDb(t.path);
    try {
      expect(second.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(second.pragma('journal_mode', { simple: true })).toBe('wal');
    } finally {
      second.close();
    }
  });

  it('runs a migration once: opening again changes nothing', () => {
    const before = db.prepare('SELECT name FROM schema_migration').all();
    openDb(t.path).close();
    expect(db.prepare('SELECT name FROM schema_migration').all()).toEqual(before);
    expect(before).toEqual([{ name: '001_init.sql' }]);
  });

  it('creates every table of plan §6.3', () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(tables).toEqual(
      [
        'auth_code',
        'auth_throttle',
        'credential',
        'entry',
        'episode',
        'episode_link',
        'record_feed',
        'record_referrer',
        'record_view',
        'schema_migration',
        'session',
        'setting',
      ].sort(),
    );
  });
});

describe('entry', () => {
  it('refuses a language that is not en or fa', () => {
    expect(() => entry({ lang: 'de' })).toThrow(/CHECK constraint failed/);
    expect(() => entry({ lang: 'EN' })).toThrow(/CHECK constraint failed/);
    expect(entry({ lang: 'en' })).toBeTruthy();
    expect(entry({ lang: 'fa' })).toBeTruthy();
  });

  it('refuses a state that is not draft or published', () => {
    expect(() => entry({ state: 'archived' })).toThrow(/CHECK constraint failed/);
  });

  it('refuses a published entry with no first_published_at', () => {
    expect(() => entry({ state: 'published', first_published_at: null })).toThrow(/CHECK constraint failed/);
    expect(entry({ state: 'published', first_published_at: NOW })).toBeTruthy();
  });

  it('refuses publishing a draft by an update that leaves first_published_at empty', () => {
    const id = entry();
    expect(() => db.prepare("UPDATE entry SET state = 'published' WHERE id = ?").run(id)).toThrow(
      /CHECK constraint failed/,
    );
    db.prepare("UPDATE entry SET state = 'published', first_published_at = ? WHERE id = ?").run(NOW, id);
  });

  it('allows a draft that was once published (it keeps its date)', () => {
    expect(entry({ state: 'draft', first_published_at: NOW })).toBeTruthy();
  });

  it('requires a body', () => {
    expect(() => db.prepare("INSERT INTO entry (id, lang, state, created_at, updated_at) VALUES ('x', 'en', 'draft', 1, 1)").run()).toThrow(
      /NOT NULL constraint failed: entry.body/,
    );
  });

  it('keeps publish_key unique, and lets many entries have none', () => {
    entry({ publish_key: 'key-1' });
    expect(() => entry({ publish_key: 'key-1' })).toThrow(/UNIQUE constraint failed/);
    entry({ publish_key: null });
    entry({ publish_key: null });
  });

  it('keeps ids unique', () => {
    const id = entry();
    expect(() => entry({ id })).toThrow(/UNIQUE constraint failed/);
  });
});

describe('episode', () => {
  it('refuses a language that is not en or fa', () => {
    expect(() => episode({ lang: 'fr' })).toThrow(/CHECK constraint failed/);
  });

  it('refuses a state that is not draft or published', () => {
    expect(() => episode({ state: 'live' })).toThrow(/CHECK constraint failed/);
  });

  it('refuses a published episode with no first_published_at', () => {
    const id = episode();
    addLink(id, 0);
    expect(() => db.prepare("UPDATE episode SET state = 'published' WHERE id = ?").run(id)).toThrow(
      /CHECK constraint failed/,
    );
  });

  it('refuses a date that is not YYYY-MM-DD', () => {
    for (const date of ['2026-1-5', '10/10/2026', 'today', '', '2026-10-1x']) {
      expect(() => episode({ date })).toThrow(/CHECK constraint failed/);
    }
    expect(episode({ date: '2026-02-03' })).toBeTruthy();
  });

  it('needs only a language to be a draft', () => {
    const id = newId();
    db.prepare("INSERT INTO episode (id, lang, date, created_at, updated_at) VALUES (?, 'fa', '2026-10-10', 1, 1)").run(id);
    const row = db.prepare('SELECT name, description, tag1, tag2, state FROM episode WHERE id = ?').get(id);
    expect(row).toEqual({ name: null, description: null, tag1: null, tag2: null, state: 'draft' });
  });
});

describe('episode_link', () => {
  it('refuses a url that is not https', () => {
    const id = episode();
    for (const url of ['http://example.com', 'ftp://example.com', 'example.com', 'javascript:alert(1)', 'https:/x']) {
      expect(() => addLink(id, 0, url)).toThrow(/CHECK constraint failed/);
    }
    addLink(id, 0, 'https://example.com/ok');
  });

  it('requires a label', () => {
    const id = episode();
    expect(() =>
      db.prepare("INSERT INTO episode_link (episode_id, position, label, url) VALUES (?, 0, NULL, 'https://x.example')").run(id),
    ).toThrow(/NOT NULL constraint failed/);
  });

  it('refuses a link for an episode that does not exist (foreign keys are on)', () => {
    expect(() => addLink('nosuchid00', 0)).toThrow(/FOREIGN KEY constraint failed/);
  });

  it('refuses two links at one position of one episode', () => {
    const id = episode();
    addLink(id, 0);
    expect(() => addLink(id, 0)).toThrow(/UNIQUE constraint failed/);
  });
});

describe('trigger episode_last_link', () => {
  function publishedEpisode(links: number) {
    const id = episode();
    for (let i = 0; i < links; i++) addLink(id, i);
    db.prepare("UPDATE episode SET state = 'published', first_published_at = ? WHERE id = ?").run(NOW, id);
    return id;
  }

  it('refuses deleting the only link of a published episode', () => {
    const id = publishedEpisode(1);
    expect(() => db.prepare('DELETE FROM episode_link WHERE episode_id = ?').run(id)).toThrow(/LAST_LINK/);
    expect(db.prepare('SELECT count(*) AS n FROM episode_link WHERE episode_id = ?').get(id)).toEqual({ n: 1 });
  });

  it('allows deleting one link while another remains, then refuses the last', () => {
    const id = publishedEpisode(2);
    db.prepare('DELETE FROM episode_link WHERE episode_id = ? AND position = 0').run(id);
    expect(() => db.prepare('DELETE FROM episode_link WHERE episode_id = ? AND position = 1').run(id)).toThrow(
      /LAST_LINK/,
    );
  });

  it('refuses a delete of every link at once from a published episode', () => {
    const id = publishedEpisode(2);
    expect(() => db.prepare('DELETE FROM episode_link WHERE episode_id = ?').run(id)).toThrow(/LAST_LINK/);
  });

  it('allows deleting the only link of a draft', () => {
    const id = episode();
    addLink(id, 0);
    db.prepare('DELETE FROM episode_link WHERE episode_id = ?').run(id);
    expect(db.prepare('SELECT count(*) AS n FROM episode_link WHERE episode_id = ?').get(id)).toEqual({ n: 0 });
  });

  it('allows the last link to go once the episode is back to draft', () => {
    const id = publishedEpisode(1);
    db.prepare("UPDATE episode SET state = 'draft' WHERE id = ?").run(id);
    db.prepare('DELETE FROM episode_link WHERE episode_id = ?').run(id);
  });

  it('lets deleting the episode itself remove its links', () => {
    const id = publishedEpisode(1);
    db.prepare('DELETE FROM episode WHERE id = ?').run(id);
    expect(db.prepare('SELECT count(*) AS n FROM episode_link WHERE episode_id = ?').get(id)).toEqual({ n: 0 });
  });
});

describe('trigger episode_publish_needs_link', () => {
  it('refuses setting state to published with no link', () => {
    const id = episode({ first_published_at: NOW });
    expect(() => db.prepare("UPDATE episode SET state = 'published' WHERE id = ?").run(id)).toThrow(/LINK_REQUIRED/);
    expect(db.prepare('SELECT state FROM episode WHERE id = ?').get(id)).toEqual({ state: 'draft' });
  });

  it('allows it with one link', () => {
    const id = episode({ first_published_at: NOW });
    addLink(id, 0);
    db.prepare("UPDATE episode SET state = 'published' WHERE id = ?").run(id);
    expect(db.prepare('SELECT state FROM episode WHERE id = ?').get(id)).toEqual({ state: 'published' });
  });

  it('allows other updates to a draft with no link', () => {
    const id = episode();
    db.prepare("UPDATE episode SET name = 'Pilot', updated_at = ? WHERE id = ?").run(NOW + 1, id);
  });

  it('refuses an episode that is inserted already published, which can never have a link', () => {
    expect(() => episode({ state: 'published', first_published_at: NOW })).toThrow(/LINK_REQUIRED/);
  });
});

describe('credential and session', () => {
  it('refuses a credential with no name', () => {
    expect(() =>
      db.prepare("INSERT INTO credential (id, public_key, name, created_at) VALUES ('c1', x'00', NULL, 1)").run(),
    ).toThrow(/NOT NULL constraint failed: credential.name/);
  });

  it('refuses backup flags other than 0 and 1', () => {
    expect(() =>
      db
        .prepare("INSERT INTO credential (id, public_key, name, backup_eligible, created_at) VALUES ('c2', x'00', 'n', 2, 1)")
        .run(),
    ).toThrow(/CHECK constraint failed/);
    expect(() =>
      db
        .prepare("INSERT INTO credential (id, public_key, name, backed_up, created_at) VALUES ('c3', x'00', 'n', -1, 1)")
        .run(),
    ).toThrow(/CHECK constraint failed/);
  });

  function addSession(openedBy: string, device: string) {
    db.prepare(
      'INSERT INTO session (id_hash, opened_by, device_credential, csrf, created_at, last_seen_at, auth_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(newId(), openedBy, device, 'csrf', NOW, NOW, NOW);
  }

  const sessionCount = () => (db.prepare('SELECT count(*) AS n FROM session').get() as { n: number }).n;

  it('ends a session when the credential that opened it is deleted (AC-22)', () => {
    const phone = addCredential();
    addSession(phone, phone);
    db.prepare('DELETE FROM credential WHERE id = ?').run(phone);
    expect(sessionCount()).toBe(0);
  });

  it('ends a session when its device credential is deleted, though another opened it', () => {
    const phone = addCredential();
    const laptop = addCredential();
    addSession(phone, laptop);
    db.prepare('DELETE FROM credential WHERE id = ?').run(laptop);
    expect(sessionCount()).toBe(0);
  });

  it('keeps a session whose two credentials both remain', () => {
    const phone = addCredential();
    const laptop = addCredential();
    const other = addCredential();
    addSession(phone, laptop);
    db.prepare('DELETE FROM credential WHERE id = ?').run(other);
    expect(sessionCount()).toBe(1);
  });

  it('refuses a session for a credential that does not exist', () => {
    const phone = addCredential();
    expect(() => addSession('nosuchcred', phone)).toThrow(/FOREIGN KEY constraint failed/);
    expect(() => addSession(phone, 'nosuchcred')).toThrow(/FOREIGN KEY constraint failed/);
  });
});

describe('auth_code and auth_throttle', () => {
  const addCode = (kind: string, hash: string) =>
    db.prepare('INSERT INTO auth_code (id, kind, hash, expires_at) VALUES (?, ?, ?, ?)').run(newId(), kind, hash, NOW);

  it('refuses a kind that is not setup or enrol', () => {
    expect(() => addCode('reset', 'h1')).toThrow(/CHECK constraint failed/);
    addCode('setup', 'h2');
    addCode('enrol', 'h3');
  });

  it('keeps hashes unique', () => {
    addCode('setup', 'same');
    expect(() => addCode('enrol', 'same')).toThrow(/UNIQUE constraint failed/);
  });

  it('starts with its one row, and refuses a second', () => {
    expect(db.prepare('SELECT id, failures, last_failure_at FROM auth_throttle').all()).toEqual([
      { id: 1, failures: 0, last_failure_at: null },
    ]);
    expect(() => db.prepare('INSERT INTO auth_throttle (id, failures) VALUES (2, 0)').run()).toThrow(
      /CHECK constraint failed/,
    );
    expect(() => db.prepare('INSERT INTO auth_throttle (id, failures) VALUES (1, 0)').run()).toThrow(
      /UNIQUE constraint failed/,
    );
  });
});

describe('the reader record', () => {
  // AC-46: nothing per visitor. Each table is its key plus one number, and
  // no other column, so a column that could describe a visitor cannot be added by accident.
  const columns = (table: string) =>
    (db.pragma(`table_info(${table})`) as { name: string; pk: number }[]).map((c) => c.name);

  it('has no column but its key and one count', () => {
    expect(columns('record_view')).toEqual(['month', 'lang', 'page', 'views']);
    expect(columns('record_feed')).toEqual(['month', 'lang', 'aggregator', 'subscribers']);
    expect(columns('record_referrer')).toEqual(['month', 'lang', 'domain', 'count']);
  });

  it('has a composite primary key on every table', () => {
    for (const [table, key] of [
      ['record_view', ['month', 'lang', 'page']],
      ['record_feed', ['month', 'lang', 'aggregator']],
      ['record_referrer', ['month', 'lang', 'domain']],
    ] as const) {
      const pk = (db.pragma(`table_info(${table})`) as { name: string; pk: number }[])
        .filter((c) => c.pk > 0)
        .sort((a, b) => a.pk - b.pk)
        .map((c) => c.name);
      expect(pk).toEqual(key);
    }
  });

  it('refuses a language that is not en or fa', () => {
    expect(() => db.prepare("INSERT INTO record_view (month, lang, page, views) VALUES ('2026-10', 'de', '/', 1)").run()).toThrow(
      /CHECK constraint failed/,
    );
    expect(() =>
      db.prepare("INSERT INTO record_feed (month, lang, aggregator, subscribers) VALUES ('2026-10', 'de', 'x', 1)").run(),
    ).toThrow(/CHECK constraint failed/);
    expect(() =>
      db.prepare("INSERT INTO record_referrer (month, lang, domain, count) VALUES ('2026-10', 'de', 'x.example', 1)").run(),
    ).toThrow(/CHECK constraint failed/);
  });

  it('refuses a second row for the same key', () => {
    db.prepare("INSERT INTO record_view (month, lang, page, views) VALUES ('2026-10', 'en', '/', 1)").run();
    expect(() =>
      db.prepare("INSERT INTO record_view (month, lang, page, views) VALUES ('2026-10', 'en', '/', 2)").run(),
    ).toThrow(/UNIQUE constraint failed/);
    db.exec('DELETE FROM record_view');
  });
});

describe('setting', () => {
  it('holds one value per key', () => {
    db.prepare("INSERT INTO setting (key, value) VALUES ('last_language', 'fa')").run();
    expect(() => db.prepare("INSERT INTO setting (key, value) VALUES ('last_language', 'en')").run()).toThrow(
      /UNIQUE constraint failed/,
    );
    expect(() => db.prepare("INSERT INTO setting (key, value) VALUES ('empty', NULL)").run()).toThrow(
      /NOT NULL constraint failed/,
    );
  });
});
