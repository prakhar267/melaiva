const STORE_SCHEMA_VERSION = 6;
const MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000;

const STORE_SCHEMA_V1_SQL = `
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
INSERT OR IGNORE INTO _sql_schema_migrations (id) VALUES (1);
`;

const STORE_SCHEMA_V2_FINALIZE_SQL = `
CREATE TABLE IF NOT EXISTS auction_vendor_invites (
  auction_id TEXT PRIMARY KEY REFERENCES auctions(id) ON DELETE CASCADE,
  vendor_id TEXT NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,
  invited_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'responded', 'unavailable')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_auction_vendor_invites_vendor
  ON auction_vendor_invites(vendor_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_auction_vendor_invites_inviter
  ON auction_vendor_invites(invited_by_user_id, created_at);

INSERT OR IGNORE INTO _sql_schema_migrations (id) VALUES (2);
PRAGMA optimize;
`;

const STORE_SCHEMA_V2_MIGRATION_SQL = `
ALTER TABLE idempotency_keys ADD COLUMN request_hash TEXT;
${STORE_SCHEMA_V2_FINALIZE_SQL}
`;

const STORE_SCHEMA_V3_COLUMN_MIGRATIONS = Object.freeze([
  [
    "exclusions_json",
    `ALTER TABLE bids ADD COLUMN exclusions_json TEXT NOT NULL DEFAULT '[]'
       CHECK (json_valid(exclusions_json) AND json_type(exclusions_json) = 'array' AND json_array_length(exclusions_json) <= 30)`,
  ],
  [
    "gst_included",
    "ALTER TABLE bids ADD COLUMN gst_included INTEGER NOT NULL DEFAULT 0 CHECK (gst_included IN (0, 1))",
  ],
  [
    "gst_rate",
    "ALTER TABLE bids ADD COLUMN gst_rate INTEGER NOT NULL DEFAULT 0 CHECK (gst_rate BETWEEN 0 AND 28 AND gst_rate = CAST(gst_rate AS INTEGER))",
  ],
  [
    "travel_policy",
    "ALTER TABLE bids ADD COLUMN travel_policy TEXT NOT NULL DEFAULT 'not_applicable' CHECK (travel_policy IN ('included', 'fixed_fee', 'not_applicable'))",
  ],
  [
    "travel_fee",
    `ALTER TABLE bids ADD COLUMN travel_fee INTEGER NOT NULL DEFAULT 0
       CHECK (
         typeof(travel_fee) = 'integer'
         AND travel_fee BETWEEN 0 AND 1000000000
         AND (
           (travel_policy = 'fixed_fee' AND travel_fee > 0)
           OR (travel_policy != 'fixed_fee' AND travel_fee = 0)
         )
       )`,
  ],
  [
    "add_ons_json",
    `ALTER TABLE bids ADD COLUMN add_ons_json TEXT NOT NULL DEFAULT '[]'
       CHECK (json_valid(add_ons_json) AND json_type(add_ons_json) = 'array' AND json_array_length(add_ons_json) <= 20)`,
  ],
  [
    "cancellation_terms",
    "ALTER TABLE bids ADD COLUMN cancellation_terms TEXT NOT NULL DEFAULT '' CHECK (length(cancellation_terms) <= 3000)",
  ],
  [
    "delivery_plan",
    "ALTER TABLE bids ADD COLUMN delivery_plan TEXT NOT NULL DEFAULT '' CHECK (length(delivery_plan) <= 3000)",
  ],
  [
    "structured_terms_provided",
    `ALTER TABLE bids ADD COLUMN structured_terms_provided INTEGER NOT NULL DEFAULT 0
       CHECK (
         (structured_terms_provided = 0 AND cancellation_terms = '' AND delivery_plan = '')
         OR (
           structured_terms_provided = 1
           AND length(cancellation_terms) BETWEEN 20 AND 3000
           AND length(delivery_plan) BETWEEN 20 AND 3000
         )
       )`,
  ],
]);

const STORE_SCHEMA_V3_FINALIZE_SQL = `
INSERT OR IGNORE INTO _sql_schema_migrations (id) VALUES (3);
PRAGMA optimize;
`;

const STORE_SCHEMA_V3_MIGRATION_SQL = `${STORE_SCHEMA_V3_COLUMN_MIGRATIONS
  .map(([, sql]) => `${sql};`)
  .join("\n")}\n${STORE_SCHEMA_V3_FINALIZE_SQL}`;

