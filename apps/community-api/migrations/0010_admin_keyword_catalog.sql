CREATE TABLE admin_keyword_packs (
  id TEXT PRIMARY KEY,
  name_zh TEXT NOT NULL,
  name_en TEXT NOT NULL,
  description_zh TEXT NOT NULL,
  description_en TEXT NOT NULL,
  source_refs TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE admin_keyword_rules (
  id TEXT PRIMARY KEY,
  pack_id TEXT NOT NULL REFERENCES admin_keyword_packs(id),
  phrase TEXT NOT NULL,
  terms TEXT,
  max_gap INTEGER,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE admin_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_email TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_admin_keyword_rules_pack ON admin_keyword_rules(pack_id, active, phrase);
CREATE INDEX idx_admin_audit_created ON admin_audit_log(created_at DESC);
