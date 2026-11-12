-- WynnPages Studio D1 Schema (wynnpages-db)

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  business_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  demo_slug TEXT NOT NULL DEFAULT '',
  demo_url TEXT NOT NULL DEFAULT '',
  live_url TEXT NOT NULL DEFAULT '',
  stage TEXT NOT NULL DEFAULT '',
  payment_status TEXT NOT NULL DEFAULT 'unpaid',
  flow_type TEXT NOT NULL DEFAULT 'inbound',
  view_count INTEGER NOT NULL DEFAULT 0,
  claim_click_count INTEGER NOT NULL DEFAULT 0,
  last_viewed_at TEXT NOT NULL DEFAULT '',
  last_clicked_at TEXT NOT NULL DEFAULT '',
  last_viewer_device TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_clients_slug ON clients(demo_slug);
CREATE INDEX IF NOT EXISTS idx_clients_live_url ON clients(live_url);

CREATE TABLE IF NOT EXISTS activity_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '🔔',
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  client_name TEXT NOT NULL DEFAULT '',
  slug TEXT NOT NULL DEFAULT '',
  timestamp TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_activity_timestamp ON activity_events(timestamp DESC);

CREATE TABLE IF NOT EXISTS tracking_events (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL DEFAULT '',
  client_id TEXT NOT NULL DEFAULT '',
  event_type TEXT NOT NULL,
  device TEXT NOT NULL DEFAULT 'Desktop',
  user_agent TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tracking_slug_created ON tracking_events(slug, created_at DESC);

CREATE TABLE IF NOT EXISTS scheduled_sms (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL DEFAULT '',
  client_name TEXT NOT NULL DEFAULT '',
  to_phone TEXT NOT NULL,
  body_text TEXT NOT NULL,
  scheduled_for_utc TEXT NOT NULL,
  scheduled_for_au TEXT NOT NULL,
  au_timezone TEXT NOT NULL DEFAULT 'Australia/Sydney',
  status TEXT NOT NULL DEFAULT 'pending',
  error_reason TEXT NOT NULL DEFAULT '',
  sent_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scheduled_sms_due ON scheduled_sms(status, scheduled_for_utc);

CREATE TABLE IF NOT EXISTS lead_hunter_leads (
  id TEXT PRIMARY KEY,
  place_id TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  industry TEXT NOT NULL DEFAULT 'other',
  lead_type TEXT NOT NULL DEFAULT '',
  imported INTEGER NOT NULL DEFAULT 0,
  data_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);