const STORE_SCHEMA_V4_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  auction_id TEXT NOT NULL UNIQUE REFERENCES auctions(id) ON DELETE RESTRICT,
  accepted_bid_id TEXT NOT NULL UNIQUE REFERENCES bids(id) ON DELETE RESTRICT,
  couple_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  vendor_id TEXT NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'contract_pending' CHECK (status = 'contract_pending'),
  accepted_scope_json TEXT NOT NULL
    CHECK (json_valid(accepted_scope_json) AND json_type(accepted_scope_json) = 'object' AND length(accepted_scope_json) <= 100000),
  awarded_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_bookings_couple ON bookings(couple_user_id, awarded_at);
CREATE INDEX IF NOT EXISTS idx_bookings_vendor ON bookings(vendor_id, awarded_at);

INSERT INTO bookings
  (id, auction_id, accepted_bid_id, couple_user_id, vendor_id, status, accepted_scope_json, awarded_at)
SELECT
  'booking-' || b.id,
  a.id,
  b.id,
  a.couple_user_id,
  b.vendor_id,
  'contract_pending',
  json_object(
    'request', json_object(
      'id', a.id,
      'title', a.title,
      'eventType', a.event_type,
      'eventDate', a.event_date,
      'city', a.city,
      'guestCount', a.guest_count,
      'budgetMin', a.budget_min,
      'budgetMax', a.budget_max,
      'currency', a.currency,
      'categories', json(a.categories_json),
      'requirements', a.requirements,
      'status', 'awarded',
      'biddingEndsAt', a.bidding_ends_at,
      'bidCount', (SELECT COUNT(*) FROM bids counted_bid WHERE counted_bid.auction_id = a.id AND counted_bid.status != 'withdrawn'),
      'createdAt', a.created_at
    ),
    'offer', json_object(
      'id', b.id,
      'auctionId', b.auction_id,
      'amount', b.amount,
      'currency', b.currency,
      'proposal', b.proposal,
      'deliverables', json(b.deliverables_json),
      'exclusions', json(b.exclusions_json),
      'gstIncluded', json(CASE WHEN b.gst_included = 1 THEN 'true' ELSE 'false' END),
      'gstRate', b.gst_rate,
      'travelPolicy', b.travel_policy,
      'travelFee', b.travel_fee,
      'addOns', json(b.add_ons_json),
      'cancellationTerms', b.cancellation_terms,
      'deliveryPlan', b.delivery_plan,
      'structuredTermsProvided', json(CASE WHEN b.structured_terms_provided = 1 THEN 'true' ELSE 'false' END),
      'validUntil', b.valid_until,
      'status', 'accepted',
      'createdAt', b.created_at,
      'updatedAt', COALESCE(
        strftime('%Y-%m-%dT%H:%M:%fZ', (
          SELECT accepted_event.created_at FROM audit_events accepted_event
          WHERE accepted_event.action = 'bid.accepted' AND accepted_event.entity_id = b.id
          ORDER BY accepted_event.created_at ASC LIMIT 1
        )),
        strftime('%Y-%m-%dT%H:%M:%fZ', b.updated_at),
        strftime('%Y-%m-%dT%H:%M:%fZ', b.created_at)
      )
    ),
    'vendor', json_object(
      'id', v.id,
      'slug', v.slug,
      'businessName', v.business_name,
      'verified', json(CASE WHEN v.verified = 1 THEN 'true' ELSE 'false' END),
      'rating', v.rating
    )
  ),
  COALESCE(
    strftime('%Y-%m-%dT%H:%M:%fZ', (
      SELECT accepted_event.created_at FROM audit_events accepted_event
      WHERE accepted_event.action = 'bid.accepted' AND accepted_event.entity_id = b.id
      ORDER BY accepted_event.created_at ASC LIMIT 1
    )),
    strftime('%Y-%m-%dT%H:%M:%fZ', b.updated_at),
    strftime('%Y-%m-%dT%H:%M:%fZ', b.created_at)
  )
FROM bids b
JOIN auctions a ON a.id = b.auction_id
JOIN vendors v ON v.id = b.vendor_id
WHERE b.status = 'accepted'
  AND NOT EXISTS (
    SELECT 1 FROM bookings existing
    WHERE existing.id = 'booking-' || b.id
      AND existing.auction_id = a.id
      AND existing.accepted_bid_id = b.id
  );

