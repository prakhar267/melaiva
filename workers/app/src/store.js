const STORE_SCHEMA_VERSION = 10;
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

const STORE_SCHEMA_V7_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS booking_message_read_cursors (
  booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  participant_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  last_read_message_id TEXT REFERENCES booking_messages(id) ON DELETE RESTRICT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (booking_id, participant_user_id)
);

DROP TRIGGER IF EXISTS booking_message_read_cursor_participant_insert;
DROP TRIGGER IF EXISTS booking_message_read_cursor_participant_update;
DROP TRIGGER IF EXISTS booking_message_read_cursor_message_insert;
DROP TRIGGER IF EXISTS booking_message_read_cursor_message_update;
DROP TRIGGER IF EXISTS booking_message_read_cursor_identity_update;
DROP TRIGGER IF EXISTS booking_message_read_cursor_delete;
DROP TRIGGER IF EXISTS bookings_message_read_cursors_insert;

CREATE TRIGGER booking_message_read_cursor_participant_insert
BEFORE INSERT ON booking_message_read_cursors
WHEN NOT EXISTS (
  SELECT 1
  FROM bookings booking
  JOIN vendors vendor ON vendor.id = booking.vendor_id
  WHERE booking.id = NEW.booking_id
    AND NEW.participant_user_id IN (booking.couple_user_id, vendor.user_id)
)
BEGIN
  SELECT RAISE(ABORT, 'booking message read cursor owner must be a participant');
END;

CREATE TRIGGER booking_message_read_cursor_participant_update
BEFORE UPDATE ON booking_message_read_cursors
WHEN NOT EXISTS (
  SELECT 1
  FROM bookings booking
  JOIN vendors vendor ON vendor.id = booking.vendor_id
  WHERE booking.id = NEW.booking_id
    AND NEW.participant_user_id IN (booking.couple_user_id, vendor.user_id)
)
BEGIN
  SELECT RAISE(ABORT, 'booking message read cursor owner must be a participant');
END;

CREATE TRIGGER booking_message_read_cursor_message_insert
BEFORE INSERT ON booking_message_read_cursors
WHEN NEW.last_read_message_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM booking_messages message
    WHERE message.id = NEW.last_read_message_id
      AND message.booking_id = NEW.booking_id
  )
BEGIN
  SELECT RAISE(ABORT, 'booking message read cursor must reference its thread');
END;

CREATE TRIGGER booking_message_read_cursor_message_update
BEFORE UPDATE OF last_read_message_id ON booking_message_read_cursors
WHEN (NEW.last_read_message_id IS NULL AND OLD.last_read_message_id IS NOT NULL)
  OR (
    NEW.last_read_message_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM booking_messages candidate
      WHERE candidate.id = NEW.last_read_message_id
        AND candidate.booking_id = NEW.booking_id
    )
  )
  OR (
    OLD.last_read_message_id IS NOT NULL
    AND (
      SELECT candidate.stream_position
      FROM booking_messages candidate
      WHERE candidate.id = NEW.last_read_message_id
    ) < (
      SELECT previous.stream_position
      FROM booking_messages previous
      WHERE previous.id = OLD.last_read_message_id
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'booking message read cursor cannot move backward or leave its thread');
END;

CREATE TRIGGER booking_message_read_cursor_identity_update
BEFORE UPDATE OF booking_id, participant_user_id ON booking_message_read_cursors
BEGIN
  SELECT RAISE(ABORT, 'booking message read cursor identity is immutable');
END;

CREATE TRIGGER booking_message_read_cursor_delete
BEFORE DELETE ON booking_message_read_cursors
BEGIN
  SELECT RAISE(ABORT, 'booking message read cursors are retained');
END;

INSERT INTO booking_message_read_cursors
  (booking_id, participant_user_id, last_read_message_id, updated_at)
SELECT booking.id,
       booking.couple_user_id,
       (
         SELECT latest.id
         FROM booking_messages latest
         WHERE latest.booking_id = booking.id
         ORDER BY latest.stream_position DESC
         LIMIT 1
       ),
       CURRENT_TIMESTAMP
FROM bookings booking
WHERE true
ON CONFLICT (booking_id, participant_user_id) DO NOTHING;

INSERT INTO booking_message_read_cursors
  (booking_id, participant_user_id, last_read_message_id, updated_at)
SELECT booking.id,
       vendor.user_id,
       (
         SELECT latest.id
         FROM booking_messages latest
         WHERE latest.booking_id = booking.id
         ORDER BY latest.stream_position DESC
         LIMIT 1
       ),
       CURRENT_TIMESTAMP
FROM bookings booking
JOIN vendors vendor ON vendor.id = booking.vendor_id
WHERE vendor.user_id IS NOT NULL
ON CONFLICT (booking_id, participant_user_id) DO NOTHING;

CREATE TRIGGER bookings_message_read_cursors_insert
AFTER INSERT ON bookings
BEGIN
  INSERT OR IGNORE INTO booking_message_read_cursors
    (booking_id, participant_user_id, last_read_message_id)
  VALUES (NEW.id, NEW.couple_user_id, NULL);

  INSERT OR IGNORE INTO booking_message_read_cursors
    (booking_id, participant_user_id, last_read_message_id)
  SELECT NEW.id, vendor.user_id, NULL
  FROM vendors vendor
  WHERE vendor.id = NEW.vendor_id
    AND vendor.user_id IS NOT NULL;
END;

INSERT OR IGNORE INTO _sql_schema_migrations (id) VALUES (7);
PRAGMA optimize;
`;

const STORE_SCHEMA_V8_FINALIZE_SQL = `
UPDATE vendors
SET review_revision = (
  SELECT COUNT(*)
  FROM audit_events review_event
  WHERE review_event.action = 'vendor.reviewed'
    AND review_event.entity_type = 'vendor'
    AND review_event.entity_id = vendors.id
)
WHERE review_revision = 0;

DROP TRIGGER IF EXISTS vendors_review_revision_update;
DROP TRIGGER IF EXISTS audit_events_immutable_update;
DROP TRIGGER IF EXISTS audit_events_identity_immutable_update;
DROP TRIGGER IF EXISTS audit_events_actor_retention_update;
DROP TRIGGER IF EXISTS audit_events_immutable_delete;

CREATE TRIGGER vendors_review_revision_update
AFTER UPDATE OF status ON vendors
WHEN OLD.status != NEW.status
BEGIN
  UPDATE vendors
  SET review_revision = OLD.review_revision + 1
  WHERE id = NEW.id;
END;

CREATE TRIGGER audit_events_identity_immutable_update
BEFORE UPDATE OF id, action, entity_type, entity_id, metadata_json, created_at ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'audit events are immutable');
END;

CREATE TRIGGER audit_events_actor_retention_update
BEFORE UPDATE OF actor_user_id ON audit_events
WHEN NEW.actor_user_id IS NOT NULL OR OLD.actor_user_id IS NULL
BEGIN
  SELECT RAISE(ABORT, 'audit event actors can only be anonymized');
END;

CREATE TRIGGER audit_events_immutable_delete
BEFORE DELETE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'audit events are immutable');
END;

INSERT OR IGNORE INTO _sql_schema_migrations (id) VALUES (8);
PRAGMA optimize;
`;

const STORE_SCHEMA_V8_MIGRATION_SQL = `
ALTER TABLE vendors ADD COLUMN review_revision INTEGER NOT NULL DEFAULT 0
  CHECK (typeof(review_revision) = 'integer' AND review_revision >= 0);
${STORE_SCHEMA_V8_FINALIZE_SQL}
`;

const STORE_SCHEMA_V9_FINALIZE_SQL = `
CREATE TABLE IF NOT EXISTS vendor_application_evidence (
  vendor_id TEXT PRIMARY KEY REFERENCES vendors(id) ON DELETE RESTRICT,
  evidence_revision INTEGER NOT NULL DEFAULT 1
    CHECK (typeof(evidence_revision) = 'integer' AND evidence_revision = 1),
  portfolio_urls_json TEXT NOT NULL
    CHECK (
      json_valid(portfolio_urls_json)
      AND json_type(portfolio_urls_json) = 'array'
      AND json_array_length(portfolio_urls_json) BETWEEN 1 AND 5
      AND length(portfolio_urls_json) <= 2000
    ),
  reference_urls_json TEXT NOT NULL
    CHECK (
      json_valid(reference_urls_json)
      AND json_type(reference_urls_json) = 'array'
      AND json_array_length(reference_urls_json) BETWEEN 1 AND 3
      AND length(reference_urls_json) <= 1200
    ),
  registration_type TEXT NOT NULL
    CHECK (registration_type IN ('gstin', 'cin', 'udyam', 'not_registered')),
  registration_reference TEXT,
  attested INTEGER NOT NULL CHECK (attested = 1),
  attested_at TEXT NOT NULL CHECK (length(attested_at) BETWEEN 20 AND 35),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (registration_type = 'not_registered' AND registration_reference IS NULL)
    OR (
      registration_type = 'gstin'
      AND registration_reference IS NOT NULL
      AND length(registration_reference) = 15
      AND substr(registration_reference, 1, 2) NOT GLOB '*[^0-9]*'
      AND substr(registration_reference, 3, 5) NOT GLOB '*[^A-Z]*'
      AND substr(registration_reference, 8, 4) NOT GLOB '*[^0-9]*'
      AND substr(registration_reference, 12, 1) GLOB '[A-Z]'
      AND substr(registration_reference, 13, 1) GLOB '[1-9A-Z]'
      AND substr(registration_reference, 14, 1) = 'Z'
      AND substr(registration_reference, 15, 1) GLOB '[0-9A-Z]'
    )
    OR (
      registration_type = 'cin'
      AND registration_reference IS NOT NULL
      AND length(registration_reference) = 21
      AND substr(registration_reference, 1, 1) GLOB '[LU]'
      AND substr(registration_reference, 2, 5) NOT GLOB '*[^0-9]*'
      AND substr(registration_reference, 7, 2) NOT GLOB '*[^A-Z]*'
      AND substr(registration_reference, 9, 4) NOT GLOB '*[^0-9]*'
      AND substr(registration_reference, 13, 3) NOT GLOB '*[^A-Z]*'
      AND substr(registration_reference, 16, 6) NOT GLOB '*[^0-9]*'
    )
    OR (
      registration_type = 'udyam'
      AND registration_reference IS NOT NULL
      AND length(registration_reference) = 19
      AND substr(registration_reference, 1, 6) = 'UDYAM-'
      AND substr(registration_reference, 7, 2) NOT GLOB '*[^A-Z]*'
      AND substr(registration_reference, 9, 1) = '-'
      AND substr(registration_reference, 10, 2) NOT GLOB '*[^0-9]*'
      AND substr(registration_reference, 12, 1) = '-'
      AND substr(registration_reference, 13, 7) NOT GLOB '*[^0-9]*'
    )
  )
);

