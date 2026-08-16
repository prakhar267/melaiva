const STORE_SCHEMA_VERSION = 1;
const MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000;

const STORE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 100),
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL CHECK (password_iterations >= 100000),
  password_scheme TEXT NOT NULL DEFAULT 'pbkdf2-server-v1'
    CHECK (password_scheme IN ('pbkdf2-server-v1', 'client-verifier-v1')),
  role TEXT NOT NULL DEFAULT 'couple' CHECK (role IN ('couple', 'vendor', 'admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted')),
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  user_agent_hash TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS vendors (
  id TEXT PRIMARY KEY,
  user_id TEXT UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  slug TEXT NOT NULL COLLATE NOCASE UNIQUE,
  business_name TEXT NOT NULL,
  legal_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'suspended')),
  category TEXT NOT NULL,
  categories_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(categories_json)),
  city TEXT NOT NULL,
  service_areas_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(service_areas_json)),
  description TEXT NOT NULL,
  min_budget INTEGER NOT NULL DEFAULT 0 CHECK (min_budget >= 0),
  max_budget INTEGER NOT NULL CHECK (max_budget >= min_budget),
  currency TEXT NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  phone TEXT,
  website_url TEXT,
  instagram_handle TEXT,
  rating REAL NOT NULL DEFAULT 0 CHECK (rating BETWEEN 0 AND 5),
  review_count INTEGER NOT NULL DEFAULT 0 CHECK (review_count >= 0),
  image_url TEXT,
  verified INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_vendors_catalog ON vendors(status, category, city);
CREATE INDEX IF NOT EXISTS idx_vendors_user_id ON vendors(user_id);

CREATE TABLE IF NOT EXISTS auctions (
  id TEXT PRIMARY KEY,
  couple_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  event_type TEXT NOT NULL DEFAULT 'wedding',
  event_date TEXT NOT NULL,
  city TEXT NOT NULL,
  guest_count INTEGER NOT NULL CHECK (guest_count BETWEEN 2 AND 20000),
  budget_min INTEGER NOT NULL CHECK (budget_min >= 0),
  budget_max INTEGER NOT NULL CHECK (budget_max >= budget_min),
  currency TEXT NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  categories_json TEXT NOT NULL CHECK (json_valid(categories_json)),
  requirements TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('draft', 'open', 'awarded', 'closed', 'cancelled')),
  bidding_ends_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_auctions_public ON auctions(status, bidding_ends_at, created_at);
CREATE INDEX IF NOT EXISTS idx_auctions_owner ON auctions(couple_user_id, created_at);

CREATE TABLE IF NOT EXISTS bids (
  id TEXT PRIMARY KEY,
  auction_id TEXT NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
  vendor_id TEXT NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,
  amount INTEGER NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL CHECK (currency = 'INR'),
  proposal TEXT NOT NULL,
  deliverables_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(deliverables_json)),
  valid_until TEXT,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'shortlisted', 'accepted', 'rejected', 'withdrawn')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (auction_id, vendor_id)
);
CREATE INDEX IF NOT EXISTS idx_bids_auction ON bids(auction_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_bids_vendor ON bids(vendor_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bids_one_accepted_per_auction
  ON bids(auction_id) WHERE status = 'accepted';

CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE,
  phone TEXT,
  event_date TEXT,
  city TEXT,
  budget INTEGER,
  message TEXT,
  source TEXT NOT NULL DEFAULT 'website',
  ip_hash TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'qualified', 'closed', 'spam')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_leads_status_created ON leads(status, created_at);
CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email);

CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  email TEXT PRIMARY KEY COLLATE NOCASE,
  name TEXT,
  source TEXT NOT NULL DEFAULT 'website',
  status TEXT NOT NULL DEFAULT 'subscribed' CHECK (status IN ('subscribed', 'unsubscribed')),
  subscribed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  unsubscribed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT NOT NULL,
  bucket_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 1 CHECK (count > 0),
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (key, bucket_start)
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_expiry ON rate_limits(expires_at);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  scope TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  response_status INTEGER NOT NULL,
  response_json TEXT NOT NULL CHECK (json_valid(response_json)),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (scope, key_hash)
);
CREATE INDEX IF NOT EXISTS idx_idempotency_expiry ON idempotency_keys(expires_at);

CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_audit_events_entity ON audit_events(entity_type, entity_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_events_actor ON audit_events(actor_user_id, created_at);

PRAGMA optimize;
INSERT OR IGNORE INTO _sql_schema_migrations (id) VALUES (${STORE_SCHEMA_VERSION});
`;

const DEMO_CATALOG_SQL = `
INSERT OR IGNORE INTO vendors
  (id, slug, business_name, legal_name, status, category, categories_json, city, service_areas_json,
   description, min_budget, max_budget, currency, rating, review_count, verified)
VALUES
  ('demo-venue-udaipur', 'the-lakehouse-udaipur', 'The Lakehouse Udaipur', 'Demo listing',
   'approved', 'venues', '["venues","hospitality"]', 'Udaipur', '["Udaipur","Jaipur"]',
   'Development-only demonstration listing. Not a real or verified business.', 1200000, 4500000, 'INR', 0, 0, 0),
  ('demo-photo-delhi', 'moonlit-stories', 'Moonlit Stories', 'Demo listing',
   'approved', 'photography', '["photography","cinematography"]', 'Delhi NCR', '["Delhi NCR","Jaipur","Goa"]',
   'Development-only demonstration listing. Not a real or verified business.', 250000, 750000, 'INR', 0, 0, 0);
`;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function executeSql(sqlStorage, statement) {
  const cursor = sqlStorage.exec(statement.sql, ...(statement.args || []));
  const rows = cursor.toArray();
  const logicalChanges = statement.mode === "run"
    ? Number(sqlStorage.exec("SELECT changes() AS changes").toArray()[0]?.changes || 0)
    : 0;
  const meta = {
    changes: logicalChanges,
    rowsRead: Number(cursor.rowsRead || 0),
    rowsWritten: Number(cursor.rowsWritten || 0),
  };
  if (statement.mode === "first") return rows[0] || null;
  if (statement.mode === "all") return { success: true, results: rows, meta };
  return { success: true, results: rows, meta };
}

export class MelaivaStore {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => {
      this.sql.exec(
        `CREATE TABLE IF NOT EXISTS _sql_schema_migrations (
           id INTEGER PRIMARY KEY,
           applied_at TEXT NOT NULL DEFAULT (datetime('now'))
         )`,
      ).toArray();
      const versionRow = this.sql
        .exec("SELECT COALESCE(MAX(id), 0) AS version FROM _sql_schema_migrations")
        .toArray()[0] || {};
      const version = Number(versionRow.version || 0);
      if (version < STORE_SCHEMA_VERSION) this.sql.exec(STORE_SCHEMA_SQL).toArray();
      if (env?.ENABLE_DEMO_CATALOG === "true" && env?.ENVIRONMENT !== "production") {
        this.sql.exec(DEMO_CATALOG_SQL).toArray();
      }
      if (typeof ctx.storage.getAlarm === "function" && typeof ctx.storage.setAlarm === "function") {
        const nextAlarm = await ctx.storage.getAlarm();
        if (nextAlarm === null) await ctx.storage.setAlarm(Date.now() + MAINTENANCE_INTERVAL_MS);
      }
    });
  }

  async alarm() {
    const now = new Date().toISOString();
    const nowSeconds = Math.floor(Date.now() / 1000);
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("DELETE FROM sessions WHERE expires_at <= ?", now).toArray();
      this.sql.exec("DELETE FROM rate_limits WHERE expires_at <= ?", nowSeconds).toArray();
      this.sql.exec("DELETE FROM idempotency_keys WHERE expires_at <= ?", now).toArray();
      this.sql
        .exec(
          "UPDATE auctions SET status = 'closed', updated_at = CURRENT_TIMESTAMP WHERE status = 'open' AND bidding_ends_at <= ?",
          now,
        )
        .toArray();
    });
    if (typeof this.ctx.storage.setAlarm === "function") {
      await this.ctx.storage.setAlarm(Date.now() + MAINTENANCE_INTERVAL_MS);
    }
  }

  async fetch(request) {
    if (request.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);
    let input;
    try {
      const text = await request.text();
      if (text.length > 100_000) return jsonResponse({ error: "payload_too_large" }, 413);
      input = JSON.parse(text);
    } catch {
      return jsonResponse({ error: "invalid_request" }, 400);
    }
    try {
      if (input.operation === "statement") {
        return jsonResponse({ data: executeSql(this.sql, input.statement) });
      }
      if (input.operation === "batch" && Array.isArray(input.statements) && input.statements.length <= 50) {
        const data = this.ctx.storage.transactionSync(() => input.statements.map((statement) => executeSql(this.sql, statement)));
        return jsonResponse({ data });
      }
      return jsonResponse({ error: "unsupported_operation" }, 400);
    } catch (error) {
      return jsonResponse({ error: "storage_error", message: String(error?.message || error).slice(0, 500) }, 409);
    }
  }
}

class DurablePreparedStatement {
  constructor(database, sql, args = []) {
    this.database = database;
    this.sql = sql;
    this.args = args;
  }

  bind(...args) {
    return new DurablePreparedStatement(this.database, this.sql, args);
  }

  first() {
    return this.database.execute({ mode: "first", sql: this.sql, args: this.args });
  }

  all() {
    return this.database.execute({ mode: "all", sql: this.sql, args: this.args });
  }

  run() {
    return this.database.execute({ mode: "run", sql: this.sql, args: this.args });
  }
}

class DurableObjectDatabase {
  constructor(stub) {
    this.stub = stub;
  }

  prepare(sql) {
    return new DurablePreparedStatement(this, sql);
  }

  async send(payload) {
    const response = await this.stub.fetch("https://melaiva-store.internal/sql", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body?.message || body?.error || "Durable Object storage request failed");
    return body.data;
  }

  execute(statement) {
    return this.send({ operation: "statement", statement });
  }

  batch(statements) {
    return this.send({
      operation: "batch",
      statements: statements.map((statement) => ({ mode: "run", sql: statement.sql, args: statement.args })),
    });
  }
}

export function createDurableDatabase(namespace) {
  if (!namespace) return null;
  const stub = typeof namespace.getByName === "function"
    ? namespace.getByName("global")
    : namespace.get(namespace.idFromName("global"));
  return new DurableObjectDatabase(stub);
}

export { MAINTENANCE_INTERVAL_MS, STORE_SCHEMA_SQL, STORE_SCHEMA_VERSION, executeSql };