CREATE TRIGGER IF NOT EXISTS bookings_immutable_update
BEFORE UPDATE ON bookings
BEGIN
  SELECT RAISE(ABORT, 'booking records are immutable');
END;

CREATE TRIGGER IF NOT EXISTS bookings_immutable_delete
BEFORE DELETE ON bookings
BEGIN
  SELECT RAISE(ABORT, 'booking records are immutable');
END;

INSERT OR IGNORE INTO _sql_schema_migrations (id) VALUES (4);
PRAGMA optimize;
`;

const STORE_SCHEMA_V5_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS booking_messages (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  sender_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  body TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 2 AND 2000),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_booking_messages_thread
  ON booking_messages(booking_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_booking_messages_sender
  ON booking_messages(sender_user_id, created_at DESC);

CREATE TRIGGER IF NOT EXISTS booking_messages_participant_insert
BEFORE INSERT ON booking_messages
WHEN NOT EXISTS (
  SELECT 1
  FROM bookings booking
  JOIN vendors vendor ON vendor.id = booking.vendor_id
  WHERE booking.id = NEW.booking_id
    AND NEW.sender_user_id IN (booking.couple_user_id, vendor.user_id)
)
BEGIN
  SELECT RAISE(ABORT, 'booking message sender must be a participant');
END;

INSERT OR IGNORE INTO _sql_schema_migrations (id) VALUES (5);
PRAGMA optimize;
`;

const STORE_SCHEMA_V6_FINALIZE_SQL = `
DROP TRIGGER IF EXISTS booking_messages_stream_position_insert;
DROP TRIGGER IF EXISTS booking_messages_stream_position_sequence;
DROP TRIGGER IF EXISTS booking_messages_stream_position_assign;
DROP TRIGGER IF EXISTS booking_messages_stream_position_update;
DROP TRIGGER IF EXISTS booking_messages_stream_identity_update;
DROP TRIGGER IF EXISTS booking_messages_stream_identity_delete;

WITH ranked_messages AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY booking_id
           ORDER BY rowid ASC
         ) AS stream_position
  FROM booking_messages
)
UPDATE booking_messages
SET stream_position = (
  SELECT ranked.stream_position
  FROM ranked_messages ranked
  WHERE ranked.id = booking_messages.id
)
WHERE stream_position IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_messages_stream
  ON booking_messages(booking_id, stream_position);

CREATE TRIGGER IF NOT EXISTS booking_messages_stream_position_insert
BEFORE INSERT ON booking_messages
WHEN NEW.stream_position IS NOT NULL
  AND (
    typeof(NEW.stream_position) != 'integer'
    OR NEW.stream_position < 1
  )
BEGIN
  SELECT RAISE(ABORT, 'booking message stream position must be a positive integer');
END;

CREATE TRIGGER IF NOT EXISTS booking_messages_stream_position_sequence
BEFORE INSERT ON booking_messages
WHEN NEW.stream_position IS NOT NULL
  AND typeof(NEW.stream_position) = 'integer'
  AND NEW.stream_position >= 1
  AND NEW.stream_position != COALESCE(
    (
      SELECT MAX(existing_message.stream_position) + 1
      FROM booking_messages existing_message
      WHERE existing_message.booking_id = NEW.booking_id
    ),
    1
  )
BEGIN
  SELECT RAISE(ABORT, 'booking message stream position must be the next position');
END;

CREATE TRIGGER IF NOT EXISTS booking_messages_stream_position_assign
AFTER INSERT ON booking_messages
WHEN NEW.stream_position IS NULL
BEGIN
  UPDATE booking_messages
  SET stream_position = COALESCE(
    (
      SELECT MAX(existing_message.stream_position) + 1
      FROM booking_messages existing_message
      WHERE existing_message.booking_id = NEW.booking_id
        AND existing_message.id != NEW.id
    ),
    1
  )
  WHERE id = NEW.id AND stream_position IS NULL;
END;

CREATE TRIGGER IF NOT EXISTS booking_messages_stream_position_update
BEFORE UPDATE OF stream_position ON booking_messages
WHEN OLD.stream_position IS NOT NULL
  OR NEW.stream_position IS NULL
  OR typeof(NEW.stream_position) != 'integer'
  OR NEW.stream_position < 1
BEGIN
  SELECT RAISE(ABORT, 'booking message stream position is immutable');
END;

CREATE TRIGGER IF NOT EXISTS booking_messages_stream_identity_update
BEFORE UPDATE OF id, booking_id ON booking_messages
BEGIN
  SELECT RAISE(ABORT, 'booking message stream identity is immutable');
END;

CREATE TRIGGER IF NOT EXISTS booking_messages_stream_identity_delete
BEFORE DELETE ON booking_messages
BEGIN
  SELECT RAISE(ABORT, 'booking message stream records are immutable');
END;

INSERT OR IGNORE INTO _sql_schema_migrations (id) VALUES (6);
PRAGMA optimize;
`;