CREATE TRIGGER IF NOT EXISTS vendor_application_evidence_validate_insert
BEFORE INSERT ON vendor_application_evidence
WHEN
  EXISTS (
    SELECT 1 FROM json_each(NEW.portfolio_urls_json) item
    WHERE item.type != 'text'
      OR length(CAST(item.value AS TEXT)) NOT BETWEEN 10 AND 300
      OR substr(CAST(item.value AS TEXT), 1, 8) != 'https://'
      OR trim(CAST(item.value AS TEXT)) != CAST(item.value AS TEXT)
      OR instr(CAST(item.value AS TEXT), '#') != 0
      OR instr(substr(CAST(item.value AS TEXT), 9), '/') = 0
      OR substr(
        substr(CAST(item.value AS TEXT), 9),
        1,
        instr(substr(CAST(item.value AS TEXT), 9), '/') - 1
      ) GLOB '*.'
      OR instr(
        substr(
          substr(CAST(item.value AS TEXT), 9),
          1,
          instr(substr(CAST(item.value AS TEXT), 9), '/') - 1
        ),
        '.:'
      ) != 0
      OR lower(substr(
        substr(CAST(item.value AS TEXT), 9),
        1,
        instr(substr(CAST(item.value AS TEXT), 9), '/') - 1
      )) GLOB 'xn--*'
      OR lower(substr(
        substr(CAST(item.value AS TEXT), 9),
        1,
        instr(substr(CAST(item.value AS TEXT), 9), '/') - 1
      )) GLOB '*.xn--*'
  )
  OR EXISTS (
    SELECT 1 FROM json_each(NEW.reference_urls_json) item
    WHERE item.type != 'text'
      OR length(CAST(item.value AS TEXT)) NOT BETWEEN 10 AND 300
      OR substr(CAST(item.value AS TEXT), 1, 8) != 'https://'
      OR trim(CAST(item.value AS TEXT)) != CAST(item.value AS TEXT)
      OR instr(CAST(item.value AS TEXT), '#') != 0
      OR instr(substr(CAST(item.value AS TEXT), 9), '/') = 0
      OR substr(
        substr(CAST(item.value AS TEXT), 9),
        1,
        instr(substr(CAST(item.value AS TEXT), 9), '/') - 1
      ) GLOB '*.'
      OR instr(
        substr(
          substr(CAST(item.value AS TEXT), 9),
          1,
          instr(substr(CAST(item.value AS TEXT), 9), '/') - 1
        ),
        '.:'
      ) != 0
      OR lower(substr(
        substr(CAST(item.value AS TEXT), 9),
        1,
        instr(substr(CAST(item.value AS TEXT), 9), '/') - 1
      )) GLOB 'xn--*'
      OR lower(substr(
        substr(CAST(item.value AS TEXT), 9),
        1,
        instr(substr(CAST(item.value AS TEXT), 9), '/') - 1
      )) GLOB '*.xn--*'
  )
  OR (
    SELECT COUNT(*) FROM json_each(NEW.portfolio_urls_json)
  ) != (
    SELECT COUNT(DISTINCT CAST(item.value AS TEXT)) FROM json_each(NEW.portfolio_urls_json) item
  )
  OR (
    SELECT COUNT(*) FROM json_each(NEW.reference_urls_json)
  ) != (
    SELECT COUNT(DISTINCT CAST(item.value AS TEXT)) FROM json_each(NEW.reference_urls_json) item
  )
  OR EXISTS (
    SELECT 1
    FROM json_each(NEW.portfolio_urls_json) portfolio
    JOIN json_each(NEW.reference_urls_json) reference
      ON CAST(reference.value AS TEXT) = CAST(portfolio.value AS TEXT)
  )
BEGIN
  SELECT RAISE(ABORT, 'vendor application evidence URLs must be normalized unique public HTTPS URLs');
END;

CREATE TRIGGER IF NOT EXISTS vendor_application_evidence_vendor_state_insert
BEFORE INSERT ON vendor_application_evidence
WHEN NOT EXISTS (
  SELECT 1
  FROM vendors vendor
  WHERE vendor.id = NEW.vendor_id
    AND vendor.status IN ('pending', 'rejected')
)
BEGIN
  SELECT RAISE(ABORT, 'vendor application evidence requires a pending or rejected vendor');
END;

CREATE TRIGGER IF NOT EXISTS vendor_application_evidence_immutable_update
BEFORE UPDATE ON vendor_application_evidence
BEGIN
  SELECT RAISE(ABORT, 'vendor application evidence is immutable');
END;

CREATE TRIGGER IF NOT EXISTS vendor_application_evidence_immutable_delete
BEFORE DELETE ON vendor_application_evidence
BEGIN
  SELECT RAISE(ABORT, 'vendor application evidence is immutable');
END;

