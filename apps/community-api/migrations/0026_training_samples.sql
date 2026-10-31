-- Separate immutable observation/claim events from community votes and reviewer decisions.
CREATE TABLE training_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  installation_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  handle TEXT NOT NULL,
  action TEXT NOT NULL,
  observed_at INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  payload TEXT NOT NULL,
  UNIQUE(installation_id, event_id)
);
CREATE INDEX idx_training_samples_received ON training_samples(received_at, id);
CREATE INDEX idx_training_samples_content ON training_samples(content_hash);
CREATE TABLE training_sample_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sample_id INTEGER NOT NULL REFERENCES training_samples(id),
  verdict TEXT NOT NULL CHECK(verdict IN ('spam','normal','uncertain')),
  family TEXT NOT NULL,
  tags TEXT NOT NULL,
  note TEXT NOT NULL,
  reviewer TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_training_reviews_sample ON training_sample_reviews(sample_id, id DESC);
CREATE TABLE training_sample_usage (
  identity TEXT NOT NULL,
  day TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY(identity, day)
);

CREATE INDEX idx_training_sample_usage_day ON training_sample_usage(day);