const STORE_SCHEMA_V6_MIGRATION_SQL = `
ALTER TABLE booking_messages ADD COLUMN stream_position INTEGER;
${STORE_SCHEMA_V6_FINALIZE_SQL}
`;

const STORE_SCHEMA_SQL = `${STORE_SCHEMA_V1_SQL}\n${STORE_SCHEMA_V2_MIGRATION_SQL}\n${STORE_SCHEMA_V3_MIGRATION_SQL}\n${STORE_SCHEMA_V4_MIGRATION_SQL}\n${STORE_SCHEMA_V5_MIGRATION_SQL}\n${STORE_SCHEMA_V6_MIGRATION_SQL}`;

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
      if (version === 0) {
        this.sql.exec(STORE_SCHEMA_SQL).toArray();
      } else if (version < 2) {
        const idempotencyColumns = this.sql.exec("PRAGMA table_info(idempotency_keys)").toArray();
        if (!idempotencyColumns.some((column) => column.name === "request_hash")) {
          this.sql.exec("ALTER TABLE idempotency_keys ADD COLUMN request_hash TEXT").toArray();
        }
        this.sql.exec(STORE_SCHEMA_V2_FINALIZE_SQL).toArray();
      }
      if (version > 0 && version < 4) {
        const bidColumns = new Set(this.sql.exec("PRAGMA table_info(bids)").toArray().map((column) => column.name));
        for (const [name, sql] of STORE_SCHEMA_V3_COLUMN_MIGRATIONS) {
          if (!bidColumns.has(name)) this.sql.exec(sql).toArray();
        }
        this.sql.exec(STORE_SCHEMA_V3_FINALIZE_SQL).toArray();
      }
      if (version > 0 && version < 4) {
        this.sql.exec(STORE_SCHEMA_V4_MIGRATION_SQL).toArray();
      }
      if (version > 0 && version < 5) {
        this.sql.exec(STORE_SCHEMA_V5_MIGRATION_SQL).toArray();
      }
      if (version > 0 && version < 6) {
        const messageColumns = this.sql.exec("PRAGMA table_info(booking_messages)").toArray();
        if (!messageColumns.some((column) => column.name === "stream_position")) {
          this.sql.exec("ALTER TABLE booking_messages ADD COLUMN stream_position INTEGER").toArray();
        }
        this.sql.exec(STORE_SCHEMA_V6_FINALIZE_SQL).toArray();
      }
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
      const code = /unique constraint failed|SQLITE_CONSTRAINT_(?:UNIQUE|PRIMARYKEY)/i.test(
        String(error?.message || error),
      )
        ? "unique_constraint"
        : "storage_error";
      return jsonResponse({ error: "storage_error", code }, 409);
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
    if (!response.ok) {
      const error = new Error(body?.error || "Durable Object storage request failed");
      error.code = body?.code || body?.error || "storage_error";
      throw error;
    }
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

export {
  MAINTENANCE_INTERVAL_MS,
  STORE_SCHEMA_SQL,
  STORE_SCHEMA_V1_SQL,
  STORE_SCHEMA_V2_MIGRATION_SQL,
  STORE_SCHEMA_V3_MIGRATION_SQL,
  STORE_SCHEMA_V4_MIGRATION_SQL,
  STORE_SCHEMA_V5_MIGRATION_SQL,
  STORE_SCHEMA_V6_FINALIZE_SQL,
  STORE_SCHEMA_V6_MIGRATION_SQL,
  STORE_SCHEMA_VERSION,
  executeSql,
};
