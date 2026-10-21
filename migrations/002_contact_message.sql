-- 002_contact_message: what a visitor types into the contact form (change note 08, CT1).
-- The table holds the three typed fields, the page's language and the time, and nothing else:
-- no address, agent or header, because the app never reads them (house rule 9, CT-7).
-- Instants are UTC milliseconds. The lengths are held here as well as in code (house rule 6),
-- counted in characters like `lib/limits.ts` counts them.

CREATE TABLE contact_message (
  id          TEXT    PRIMARY KEY,                   -- random, never a counter (PD-6)
  lang        TEXT    NOT NULL CHECK (lang IN ('en', 'fa')),
  subject     TEXT    NOT NULL CHECK (length(subject) BETWEEN 1 AND 120),
  message     TEXT    NOT NULL CHECK (length(message) BETWEEN 1 AND 5000),
  reach       TEXT    NOT NULL CHECK (length(reach) BETWEEN 1 AND 200),
  received_at INTEGER NOT NULL
);

-- The 24-hour cap counts the rows after a time, and the admin lists them newest first.
CREATE INDEX contact_message_received ON contact_message (received_at);
