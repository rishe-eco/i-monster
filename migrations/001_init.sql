-- 001_init: the whole schema, landed in B1 so no later lane touches it (PD-5).
-- Instants are UTC milliseconds (INTEGER). Rules SQL can hold are held here as
-- well as in code (house rule 6), and each is proven by a direct SQL test.

-- ── Authentication ─────────────────────────────────────────────────────────

CREATE TABLE credential (
  id              TEXT    PRIMARY KEY,               -- the WebAuthn credential id
  public_key      BLOB    NOT NULL,
  sign_count      INTEGER NOT NULL DEFAULT 0,
  transports      TEXT,
  name            TEXT    NOT NULL,
  aaguid          TEXT,
  backup_eligible INTEGER NOT NULL DEFAULT 0 CHECK (backup_eligible IN (0, 1)),
  backed_up       INTEGER NOT NULL DEFAULT 0 CHECK (backed_up IN (0, 1)),
  created_at      INTEGER NOT NULL
);

-- Revocation keys on opened_by, "this device" on device_credential (PD-13).
-- They start equal. Removing either credential ends the session (AC-22).
CREATE TABLE session (
  id_hash           TEXT    PRIMARY KEY,             -- SHA-256 of the cookie value
  opened_by         TEXT    NOT NULL REFERENCES credential (id) ON DELETE CASCADE,
  device_credential TEXT    NOT NULL REFERENCES credential (id) ON DELETE CASCADE,
  csrf              TEXT    NOT NULL,
  created_at        INTEGER NOT NULL,
  last_seen_at      INTEGER NOT NULL,
  auth_at           INTEGER NOT NULL
);

CREATE TABLE auth_code (
  id         TEXT    PRIMARY KEY,
  kind       TEXT    NOT NULL CHECK (kind IN ('setup', 'enrol')),
  hash       TEXT    NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER
);

-- One account, so one row (PD-15). The CHECK keeps it to one.
CREATE TABLE auth_throttle (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  failures        INTEGER NOT NULL DEFAULT 0,
  last_failure_at INTEGER
);
INSERT INTO auth_throttle (id, failures) VALUES (1, 0);

CREATE TABLE setting (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ── Content ────────────────────────────────────────────────────────────────

-- Ids are random text, never a counter (PD-6, D-2). publish_key makes
-- publishing idempotent (AC-25); NULLs don't collide in a UNIQUE column.
CREATE TABLE entry (
  id                 TEXT    PRIMARY KEY,
  lang               TEXT    NOT NULL CHECK (lang IN ('en', 'fa')),
  title              TEXT,
  body               TEXT    NOT NULL,               -- ProseMirror document, JSON (PD-7)
  state              TEXT    NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'published')),
  first_published_at INTEGER,
  publish_key        TEXT    UNIQUE,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL,
  CHECK (state = 'draft' OR first_published_at IS NOT NULL)
);

-- An episode is "like an entry" in id, language, state, dates and publish key,
-- but its content is a name, a description, tags and links, not a title and a
-- body (spec §4.4). A draft needs only a language (PD-23), so the content
-- columns are nullable; the code refuses to publish without them.
CREATE TABLE episode (
  id                 TEXT    PRIMARY KEY,
  lang               TEXT    NOT NULL CHECK (lang IN ('en', 'fa')),
  name               TEXT,
  description        TEXT,
  tag1               TEXT,
  tag2               TEXT,
  date               TEXT    NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  state              TEXT    NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'published')),
  first_published_at INTEGER,
  publish_key        TEXT    UNIQUE,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL,
  CHECK (state = 'draft' OR first_published_at IS NOT NULL)
);

CREATE TABLE episode_link (
  episode_id TEXT    NOT NULL REFERENCES episode (id) ON DELETE CASCADE,
  position   INTEGER NOT NULL,
  label      TEXT    NOT NULL,
  url        TEXT    NOT NULL CHECK (url LIKE 'https://%'),
  PRIMARY KEY (episode_id, position)
);

-- A published episode keeps at least one link (AC-17). Deleting the episode
-- itself cascades past this: the parent row is already gone when it runs.
CREATE TRIGGER episode_last_link
BEFORE DELETE ON episode_link
WHEN (SELECT state FROM episode WHERE id = OLD.episode_id) = 'published'
 AND (SELECT count(*) FROM episode_link WHERE episode_id = OLD.episode_id) <= 1
BEGIN
  SELECT RAISE(ABORT, 'LAST_LINK');
END;

-- An episode can't be published without a link (AC-17). Two triggers, one
-- rule: an UPDATE of state, and an INSERT that is born published, which can
-- never have a link because links need the episode to exist first.
CREATE TRIGGER episode_publish_needs_link
BEFORE UPDATE OF state ON episode
WHEN NEW.state = 'published'
 AND NOT EXISTS (SELECT 1 FROM episode_link WHERE episode_id = NEW.id)
BEGIN
  SELECT RAISE(ABORT, 'LINK_REQUIRED');
END;

CREATE TRIGGER episode_publish_needs_link_on_insert
BEFORE INSERT ON episode
WHEN NEW.state = 'published'
BEGIN
  SELECT RAISE(ABORT, 'LINK_REQUIRED');
END;

-- ── The reader record (spec §3.1) ──────────────────────────────────────────
-- Counts only. No column here may identify or describe one visitor (AC-46),
-- so each table is its key plus one number and nothing else.

CREATE TABLE record_view (
  month TEXT    NOT NULL,
  lang  TEXT    NOT NULL CHECK (lang IN ('en', 'fa')),
  page  TEXT    NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (month, lang, page)
) WITHOUT ROWID;

CREATE TABLE record_feed (
  month       TEXT    NOT NULL,
  lang        TEXT    NOT NULL CHECK (lang IN ('en', 'fa')),
  aggregator  TEXT    NOT NULL,
  subscribers INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (month, lang, aggregator)
) WITHOUT ROWID;

CREATE TABLE record_referrer (
  month  TEXT    NOT NULL,
  lang   TEXT    NOT NULL CHECK (lang IN ('en', 'fa')),
  domain TEXT    NOT NULL,
  count  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (month, lang, domain)
) WITHOUT ROWID;