CREATE TRIGGER IF NOT EXISTS vendors_evidence_approval_guard
BEFORE UPDATE OF status ON vendors
WHEN OLD.status != NEW.status
  AND NEW.status = 'approved'
  AND (
    (
      NEW.evidence_required = 1
      AND NOT EXISTS (
        SELECT 1 FROM vendor_application_evidence evidence
        WHERE evidence.vendor_id = NEW.id
      )
    )
    OR EXISTS (
      SELECT 1
      FROM vendor_application_evidence evidence
      WHERE evidence.vendor_id = NEW.id
        AND evidence.evidence_revision != NEW.evidence_reviewed_revision
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'vendor evidence must be completed and acknowledged before approval');
END;

CREATE TRIGGER IF NOT EXISTS audit_events_vendor_review_sensitive_insert
BEFORE INSERT ON audit_events
WHEN NEW.action = 'vendor.reviewed'
  AND NEW.entity_type = 'vendor'
  AND (
    lower(COALESCE(json_extract(NEW.metadata_json, '$.reason'), json_extract(NEW.metadata_json, '$.note'), ''))
      LIKE '%http://%'
    OR lower(COALESCE(json_extract(NEW.metadata_json, '$.reason'), json_extract(NEW.metadata_json, '$.note'), ''))
      LIKE '%https://%'
    OR lower(COALESCE(json_extract(NEW.metadata_json, '$.reason'), json_extract(NEW.metadata_json, '$.note'), ''))
      LIKE '%www.%'
    OR lower(COALESCE(json_extract(NEW.metadata_json, '$.reason'), json_extract(NEW.metadata_json, '$.note'), ''))
      GLOB '*[a-z0-9].[a-z][a-z]*'
    OR lower(COALESCE(json_extract(NEW.metadata_json, '$.reason'), json_extract(NEW.metadata_json, '$.note'), ''))
      GLOB '*[0-9].[0-9].[0-9].[0-9]*'
    OR (' ' || upper(COALESCE(
      json_extract(NEW.metadata_json, '$.reason'), json_extract(NEW.metadata_json, '$.note'), ''
    )) || ' ') GLOB '*[^A-Z0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][^A-Z0-9]*'
    OR (' ' || upper(COALESCE(
      json_extract(NEW.metadata_json, '$.reason'), json_extract(NEW.metadata_json, '$.note'), ''
    )) || ' ') GLOB '*[^A-Z0-9][0-9][0-9][0-9][0-9] [0-9][0-9][0-9][0-9] [0-9][0-9][0-9][0-9][^A-Z0-9]*'
    OR (' ' || upper(COALESCE(
      json_extract(NEW.metadata_json, '$.reason'), json_extract(NEW.metadata_json, '$.note'), ''
    )) || ' ') GLOB '*[^A-Z0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][^A-Z0-9]*'
    OR (
      (' ' || lower(COALESCE(
        json_extract(NEW.metadata_json, '$.reason'), json_extract(NEW.metadata_json, '$.note'), ''
      )) || ' ') GLOB '*[^a-z0-9]pan[^a-z0-9]*'
      AND (
        (' ' || upper(COALESCE(
          json_extract(NEW.metadata_json, '$.reason'), json_extract(NEW.metadata_json, '$.note'), ''
        )) || ' ') GLOB '*[^A-Z0-9][A-Z][A-Z][A-Z][A-Z][A-Z][0-9][0-9][0-9][0-9][A-Z][^A-Z0-9]*'
        OR (' ' || upper(COALESCE(
          json_extract(NEW.metadata_json, '$.reason'), json_extract(NEW.metadata_json, '$.note'), ''
        )) || ' ') GLOB '*[^A-Z0-9][A-Z][A-Z][A-Z][A-Z][A-Z] [0-9][0-9][0-9][0-9] [A-Z][^A-Z0-9]*'
        OR (' ' || upper(COALESCE(
          json_extract(NEW.metadata_json, '$.reason'), json_extract(NEW.metadata_json, '$.note'), ''
        )) || ' ') GLOB '*[^A-Z0-9][A-Z] [A-Z] [A-Z] [A-Z] [A-Z] [0-9] [0-9] [0-9] [0-9] [A-Z][^A-Z0-9]*'
      )
    )
    OR (
      (' ' || lower(COALESCE(
        json_extract(NEW.metadata_json, '$.reason'), json_extract(NEW.metadata_json, '$.note'), ''
      )) || ' ') GLOB '*[^a-z0-9]passport[^a-z0-9]*'
      AND (
        (' ' || upper(COALESCE(
          json_extract(NEW.metadata_json, '$.reason'), json_extract(NEW.metadata_json, '$.note'), ''
        )) || ' ') GLOB '*[^A-Z0-9][A-Z][0-9][0-9][0-9][0-9][0-9][0-9][0-9][^A-Z0-9]*'
        OR (' ' || upper(COALESCE(
          json_extract(NEW.metadata_json, '$.reason'), json_extract(NEW.metadata_json, '$.note'), ''
        )) || ' ') GLOB '*[^A-Z0-9][A-Z] [0-9] [0-9] [0-9] [0-9] [0-9] [0-9] [0-9][^A-Z0-9]*'
      )
    )
    OR (' ' || upper(COALESCE(
      json_extract(NEW.metadata_json, '$.reason'), json_extract(NEW.metadata_json, '$.note'), ''
    )) || ' ') GLOB '*[^A-Z0-9][0-9][0-9][A-Z][A-Z][A-Z][A-Z][A-Z][0-9][0-9][0-9][0-9][A-Z][A-Z0-9]Z[A-Z0-9][^A-Z0-9]*'
    OR (' ' || upper(COALESCE(
      json_extract(NEW.metadata_json, '$.reason'), json_extract(NEW.metadata_json, '$.note'), ''
    )) || ' ') GLOB '*[^A-Z0-9][LU][0-9][0-9][0-9][0-9][0-9][A-Z][A-Z][0-9][0-9][0-9][0-9][A-Z][A-Z][A-Z][0-9][0-9][0-9][0-9][0-9][0-9][^A-Z0-9]*'
    OR (' ' || upper(COALESCE(
      json_extract(NEW.metadata_json, '$.reason'), json_extract(NEW.metadata_json, '$.note'), ''
    )) || ' ') GLOB '*[^A-Z0-9]UDYAM-[A-Z][A-Z]-[0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][^A-Z0-9]*'
    OR (
      (
        lower(COALESCE(json_extract(NEW.metadata_json, '$.reason'), json_extract(NEW.metadata_json, '$.note'), ''))
          LIKE '%aadhaar%'
        OR lower(COALESCE(json_extract(NEW.metadata_json, '$.reason'), json_extract(NEW.metadata_json, '$.note'), ''))
          LIKE '%aadhar%'
      )
      AND upper(replace(replace(replace(replace(replace(
        COALESCE(json_extract(NEW.metadata_json, '$.reason'), json_extract(NEW.metadata_json, '$.note'), ''),
        ' ', ''), '-', ''), char(9), ''), char(10), ''), char(13), ''))
        GLOB '*[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]*'
    )
    OR (
      (' ' || lower(COALESCE(
        json_extract(NEW.metadata_json, '$.reason'), json_extract(NEW.metadata_json, '$.note'), ''
      )) || ' ') GLOB '*[^a-z0-9]pan[^a-z0-9]*'
      AND upper(replace(replace(replace(replace(replace(
        COALESCE(json_extract(NEW.metadata_json, '$.reason'), json_extract(NEW.metadata_json, '$.note'), ''),
        ' ', ''), '-', ''), char(9), ''), char(10), ''), char(13), ''))
        GLOB '*[A-Z][A-Z][A-Z][A-Z][A-Z][0-9][0-9][0-9][0-9][A-Z]*'
    )
    OR (
      (' ' || lower(COALESCE(
        json_extract(NEW.metadata_json, '$.reason'), json_extract(NEW.metadata_json, '$.note'), ''
      )) || ' ') GLOB '*[^a-z0-9]passport[^a-z0-9]*'
      AND upper(replace(replace(replace(replace(replace(
        COALESCE(json_extract(NEW.metadata_json, '$.reason'), json_extract(NEW.metadata_json, '$.note'), ''),
        ' ', ''), '-', ''), char(9), ''), char(10), ''), char(13), ''))
        GLOB '*[A-Z][0-9][0-9][0-9][0-9][0-9][0-9][0-9]*'
    )
    OR upper(replace(replace(replace(replace(replace(
      COALESCE(json_extract(NEW.metadata_json, '$.reason'), json_extract(NEW.metadata_json, '$.note'), ''),
      ' ', ''), '-', ''), char(9), ''), char(10), ''), char(13), ''))
      GLOB '*[0-9][0-9][A-Z][A-Z][A-Z][A-Z][A-Z][0-9][0-9][0-9][0-9][A-Z][A-Z0-9]Z[A-Z0-9]*'
    OR upper(replace(replace(replace(replace(replace(
      COALESCE(json_extract(NEW.metadata_json, '$.reason'), json_extract(NEW.metadata_json, '$.note'), ''),
      ' ', ''), '-', ''), char(9), ''), char(10), ''), char(13), ''))
      GLOB '*[LU][0-9][0-9][0-9][0-9][0-9][A-Z][A-Z][0-9][0-9][0-9][0-9][A-Z][A-Z][A-Z][0-9][0-9][0-9][0-9][0-9][0-9]*'
    OR upper(replace(replace(replace(replace(replace(
      COALESCE(json_extract(NEW.metadata_json, '$.reason'), json_extract(NEW.metadata_json, '$.note'), ''),
      ' ', ''), '-', ''), char(9), ''), char(10), ''), char(13), ''))
      GLOB '*UDYAM[A-Z][A-Z][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]*'
    OR EXISTS (
      SELECT 1
      FROM vendor_application_evidence evidence
      WHERE evidence.vendor_id = NEW.entity_id
        AND (
          (
            evidence.registration_reference IS NOT NULL
            AND instr(
              upper(replace(replace(replace(replace(replace(
                COALESCE(json_extract(NEW.metadata_json, '$.reason'), json_extract(NEW.metadata_json, '$.note'), ''),
                ' ', ''), '-', ''), char(9), ''), char(10), ''), char(13), '')),
              upper(replace(evidence.registration_reference, '-', ''))
            ) != 0
          )
          OR EXISTS (
            SELECT 1 FROM json_each(evidence.portfolio_urls_json) url
            WHERE instr(
              lower(replace(replace(replace(replace(
                COALESCE(json_extract(NEW.metadata_json, '$.reason'), json_extract(NEW.metadata_json, '$.note'), ''),
                ' ', ''), char(9), ''), char(10), ''), char(13), '')),
              lower(substr(
                substr(CAST(url.value AS TEXT), 9),
                1,
                instr(substr(CAST(url.value AS TEXT), 9), '/') - 1
              ))
            ) != 0
          )
          OR EXISTS (
            SELECT 1 FROM json_each(evidence.reference_urls_json) url
            WHERE instr(
              lower(replace(replace(replace(replace(
                COALESCE(json_extract(NEW.metadata_json, '$.reason'), json_extract(NEW.metadata_json, '$.note'), ''),
                ' ', ''), char(9), ''), char(10), ''), char(13), '')),
              lower(substr(
                substr(CAST(url.value AS TEXT), 9),
                1,
                instr(substr(CAST(url.value AS TEXT), 9), '/') - 1
              ))
            ) != 0
          )
        )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'vendor review reasons must not contain evidence addresses or identity references');
END;

INSERT OR IGNORE INTO _sql_schema_migrations (id) VALUES (9);
PRAGMA optimize;
`;

const STORE_SCHEMA_V9_MIGRATION_SQL = `
ALTER TABLE vendors ADD COLUMN evidence_required INTEGER NOT NULL DEFAULT 1
  CHECK (evidence_required IN (0, 1));
UPDATE vendors SET evidence_required = 0 WHERE evidence_required = 1;
ALTER TABLE vendors ADD COLUMN evidence_reviewed_revision INTEGER NOT NULL DEFAULT 0
  CHECK (typeof(evidence_reviewed_revision) = 'integer' AND evidence_reviewed_revision >= 0);
${STORE_SCHEMA_V9_FINALIZE_SQL}
`;

const STORE_SCHEMA_V10_FINALIZE_SQL = `
CREATE TABLE IF NOT EXISTS vendor_application_evidence_revisions (
  vendor_id TEXT NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,
  evidence_revision INTEGER NOT NULL
    CHECK (typeof(evidence_revision) = 'integer' AND evidence_revision BETWEEN 1 AND 20),
  portfolio_urls_json TEXT NOT NULL
    CHECK (json_valid(portfolio_urls_json) AND json_type(portfolio_urls_json) = 'array'
      AND json_array_length(portfolio_urls_json) BETWEEN 1 AND 5 AND length(portfolio_urls_json) <= 2000),
  reference_urls_json TEXT NOT NULL
    CHECK (json_valid(reference_urls_json) AND json_type(reference_urls_json) = 'array'
      AND json_array_length(reference_urls_json) BETWEEN 1 AND 3 AND length(reference_urls_json) <= 1200),
  registration_type TEXT NOT NULL CHECK (registration_type IN ('gstin', 'cin', 'udyam', 'not_registered')),
  registration_reference TEXT,
  attested INTEGER NOT NULL CHECK (attested = 1),
  attested_at TEXT NOT NULL CHECK (length(attested_at) BETWEEN 20 AND 35),
  submitted_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (vendor_id, evidence_revision),
  CHECK (
    (registration_type = 'not_registered' AND registration_reference IS NULL)
    OR (registration_type = 'gstin' AND registration_reference IS NOT NULL
      AND length(registration_reference) = 15
      AND substr(registration_reference, 1, 2) NOT GLOB '*[^0-9]*'
      AND substr(registration_reference, 3, 5) NOT GLOB '*[^A-Z]*'
      AND substr(registration_reference, 8, 4) NOT GLOB '*[^0-9]*'
      AND substr(registration_reference, 12, 1) GLOB '[A-Z]'
      AND substr(registration_reference, 13, 1) GLOB '[1-9A-Z]'
      AND substr(registration_reference, 14, 1) = 'Z'
      AND substr(registration_reference, 15, 1) GLOB '[0-9A-Z]')
    OR (registration_type = 'cin' AND registration_reference IS NOT NULL
      AND length(registration_reference) = 21
      AND substr(registration_reference, 1, 1) GLOB '[LU]'
      AND substr(registration_reference, 2, 5) NOT GLOB '*[^0-9]*'
      AND substr(registration_reference, 7, 2) NOT GLOB '*[^A-Z]*'
      AND substr(registration_reference, 9, 4) NOT GLOB '*[^0-9]*'
      AND substr(registration_reference, 13, 3) NOT GLOB '*[^A-Z]*'
      AND substr(registration_reference, 16, 6) NOT GLOB '*[^0-9]*')
    OR (registration_type = 'udyam' AND registration_reference IS NOT NULL
      AND length(registration_reference) = 19
      AND substr(registration_reference, 1, 6) = 'UDYAM-'
      AND substr(registration_reference, 7, 2) NOT GLOB '*[^A-Z]*'
      AND substr(registration_reference, 9, 1) = '-'
      AND substr(registration_reference, 10, 2) NOT GLOB '*[^0-9]*'
      AND substr(registration_reference, 12, 1) = '-'
      AND substr(registration_reference, 13, 7) NOT GLOB '*[^0-9]*')
  )
);

CREATE TABLE IF NOT EXISTS vendor_application_information_requests (
  vendor_id TEXT NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,
  request_revision INTEGER NOT NULL
    CHECK (typeof(request_revision) = 'integer' AND request_revision BETWEEN 1 AND 1000000000),
  evidence_revision INTEGER NOT NULL
    CHECK (typeof(evidence_revision) = 'integer' AND evidence_revision BETWEEN 0 AND 20),
  requested_fields_json TEXT NOT NULL
    CHECK (json_valid(requested_fields_json) AND json_type(requested_fields_json) = 'array'
      AND json_array_length(requested_fields_json) BETWEEN 1 AND 3 AND length(requested_fields_json) <= 80),
  applicant_message TEXT NOT NULL CHECK (length(applicant_message) BETWEEN 10 AND 1000),
  requested_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  requested_at TEXT NOT NULL CHECK (length(requested_at) BETWEEN 20 AND 35),
  PRIMARY KEY (vendor_id, request_revision)
);
CREATE INDEX IF NOT EXISTS idx_vendor_information_requests_current
  ON vendor_application_information_requests(vendor_id, request_revision DESC);

INSERT OR IGNORE INTO vendor_application_evidence_revisions
  (vendor_id, evidence_revision, portfolio_urls_json, reference_urls_json, registration_type,
   registration_reference, attested, attested_at, submitted_by_user_id, created_at)
SELECT evidence.vendor_id, evidence.evidence_revision, evidence.portfolio_urls_json,
       evidence.reference_urls_json, evidence.registration_type, evidence.registration_reference,
       evidence.attested, evidence.attested_at, vendor.user_id, evidence.created_at
FROM vendor_application_evidence evidence
JOIN vendors vendor ON vendor.id = evidence.vendor_id;

UPDATE vendors
SET evidence_latest_revision = COALESCE(
  (SELECT MAX(revision.evidence_revision)
   FROM vendor_application_evidence_revisions revision WHERE revision.vendor_id = vendors.id),
  0
)
WHERE evidence_latest_revision != COALESCE(
  (SELECT MAX(revision.evidence_revision)
   FROM vendor_application_evidence_revisions revision WHERE revision.vendor_id = vendors.id),
  0
);

DROP TRIGGER IF EXISTS vendor_application_evidence_vendor_state_insert;
DROP TRIGGER IF EXISTS vendors_evidence_approval_guard;
DROP TRIGGER IF EXISTS audit_events_vendor_review_sensitive_insert;
DROP TRIGGER IF EXISTS vendor_application_evidence_vendor_state_insert_v10;
DROP TRIGGER IF EXISTS vendor_application_evidence_mirror_insert_v10;
DROP TRIGGER IF EXISTS vendor_application_evidence_revisions_validate_insert;
DROP TRIGGER IF EXISTS vendor_application_evidence_revisions_state_insert;
DROP TRIGGER IF EXISTS vendor_application_evidence_revisions_apply_insert;
DROP TRIGGER IF EXISTS vendor_application_evidence_revisions_identity_update;
DROP TRIGGER IF EXISTS vendor_application_evidence_revisions_actor_update;
DROP TRIGGER IF EXISTS vendor_application_evidence_revisions_delete;
DROP TRIGGER IF EXISTS vendors_evidence_latest_revision_guard;
DROP TRIGGER IF EXISTS vendor_application_information_requests_validate_insert;
DROP TRIGGER IF EXISTS vendor_application_information_requests_apply_insert;
DROP TRIGGER IF EXISTS vendor_application_information_requests_identity_update;
DROP TRIGGER IF EXISTS vendor_application_information_requests_actor_update;
DROP TRIGGER IF EXISTS vendor_application_information_requests_delete;
DROP TRIGGER IF EXISTS vendors_information_request_status_guard;
DROP TRIGGER IF EXISTS vendors_information_request_state_guard;
DROP TRIGGER IF EXISTS vendors_evidence_approval_guard_v10;
DROP TRIGGER IF EXISTS audit_events_vendor_review_sensitive_insert_v10;

CREATE TRIGGER vendor_application_evidence_vendor_state_insert_v10
BEFORE INSERT ON vendor_application_evidence
WHEN NOT EXISTS (
  SELECT 1 FROM vendors vendor
  WHERE vendor.id = NEW.vendor_id AND vendor.status IN ('pending', 'rejected')
)
BEGIN
  SELECT RAISE(ABORT, 'vendor application evidence requires a pending or rejected vendor');
END;

CREATE TRIGGER vendor_application_evidence_revisions_validate_insert
BEFORE INSERT ON vendor_application_evidence_revisions
WHEN
  EXISTS (
    SELECT 1 FROM json_each(NEW.portfolio_urls_json) item
    WHERE item.type != 'text'
      OR length(CAST(item.value AS TEXT)) NOT BETWEEN 10 AND 300
      OR substr(CAST(item.value AS TEXT), 1, 8) != 'https://'
      OR trim(CAST(item.value AS TEXT)) != CAST(item.value AS TEXT)
      OR instr(CAST(item.value AS TEXT), '#') != 0
      OR instr(substr(CAST(item.value AS TEXT), 9), '/') = 0
      OR substr(substr(CAST(item.value AS TEXT), 9), 1,
        instr(substr(CAST(item.value AS TEXT), 9), '/') - 1) GLOB '*.'
      OR instr(substr(substr(CAST(item.value AS TEXT), 9), 1,
        instr(substr(CAST(item.value AS TEXT), 9), '/') - 1), '.:') != 0
      OR lower(substr(substr(CAST(item.value AS TEXT), 9), 1,
        instr(substr(CAST(item.value AS TEXT), 9), '/') - 1)) GLOB 'xn--*'
      OR lower(substr(substr(CAST(item.value AS TEXT), 9), 1,
        instr(substr(CAST(item.value AS TEXT), 9), '/') - 1)) GLOB '*.xn--*'
  )
  OR EXISTS (
    SELECT 1 FROM json_each(NEW.reference_urls_json) item
    WHERE item.type != 'text'
      OR length(CAST(item.value AS TEXT)) NOT BETWEEN 10 AND 300
      OR substr(CAST(item.value AS TEXT), 1, 8) != 'https://'
      OR trim(CAST(item.value AS TEXT)) != CAST(item.value AS TEXT)
      OR instr(CAST(item.value AS TEXT), '#') != 0
      OR instr(substr(CAST(item.value AS TEXT), 9), '/') = 0
      OR substr(substr(CAST(item.value AS TEXT), 9), 1,
        instr(substr(CAST(item.value AS TEXT), 9), '/') - 1) GLOB '*.'
      OR instr(substr(substr(CAST(item.value AS TEXT), 9), 1,
        instr(substr(CAST(item.value AS TEXT), 9), '/') - 1), '.:') != 0
      OR lower(substr(substr(CAST(item.value AS TEXT), 9), 1,
        instr(substr(CAST(item.value AS TEXT), 9), '/') - 1)) GLOB 'xn--*'
      OR lower(substr(substr(CAST(item.value AS TEXT), 9), 1,
        instr(substr(CAST(item.value AS TEXT), 9), '/') - 1)) GLOB '*.xn--*'
  )
  OR (SELECT COUNT(*) FROM json_each(NEW.portfolio_urls_json))
    != (SELECT COUNT(DISTINCT CAST(item.value AS TEXT)) FROM json_each(NEW.portfolio_urls_json) item)
  OR (SELECT COUNT(*) FROM json_each(NEW.reference_urls_json))
    != (SELECT COUNT(DISTINCT CAST(item.value AS TEXT)) FROM json_each(NEW.reference_urls_json) item)
  OR EXISTS (
    SELECT 1 FROM json_each(NEW.portfolio_urls_json) portfolio
    JOIN json_each(NEW.reference_urls_json) reference
      ON CAST(reference.value AS TEXT) = CAST(portfolio.value AS TEXT)
  )
BEGIN
  SELECT RAISE(ABORT, 'vendor application evidence URLs must be normalized unique public HTTPS URLs');
END;

CREATE TRIGGER vendor_application_evidence_revisions_state_insert
BEFORE INSERT ON vendor_application_evidence_revisions
WHEN
  (
    NEW.evidence_revision = 1
    AND NOT EXISTS (
      SELECT 1 FROM vendor_application_evidence compatibility
      WHERE compatibility.vendor_id = NEW.vendor_id
        AND compatibility.evidence_revision = 1
        AND compatibility.portfolio_urls_json = NEW.portfolio_urls_json
        AND compatibility.reference_urls_json = NEW.reference_urls_json
        AND compatibility.registration_type = NEW.registration_type
        AND compatibility.registration_reference IS NEW.registration_reference
        AND compatibility.attested = NEW.attested
        AND compatibility.attested_at = NEW.attested_at
    )
  )
  OR (
    NEW.evidence_revision > 1
    AND NOT EXISTS (
      SELECT 1 FROM vendors vendor
      JOIN users owner ON owner.id = vendor.user_id
      WHERE vendor.id = NEW.vendor_id
        AND vendor.status IN ('pending', 'rejected')
        AND vendor.information_requested = 1
        AND vendor.evidence_latest_revision + 1 = NEW.evidence_revision
        AND NEW.submitted_by_user_id = vendor.user_id
        AND owner.status = 'active'
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'vendor evidence revision requires the active owner and an information request');
END;

CREATE TRIGGER vendor_application_evidence_revisions_apply_insert
AFTER INSERT ON vendor_application_evidence_revisions
BEGIN
  UPDATE vendors
  SET evidence_latest_revision = NEW.evidence_revision,
      information_requested = 0,
      status = CASE
        WHEN NEW.evidence_revision > 1 OR information_requested = 1 THEN 'pending'
        ELSE status
      END,
      review_revision = review_revision + CASE
        WHEN NEW.evidence_revision > 1 OR information_requested = 1 THEN 1
        ELSE 0
      END,
      updated_at = CASE
        WHEN NEW.evidence_revision > 1 OR information_requested = 1 THEN NEW.created_at
        ELSE updated_at
      END
  WHERE id = NEW.vendor_id AND evidence_latest_revision < NEW.evidence_revision;
END;

CREATE TRIGGER vendor_application_evidence_mirror_insert_v10
AFTER INSERT ON vendor_application_evidence
BEGIN
  INSERT INTO vendor_application_evidence_revisions
    (vendor_id, evidence_revision, portfolio_urls_json, reference_urls_json, registration_type,
     registration_reference, attested, attested_at, submitted_by_user_id, created_at)
  SELECT NEW.vendor_id, NEW.evidence_revision, NEW.portfolio_urls_json, NEW.reference_urls_json,
         NEW.registration_type, NEW.registration_reference, NEW.attested, NEW.attested_at,
         vendor.user_id, NEW.created_at
  FROM vendors vendor WHERE vendor.id = NEW.vendor_id;
END;

CREATE TRIGGER vendor_application_evidence_revisions_identity_update
BEFORE UPDATE OF vendor_id, evidence_revision, portfolio_urls_json, reference_urls_json,
  registration_type, registration_reference, attested, attested_at, created_at
ON vendor_application_evidence_revisions
BEGIN
  SELECT RAISE(ABORT, 'vendor application evidence revisions are immutable');
END;

CREATE TRIGGER vendor_application_evidence_revisions_actor_update
BEFORE UPDATE OF submitted_by_user_id ON vendor_application_evidence_revisions
WHEN NEW.submitted_by_user_id IS NOT NULL OR OLD.submitted_by_user_id IS NULL
BEGIN
  SELECT RAISE(ABORT, 'vendor evidence revision actors can only be anonymized');
END;

CREATE TRIGGER vendor_application_evidence_revisions_delete
BEFORE DELETE ON vendor_application_evidence_revisions
BEGIN
  SELECT RAISE(ABORT, 'vendor application evidence revisions are immutable');
END;

CREATE TRIGGER vendors_evidence_latest_revision_guard
BEFORE UPDATE OF evidence_latest_revision ON vendors
WHEN NEW.evidence_latest_revision < OLD.evidence_latest_revision
  OR (
    NEW.evidence_latest_revision > 0
    AND NOT EXISTS (
      SELECT 1 FROM vendor_application_evidence_revisions evidence
      WHERE evidence.vendor_id = NEW.id
        AND evidence.evidence_revision = NEW.evidence_latest_revision
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'vendor evidence latest revision must reference append-only history');
END;

CREATE TRIGGER vendor_application_information_requests_validate_insert
BEFORE INSERT ON vendor_application_information_requests
WHEN
  EXISTS (
    SELECT 1 FROM json_each(NEW.requested_fields_json) item
    WHERE item.type != 'text'
      OR CAST(item.value AS TEXT) NOT IN ('portfolio', 'references', 'registration')
  )
  OR (SELECT COUNT(*) FROM json_each(NEW.requested_fields_json))
    != (SELECT COUNT(DISTINCT CAST(item.value AS TEXT))
        FROM json_each(NEW.requested_fields_json) item)
  OR NOT EXISTS (
    SELECT 1 FROM vendors vendor
    JOIN users operator ON operator.id = NEW.requested_by_user_id
    WHERE vendor.id = NEW.vendor_id
      AND vendor.status IN ('pending', 'rejected')
      AND vendor.information_requested = 0
      AND vendor.evidence_latest_revision < 20
      AND NEW.request_revision = vendor.information_request_revision + 1
      AND NEW.evidence_revision = vendor.evidence_latest_revision
      AND operator.role = 'admin'
      AND operator.status = 'active'
  )
  OR lower(NEW.applicant_message) LIKE '%http://%'
  OR lower(NEW.applicant_message) LIKE '%https://%'
  OR lower(NEW.applicant_message) LIKE '%www.%'
  OR trim(NEW.applicant_message, ' ' || char(9) || char(10) || char(13)) != NEW.applicant_message
  OR EXISTS (
    SELECT 1
    FROM (
      SELECT column1 AS code
      FROM (VALUES
        (0), (1), (2), (3), (4), (5), (6), (7), (8),
        (11), (12), (14), (15), (16), (17), (18), (19), (20), (21), (22), (23),
        (24), (25), (26), (27), (28), (29), (30), (31), (127),
        (8234), (8235), (8236), (8237), (8238), (8294), (8295), (8296), (8297)
      )
    ) disallowed_character
    WHERE instr(NEW.applicant_message, char(disallowed_character.code)) != 0
  )
  OR lower(NEW.applicant_message) GLOB '*[a-z0-9].[a-z][a-z]*'
  OR lower(NEW.applicant_message) GLOB '*[0-9].[0-9].[0-9].[0-9]*'
  OR EXISTS (
    WITH RECURSIVE
      compact(value) AS (
        SELECT upper(replace(replace(replace(replace(replace(
          NEW.applicant_message, ' ', ''), '-', ''), char(9), ''), char(10), ''), char(13), ''))
      ),
      positions(position) AS (
        SELECT 1
        UNION ALL
        SELECT position + 1 FROM positions, compact WHERE position < length(compact.value)
      )
    SELECT 1 FROM compact, positions
    WHERE
      (length(substr(value, position, 12)) = 12
        AND substr(value, position, 12) NOT GLOB '*[^0-9]*')
      OR (length(substr(value, position, 10)) = 10
        AND substr(value, position, 5) NOT GLOB '*[^A-Z]*'
        AND substr(value, position + 5, 4) NOT GLOB '*[^0-9]*'
        AND substr(value, position + 9, 1) GLOB '[A-Z]')
      OR (length(substr(value, position, 8)) = 8
        AND substr(value, position, 1) GLOB '[A-Z]'
        AND substr(value, position + 1, 7) NOT GLOB '*[^0-9]*')
      OR (length(substr(value, position, 15)) = 15
        AND substr(value, position, 2) NOT GLOB '*[^0-9]*'
        AND substr(value, position + 2, 5) NOT GLOB '*[^A-Z]*'
        AND substr(value, position + 7, 4) NOT GLOB '*[^0-9]*'
        AND substr(value, position + 11, 1) GLOB '[A-Z]'
        AND substr(value, position + 12, 1) GLOB '[1-9A-Z]'
        AND substr(value, position + 13, 1) = 'Z'
        AND substr(value, position + 14, 1) GLOB '[0-9A-Z]')
      OR (length(substr(value, position, 21)) = 21
        AND substr(value, position, 1) GLOB '[LU]'
        AND substr(value, position + 1, 5) NOT GLOB '*[^0-9]*'
        AND substr(value, position + 6, 2) NOT GLOB '*[^A-Z]*'
        AND substr(value, position + 8, 4) NOT GLOB '*[^0-9]*'
        AND substr(value, position + 12, 3) NOT GLOB '*[^A-Z]*'
        AND substr(value, position + 15, 6) NOT GLOB '*[^0-9]*')
      OR (substr(value, position, 5) = 'UDYAM'
        AND length(substr(value, position, 16)) = 16
        AND substr(value, position + 5, 2) NOT GLOB '*[^A-Z]*'
        AND substr(value, position + 7, 9) NOT GLOB '*[^0-9]*')
  )
  OR EXISTS (
    SELECT 1 FROM vendor_application_evidence_revisions evidence
    WHERE evidence.vendor_id = NEW.vendor_id
      AND (
        (
          evidence.registration_reference IS NOT NULL
          AND instr(
            upper(replace(replace(replace(replace(replace(
              NEW.applicant_message, ' ', ''), '-', ''), char(9), ''), char(10), ''), char(13), '')),
            upper(replace(evidence.registration_reference, '-', ''))
          ) != 0
        )
        OR EXISTS (
          SELECT 1 FROM json_each(evidence.portfolio_urls_json) url
          WHERE instr(
            lower(replace(replace(replace(replace(
              NEW.applicant_message, ' ', ''), char(9), ''), char(10), ''), char(13), '')),
            lower(substr(substr(CAST(url.value AS TEXT), 9), 1,
              instr(substr(CAST(url.value AS TEXT), 9), '/') - 1))
          ) != 0
        )
        OR EXISTS (
          SELECT 1 FROM json_each(evidence.reference_urls_json) url
          WHERE instr(
            lower(replace(replace(replace(replace(
              NEW.applicant_message, ' ', ''), char(9), ''), char(10), ''), char(13), '')),
            lower(substr(substr(CAST(url.value AS TEXT), 9), 1,
              instr(substr(CAST(url.value AS TEXT), 9), '/') - 1))
          ) != 0
        )
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'vendor information requests contain invalid or sensitive content');
END;

CREATE TRIGGER vendor_application_information_requests_apply_insert
AFTER INSERT ON vendor_application_information_requests
BEGIN
  UPDATE vendors
  SET status = 'pending',
      verified = 0,
      information_request_revision = NEW.request_revision,
      information_requested = 1,
      evidence_reviewed_revision = NEW.evidence_revision,
      review_revision = review_revision + 1,
      updated_at = NEW.requested_at
  WHERE id = NEW.vendor_id;
END;

CREATE TRIGGER vendor_application_information_requests_identity_update
BEFORE UPDATE OF vendor_id, request_revision, evidence_revision, requested_fields_json,
  applicant_message, requested_at
ON vendor_application_information_requests
BEGIN
  SELECT RAISE(ABORT, 'vendor information requests are immutable');
END;

CREATE TRIGGER vendor_application_information_requests_actor_update
BEFORE UPDATE OF requested_by_user_id ON vendor_application_information_requests
WHEN NEW.requested_by_user_id IS NOT NULL OR OLD.requested_by_user_id IS NULL
BEGIN
  SELECT RAISE(ABORT, 'vendor information request actors can only be anonymized');
END;

CREATE TRIGGER vendor_application_information_requests_delete
BEFORE DELETE ON vendor_application_information_requests
BEGIN
  SELECT RAISE(ABORT, 'vendor information requests are immutable');
END;

CREATE TRIGGER vendors_information_request_status_guard
BEFORE UPDATE OF status ON vendors
WHEN OLD.status != NEW.status
  AND OLD.information_requested = 1
  AND NEW.information_requested = 1
BEGIN
  SELECT RAISE(ABORT, 'vendor information request must be resolved before a status decision');
END;

CREATE TRIGGER vendors_information_request_state_guard
BEFORE UPDATE OF information_requested, information_request_revision ON vendors
WHEN
  NEW.information_request_revision < OLD.information_request_revision
  OR (
    NEW.information_requested = 1
    AND (
      NEW.status NOT IN ('pending', 'rejected')
      OR NOT EXISTS (
        SELECT 1 FROM vendor_application_information_requests request
        WHERE request.vendor_id = NEW.id
          AND request.request_revision = NEW.information_request_revision
      )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'vendor information request state is invalid');
END;

CREATE TRIGGER vendors_evidence_approval_guard_v10
BEFORE UPDATE OF status ON vendors
WHEN OLD.status != NEW.status
  AND NEW.status = 'approved'
  AND (
    NEW.information_requested = 1
    OR (NEW.evidence_required = 1 AND NEW.evidence_latest_revision = 0)
    OR NEW.evidence_latest_revision != NEW.evidence_reviewed_revision
    OR (
      NEW.evidence_latest_revision > 0
      AND NOT EXISTS (
        SELECT 1 FROM vendor_application_evidence_revisions evidence
        WHERE evidence.vendor_id = NEW.id
          AND evidence.evidence_revision = NEW.evidence_latest_revision
      )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'vendor evidence must be completed and acknowledged before approval');
END;

CREATE TRIGGER audit_events_vendor_review_sensitive_insert_v10
BEFORE INSERT ON audit_events
WHEN NEW.action = 'vendor.reviewed'
  AND NEW.entity_type = 'vendor'
  AND (
    lower(COALESCE(json_extract(NEW.metadata_json, '$.reason'), json_extract(NEW.metadata_json, '$.note'), ''))
      LIKE '%http://%'
    OR lower(COALESCE(json_extract(NEW.metadata_json, '$.reason'), json_extract(NEW.metadata_json, '$.note'), ''))
      LIKE '%https://%'
    OR lower(COALESCE(json_extract(NEW.metadata_json, '$.reason'), json_extract(NEW.metadata_json, '$.note'), ''))
      LIKE '%www.%'
    OR lower(COALESCE(json_extract(NEW.metadata_json, '$.reason'), json_extract(NEW.metadata_json, '$.note'), ''))
      GLOB '*[a-z0-9].[a-z][a-z]*'
    OR lower(COALESCE(json_extract(NEW.metadata_json, '$.reason'), json_extract(NEW.metadata_json, '$.note'), ''))
      GLOB '*[0-9].[0-9].[0-9].[0-9]*'
    OR EXISTS (
      WITH RECURSIVE
        compact(value) AS (
          SELECT upper(replace(replace(replace(replace(replace(
            COALESCE(json_extract(NEW.metadata_json, '$.reason'), json_extract(NEW.metadata_json, '$.note'), ''),
            ' ', ''), '-', ''), char(9), ''), char(10), ''), char(13), ''))
        ),
        positions(position) AS (
          SELECT 1
          UNION ALL
          SELECT position + 1 FROM positions, compact WHERE position < length(compact.value)
        )
      SELECT 1 FROM compact, positions
      WHERE
        (length(substr(value, position, 12)) = 12
          AND substr(value, position, 12) NOT GLOB '*[^0-9]*')
        OR (length(substr(value, position, 10)) = 10
          AND substr(value, position, 5) NOT GLOB '*[^A-Z]*'
          AND substr(value, position + 5, 4) NOT GLOB '*[^0-9]*'
          AND substr(value, position + 9, 1) GLOB '[A-Z]')
        OR (length(substr(value, position, 8)) = 8
          AND substr(value, position, 1) GLOB '[A-Z]'
          AND substr(value, position + 1, 7) NOT GLOB '*[^0-9]*')
        OR (length(substr(value, position, 15)) = 15
          AND substr(value, position, 2) NOT GLOB '*[^0-9]*'
          AND substr(value, position + 2, 5) NOT GLOB '*[^A-Z]*'
          AND substr(value, position + 7, 4) NOT GLOB '*[^0-9]*'
          AND substr(value, position + 11, 1) GLOB '[A-Z]'
          AND substr(value, position + 12, 1) GLOB '[1-9A-Z]'
          AND substr(value, position + 13, 1) = 'Z'
          AND substr(value, position + 14, 1) GLOB '[0-9A-Z]')
        OR (length(substr(value, position, 21)) = 21
          AND substr(value, position, 1) GLOB '[LU]'
          AND substr(value, position + 1, 5) NOT GLOB '*[^0-9]*'
          AND substr(value, position + 6, 2) NOT GLOB '*[^A-Z]*'
          AND substr(value, position + 8, 4) NOT GLOB '*[^0-9]*'
          AND substr(value, position + 12, 3) NOT GLOB '*[^A-Z]*'
          AND substr(value, position + 15, 6) NOT GLOB '*[^0-9]*')
        OR (substr(value, position, 5) = 'UDYAM'
          AND length(substr(value, position, 16)) = 16
          AND substr(value, position + 5, 2) NOT GLOB '*[^A-Z]*'
          AND substr(value, position + 7, 9) NOT GLOB '*[^0-9]*')
    )
    OR EXISTS (
      SELECT 1 FROM vendor_application_evidence_revisions evidence
      WHERE evidence.vendor_id = NEW.entity_id
        AND (
          (
            evidence.registration_reference IS NOT NULL
            AND instr(
              upper(replace(replace(replace(replace(replace(
                COALESCE(json_extract(NEW.metadata_json, '$.reason'), json_extract(NEW.metadata_json, '$.note'), ''),
                ' ', ''), '-', ''), char(9), ''), char(10), ''), char(13), '')),
              upper(replace(evidence.registration_reference, '-', ''))
            ) != 0
          )
          OR EXISTS (
            SELECT 1 FROM json_each(evidence.portfolio_urls_json) url
            WHERE instr(
              lower(replace(replace(replace(replace(
                COALESCE(json_extract(NEW.metadata_json, '$.reason'), json_extract(NEW.metadata_json, '$.note'), ''),
                ' ', ''), char(9), ''), char(10), ''), char(13), '')),
              lower(substr(substr(CAST(url.value AS TEXT), 9), 1,
                instr(substr(CAST(url.value AS TEXT), 9), '/') - 1))
            ) != 0
          )
          OR EXISTS (
            SELECT 1 FROM json_each(evidence.reference_urls_json) url
            WHERE instr(
              lower(replace(replace(replace(replace(
                COALESCE(json_extract(NEW.metadata_json, '$.reason'), json_extract(NEW.metadata_json, '$.note'), ''),
                ' ', ''), char(9), ''), char(10), ''), char(13), '')),
              lower(substr(substr(CAST(url.value AS TEXT), 9), 1,
                instr(substr(CAST(url.value AS TEXT), 9), '/') - 1))
            ) != 0
          )
        )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'vendor review reasons must not contain evidence addresses or identity references');
END;

INSERT OR IGNORE INTO _sql_schema_migrations (id) VALUES (10);
PRAGMA optimize;
`;

const STORE_SCHEMA_V10_MIGRATION_SQL = `
ALTER TABLE vendors ADD COLUMN evidence_latest_revision INTEGER NOT NULL DEFAULT 0
  CHECK (typeof(evidence_latest_revision) = 'integer' AND evidence_latest_revision BETWEEN 0 AND 20);
ALTER TABLE vendors ADD COLUMN information_request_revision INTEGER NOT NULL DEFAULT 0
  CHECK (typeof(information_request_revision) = 'integer' AND information_request_revision >= 0);
ALTER TABLE vendors ADD COLUMN information_requested INTEGER NOT NULL DEFAULT 0
  CHECK (information_requested IN (0, 1));
${STORE_SCHEMA_V10_FINALIZE_SQL}
`;

const STORE_SCHEMA_SQL = `${STORE_SCHEMA_V1_SQL}\n${STORE_SCHEMA_V2_MIGRATION_SQL}\n${STORE_SCHEMA_V3_MIGRATION_SQL}\n${STORE_SCHEMA_V4_MIGRATION_SQL}\n${STORE_SCHEMA_V5_MIGRATION_SQL}\n${STORE_SCHEMA_V6_MIGRATION_SQL}\n${STORE_SCHEMA_V7_MIGRATION_SQL}\n${STORE_SCHEMA_V8_MIGRATION_SQL}\n${STORE_SCHEMA_V9_MIGRATION_SQL}\n${STORE_SCHEMA_V10_MIGRATION_SQL}`;

const DEMO_CATALOG_SQL = `
INSERT OR IGNORE INTO vendors
  (id, slug, business_name, legal_name, status, category, categories_json, city, service_areas_json,
   description, min_budget, max_budget, currency, rating, review_count, verified, evidence_required)
VALUES
  ('demo-venue-udaipur', 'the-lakehouse-udaipur', 'The Lakehouse Udaipur', 'Demo listing',
   'approved', 'venues', '["venues","hospitality"]', 'Udaipur', '["Udaipur","Jaipur"]',
   'Development-only demonstration listing. Not a real or verified business.', 1200000, 4500000, 'INR', 0, 0, 0, 0),
  ('demo-photo-delhi', 'moonlit-stories', 'Moonlit Stories', 'Demo listing',
   'approved', 'photography', '["photography","cinematography"]', 'Delhi NCR', '["Delhi NCR","Jaipur","Goa"]',
   'Development-only demonstration listing. Not a real or verified business.', 250000, 750000, 'INR', 0, 0, 0, 0);
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

const VENDOR_EVIDENCE_TRIGGER_NAMES = Object.freeze([
  "vendor_application_evidence_validate_insert",
  "vendor_application_evidence_vendor_state_insert",
  "vendor_application_evidence_immutable_update",
  "vendor_application_evidence_immutable_delete",
  "vendors_evidence_approval_guard",
  "audit_events_vendor_review_sensitive_insert",
]);

const VENDOR_EVIDENCE_V10_TRIGGER_NAMES = Object.freeze([
  "vendor_application_evidence_validate_insert",
  "vendor_application_evidence_vendor_state_insert_v10",
  "vendor_application_evidence_immutable_update",
  "vendor_application_evidence_immutable_delete",
  "vendor_application_evidence_mirror_insert_v10",
  "vendor_application_evidence_revisions_validate_insert",
  "vendor_application_evidence_revisions_state_insert",
  "vendor_application_evidence_revisions_apply_insert",
  "vendor_application_evidence_revisions_identity_update",
  "vendor_application_evidence_revisions_actor_update",
  "vendor_application_evidence_revisions_delete",
  "vendors_evidence_latest_revision_guard",
  "vendor_application_information_requests_validate_insert",
  "vendor_application_information_requests_apply_insert",
  "vendor_application_information_requests_identity_update",
  "vendor_application_information_requests_actor_update",
  "vendor_application_information_requests_delete",
  "vendors_information_request_status_guard",
  "vendors_information_request_state_guard",
  "vendors_evidence_approval_guard_v10",
  "audit_events_vendor_review_sensitive_insert_v10",
]);

function runStorageTransaction(storage, callback) {
  return typeof storage.transactionSync === "function" ? storage.transactionSync(callback) : callback();
}

function assertVendorEvidenceSchemaReady(sqlStorage) {
  const migration = sqlStorage
    .exec("SELECT id FROM _sql_schema_migrations WHERE id = 9 LIMIT 1")
    .toArray()[0];
  const vendorColumns = new Set(sqlStorage.exec("PRAGMA table_info(vendors)").toArray().map((column) => column.name));
  const evidenceColumns = new Set(
    sqlStorage.exec("PRAGMA table_info(vendor_application_evidence)").toArray().map((column) => column.name),
  );
  const triggers = new Map(
    sqlStorage
      .exec(
        `SELECT name, sql FROM sqlite_master
         WHERE type = 'trigger' AND name IN (${VENDOR_EVIDENCE_TRIGGER_NAMES.map(() => "?").join(", ")})`,
        ...VENDOR_EVIDENCE_TRIGGER_NAMES,
      )
      .toArray()
      .map((trigger) => [trigger.name, String(trigger.sql || "")]),
  );
  const approvalGuard = triggers.get("vendors_evidence_approval_guard") || "";
  const stateGuard = triggers.get("vendor_application_evidence_vendor_state_insert") || "";
  const ready = Boolean(migration)
    && vendorColumns.has("evidence_required")
    && vendorColumns.has("evidence_reviewed_revision")
    && [
      "vendor_id",
      "evidence_revision",
      "portfolio_urls_json",
      "reference_urls_json",
      "registration_type",
      "registration_reference",
      "attested",
      "attested_at",
    ].every((column) => evidenceColumns.has(column))
    && VENDOR_EVIDENCE_TRIGGER_NAMES.every((name) => triggers.has(name))
    && approvalGuard.includes("NEW.evidence_required = 1")
    && approvalGuard.includes("evidence.evidence_revision != NEW.evidence_reviewed_revision")
    && stateGuard.includes("vendor.status IN ('pending', 'rejected')");
  if (!ready) throw new Error("vendor evidence schema v9 is incomplete");
}

function assertVendorEvidenceV10SchemaReady(sqlStorage) {
  const legacyTriggerName = "vendor_application_evidence_vendor_state_insert";
  const inspectedTriggerNames = [...VENDOR_EVIDENCE_V10_TRIGGER_NAMES, legacyTriggerName];
  const migration = sqlStorage
    .exec("SELECT id FROM _sql_schema_migrations WHERE id = 10 LIMIT 1")
    .toArray()[0];
  const vendorColumns = new Set(sqlStorage.exec("PRAGMA table_info(vendors)").toArray().map((column) => column.name));
  const revisionColumns = new Set(
    sqlStorage.exec("PRAGMA table_info(vendor_application_evidence_revisions)").toArray().map((column) => column.name),
  );
  const requestColumns = new Set(
    sqlStorage.exec("PRAGMA table_info(vendor_application_information_requests)").toArray().map((column) => column.name),
  );
  const triggers = new Map(
    sqlStorage
      .exec(
        `SELECT name, sql FROM sqlite_master
         WHERE type = 'trigger' AND name IN (${inspectedTriggerNames.map(() => "?").join(", ")})`,
        ...inspectedTriggerNames,
      )
      .toArray()
      .map((trigger) => [trigger.name, String(trigger.sql || "")]),
  );
  const approvalGuard = triggers.get("vendors_evidence_approval_guard_v10") || "";
  const revisionGuard = triggers.get("vendor_application_evidence_revisions_state_insert") || "";
  const latestRevisionGuard = triggers.get("vendors_evidence_latest_revision_guard") || "";
  const ready = Boolean(migration)
    && ["evidence_latest_revision", "information_request_revision", "information_requested"]
      .every((column) => vendorColumns.has(column))
    && [
      "vendor_id",
      "evidence_revision",
      "portfolio_urls_json",
      "reference_urls_json",
      "registration_type",
      "registration_reference",
      "attested",
      "attested_at",
      "submitted_by_user_id",
      "created_at",
    ].every((column) => revisionColumns.has(column))
    && [
      "vendor_id",
      "request_revision",
      "evidence_revision",
      "requested_fields_json",
      "applicant_message",
      "requested_by_user_id",
      "requested_at",
    ].every((column) => requestColumns.has(column))
    && VENDOR_EVIDENCE_V10_TRIGGER_NAMES.every((name) => triggers.has(name))
    && approvalGuard.includes("NEW.evidence_latest_revision != NEW.evidence_reviewed_revision")
    && approvalGuard.includes("NEW.information_requested = 1")
    && revisionGuard.includes("vendor.evidence_latest_revision + 1 = NEW.evidence_revision")
    && latestRevisionGuard.includes("vendor evidence latest revision must reference append-only history")
    && !triggers.has(legacyTriggerName);
  if (!ready) throw new Error("vendor evidence schema v10 is incomplete");
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
        runStorageTransaction(ctx.storage, () => {
          this.sql.exec(STORE_SCHEMA_SQL).toArray();
          assertVendorEvidenceV10SchemaReady(this.sql);
        });
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
      if (version > 0 && version < 7) {
        this.sql.exec(STORE_SCHEMA_V7_MIGRATION_SQL).toArray();
      }
      if (version > 0 && version < 8) {
        const vendorColumns = this.sql.exec("PRAGMA table_info(vendors)").toArray();
        if (!vendorColumns.some((column) => column.name === "review_revision")) {
          this.sql
            .exec(
              `ALTER TABLE vendors ADD COLUMN review_revision INTEGER NOT NULL DEFAULT 0
                 CHECK (typeof(review_revision) = 'integer' AND review_revision >= 0)`,
            )
            .toArray();
        }
        this.sql.exec(STORE_SCHEMA_V8_FINALIZE_SQL).toArray();
      }
      if (version > 0 && version < 9) {
        runStorageTransaction(ctx.storage, () => {
          const vendorColumns = this.sql.exec("PRAGMA table_info(vendors)").toArray();
          if (!vendorColumns.some((column) => column.name === "evidence_required")) {
            this.sql
              .exec(
                `ALTER TABLE vendors ADD COLUMN evidence_required INTEGER NOT NULL DEFAULT 1
                   CHECK (evidence_required IN (0, 1))`,
              )
              .toArray();
          }
          this.sql.exec("UPDATE vendors SET evidence_required = 0 WHERE evidence_required = 1").toArray();
          if (!vendorColumns.some((column) => column.name === "evidence_reviewed_revision")) {
            this.sql
              .exec(
                `ALTER TABLE vendors ADD COLUMN evidence_reviewed_revision INTEGER NOT NULL DEFAULT 0
                   CHECK (typeof(evidence_reviewed_revision) = 'integer' AND evidence_reviewed_revision >= 0)`,
              )
              .toArray();
          }
          this.sql.exec(STORE_SCHEMA_V9_FINALIZE_SQL).toArray();
          assertVendorEvidenceSchemaReady(this.sql);
        });
      }
      if (version === 9) {
        runStorageTransaction(ctx.storage, () => {
          const vendorColumns = this.sql.exec("PRAGMA table_info(vendors)").toArray();
          if (!vendorColumns.some((column) => column.name === "evidence_required")) {
            this.sql
              .exec(
                `ALTER TABLE vendors ADD COLUMN evidence_required INTEGER NOT NULL DEFAULT 1
                   CHECK (evidence_required IN (0, 1))`,
              )
              .toArray();
          }
          if (!vendorColumns.some((column) => column.name === "evidence_reviewed_revision")) {
            this.sql
              .exec(
                `ALTER TABLE vendors ADD COLUMN evidence_reviewed_revision INTEGER NOT NULL DEFAULT 0
                   CHECK (typeof(evidence_reviewed_revision) = 'integer' AND evidence_reviewed_revision >= 0)`,
              )
              .toArray();
          }
          this.sql.exec(STORE_SCHEMA_V9_FINALIZE_SQL).toArray();
          assertVendorEvidenceSchemaReady(this.sql);
        });
      }
      if (version > 0 && version < 10) {
        runStorageTransaction(ctx.storage, () => {
          const vendorColumns = new Set(
            this.sql.exec("PRAGMA table_info(vendors)").toArray().map((column) => column.name),
          );
          if (!vendorColumns.has("evidence_latest_revision")) {
            this.sql
              .exec(
                `ALTER TABLE vendors ADD COLUMN evidence_latest_revision INTEGER NOT NULL DEFAULT 0
                   CHECK (typeof(evidence_latest_revision) = 'integer' AND evidence_latest_revision BETWEEN 0 AND 20)`,
              )
              .toArray();
          }
          if (!vendorColumns.has("information_request_revision")) {
            this.sql
              .exec(
                `ALTER TABLE vendors ADD COLUMN information_request_revision INTEGER NOT NULL DEFAULT 0
                   CHECK (typeof(information_request_revision) = 'integer' AND information_request_revision >= 0)`,
              )
              .toArray();
          }
          if (!vendorColumns.has("information_requested")) {
            this.sql
              .exec(
                `ALTER TABLE vendors ADD COLUMN information_requested INTEGER NOT NULL DEFAULT 0
                   CHECK (information_requested IN (0, 1))`,
              )
              .toArray();
          }
          this.sql.exec(STORE_SCHEMA_V10_FINALIZE_SQL).toArray();
          assertVendorEvidenceV10SchemaReady(this.sql);
        });
      }
      if (version === 10) {
        runStorageTransaction(ctx.storage, () => {
          const vendorColumns = new Set(
            this.sql.exec("PRAGMA table_info(vendors)").toArray().map((column) => column.name),
          );
          if (!vendorColumns.has("evidence_latest_revision")) {
            this.sql
              .exec(
                `ALTER TABLE vendors ADD COLUMN evidence_latest_revision INTEGER NOT NULL DEFAULT 0
                   CHECK (typeof(evidence_latest_revision) = 'integer' AND evidence_latest_revision BETWEEN 0 AND 20)`,
              )
              .toArray();
          }
          if (!vendorColumns.has("information_request_revision")) {
            this.sql
              .exec(
                `ALTER TABLE vendors ADD COLUMN information_request_revision INTEGER NOT NULL DEFAULT 0
                   CHECK (typeof(information_request_revision) = 'integer' AND information_request_revision >= 0)`,
              )
              .toArray();
          }
          if (!vendorColumns.has("information_requested")) {
            this.sql
              .exec(
                `ALTER TABLE vendors ADD COLUMN information_requested INTEGER NOT NULL DEFAULT 0
                   CHECK (information_requested IN (0, 1))`,
              )
              .toArray();
          }
          this.sql.exec(STORE_SCHEMA_V10_FINALIZE_SQL).toArray();
          assertVendorEvidenceV10SchemaReady(this.sql);
        });
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
      const message = String(error?.message || error);
      const code = /unique constraint failed|SQLITE_CONSTRAINT_(?:UNIQUE|PRIMARYKEY)/i.test(message)
        ? "unique_constraint"
        : /vendor application evidence requires a pending or rejected vendor/i.test(message)
          ? "vendor_evidence_state_conflict"
          : /vendor evidence revision requires the active owner and an information request/i.test(message)
            ? "vendor_evidence_revision_conflict"
            : /vendor information requests contain invalid or sensitive content/i.test(message)
              ? "vendor_information_request_conflict"
              : /vendor information request must be resolved before a status decision|vendor information request state is invalid/i.test(message)
                ? "vendor_information_state_conflict"
          : /vendor evidence must be completed and acknowledged before approval/i.test(message)
            ? "vendor_evidence_approval_conflict"
            : /vendor review reasons must not contain evidence addresses or identity references/i.test(message)
              ? "vendor_review_sensitive_content"
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
  STORE_SCHEMA_V7_MIGRATION_SQL,
  STORE_SCHEMA_V8_FINALIZE_SQL,
  STORE_SCHEMA_V8_MIGRATION_SQL,
  STORE_SCHEMA_V9_FINALIZE_SQL,
  STORE_SCHEMA_V9_MIGRATION_SQL,
  STORE_SCHEMA_V10_FINALIZE_SQL,
  STORE_SCHEMA_V10_MIGRATION_SQL,
  STORE_SCHEMA_VERSION,
  executeSql,
};
