import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  MAINTENANCE_INTERVAL_MS,
  MelaivaStore,
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
  createDurableDatabase,
  executeSql,
} from "../src/store.js";

test("Durable Object adapter reports logical changes rather than indexed billing rows", () => {
  const calls = [];
  const storage = {
    exec(sql) {
      calls.push(sql);
      if (sql === "SELECT changes() AS changes") {
        return { rowsRead: 1, rowsWritten: 0, toArray: () => [{ changes: 1 }] };
      }
      return { rowsRead: 0, rowsWritten: 5, toArray: () => [] };
    },
  };

  const result = executeSql(storage, {
    mode: "run",
    sql: "UPDATE bids SET status = 'accepted' WHERE id = ?",
    args: ["bid-1"],
  });

  assert.equal(result.meta.changes, 1);
  assert.equal(result.meta.rowsWritten, 5);
  assert.deepEqual(calls, ["UPDATE bids SET status = 'accepted' WHERE id = ?", "SELECT changes() AS changes"]);
});

test("Durable Object storage errors preserve only safe conflict classifications", async () => {
  const store = Object.create(MelaivaStore.prototype);
  const classifications = [
    ["UNIQUE constraint failed: users.email", "unique_constraint"],
    ["vendor application evidence requires a pending or rejected vendor", "vendor_evidence_state_conflict"],
    ["vendor application evidence requires the active owner", "vendor_evidence_revision_conflict"],
    [
      "legacy vendor evidence cannot resolve an active information request",
      "vendor_evidence_revision_conflict",
    ],
    ["vendor evidence must be completed and acknowledged before approval", "vendor_evidence_approval_conflict"],
    [
      "vendor review reasons must not contain evidence addresses or identity references",
      "vendor_review_sensitive_content",
    ],
  ];
  let body;
  for (const [message, code] of classifications) {
    store.sql = { exec() { throw new Error(message); } };
    const response = await store.fetch(new Request("https://melaiva-store.internal/sql", {
      method: "POST",
      body: JSON.stringify({ operation: "statement", statement: { mode: "run", sql: "INSERT", args: [] } }),
    }));
    body = await response.json();
    assert.equal(response.status, 409);
    assert.deepEqual(body, { error: "storage_error", code });
    assert.doesNotMatch(JSON.stringify(body), /users\.email|UNIQUE constraint|pending or rejected|acknowledged|identity references/i);
  }

  const database = createDurableDatabase({
    getByName() {
      return {
        async fetch() {
          return new Response(JSON.stringify({ error: "storage_error", code: "unique_constraint" }), {
            status: 409,
            headers: { "content-type": "application/json" },
          });
        },
      };
    },
  });
  await assert.rejects(
    database.prepare("INSERT").run(),
    (error) => error.code === "unique_constraint" && error.message === "storage_error",
  );
});

test("Durable Object alarm performs bounded maintenance and schedules its next run", async () => {
  const statements = [];
  let scheduledAt = null;
  const store = Object.create(MelaivaStore.prototype);
  store.sql = {
    exec(sql, ...args) {
      statements.push({ sql, args });
      return { toArray: () => [] };
    },
  };
  store.ctx = {
    storage: {
      transactionSync(callback) {
        callback();
      },
      async setAlarm(timestamp) {
        scheduledAt = timestamp;
      },
    },
  };

  const before = Date.now();
  await store.alarm();

  assert.deepEqual(
    statements.map(({ sql }) => sql.split(" ").slice(0, 3).join(" ")),
    ["DELETE FROM sessions", "DELETE FROM rate_limits", "DELETE FROM idempotency_keys", "UPDATE auctions SET"],
  );
  assert.ok(scheduledAt >= before + MAINTENANCE_INTERVAL_MS);
  assert.ok(scheduledAt <= Date.now() + MAINTENANCE_INTERVAL_MS);
});

test("schema v2 migrates a populated v1 store without losing idempotency records", () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE _sql_schema_migrations (
    id INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  sqlite.exec(STORE_SCHEMA_V1_SQL);
  sqlite
    .prepare(
      `INSERT INTO users
       (id, name, email, password_hash, password_salt, password_iterations, role, status)
       VALUES ('user-1', 'Test User', 'test@example.com', 'hash', 'salt', 100000, 'couple', 'active')`,
    )
    .run();
  sqlite
    .prepare(
      `INSERT INTO idempotency_keys
       (scope, key_hash, user_id, response_status, response_json, expires_at)
       VALUES ('auction-create', 'key-1', 'user-1', 201, '{}', '2099-01-01T00:00:00.000Z')`,
    )
    .run();

  sqlite.exec(STORE_SCHEMA_V2_MIGRATION_SQL);

  assert.equal(sqlite.prepare("SELECT MAX(id) AS version FROM _sql_schema_migrations").get().version, 2);
  assert.ok(sqlite.prepare("PRAGMA table_info(idempotency_keys)").all().some((column) => column.name === "request_hash"));
  assert.equal(sqlite.prepare("SELECT request_hash FROM idempotency_keys WHERE key_hash = 'key-1'").get().request_hash, null);
  assert.ok(sqlite.prepare("PRAGMA table_info(auction_vendor_invites)").all().some((column) => column.name === "vendor_id"));
  assert.deepEqual(
    sqlite
      .prepare("PRAGMA index_list(auction_vendor_invites)")
      .all()
      .map((index) => index.name)
      .filter((name) => name.startsWith("idx_auction_vendor_invites_"))
      .sort(),
    ["idx_auction_vendor_invites_inviter", "idx_auction_vendor_invites_vendor"],
  );
});

test("schema v3 preserves legacy bids and supplies explicit normalized-offer defaults", () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE _sql_schema_migrations (
    id INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  sqlite.exec(STORE_SCHEMA_V1_SQL);
  sqlite.exec(STORE_SCHEMA_V2_MIGRATION_SQL);
  sqlite.exec(`
    INSERT INTO users
      (id, name, email, password_hash, password_salt, password_iterations, role, status)
    VALUES
      ('couple-1', 'Couple User', 'couple@example.com', 'hash', 'salt', 100000, 'couple', 'active'),
      ('vendor-user-1', 'Vendor User', 'vendor@example.com', 'hash', 'salt', 100000, 'vendor', 'active');
    INSERT INTO vendors
      (id, user_id, slug, business_name, status, category, categories_json, city, service_areas_json,
       description, min_budget, max_budget, currency)
    VALUES
      ('vendor-1', 'vendor-user-1', 'legacy-vendor', 'Legacy Vendor', 'approved', 'photography',
       '["photography"]', 'Jaipur', '["Jaipur"]', 'A legacy vendor record retained for migration coverage.',
       100000, 500000, 'INR');
    INSERT INTO auctions
      (id, couple_user_id, title, event_type, event_date, city, guest_count, budget_min, budget_max,
       currency, categories_json, requirements, status, bidding_ends_at)
    VALUES
      ('auction-1', 'couple-1', 'Legacy wedding request', 'wedding', '2027-12-01', 'Jaipur', 200,
       100000, 500000, 'INR', '["photography"]', 'Legacy requirements retained through migration.',
       'closed', '2027-10-01T00:00:00.000Z');
    INSERT INTO bids
      (id, auction_id, vendor_id, amount, currency, proposal, deliverables_json, valid_until, status)
    VALUES
      ('bid-1', 'auction-1', 'vendor-1', 250000, 'INR',
       'Legacy proposal content must survive the normalized terms migration unchanged.',
       '["Photography team","Edited gallery"]', NULL, 'submitted');
  `);

  sqlite.exec(STORE_SCHEMA_V3_MIGRATION_SQL);

  assert.equal(sqlite.prepare("SELECT MAX(id) AS version FROM _sql_schema_migrations").get().version, 3);
  const columns = new Set(sqlite.prepare("PRAGMA table_info(bids)").all().map((column) => column.name));
  for (const name of [
    "exclusions_json",
    "gst_included",
    "gst_rate",
    "travel_policy",
    "travel_fee",
    "add_ons_json",
    "cancellation_terms",
    "delivery_plan",
    "structured_terms_provided",
  ]) {
    assert.ok(columns.has(name), `missing migrated bids.${name}`);
  }
  const legacy = sqlite.prepare("SELECT * FROM bids WHERE id = 'bid-1'").get();
  assert.equal(legacy.proposal, "Legacy proposal content must survive the normalized terms migration unchanged.");
  assert.equal(legacy.deliverables_json, '["Photography team","Edited gallery"]');
  assert.equal(legacy.exclusions_json, "[]");
  assert.equal(legacy.gst_included, 0);
  assert.equal(legacy.gst_rate, 0);
  assert.equal(legacy.travel_policy, "not_applicable");
  assert.equal(legacy.travel_fee, 0);
  assert.equal(legacy.add_ons_json, "[]");
  assert.equal(legacy.cancellation_terms, "");
  assert.equal(legacy.delivery_plan, "");
  assert.equal(legacy.structured_terms_provided, 0);

  assert.throws(
    () => sqlite.prepare("UPDATE bids SET gst_rate = 28.5 WHERE id = 'bid-1'").run(),
    /CHECK constraint failed/,
  );
  assert.throws(
    () => sqlite.prepare("UPDATE bids SET gst_rate = 29 WHERE id = 'bid-1'").run(),
    /CHECK constraint failed/,
  );
  assert.throws(
    () => sqlite.prepare("UPDATE bids SET travel_policy = 'fixed_fee' WHERE id = 'bid-1'").run(),
    /CHECK constraint failed/,
  );
  assert.throws(
    () => sqlite.prepare("UPDATE bids SET exclusions_json = '{}' WHERE id = 'bid-1'").run(),
    /CHECK constraint failed/,
  );
  assert.throws(
    () => sqlite.prepare("UPDATE bids SET add_ons_json = '{\"not\":\"an array\"}' WHERE id = 'bid-1'").run(),
    /CHECK constraint failed/,
  );
  assert.throws(
    () => sqlite.prepare("UPDATE bids SET travel_policy = 'fixed_fee', travel_fee = 1.5 WHERE id = 'bid-1'").run(),
    /CHECK constraint failed/,
  );
  assert.throws(
    () => sqlite.prepare("UPDATE bids SET travel_policy = 'fixed_fee', travel_fee = 1000000001 WHERE id = 'bid-1'").run(),
    /CHECK constraint failed/,
  );
  assert.throws(
    () => sqlite.prepare("UPDATE bids SET structured_terms_provided = 1 WHERE id = 'bid-1'").run(),
    /CHECK constraint failed/,
  );
  sqlite.prepare("UPDATE bids SET travel_policy = 'fixed_fee', travel_fee = 15000 WHERE id = 'bid-1'").run();
  const updatedTravel = sqlite.prepare("SELECT travel_policy, travel_fee FROM bids WHERE id = 'bid-1'").get();
  assert.equal(updatedTravel.travel_policy, "fixed_fee");
  assert.equal(updatedTravel.travel_fee, 15000);
});

test("schema v4 backfills exact accepted scope and makes booking records immutable", () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE _sql_schema_migrations (
    id INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  sqlite.exec(STORE_SCHEMA_V1_SQL);
  sqlite.exec(STORE_SCHEMA_V2_MIGRATION_SQL);
  sqlite.exec(STORE_SCHEMA_V3_MIGRATION_SQL);
  sqlite.exec(`
    INSERT INTO users
      (id, name, email, password_hash, password_salt, password_iterations, role, status)
    VALUES
      ('couple-award', 'Award Couple', 'award-couple@example.com', 'hash', 'salt', 100000, 'couple', 'active'),
      ('vendor-award-user', 'Award Vendor', 'award-vendor@example.com', 'hash', 'salt', 100000, 'vendor', 'active');
    INSERT INTO vendors
      (id, user_id, slug, business_name, status, category, categories_json, city, service_areas_json,
       description, min_budget, max_budget, currency, verified, rating)
    VALUES
      ('vendor-award', 'vendor-award-user', 'award-studio', 'Award Studio', 'approved', 'photography',
       '["photography"]', 'Jaipur', '["Jaipur"]',
       'A complete approved vendor record used to verify immutable accepted-scope backfills.',
       100000, 500000, 'INR', 1, 4.75);
    INSERT INTO auctions
      (id, couple_user_id, title, event_type, event_date, city, guest_count, budget_min, budget_max,
       currency, categories_json, requirements, status, bidding_ends_at, created_at, updated_at)
    VALUES
      ('auction-award', 'couple-award', 'Awarded Jaipur photography', 'wedding', '2028-02-10', 'Jaipur', 180,
       200000, 400000, 'INR', '["photography"]', 'Retain this exact private accepted request scope.',
       'awarded', '2027-12-01T12:00:00.000Z', '2027-09-01T00:00:00.000Z', '2027-10-02T03:04:05.000Z');
    INSERT INTO bids
      (id, auction_id, vendor_id, amount, currency, proposal, deliverables_json, exclusions_json,
       gst_included, gst_rate, travel_policy, travel_fee, add_ons_json, cancellation_terms,
       delivery_plan, structured_terms_provided, valid_until, status, created_at, updated_at)
    VALUES
      ('bid-award', 'auction-award', 'vendor-award', 325000, 'INR',
       'This exact accepted proposal must be copied without changing its commercial meaning.',
       '["Two photographers","Edited gallery"]', '["Raw footage"]', 0, 18, 'fixed_fee', 15000,
       '[{"name":"Album","amount":30000}]',
       'Cancellation follows the signed milestone schedule after a non-refundable booking fee.',
       'Previews arrive in seven days and the completed gallery arrives within twelve weeks.',
       1, '2027-12-31', 'accepted', '2027-09-02T00:00:00.000Z', '2027-10-02T03:04:05.000Z');
    INSERT INTO audit_events (actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
    VALUES ('couple-award', 'bid.accepted', 'bid', 'bid-award', '{"auctionId":"auction-award"}', '2027-10-02T03:04:05.000Z');
    INSERT INTO auctions
      (id, couple_user_id, title, event_type, event_date, city, guest_count, budget_min, budget_max,
       currency, categories_json, requirements, status, bidding_ends_at)
    VALUES
      ('auction-legacy-award', 'couple-award', 'Legacy accepted photography', 'wedding', '2028-03-10',
       'Jaipur', 90, 100000, 250000, 'INR', '["photography"]',
       'Legacy accepted scope must stay explicitly incomplete after booking backfill.',
       'awarded', '2028-01-01T00:00:00.000Z');
    INSERT INTO bids
      (id, auction_id, vendor_id, amount, currency, proposal, deliverables_json, status)
    VALUES
      ('bid-legacy-award', 'auction-legacy-award', 'vendor-award', 175000, 'INR',
       'A legacy accepted proposal that predates normalized commercial disclosures.',
       '["Photography coverage","Edited gallery"]', 'accepted');
  `);

  sqlite.exec(STORE_SCHEMA_V4_MIGRATION_SQL);
  sqlite.exec(STORE_SCHEMA_V4_MIGRATION_SQL);

  assert.equal(sqlite.prepare("SELECT MAX(id) AS version FROM _sql_schema_migrations").get().version, 4);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM bookings").get().count, 2);
  const booking = sqlite.prepare("SELECT * FROM bookings WHERE accepted_bid_id = 'bid-award'").get();
  assert.equal(booking.id, "booking-bid-award");
  assert.equal(booking.status, "contract_pending");
  assert.equal(booking.awarded_at, "2027-10-02T03:04:05.000Z");
  const snapshot = JSON.parse(booking.accepted_scope_json);
  assert.deepEqual(snapshot.request.categories, ["photography"]);
  assert.equal(snapshot.request.requirements, "Retain this exact private accepted request scope.");
  assert.equal(snapshot.offer.amount, 325000);
  assert.deepEqual(snapshot.offer.deliverables, ["Two photographers", "Edited gallery"]);
  assert.deepEqual(snapshot.offer.exclusions, ["Raw footage"]);
  assert.equal(snapshot.offer.gstIncluded, false);
  assert.equal(snapshot.offer.structuredTermsProvided, true);
  assert.deepEqual(snapshot.offer.addOns, [{ name: "Album", amount: 30000 }]);
  assert.deepEqual(snapshot.vendor, {
    id: "vendor-award",
    slug: "award-studio",
    businessName: "Award Studio",
    verified: true,
    rating: 4.75,
  });
  const legacySnapshot = JSON.parse(
    sqlite.prepare("SELECT accepted_scope_json FROM bookings WHERE accepted_bid_id = 'bid-legacy-award'").get().accepted_scope_json,
  );
  assert.equal(legacySnapshot.offer.structuredTermsProvided, false);
  assert.deepEqual(legacySnapshot.offer.deliverables, ["Photography coverage", "Edited gallery"]);
  assert.deepEqual(legacySnapshot.offer.exclusions, []);
  assert.deepEqual(legacySnapshot.offer.addOns, []);
  assert.equal(legacySnapshot.offer.cancellationTerms, "");
  assert.equal(legacySnapshot.offer.deliveryPlan, "");
  assert.throws(
    () => sqlite.prepare("UPDATE bookings SET status = 'contract_pending' WHERE id = 'booking-bid-award'").run(),
    /booking records are immutable/,
  );
  assert.throws(
    () => sqlite.prepare("DELETE FROM bookings WHERE id = 'booking-bid-award'").run(),
    /booking records are immutable/,
  );
});

function createV3AwardDatabase() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE _sql_schema_migrations (
    id INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  sqlite.exec(STORE_SCHEMA_V1_SQL);
  sqlite.exec(STORE_SCHEMA_V2_MIGRATION_SQL);
  sqlite.exec(STORE_SCHEMA_V3_MIGRATION_SQL);
  sqlite.exec(`
    INSERT INTO users
      (id, name, email, password_hash, password_salt, password_iterations, role, status)
    VALUES
      ('migration-couple', 'Migration Couple', 'migration-couple@example.com', 'hash', 'salt', 100000, 'couple', 'active'),
      ('migration-vendor-user', 'Migration Vendor', 'migration-vendor@example.com', 'hash', 'salt', 100000, 'vendor', 'active');
    INSERT INTO vendors
      (id, user_id, slug, business_name, status, category, categories_json, city, service_areas_json,
       description, min_budget, max_budget, currency, verified, rating)
    VALUES
      ('migration-vendor', 'migration-vendor-user', 'migration-studio', 'Migration Studio', 'approved',
       'photography', '["photography"]', 'Jaipur', '["Jaipur"]',
       'A legacy vendor used to exercise restart-safe award migrations.', 100000, 500000, 'INR', 1, 4.5);
  `);
  return sqlite;
}

function seedAcceptedAward(
  sqlite,
  suffix,
  {
    requirements = "A legacy accepted request with a complete scope for migration testing.",
    bidCreatedAt = "2027-09-01T01:02:03.000Z",
    bidUpdatedAt = "2027-10-01T04:05:06.000Z",
    auditCreatedAt,
  } = {},
) {
  const auctionId = `migration-auction-${suffix}`;
  const bidId = `migration-bid-${suffix}`;
  sqlite
    .prepare(
      `INSERT INTO auctions
       (id, couple_user_id, title, event_type, event_date, city, guest_count, budget_min, budget_max,
        currency, categories_json, requirements, status, bidding_ends_at, created_at, updated_at)
       VALUES (?, 'migration-couple', ?, 'wedding', '2028-02-10', 'Jaipur', 120, 150000, 350000,
               'INR', '["photography"]', ?, 'awarded', '2027-12-01T12:00:00.000Z',
               '2027-08-01T00:00:00.000Z', '2027-10-01T04:05:06.000Z')`,
    )
    .run(auctionId, `Migration award ${suffix}`, requirements);
  sqlite
    .prepare(
      `INSERT INTO bids
       (id, auction_id, vendor_id, amount, currency, proposal, deliverables_json, status, created_at, updated_at)
       VALUES (?, ?, 'migration-vendor', 225000, 'INR',
               'A legacy accepted proposal retained for restart-safe migration verification.',
               '["Photography coverage","Edited gallery"]', 'accepted', ?, ?)`,
    )
    .run(bidId, auctionId, bidCreatedAt, bidUpdatedAt);
  if (auditCreatedAt !== undefined) {
    sqlite
      .prepare(
        `INSERT INTO audit_events
         (actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
         VALUES ('migration-couple', 'bid.accepted', 'bid', ?, ?, ?)`,
      )
      .run(bidId, JSON.stringify({ auctionId }), auditCreatedAt);
  }
  return { auctionId, bidId };
}

test("schema v4 fails closed instead of marking an oversized accepted scope migrated", () => {
  const sqlite = createV3AwardDatabase();
  seedAcceptedAward(sqlite, "oversized", { requirements: "x".repeat(100_001) });

  assert.throws(() => sqlite.exec(STORE_SCHEMA_V4_MIGRATION_SQL), /CHECK constraint failed/);
  assert.equal(sqlite.prepare("SELECT MAX(id) AS version FROM _sql_schema_migrations").get().version, 3);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM bookings").get().count, 0);
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'bookings_immutable_%'").get().count,
    0,
  );
});

test("schema v4 resumes a partial backfill and falls through malformed timestamps", () => {
  const sqlite = createV3AwardDatabase();
  const existing = seedAcceptedAward(sqlite, "existing", { auditCreatedAt: "2027-10-01T04:05:06.000Z" });
  const triggerStart = STORE_SCHEMA_V4_MIGRATION_SQL.indexOf("CREATE TRIGGER IF NOT EXISTS bookings_immutable_update");
  assert.ok(triggerStart > 0);
  sqlite.exec(STORE_SCHEMA_V4_MIGRATION_SQL.slice(0, triggerStart));
  assert.equal(sqlite.prepare("SELECT MAX(id) AS version FROM _sql_schema_migrations").get().version, 3);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM bookings").get().count, 1);

  const fallbackCreatedAt = "2027-11-02T03:04:05.000Z";
  const remaining = seedAcceptedAward(sqlite, "remaining", {
    bidCreatedAt: fallbackCreatedAt,
    bidUpdatedAt: "not-a-timestamp",
    auditCreatedAt: "also-not-a-timestamp",
  });
  sqlite.exec(STORE_SCHEMA_V4_MIGRATION_SQL);
  sqlite.exec(STORE_SCHEMA_V4_MIGRATION_SQL);

  assert.equal(sqlite.prepare("SELECT MAX(id) AS version FROM _sql_schema_migrations").get().version, 4);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM bookings").get().count, 2);
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) AS count FROM bookings WHERE accepted_bid_id = ?").get(existing.bidId).count,
    1,
  );
  const fallbackBooking = sqlite
    .prepare("SELECT awarded_at, accepted_scope_json FROM bookings WHERE accepted_bid_id = ?")
    .get(remaining.bidId);
  assert.equal(fallbackBooking.awarded_at, fallbackCreatedAt);
  assert.equal(JSON.parse(fallbackBooking.accepted_scope_json).offer.updatedAt, fallbackCreatedAt);
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'bookings_immutable_%'").get().count,
    2,
  );
});

test("schema v5 adds restart-safe booking messages without mutating existing awards", () => {
  const sqlite = createV3AwardDatabase();
  const seeded = seedAcceptedAward(sqlite, "messages", { auditCreatedAt: "2027-10-01T04:05:06.000Z" });
  sqlite.exec(STORE_SCHEMA_V4_MIGRATION_SQL);
  const bookingBefore = sqlite
    .prepare("SELECT * FROM bookings WHERE accepted_bid_id = ?")
    .get(seeded.bidId);

  sqlite.exec(STORE_SCHEMA_V5_MIGRATION_SQL);
  sqlite.exec(STORE_SCHEMA_V5_MIGRATION_SQL);

  assert.equal(sqlite.prepare("SELECT MAX(id) AS version FROM _sql_schema_migrations").get().version, 5);
  assert.deepEqual(
    sqlite.prepare("SELECT * FROM bookings WHERE accepted_bid_id = ?").get(seeded.bidId),
    bookingBefore,
  );
  assert.deepEqual(
    sqlite.prepare("PRAGMA table_info(booking_messages)").all().map((column) => column.name),
    ["id", "booking_id", "sender_user_id", "body", "created_at"],
  );
  assert.deepEqual(
    sqlite
      .prepare("PRAGMA index_list(booking_messages)")
      .all()
      .map((index) => index.name)
      .filter((name) => name.startsWith("idx_booking_messages_"))
      .sort(),
    ["idx_booking_messages_sender", "idx_booking_messages_thread"],
  );
  assert.equal(
    sqlite
      .prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'trigger' AND name = 'booking_messages_participant_insert'")
      .get().count,
    1,
  );

  sqlite.exec("PRAGMA foreign_keys = ON");
  sqlite
    .prepare(
      `INSERT INTO booking_messages (id, booking_id, sender_user_id, body, created_at)
       VALUES ('message-valid', ?, 'migration-couple', 'Please confirm the first coordination call.',
               '2027-10-02T03:04:05.000Z')`,
    )
    .run(bookingBefore.id);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM booking_messages").get().count, 1);
  assert.throws(
    () => sqlite
      .prepare("INSERT INTO booking_messages (id, booking_id, sender_user_id, body) VALUES ('message-blank', ?, 'migration-couple', '  ')")
      .run(bookingBefore.id),
    /CHECK constraint failed/,
  );
  assert.throws(
    () => sqlite
      .prepare("INSERT INTO booking_messages (id, booking_id, sender_user_id, body) VALUES ('message-long', ?, 'migration-couple', ?)")
      .run(bookingBefore.id, "x".repeat(2_001)),
    /CHECK constraint failed/,
  );
  assert.throws(
    () => sqlite
      .prepare("INSERT INTO booking_messages (id, booking_id, sender_user_id, body) VALUES ('message-orphan', 'missing-booking', 'migration-couple', 'No orphan thread')")
      .run(),
    /booking message sender must be a participant/,
  );
});

test("schema v6 backfills stable per-booking message positions and enforces stream identity", () => {
  const sqlite = createV3AwardDatabase();
  const seeded = seedAcceptedAward(sqlite, "message-stream", { auditCreatedAt: "2027-10-01T04:05:06.000Z" });
  sqlite.exec(STORE_SCHEMA_V4_MIGRATION_SQL);
  sqlite.exec(STORE_SCHEMA_V5_MIGRATION_SQL);
  const booking = sqlite.prepare("SELECT id FROM bookings WHERE accepted_bid_id = ?").get(seeded.bidId);

  const insert = sqlite.prepare(
    `INSERT INTO booking_messages (id, booking_id, sender_user_id, body, created_at)
     VALUES (?, ?, 'migration-couple', ?, ?)`,
  );
  insert.run("stream-z", booking.id, "A tied message whose identifier sorts last.", "2027-10-03T10:00:00.000Z");
  insert.run("stream-a", booking.id, "A tied message whose identifier sorts first.", "2027-10-03T10:00:00.000Z");
  insert.run("stream-backdated", booking.id, "A message with an earlier retained timestamp.", "2027-09-01T10:00:00.000Z");
  const before = sqlite
    .prepare("SELECT id, booking_id, sender_user_id, body, created_at FROM booking_messages ORDER BY id")
    .all();

  sqlite.exec(STORE_SCHEMA_V6_MIGRATION_SQL);
  sqlite.exec(STORE_SCHEMA_V6_FINALIZE_SQL);

  assert.equal(sqlite.prepare("SELECT MAX(id) AS version FROM _sql_schema_migrations").get().version, 6);
  assert.deepEqual(
    sqlite.prepare("SELECT id, booking_id, sender_user_id, body, created_at FROM booking_messages ORDER BY id").all(),
    before,
  );
  assert.deepEqual(
    sqlite
      .prepare("SELECT id, stream_position FROM booking_messages WHERE booking_id = ? ORDER BY stream_position")
      .all(booking.id)
      .map((row) => ({ ...row })),
    [
      { id: "stream-z", stream_position: 1 },
      { id: "stream-a", stream_position: 2 },
      { id: "stream-backdated", stream_position: 3 },
    ],
  );
  assert.ok(
    sqlite
      .prepare("PRAGMA index_list(booking_messages)")
      .all()
      .some((index) => index.name === "idx_booking_messages_stream" && index.unique === 1),
  );
  sqlite
    .prepare(
      `INSERT INTO booking_messages (id, booking_id, sender_user_id, body, created_at)
       SELECT ?, booking.id, ?, ?, ?
       FROM bookings booking
       JOIN vendors vendor ON vendor.id = booking.vendor_id
       WHERE booking.id = ?
         AND vendor.status = 'approved'
         AND (booking.couple_user_id = ? OR vendor.user_id = ?)`,
    )
    .run(
      "stream-legacy",
      "migration-couple",
      "A rolling-deploy legacy insert receives its stream position.",
      "2027-10-04T10:00:00.000Z",
      booking.id,
      "migration-couple",
      "migration-couple",
    );
  assert.equal(
    sqlite.prepare("SELECT stream_position FROM booking_messages WHERE id = 'stream-legacy'").get().stream_position,
    4,
  );
  assert.deepEqual(
    {
      ...sqlite
        .prepare(
          `SELECT COUNT(*) AS row_count, COALESCE(MAX(stream_position), 0) AS position_count
           FROM booking_messages WHERE booking_id = ?`,
        )
        .get(booking.id),
    },
    { row_count: 4, position_count: 4 },
  );
  assert.match(
    sqlite
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT stream_position FROM booking_messages
         WHERE booking_id = ? ORDER BY stream_position DESC LIMIT 1`,
      )
      .all(booking.id)
      .map((row) => row.detail)
      .join("\n"),
    /idx_booking_messages_stream/,
  );
  assert.throws(
    () => sqlite
      .prepare(
        `INSERT INTO booking_messages
         (id, booking_id, sender_user_id, body, created_at, stream_position)
         VALUES ('stream-gap', ?, 'migration-couple', 'A non-contiguous position must fail.',
                 '2027-10-04T10:00:00.000Z', 6)`,
      )
      .run(booking.id),
    /booking message stream position must be the next position/,
  );
  assert.throws(
    () => sqlite
      .prepare(
        `INSERT INTO booking_messages
         (id, booking_id, sender_user_id, body, created_at, stream_position)
         VALUES ('stream-invalid', ?, 'migration-couple', 'An explicit invalid position must fail.',
                 '2027-10-04T10:00:00.000Z', 0)`,
      )
      .run(booking.id),
    /booking message stream position must be a positive integer/,
  );
  sqlite
    .prepare(
      `INSERT INTO booking_messages
       (id, booking_id, sender_user_id, body, created_at, stream_position)
       VALUES ('stream-next', ?, 'migration-couple', 'A valid next position is accepted.',
               '2027-10-04T10:00:00.000Z', 5)`,
    )
    .run(booking.id);
  assert.throws(
    () => sqlite.prepare("UPDATE booking_messages SET stream_position = 6 WHERE id = 'stream-next'").run(),
    /booking message stream position is immutable/,
  );
  assert.throws(
    () => sqlite.prepare("DELETE FROM booking_messages WHERE id = 'stream-next'").run(),
    /booking message stream records are immutable/,
  );
});

test("schema v7 baselines participant-local cursors at the exact thread head and remains safe for old writers", () => {
  const sqlite = createV3AwardDatabase();
  const populated = seedAcceptedAward(sqlite, "read-state", { auditCreatedAt: "2027-10-01T04:05:06.000Z" });
  const empty = seedAcceptedAward(sqlite, "read-state-empty", { auditCreatedAt: "2027-10-02T04:05:06.000Z" });
  sqlite.exec(STORE_SCHEMA_V4_MIGRATION_SQL);
  sqlite.exec(STORE_SCHEMA_V5_MIGRATION_SQL);
  sqlite.exec(STORE_SCHEMA_V6_MIGRATION_SQL);
  const populatedBooking = sqlite.prepare("SELECT id FROM bookings WHERE accepted_bid_id = ?").get(populated.bidId);
  const emptyBooking = sqlite.prepare("SELECT id FROM bookings WHERE accepted_bid_id = ?").get(empty.bidId);
  const legacyInsert = sqlite.prepare(
    `INSERT INTO booking_messages (id, booking_id, sender_user_id, body, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  legacyInsert.run(
    "read-head-z",
    populatedBooking.id,
    "migration-couple",
    "The first retained message has a tied display timestamp.",
    "2027-10-03T10:00:00.000Z",
  );
  legacyInsert.run(
    "read-head-a",
    populatedBooking.id,
    "migration-vendor-user",
    "The second retained message sorts lower by identifier.",
    "2027-10-03T10:00:00.000Z",
  );
  legacyInsert.run(
    "read-head-backdated",
    populatedBooking.id,
    "migration-vendor-user",
    "The actual thread head carries an earlier display timestamp.",
    "2027-09-01T10:00:00.000Z",
  );
  const messagesBefore = sqlite
    .prepare(
      `SELECT id, booking_id, sender_user_id, body, created_at, stream_position
       FROM booking_messages ORDER BY booking_id, stream_position`,
    )
    .all();

  sqlite.exec(STORE_SCHEMA_V7_MIGRATION_SQL);
  sqlite.exec(STORE_SCHEMA_V7_MIGRATION_SQL);

  assert.equal(sqlite.prepare("SELECT MAX(id) AS version FROM _sql_schema_migrations").get().version, 7);
  assert.deepEqual(
    sqlite
      .prepare(
        `SELECT id, booking_id, sender_user_id, body, created_at, stream_position
         FROM booking_messages ORDER BY booking_id, stream_position`,
      )
      .all(),
    messagesBefore,
  );
  assert.deepEqual(
    sqlite
      .prepare(
        `SELECT booking_id, participant_user_id, last_read_message_id
         FROM booking_message_read_cursors ORDER BY booking_id, participant_user_id`,
      )
      .all()
      .map((row) => ({ ...row })),
    [
      {
        booking_id: populatedBooking.id,
        participant_user_id: "migration-couple",
        last_read_message_id: "read-head-backdated",
      },
      {
        booking_id: populatedBooking.id,
        participant_user_id: "migration-vendor-user",
        last_read_message_id: "read-head-backdated",
      },
      {
        booking_id: emptyBooking.id,
        participant_user_id: "migration-couple",
        last_read_message_id: null,
      },
      {
        booking_id: emptyBooking.id,
        participant_user_id: "migration-vendor-user",
        last_read_message_id: null,
      },
    ],
  );
  assert.equal(
    sqlite
      .prepare("SELECT stream_position FROM booking_messages WHERE id = 'read-head-backdated'")
      .get().stream_position,
    3,
  );

  sqlite
    .prepare(
      `INSERT INTO users
       (id, name, email, password_hash, password_salt, password_iterations, role, status)
       VALUES ('migration-outsider', 'Migration Outsider', 'migration-outsider@example.com',
               'hash', 'salt', 100000, 'couple', 'active')`,
    )
    .run();
  assert.throws(
    () => sqlite
      .prepare(
        `INSERT INTO booking_message_read_cursors
         (booking_id, participant_user_id, last_read_message_id)
         VALUES (?, 'migration-outsider', 'read-head-backdated')`,
      )
      .run(populatedBooking.id),
    /read cursor owner must be a participant/,
  );
  legacyInsert.run(
    "read-other-thread",
    emptyBooking.id,
    "migration-couple",
    "A message in another private booking cannot become this cursor.",
    "2027-10-04T10:00:00.000Z",
  );
  assert.throws(
    () => sqlite
      .prepare(
        `UPDATE booking_message_read_cursors SET last_read_message_id = 'read-other-thread'
         WHERE booking_id = ? AND participant_user_id = 'migration-couple'`,
      )
      .run(populatedBooking.id),
    /cannot move backward or leave its thread/,
  );
  assert.throws(
    () => sqlite
      .prepare(
        `UPDATE booking_message_read_cursors SET last_read_message_id = 'read-head-a'
         WHERE booking_id = ? AND participant_user_id = 'migration-couple'`,
      )
      .run(populatedBooking.id),
    /cannot move backward or leave its thread/,
  );
  assert.throws(
    () => sqlite
      .prepare(
        `UPDATE booking_message_read_cursors SET participant_user_id = 'migration-outsider'
         WHERE booking_id = ? AND participant_user_id = 'migration-couple'`,
      )
      .run(populatedBooking.id),
    /read cursor (?:identity is immutable|owner must be a participant)/,
  );
  assert.throws(
    () => sqlite
      .prepare(
        `DELETE FROM booking_message_read_cursors
         WHERE booking_id = ? AND participant_user_id = 'migration-couple'`,
      )
      .run(populatedBooking.id),
    /read cursors are retained/,
  );

  const oldWriterAward = seedAcceptedAward(sqlite, "read-state-old-writer");
  sqlite
    .prepare(
      `INSERT INTO bookings
       (id, auction_id, accepted_bid_id, couple_user_id, vendor_id, status,
        accepted_scope_json, awarded_at)
       SELECT 'old-writer-booking', auction.id, bid.id, auction.couple_user_id, bid.vendor_id,
              'contract_pending', '{}', '2027-10-05T00:00:00.000Z'
       FROM auctions auction
       JOIN bids bid ON bid.auction_id = auction.id
       WHERE auction.id = ? AND bid.id = ?`,
    )
    .run(oldWriterAward.auctionId, oldWriterAward.bidId);
  assert.deepEqual(
    sqlite
      .prepare(
        `SELECT participant_user_id, last_read_message_id
         FROM booking_message_read_cursors
         WHERE booking_id = 'old-writer-booking' ORDER BY participant_user_id`,
      )
      .all()
      .map((row) => ({ ...row })),
    [
      { participant_user_id: "migration-couple", last_read_message_id: null },
      { participant_user_id: "migration-vendor-user", last_read_message_id: null },
    ],
  );
  legacyInsert.run(
    "old-writer-message",
    "old-writer-booking",
    "migration-couple",
    "A rolled-back Worker can still append a positioned message.",
    "2027-10-05T10:00:00.000Z",
  );
  assert.equal(
    sqlite.prepare("SELECT stream_position FROM booking_messages WHERE id = 'old-writer-message'").get().stream_position,
    1,
  );
  assert.equal(
    sqlite
      .prepare(
        `SELECT last_read_message_id FROM booking_message_read_cursors
         WHERE booking_id = 'old-writer-booking' AND participant_user_id = 'migration-vendor-user'`,
      )
      .get().last_read_message_id,
    null,
  );
  for (let index = 0; index < 400; index += 1) {
    legacyInsert.run(
      `old-writer-volume-${String(index).padStart(3, "0")}`,
      "old-writer-booking",
      index % 2 === 0 ? "migration-couple" : "migration-vendor-user",
      "A bounded volume record verifies the unread range query stays indexed.",
      "2027-10-05T10:00:00.000Z",
    );
  }
  const unreadSql = `SELECT COUNT(*) AS unread_count
    FROM booking_messages incoming INDEXED BY idx_booking_messages_stream
    WHERE incoming.booking_id = ?
      AND incoming.sender_user_id != ?
      AND incoming.stream_position > COALESCE(
        (
          SELECT anchor.stream_position
          FROM booking_message_read_cursors cursor
          LEFT JOIN booking_messages anchor
            ON anchor.id = cursor.last_read_message_id
           AND anchor.booking_id = cursor.booking_id
          WHERE cursor.booking_id = ? AND cursor.participant_user_id = ?
        ),
        0
      )`;
  assert.equal(
    sqlite
      .prepare(unreadSql)
      .get("old-writer-booking", "migration-vendor-user", "old-writer-booking", "migration-vendor-user")
      .unread_count,
    201,
  );
  assert.match(
    sqlite
      .prepare(`EXPLAIN QUERY PLAN ${unreadSql}`)
      .all("old-writer-booking", "migration-vendor-user", "old-writer-booking", "migration-vendor-user")
      .map((row) => row.detail)
      .join("\n"),
    /idx_booking_messages_stream \(booking_id=\? AND stream_position>\?\)/,
  );
});

test("schema v8 preserves reviewed vendors, resumes safely, and makes audit facts immutable", () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE _sql_schema_migrations (
    id INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  sqlite.exec(STORE_SCHEMA_V1_SQL);
  sqlite.exec(STORE_SCHEMA_V2_MIGRATION_SQL);
  sqlite.exec(STORE_SCHEMA_V3_MIGRATION_SQL);
  sqlite.exec(STORE_SCHEMA_V4_MIGRATION_SQL);
  sqlite.exec(STORE_SCHEMA_V5_MIGRATION_SQL);
  sqlite.exec(STORE_SCHEMA_V6_MIGRATION_SQL);
  sqlite.exec(STORE_SCHEMA_V7_MIGRATION_SQL);
  sqlite.exec(`
    INSERT INTO users
      (id, name, email, password_hash, password_salt, password_iterations, role, status)
    VALUES
      ('review-admin', 'Review Admin', 'review-admin@example.com', 'hash', 'salt', 100000, 'admin', 'active'),
      ('review-owner', 'Review Owner', 'review-owner@example.com', 'hash', 'salt', 100000, 'couple', 'active');
    INSERT INTO vendors
      (id, user_id, slug, business_name, legal_name, status, category, categories_json, city,
       service_areas_json, description, min_budget, max_budget, currency, verified)
    VALUES
      ('review-vendor', 'review-owner', 'review-vendor', 'Review Vendor', 'Review Vendor Private Limited',
       'suspended', 'photography', '["photography"]', 'Jaipur', '["Jaipur"]',
       'A complete legacy reviewed vendor record that must survive the additive schema migration.',
       100000, 500000, 'INR', 0);
    INSERT INTO audit_events (actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
    VALUES
      ('review-admin', 'vendor.reviewed', 'vendor', 'review-vendor',
       '{"from":"pending","to":"approved","note":"Legacy approval rationale retained."}',
       '2027-01-01T00:00:00.000Z'),
      ('review-admin', 'vendor.reviewed', 'vendor', 'review-vendor',
       '{"from":"approved","to":"suspended","note":"Legacy suspension rationale retained."}',
       '2027-02-01T00:00:00.000Z');
  `);

  sqlite.exec(STORE_SCHEMA_V8_MIGRATION_SQL);

  assert.equal(sqlite.prepare("SELECT MAX(id) AS version FROM _sql_schema_migrations").get().version, 8);
  assert.deepEqual(
    { ...sqlite.prepare("SELECT status, verified, review_revision FROM vendors WHERE id = 'review-vendor'").get() },
    { status: "suspended", verified: 0, review_revision: 2 },
  );
  sqlite
    .prepare("UPDATE vendors SET status = 'approved', verified = 1, updated_at = CURRENT_TIMESTAMP WHERE id = 'review-vendor'")
    .run();
  assert.equal(
    sqlite.prepare("SELECT review_revision FROM vendors WHERE id = 'review-vendor'").get().review_revision,
    3,
  );
  sqlite
    .prepare(
      `INSERT INTO audit_events (actor_user_id, action, entity_type, entity_id, metadata_json)
       VALUES ('review-admin', 'vendor.reviewed', 'vendor', 'review-vendor',
               '{"from":"suspended","to":"approved","note":"Old writer restoration remains compatible."}')`,
    )
    .run();
  const firstAuditId = sqlite.prepare("SELECT MIN(id) AS id FROM audit_events").get().id;
  assert.throws(
    () => sqlite.prepare("UPDATE audit_events SET metadata_json = '{}' WHERE id = ?").run(firstAuditId),
    /audit events are immutable/,
  );
  assert.throws(
    () => sqlite.prepare("DELETE FROM audit_events WHERE id = ?").run(firstAuditId),
    /audit events are immutable/,
  );
  sqlite.prepare("UPDATE audit_events SET actor_user_id = NULL WHERE id = ?").run(firstAuditId);
  assert.throws(
    () => sqlite.prepare("UPDATE audit_events SET actor_user_id = 'review-admin' WHERE id = ?").run(firstAuditId),
    /actors can only be anonymized/,
  );

  sqlite.exec(STORE_SCHEMA_V8_FINALIZE_SQL);
  assert.equal(sqlite.prepare("SELECT review_revision FROM vendors WHERE id = 'review-vendor'").get().review_revision, 3);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM audit_events").get().count, 3);
});

test("schema v9 is additive, keeps evidence immutable, and blocks unacknowledged old-worker approvals", () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE _sql_schema_migrations (
    id INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  sqlite.exec(STORE_SCHEMA_V1_SQL);
  sqlite.exec(STORE_SCHEMA_V2_MIGRATION_SQL);
  sqlite.exec(STORE_SCHEMA_V3_MIGRATION_SQL);
  sqlite.exec(STORE_SCHEMA_V4_MIGRATION_SQL);
  sqlite.exec(STORE_SCHEMA_V5_MIGRATION_SQL);
  sqlite.exec(STORE_SCHEMA_V6_MIGRATION_SQL);
  sqlite.exec(STORE_SCHEMA_V7_MIGRATION_SQL);
  sqlite.exec(STORE_SCHEMA_V8_MIGRATION_SQL);
  sqlite.exec(`
    INSERT INTO users
      (id, name, email, password_hash, password_salt, password_iterations, role, status)
    VALUES ('evidence-owner', 'Evidence Owner', 'evidence-owner@example.com', 'hash', 'salt', 100000, 'couple', 'active');
    INSERT INTO vendors
      (id, user_id, slug, business_name, legal_name, status, category, categories_json, city,
       service_areas_json, description, min_budget, max_budget, currency)
    VALUES
      ('evidence-vendor', 'evidence-owner', 'evidence-vendor', 'Evidence Vendor', 'Evidence Vendor Private Limited',
       'pending', 'photography', '["photography"]', 'Jaipur', '["Jaipur"]',
       'A populated vendor retained while schema v9 adds immutable application evidence.', 100000, 500000, 'INR'),
      ('legacy-audit-guard-vendor', NULL, 'legacy-audit-guard-vendor', 'Legacy Audit Guard Vendor', NULL,
       'pending', 'photography', '["photography"]', 'Jaipur', '["Jaipur"]',
       'A legacy vendor retained to test old-worker audit minimization at the database boundary.', 100000, 500000, 'INR');
  `);

  sqlite.exec(STORE_SCHEMA_V9_MIGRATION_SQL);

  assert.equal(sqlite.prepare("SELECT MAX(id) AS version FROM _sql_schema_migrations").get().version, 9);
  assert.deepEqual(
    { ...sqlite.prepare(
      "SELECT evidence_required, evidence_reviewed_revision FROM vendors WHERE id = 'evidence-vendor'",
    ).get() },
    { evidence_required: 0, evidence_reviewed_revision: 0 },
  );
  assert.equal(
    sqlite.prepare("SELECT evidence_required FROM vendors WHERE id = 'legacy-audit-guard-vendor'").get().evidence_required,
    0,
  );
  const insertLegacyReviewAudit = sqlite.prepare(
    `INSERT INTO audit_events (action, entity_type, entity_id, metadata_json)
     VALUES ('vendor.reviewed', 'vendor', 'legacy-audit-guard-vendor', ?)`,
  );
  for (const sensitiveReason of [
    "Reviewed https://proof.example.com during approval.",
    "Reviewed proof.example.com during approval.",
    "Reviewed address 10.0.0.1 during approval.",
    "Reviewed GSTIN 08ABCDE1234F1Z5 during approval.",
    "Reviewed GSTIN 08 ABCDE 1234 F1Z5 during approval.",
    "Reviewed CIN L12345RJ2020PLC123456 during approval.",
    "Reviewed UDYAM-RJ-12-1234567 during approval.",
    "Reviewed PAN A B C D E 1 2 3 4 F during approval.",
    "Reviewed Aadhaar 1234 5678 9012 during approval.",
    "Reviewed Aadhaar 1234  5678  9012 during approval.",
    "Reviewed passport A 1 2 3 4 5 6 7 during approval.",
  ]) {
    assert.throws(
      () => insertLegacyReviewAudit.run(JSON.stringify({ reason: sensitiveReason })),
      /vendor review reasons must not contain evidence addresses or identity references/,
    );
  }
  insertLegacyReviewAudit.run(JSON.stringify({
    reviewId: "legacy-safe-summary",
    from: "pending",
    to: "rejected",
    evidenceSummary: {
      revision: 1,
      portfolioUrlCount: 2,
      referenceUrlCount: 1,
      registrationType: "gstin",
    },
  }));
  for (const benignReason of [
    "Alpha 2026 approval completed after an ordinary service-quality review.",
    "Phase A 1234567 was accepted after an ordinary service-quality review.",
    "The 2026 plan and 2027 launch dates were reviewed successfully.",
    "Evidence reviewed on 2026-08-17",
  ]) {
    insertLegacyReviewAudit.run(JSON.stringify({ reason: benignReason }));
  }
  assert.throws(
    () => {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        sqlite.prepare(
          "UPDATE vendors SET status = 'approved', verified = 1 WHERE id = 'legacy-audit-guard-vendor'",
        ).run();
        insertLegacyReviewAudit.run(JSON.stringify({
          from: "pending",
          to: "approved",
          note: "Old Worker reviewed proof.example.com and should roll back atomically.",
        }));
        sqlite.exec("COMMIT");
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
    /vendor review reasons must not contain evidence addresses or identity references/,
  );
  assert.deepEqual(
    { ...sqlite.prepare(
      "SELECT status, verified, review_revision FROM vendors WHERE id = 'legacy-audit-guard-vendor'",
    ).get() },
    { status: "pending", verified: 0, review_revision: 0 },
  );
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE entity_id = 'legacy-audit-guard-vendor'").get().count,
    5,
  );
  sqlite.prepare(
    `INSERT INTO vendor_application_evidence
      (vendor_id, portfolio_urls_json, reference_urls_json, registration_type, registration_reference, attested, attested_at)
     VALUES ('evidence-vendor', '["https://portfolio.example.com/work"]',
             '["https://reviews.example.com/vendor"]', 'gstin', '08ABCDE1234F1Z5', 1,
             '2028-01-01T00:00:00.000Z')`,
  ).run();
  const insertEvidenceReviewAudit = sqlite.prepare(
    `INSERT INTO audit_events (action, entity_type, entity_id, metadata_json)
     VALUES ('vendor.reviewed', 'vendor', 'evidence-vendor', ?)`,
  );
  for (const obfuscatedStoredEvidence of [
    "Reviewed portfolio . example . com during approval.",
    "Reviewed GSTIN 08 ABCDE 1234 F1Z5 during approval.",
  ]) {
    assert.throws(
      () => insertEvidenceReviewAudit.run(JSON.stringify({ reason: obfuscatedStoredEvidence })),
      /vendor review reasons must not contain evidence addresses or identity references/,
    );
  }
  sqlite.prepare(
    `INSERT INTO vendors
      (id, slug, business_name, status, category, categories_json, city, service_areas_json,
       description, min_budget, max_budget, currency)
     VALUES ('invalid-evidence-vendor', 'invalid-evidence-vendor', 'Invalid Evidence Vendor', 'pending',
             'photography', '["photography"]', 'Jaipur', '["Jaipur"]',
             'A schema-only vendor used to reject malformed evidence rows.', 100000, 500000, 'INR')`,
  ).run();
  assert.equal(
    sqlite.prepare("SELECT evidence_required FROM vendors WHERE id = 'invalid-evidence-vendor'").get().evidence_required,
    1,
  );
  assert.throws(
    () => sqlite.prepare(
      `INSERT INTO vendor_application_evidence
        (vendor_id, portfolio_urls_json, reference_urls_json, registration_type, registration_reference, attested, attested_at)
       VALUES ('invalid-evidence-vendor', '["https://portfolio.example.com/work"]',
               '["https://reviews.example.com/vendor"]', 'gstin', NULL, 1,
               '2028-01-01T00:00:00.000Z')`,
    ).run(),
    /CHECK constraint failed/,
  );
  assert.throws(
    () => sqlite.prepare(
      `INSERT INTO vendor_application_evidence
        (vendor_id, portfolio_urls_json, reference_urls_json, registration_type, registration_reference, attested, attested_at)
       VALUES ('invalid-evidence-vendor', '["https://portfolio.example.com/work"]',
               '["https://reviews.example.com/vendor"]', 'udyam', 'UDYAM-RJ-1-1234567', 1,
               '2028-01-01T00:00:00.000Z')`,
    ).run(),
    /CHECK constraint failed/,
  );
  assert.throws(
    () => sqlite.prepare(
      `INSERT INTO vendor_application_evidence
        (vendor_id, portfolio_urls_json, reference_urls_json, registration_type, registration_reference, attested, attested_at)
       VALUES ('invalid-evidence-vendor', '["https://same.example.com/work"]',
               '["https://same.example.com/work"]', 'not_registered', NULL, 1,
               '2028-01-01T00:00:00.000Z')`,
    ).run(),
    /normalized unique public HTTPS URLs/,
  );
  assert.throws(
    () => sqlite.prepare(
      `INSERT INTO vendor_application_evidence
        (vendor_id, portfolio_urls_json, reference_urls_json, registration_type, registration_reference, attested, attested_at)
       VALUES ('invalid-evidence-vendor', '["https://xn--fsqu00a.xn--55qx5d/work"]',
               '["https://reviews.example.com/vendor"]', 'not_registered', NULL, 1,
               '2028-01-01T00:00:00.000Z')`,
    ).run(),
    /normalized unique public HTTPS URLs/,
  );
  assert.throws(
    () => sqlite.prepare(
      `INSERT INTO vendor_application_evidence
        (vendor_id, portfolio_urls_json, reference_urls_json, registration_type, registration_reference, attested, attested_at)
       VALUES ('invalid-evidence-vendor', '["https://portfolio.example.com./work"]',
               '["https://reviews.example.com/vendor"]', 'not_registered', NULL, 1,
               '2028-01-01T00:00:00.000Z')`,
    ).run(),
    /normalized unique public HTTPS URLs/,
  );
  assert.throws(
    () => sqlite.prepare(
      "UPDATE vendors SET status = 'approved', verified = 1 WHERE id = 'invalid-evidence-vendor'",
    ).run(),
    /evidence must be completed and acknowledged/,
  );
  sqlite.prepare(
    `INSERT INTO vendors
      (id, slug, business_name, status, category, categories_json, city, service_areas_json,
       description, min_budget, max_budget, currency, evidence_required)
     VALUES ('legacy-approved-vendor', 'legacy-approved-vendor', 'Legacy Approved Vendor', 'pending',
             'photography', '["photography"]', 'Jaipur', '["Jaipur"]',
             'A genuine pre-evidence application used to enforce write-time completion state.',
             100000, 500000, 'INR', 0)`,
  ).run();
  sqlite.prepare("UPDATE vendors SET status = 'approved', verified = 1 WHERE id = 'legacy-approved-vendor'").run();
  assert.throws(
    () => sqlite.prepare(
      `INSERT INTO vendor_application_evidence
        (vendor_id, portfolio_urls_json, reference_urls_json, registration_type, registration_reference, attested, attested_at)
       VALUES ('legacy-approved-vendor', '["https://legacy-portfolio.example.com/work"]',
               '["https://legacy-reviews.example.com/vendor"]', 'not_registered', NULL, 1,
               '2028-01-01T00:00:00.000Z')`,
    ).run(),
    /evidence requires a pending or rejected vendor/,
  );

  assert.throws(
    () => sqlite.prepare("UPDATE vendors SET status = 'approved', verified = 1 WHERE id = 'evidence-vendor'").run(),
    /evidence must be completed and acknowledged/,
  );
  assert.deepEqual(
    { ...sqlite.prepare("SELECT status, verified, review_revision FROM vendors WHERE id = 'evidence-vendor'").get() },
    { status: "pending", verified: 0, review_revision: 0 },
  );
  sqlite.prepare("UPDATE vendors SET evidence_reviewed_revision = 2 WHERE id = 'evidence-vendor'").run();
  assert.throws(
    () => sqlite.prepare("UPDATE vendors SET status = 'approved', verified = 1 WHERE id = 'evidence-vendor'").run(),
    /evidence must be completed and acknowledged/,
  );
  sqlite.prepare("UPDATE vendors SET evidence_reviewed_revision = 0 WHERE id = 'evidence-vendor'").run();
  sqlite.prepare(
    `UPDATE vendors
     SET status = 'approved', verified = 1, evidence_reviewed_revision = 1
     WHERE id = 'evidence-vendor'`,
  ).run();
  assert.deepEqual(
    { ...sqlite.prepare(
      "SELECT status, verified, review_revision, evidence_reviewed_revision FROM vendors WHERE id = 'evidence-vendor'",
    ).get() },
    { status: "approved", verified: 1, review_revision: 1, evidence_reviewed_revision: 1 },
  );
  assert.throws(
    () => sqlite.prepare(
      "UPDATE vendor_application_evidence SET registration_reference = '08ABCDE1234F1Z6' WHERE vendor_id = 'evidence-vendor'",
    ).run(),
    /evidence is immutable/,
  );
  assert.throws(
    () => sqlite.prepare("DELETE FROM vendor_application_evidence WHERE vendor_id = 'evidence-vendor'").run(),
    /evidence is immutable/,
  );
});

test("schema v10 fresh install and interrupted v9-column restart converge without duplicate evidence structures", async () => {
  assert.doesNotMatch(STORE_SCHEMA_V9_FINALIZE_SQL, /DROP\s+TRIGGER/iu);
  const fresh = new DatabaseSync(":memory:");
  fresh.exec(`CREATE TABLE _sql_schema_migrations (
    id INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  fresh.exec(STORE_SCHEMA_SQL);
  assert.equal(fresh.prepare("SELECT MAX(id) AS version FROM _sql_schema_migrations").get().version, 10);
  assert.deepEqual(
    fresh.prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'trigger' AND name LIKE '%evidence%'
       ORDER BY name`,
    ).all().map((row) => row.name),
    [
      "vendor_application_evidence_active_owner_insert_v10",
      "vendor_application_evidence_active_request_insert_v10",
      "vendor_application_evidence_immutable_delete",
      "vendor_application_evidence_immutable_update",
      "vendor_application_evidence_mirror_insert_v10",
      "vendor_application_evidence_revisions_actor_update",
      "vendor_application_evidence_revisions_apply_insert",
      "vendor_application_evidence_revisions_compatibility_insert_v10",
      "vendor_application_evidence_revisions_delete",
      "vendor_application_evidence_revisions_identity_update",
      "vendor_application_evidence_revisions_state_insert",
      "vendor_application_evidence_revisions_validate_insert",
      "vendor_application_evidence_validate_insert",
      "vendor_application_evidence_vendor_state_insert_v10",
      "vendors_evidence_approval_guard_v10",
      "vendors_evidence_latest_revision_guard",
    ],
  );

  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE _sql_schema_migrations (
    id INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  sqlite.exec(STORE_SCHEMA_V1_SQL);
  sqlite.exec(STORE_SCHEMA_V2_MIGRATION_SQL);
  sqlite.exec(STORE_SCHEMA_V3_MIGRATION_SQL);
  sqlite.exec(STORE_SCHEMA_V4_MIGRATION_SQL);
  sqlite.exec(STORE_SCHEMA_V5_MIGRATION_SQL);
  sqlite.exec(STORE_SCHEMA_V6_MIGRATION_SQL);
  sqlite.exec(STORE_SCHEMA_V7_MIGRATION_SQL);
  sqlite.exec(STORE_SCHEMA_V8_MIGRATION_SQL);
  sqlite.exec(
    `ALTER TABLE vendors ADD COLUMN evidence_reviewed_revision INTEGER NOT NULL DEFAULT 0
       CHECK (typeof(evidence_reviewed_revision) = 'integer' AND evidence_reviewed_revision >= 0)`,
  );
  const sql = {
    exec(statement, ...args) {
      const normalized = statement.trim().toUpperCase();
      if (args.length > 0 || normalized.startsWith("SELECT") || normalized.startsWith("PRAGMA")) {
        const rows = sqlite.prepare(statement).all(...args);
        return { toArray: () => rows };
      }
      sqlite.exec(statement);
      return { toArray: () => [] };
    },
  };
  let initialized;
  const ctx = {
    storage: {
      sql,
      transactionSync(callback) {
        sqlite.exec("BEGIN IMMEDIATE");
        try {
          const result = callback();
          sqlite.exec("COMMIT");
          return result;
        } catch (error) {
          sqlite.exec("ROLLBACK");
          throw error;
        }
      },
      async getAlarm() { return 1; },
      async setAlarm() {},
    },
    blockConcurrencyWhile(callback) {
      initialized = callback();
    },
  };

  new MelaivaStore(ctx, { ENVIRONMENT: "production" });
  await initialized;
  sqlite.prepare(
    `INSERT INTO vendors
      (id, slug, business_name, status, category, categories_json, city, service_areas_json,
       description, min_budget, max_budget, currency)
     VALUES ('post-v9-restart-vendor', 'post-v9-restart-vendor', 'Post V9 Restart Vendor', 'pending',
             'photography', '["photography"]', 'Jaipur', '["Jaipur"]',
             'A post-migration old-writer row that must retain required evidence across cold starts.',
             100000, 500000, 'INR')`,
  ).run();
  new MelaivaStore(ctx, { ENVIRONMENT: "production" });
  await initialized;

  assert.equal(sqlite.prepare("SELECT MAX(id) AS version FROM _sql_schema_migrations").get().version, STORE_SCHEMA_VERSION);
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) AS count FROM pragma_table_info('vendors') WHERE name = 'evidence_reviewed_revision'").get().count,
    1,
  );
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) AS count FROM pragma_table_info('vendors') WHERE name = 'evidence_required'").get().count,
    1,
  );
  assert.equal(
    sqlite.prepare("SELECT evidence_required FROM vendors WHERE id = 'post-v9-restart-vendor'").get().evidence_required,
    1,
  );
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'vendor_application_evidence'").get().count,
    1,
  );
});

test("schema v10 enforces contiguous immutable revisions, safe applicant text, and the request cap", () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE _sql_schema_migrations (
    id INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  sqlite.exec(STORE_SCHEMA_SQL);
  const v10GlobPatterns = [...STORE_SCHEMA_V10_FINALIZE_SQL.matchAll(/GLOB '([^']+)'/gu)].map((match) => match[1]);
  assert.ok(v10GlobPatterns.length > 0);
  assert.ok(
    v10GlobPatterns.every((pattern) => pattern.length <= 32),
    "Workerd rejects the long expanded GLOB patterns that desktop SQLite accepts",
  );
  const insertUser = sqlite.prepare(
    `INSERT INTO users
      (id, name, email, password_hash, password_salt, password_iterations, password_scheme, role)
     VALUES (?, ?, ?, 'hash', 'salt', 100000, 'pbkdf2-server-v1', ?)`,
  );
  insertUser.run("revision-owner", "Revision Owner", "revision-owner@example.com", "vendor");
  insertUser.run("revision-admin", "Revision Admin", "revision-admin@example.com", "admin");
  sqlite.prepare(
    `INSERT INTO vendors
      (id, user_id, slug, business_name, status, category, categories_json, city, service_areas_json,
       description, min_budget, max_budget, currency)
     VALUES ('revision-cap-vendor', 'revision-owner', 'revision-cap-vendor', 'Revision Cap Vendor', 'pending',
             'photography', '["photography"]', 'Jaipur', '["Jaipur"]',
             'A schema-level application used to exercise append-only revision invariants.',
             100000, 500000, 'INR')`,
  ).run();
  sqlite.prepare(
    `INSERT INTO vendor_application_evidence
      (vendor_id, portfolio_urls_json, reference_urls_json, registration_type,
       registration_reference, attested, attested_at, created_at)
     VALUES ('revision-cap-vendor', '["https://revision-one.example.com/work"]',
             '["https://revision-one-reference.example.com/review"]', 'not_registered', NULL, 1,
             '2028-01-01T00:00:00.000Z', '2028-01-01T00:00:00.000Z')`,
  ).run();
  assert.deepEqual(
    { ...sqlite.prepare(
      `SELECT evidence_latest_revision, information_request_revision, information_requested
       FROM vendors WHERE id = 'revision-cap-vendor'`,
    ).get() },
    { evidence_latest_revision: 1, information_request_revision: 0, information_requested: 0 },
  );
  assert.equal(
    sqlite.prepare(
      `SELECT COUNT(*) AS count FROM sqlite_master
       WHERE type = 'trigger' AND name = 'vendor_application_evidence_vendor_state_insert'`,
    ).get().count,
    0,
  );
  assert.throws(
    () => sqlite.prepare(
      `INSERT INTO vendor_application_information_requests
        (vendor_id, request_revision, evidence_revision, requested_fields_json, applicant_message,
         requested_by_user_id, requested_at)
       VALUES ('revision-cap-vendor', 1, 1, '["portfolio"]', ?, 'revision-admin',
               '2028-01-01T00:00:01.000Z')`,
    ).run("Please replace the portfolio.\u202e Unsafe direction."),
    /invalid or sensitive content/,
  );
  assert.throws(
    () => sqlite.prepare(
      `INSERT INTO vendor_application_information_requests
        (vendor_id, request_revision, evidence_revision, requested_fields_json, applicant_message,
         requested_by_user_id, requested_at)
       VALUES ('revision-cap-vendor', 1, 1, '["portfolio"]',
               'Please verify PAN ABCDE1234F before replacing this portfolio.', 'revision-admin',
               '2028-01-01T00:00:01.000Z')`,
    ).run(),
    /invalid or sensitive content/,
  );
  assert.throws(
    () => sqlite.prepare(
      `INSERT INTO audit_events (actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
       VALUES ('revision-admin', 'vendor.reviewed', 'vendor', 'revision-cap-vendor',
               '{"reason":"Reviewed PAN ABCDE1234F before requesting an update."}',
               '2028-01-01T00:00:01.000Z')`,
    ).run(),
    /identity references/,
  );
  assert.throws(
    () => sqlite.prepare(
      `INSERT INTO vendor_application_information_requests
        (vendor_id, request_revision, evidence_revision, requested_fields_json, applicant_message,
         requested_by_user_id, requested_at)
       VALUES ('revision-cap-vendor', 1, 1, '["portfolio"]',
               ' Please replace the portfolio with clearer work. ', 'revision-admin',
               '2028-01-01T00:00:01.000Z')`,
    ).run(),
    /invalid or sensitive content/,
  );

  const insertRequest = sqlite.prepare(
    `INSERT INTO vendor_application_information_requests
      (vendor_id, request_revision, evidence_revision, requested_fields_json, applicant_message,
       requested_by_user_id, requested_at)
     VALUES ('revision-cap-vendor', ?, ?, '["portfolio"]',
             'Please replace the portfolio with clearer representative work.', 'revision-admin', ?)`,
  );
  const insertRevision = sqlite.prepare(
    `INSERT INTO vendor_application_evidence_revisions
      (vendor_id, evidence_revision, portfolio_urls_json, reference_urls_json, registration_type,
       registration_reference, attested, attested_at, submitted_by_user_id, created_at)
     VALUES ('revision-cap-vendor', ?, '["https://revised-work.example.com/gallery"]',
             '["https://revised-reference.example.com/review"]', 'not_registered', NULL, 1, ?,
             'revision-owner', ?)`,
  );
  for (let revision = 2; revision <= 20; revision += 1) {
    const requestRevision = revision - 1;
    const requestedAt = `2028-01-${String(revision).padStart(2, "0")}T00:00:00.000Z`;
    const submittedAt = `2028-02-${String(revision).padStart(2, "0")}T00:00:00.000Z`;
    insertRequest.run(requestRevision, revision - 1, requestedAt);
    insertRevision.run(revision, submittedAt, submittedAt);
  }
  assert.deepEqual(
    { ...sqlite.prepare(
      `SELECT evidence_latest_revision, information_request_revision, information_requested
       FROM vendors WHERE id = 'revision-cap-vendor'`,
    ).get() },
    { evidence_latest_revision: 20, information_request_revision: 19, information_requested: 0 },
  );
  assert.equal(
    sqlite.prepare(
      `SELECT COUNT(*) AS count FROM vendor_application_evidence_revisions
       WHERE vendor_id = 'revision-cap-vendor'`,
    ).get().count,
    20,
  );
  assert.throws(
    () => insertRequest.run(20, 20, "2028-03-01T00:00:00.000Z"),
    /invalid or sensitive content/,
  );
  assert.equal(
    sqlite.prepare(
      `SELECT COUNT(*) AS count FROM vendor_application_information_requests
       WHERE vendor_id = 'revision-cap-vendor'`,
    ).get().count,
    19,
  );
  assert.throws(
    () => sqlite.prepare(
      `UPDATE vendor_application_evidence_revisions SET registration_type = 'gstin'
       WHERE vendor_id = 'revision-cap-vendor' AND evidence_revision = 1`,
    ).run(),
    /revisions are immutable/,
  );
  assert.throws(
    () => sqlite.prepare(
      `DELETE FROM vendor_application_information_requests
       WHERE vendor_id = 'revision-cap-vendor' AND request_revision = 1`,
    ).run(),
    /information requests are immutable/,
  );
  assert.throws(
    () => sqlite.prepare(
      "UPDATE vendors SET evidence_latest_revision = 19 WHERE id = 'revision-cap-vendor'",
    ).run(),
    /latest revision must reference append-only history/,
  );
});

test("schema v10 rejects a rolling v9 revision-one insert while an information request is active", () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE _sql_schema_migrations (
    id INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  sqlite.exec(STORE_SCHEMA_SQL);
  const insertUser = sqlite.prepare(
    `INSERT INTO users
      (id, name, email, password_hash, password_salt, password_iterations, password_scheme, role)
     VALUES (?, ?, ?, 'hash', 'salt', 100000, 'pbkdf2-server-v1', ?)`,
  );
  insertUser.run("rolling-owner", "Rolling Owner", "rolling-owner@example.com", "vendor");
  insertUser.run("rolling-admin", "Rolling Admin", "rolling-admin@example.com", "admin");
  sqlite.prepare(
    `INSERT INTO vendors
      (id, user_id, slug, business_name, status, category, categories_json, city, service_areas_json,
       description, min_budget, max_budget, currency, evidence_required)
     VALUES ('rolling-request-vendor', 'rolling-owner', 'rolling-request-vendor', 'Rolling Request Vendor',
             'pending', 'photography', '["photography"]', 'Jaipur', '["Jaipur"]',
             'An evidence-less application used to exercise an in-flight v9 completion after migration.',
             100000, 500000, 'INR', 1)`,
  ).run();
  sqlite.prepare(
    `INSERT INTO vendor_application_information_requests
      (vendor_id, request_revision, evidence_revision, requested_fields_json, applicant_message,
       requested_by_user_id, requested_at)
     VALUES ('rolling-request-vendor', 1, 0, '["registration"]',
             'Please complete the business registration declaration.', 'rolling-admin',
             '2028-03-01T00:00:00.000Z')`,
  ).run();

  assert.throws(
    () => sqlite.prepare(
      `INSERT INTO vendor_application_evidence
        (vendor_id, evidence_revision, portfolio_urls_json, reference_urls_json, registration_type,
         registration_reference, attested, attested_at, created_at)
       VALUES ('rolling-request-vendor', 1, '["https://rolling-work.example.com/gallery"]',
               '["https://rolling-reference.example.com/review"]', 'not_registered', NULL, 1,
               '2028-03-02T00:00:00.000Z', '2028-03-02T00:00:00.000Z')`,
    ).run(),
    /legacy vendor evidence cannot resolve an active information request/,
  );

  assert.deepEqual(
    { ...sqlite.prepare(
      `SELECT review_revision, evidence_latest_revision, information_request_revision, information_requested
       FROM vendors WHERE id = 'rolling-request-vendor'`,
    ).get() },
    {
      review_revision: 1,
      evidence_latest_revision: 0,
      information_request_revision: 1,
      information_requested: 1,
    },
  );
  assert.equal(
    sqlite.prepare(
      `SELECT COUNT(*) AS count FROM vendor_application_evidence
       WHERE vendor_id = 'rolling-request-vendor'`,
    ).get().count,
    0,
  );
  assert.equal(
    sqlite.prepare(
      `SELECT COUNT(*) AS count FROM vendor_application_evidence_revisions
       WHERE vendor_id = 'rolling-request-vendor'`,
    ).get().count,
    0,
  );
  assert.equal(
    sqlite.prepare(
      `SELECT COUNT(*) AS count FROM vendor_application_information_requests
       WHERE vendor_id = 'rolling-request-vendor'`,
    ).get().count,
    1,
  );
});

test("schema v10 migrates v9 evidence into revision one and replaces the old-worker tripwire", () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE _sql_schema_migrations (
    id INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  sqlite.exec(STORE_SCHEMA_V1_SQL);
  sqlite.exec(STORE_SCHEMA_V2_MIGRATION_SQL);
  sqlite.exec(STORE_SCHEMA_V3_MIGRATION_SQL);
  sqlite.exec(STORE_SCHEMA_V4_MIGRATION_SQL);
  sqlite.exec(STORE_SCHEMA_V5_MIGRATION_SQL);
  sqlite.exec(STORE_SCHEMA_V6_MIGRATION_SQL);
  sqlite.exec(STORE_SCHEMA_V7_MIGRATION_SQL);
  sqlite.exec(STORE_SCHEMA_V8_MIGRATION_SQL);
  sqlite.exec(STORE_SCHEMA_V9_MIGRATION_SQL);
  sqlite.prepare(
    `INSERT INTO users
      (id, name, email, password_hash, password_salt, password_iterations, password_scheme, role)
     VALUES ('migration-owner', 'Migration Owner', 'migration-owner@example.com',
             'hash', 'salt', 100000, 'pbkdf2-server-v1', 'vendor')`,
  ).run();
  sqlite.prepare(
    `INSERT INTO vendors
      (id, user_id, slug, business_name, status, category, categories_json, city, service_areas_json,
       description, min_budget, max_budget, currency)
     VALUES ('migration-vendor', 'migration-owner', 'migration-vendor', 'Migration Vendor', 'pending',
             'photography', '["photography"]', 'Jaipur', '["Jaipur"]',
             'A populated v9 application that must retain its exact immutable evidence.',
             100000, 500000, 'INR')`,
  ).run();
  sqlite.prepare(
    `INSERT INTO vendor_application_evidence
      (vendor_id, portfolio_urls_json, reference_urls_json, registration_type,
       registration_reference, attested, attested_at, created_at)
     VALUES ('migration-vendor', '["https://migration-portfolio.example.com/work"]',
             '["https://migration-reference.example.com/review"]', 'gstin', '08ABCDE1234F1Z5', 1,
             '2028-04-01T00:00:00.000Z', '2028-04-01T00:00:00.000Z')`,
  ).run();
  assert.equal(
    sqlite.prepare(
      `SELECT COUNT(*) AS count FROM sqlite_master
       WHERE type = 'trigger' AND name = 'vendor_application_evidence_vendor_state_insert'`,
    ).get().count,
    1,
  );

  sqlite.exec(STORE_SCHEMA_V10_MIGRATION_SQL);
  assert.equal(sqlite.prepare("SELECT MAX(id) AS version FROM _sql_schema_migrations").get().version, 10);
  assert.deepEqual(
    { ...sqlite.prepare(
      `SELECT vendor_id, evidence_revision, portfolio_urls_json, reference_urls_json,
              registration_type, registration_reference, attested, attested_at, submitted_by_user_id, created_at
       FROM vendor_application_evidence_revisions WHERE vendor_id = 'migration-vendor'`,
    ).get() },
    {
      vendor_id: "migration-vendor",
      evidence_revision: 1,
      portfolio_urls_json: '["https://migration-portfolio.example.com/work"]',
      reference_urls_json: '["https://migration-reference.example.com/review"]',
      registration_type: "gstin",
      registration_reference: "08ABCDE1234F1Z5",
      attested: 1,
      attested_at: "2028-04-01T00:00:00.000Z",
      submitted_by_user_id: "migration-owner",
      created_at: "2028-04-01T00:00:00.000Z",
    },
  );
  assert.equal(
    sqlite.prepare("SELECT evidence_latest_revision FROM vendors WHERE id = 'migration-vendor'").get()
      .evidence_latest_revision,
    1,
  );
  assert.equal(
    sqlite.prepare(
      `SELECT COUNT(*) AS count FROM sqlite_master
       WHERE type = 'trigger' AND name = 'vendor_application_evidence_vendor_state_insert'`,
    ).get().count,
    0,
  );
  assert.equal(
    sqlite.prepare(
      `SELECT COUNT(*) AS count FROM sqlite_master
       WHERE type = 'trigger' AND name = 'vendor_application_evidence_vendor_state_insert_v10'`,
    ).get().count,
    1,
  );
  assert.throws(
    () => sqlite.prepare(
      `UPDATE vendor_application_evidence_revisions SET registration_reference = '08ABCDE1234F1Z6'
       WHERE vendor_id = 'migration-vendor' AND evidence_revision = 1`,
    ).run(),
    /revisions are immutable/,
  );
});

test("schema v9-to-v10 finalize failures roll back atomically and preserve an approval guard", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE _sql_schema_migrations (
    id INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  sqlite.exec(STORE_SCHEMA_V1_SQL);
  sqlite.exec(STORE_SCHEMA_V2_MIGRATION_SQL);
  sqlite.exec(STORE_SCHEMA_V3_MIGRATION_SQL);
  sqlite.exec(STORE_SCHEMA_V4_MIGRATION_SQL);
  sqlite.exec(STORE_SCHEMA_V5_MIGRATION_SQL);
  sqlite.exec(STORE_SCHEMA_V6_MIGRATION_SQL);
  sqlite.exec(STORE_SCHEMA_V7_MIGRATION_SQL);
  sqlite.exec(STORE_SCHEMA_V8_MIGRATION_SQL);
  sqlite.prepare(
    `INSERT INTO vendors
      (id, slug, business_name, status, category, categories_json, city, service_areas_json,
       description, min_budget, max_budget, currency)
     VALUES ('pre-v9-atomic-vendor', 'pre-v9-atomic-vendor', 'Pre V9 Atomic Vendor', 'pending',
             'photography', '["photography"]', 'Jaipur', '["Jaipur"]',
             'A pre-migration application retained through an injected schema-finalize failure.',
             100000, 500000, 'INR')`,
  ).run();

  let failFinalize = true;
  let failV10Finalize = false;
  const sql = {
    exec(statement, ...args) {
      const normalized = statement.trim().toUpperCase();
      if (failFinalize && statement.includes("CREATE TABLE IF NOT EXISTS vendor_application_evidence (")) {
        const failurePoint = statement.indexOf(
          "CREATE TRIGGER IF NOT EXISTS vendor_application_evidence_immutable_update",
        );
        assert.ok(failurePoint > 0);
        sqlite.exec(statement.slice(0, failurePoint));
        throw new Error("injected v9 finalize failure");
      }
      if (failV10Finalize && statement.includes("DROP TRIGGER IF EXISTS vendor_application_evidence_vendor_state_insert;")) {
        const failurePoint = statement.indexOf(
          "DROP TRIGGER IF EXISTS vendor_application_evidence_vendor_state_insert;",
        );
        assert.ok(failurePoint > 0);
        sqlite.exec(statement.slice(0, failurePoint));
        throw new Error("injected v10 finalize failure");
      }
      if (args.length > 0 || normalized.startsWith("SELECT") || normalized.startsWith("PRAGMA")) {
        const rows = sqlite.prepare(statement).all(...args);
        return { toArray: () => rows };
      }
      sqlite.exec(statement);
      return { toArray: () => [] };
    },
  };
  let initialized;
  const ctx = {
    storage: {
      sql,
      transactionSync(callback) {
        sqlite.exec("BEGIN IMMEDIATE");
        try {
          const result = callback();
          sqlite.exec("COMMIT");
          return result;
        } catch (error) {
          sqlite.exec("ROLLBACK");
          throw error;
        }
      },
      async getAlarm() { return 1; },
      async setAlarm() {},
    },
    blockConcurrencyWhile(callback) {
      initialized = callback();
    },
  };

  new MelaivaStore(ctx, { ENVIRONMENT: "production" });
  await assert.rejects(initialized, /injected v9 finalize failure/);
  assert.equal(sqlite.prepare("SELECT MAX(id) AS version FROM _sql_schema_migrations").get().version, 8);
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) AS count FROM pragma_table_info('vendors') WHERE name LIKE 'evidence_%'").get().count,
    0,
  );
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name LIKE '%evidence%'").get().count,
    0,
  );

  failFinalize = false;
  sqlite.exec(STORE_SCHEMA_V9_MIGRATION_SQL);
  assert.equal(sqlite.prepare("SELECT MAX(id) AS version FROM _sql_schema_migrations").get().version, 9);
  assert.equal(
    sqlite.prepare("SELECT evidence_required FROM vendors WHERE id = 'pre-v9-atomic-vendor'").get().evidence_required,
    0,
  );
  sqlite.prepare(
    `INSERT INTO vendors
      (id, slug, business_name, status, category, categories_json, city, service_areas_json,
       description, min_budget, max_budget, currency)
     VALUES ('post-v9-old-writer', 'post-v9-old-writer', 'Post V9 Old Writer', 'pending',
             'photography', '["photography"]', 'Jaipur', '["Jaipur"]',
             'A post-migration row written without evidence fields by a rolled-back Worker.',
             100000, 500000, 'INR')`,
  ).run();
  assert.equal(
    sqlite.prepare("SELECT evidence_required FROM vendors WHERE id = 'post-v9-old-writer'").get().evidence_required,
    1,
  );

  failV10Finalize = true;
  new MelaivaStore(ctx, { ENVIRONMENT: "production" });
  await assert.rejects(initialized, /injected v10 finalize failure/);
  assert.equal(sqlite.prepare("SELECT MAX(id) AS version FROM _sql_schema_migrations").get().version, 9);
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) AS count FROM pragma_table_info('vendors') WHERE name = 'evidence_latest_revision'").get().count,
    0,
  );
  assert.equal(
    sqlite.prepare(
      `SELECT COUNT(*) AS count FROM sqlite_master
       WHERE type = 'trigger' AND name = 'vendor_application_evidence_vendor_state_insert'`,
    ).get().count,
    1,
  );
  assert.equal(
    sqlite.prepare(
      `SELECT COUNT(*) AS count FROM sqlite_master
       WHERE type = 'trigger' AND name = 'vendor_application_evidence_vendor_state_insert_v10'`,
    ).get().count,
    0,
  );
  assert.throws(
    () => sqlite.prepare("UPDATE vendors SET status = 'approved', verified = 1 WHERE id = 'post-v9-old-writer'").run(),
    /evidence must be completed and acknowledged/,
  );
  assert.equal(sqlite.prepare("SELECT status FROM vendors WHERE id = 'post-v9-old-writer'").get().status, "pending");

  failV10Finalize = false;
  new MelaivaStore(ctx, { ENVIRONMENT: "production" });
  await initialized;
  assert.equal(sqlite.prepare("SELECT MAX(id) AS version FROM _sql_schema_migrations").get().version, 10);
  assert.equal(
    sqlite.prepare(
      `SELECT COUNT(*) AS count FROM sqlite_master
       WHERE type = 'trigger' AND name = 'vendor_application_evidence_vendor_state_insert_v10'`,
    ).get().count,
    1,
  );
});

test("schema v8 initialization resumes when the review revision column already exists", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE _sql_schema_migrations (
    id INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  sqlite.exec(STORE_SCHEMA_V1_SQL);
  sqlite.exec(STORE_SCHEMA_V2_MIGRATION_SQL);
  sqlite.exec(STORE_SCHEMA_V3_MIGRATION_SQL);
  sqlite.exec(STORE_SCHEMA_V4_MIGRATION_SQL);
  sqlite.exec(STORE_SCHEMA_V5_MIGRATION_SQL);
  sqlite.exec(STORE_SCHEMA_V6_MIGRATION_SQL);
  sqlite.exec(STORE_SCHEMA_V7_MIGRATION_SQL);
  sqlite.exec(
    `ALTER TABLE vendors ADD COLUMN review_revision INTEGER NOT NULL DEFAULT 0
       CHECK (typeof(review_revision) = 'integer' AND review_revision >= 0)`,
  );
  const sql = {
    exec(statement, ...args) {
      const normalized = statement.trim().toUpperCase();
      if (args.length > 0 || normalized.startsWith("SELECT") || normalized.startsWith("PRAGMA")) {
        const rows = sqlite.prepare(statement).all(...args);
        return { toArray: () => rows };
      }
      sqlite.exec(statement);
      return { toArray: () => [] };
    },
  };
  let initialized;
  const ctx = {
    storage: {
      sql,
      async getAlarm() { return 1; },
      async setAlarm() {},
    },
    blockConcurrencyWhile(callback) {
      initialized = callback();
    },
  };

  new MelaivaStore(ctx, { ENVIRONMENT: "production" });
  await initialized;

  assert.equal(sqlite.prepare("SELECT MAX(id) AS version FROM _sql_schema_migrations").get().version, STORE_SCHEMA_VERSION);
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) AS count FROM pragma_table_info('vendors') WHERE name = 'review_revision'").get().count,
    1,
  );
  assert.deepEqual(
    sqlite
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'trigger' AND name IN (
           'vendors_review_revision_update',
           'audit_events_identity_immutable_update',
           'audit_events_actor_retention_update',
           'audit_events_immutable_delete'
         ) ORDER BY name`,
      )
      .all()
      .map((row) => row.name),
    [
      "audit_events_actor_retention_update",
      "audit_events_identity_immutable_update",
      "audit_events_immutable_delete",
      "vendors_review_revision_update",
    ],
  );
});

test("schema v7 initialization resumes partial cursor rows without resetting or failing on empty threads", async () => {
  const sqlite = createV3AwardDatabase();
  const populated = seedAcceptedAward(sqlite, "partial-read-state");
  const empty = seedAcceptedAward(sqlite, "partial-read-state-empty");
  sqlite.exec(STORE_SCHEMA_V4_MIGRATION_SQL);
  sqlite.exec(STORE_SCHEMA_V5_MIGRATION_SQL);
  sqlite.exec(STORE_SCHEMA_V6_MIGRATION_SQL);
  const populatedBooking = sqlite.prepare("SELECT id FROM bookings WHERE accepted_bid_id = ?").get(populated.bidId);
  const emptyBooking = sqlite.prepare("SELECT id FROM bookings WHERE accepted_bid_id = ?").get(empty.bidId);
  sqlite
    .prepare(
      `INSERT INTO booking_messages (id, booking_id, sender_user_id, body, stream_position)
       VALUES ('partial-read-first', ?, 'migration-couple', 'Keep this earlier explicit participant cursor.', 1),
              ('partial-read-head', ?, 'migration-vendor-user', 'Do not reset the cursor to this newer head.', 2)`,
    )
    .run(populatedBooking.id, populatedBooking.id);
  sqlite.exec(`CREATE TABLE booking_message_read_cursors (
    booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
    participant_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    last_read_message_id TEXT REFERENCES booking_messages(id) ON DELETE RESTRICT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (booking_id, participant_user_id)
  )`);
  sqlite
    .prepare(
      `INSERT INTO booking_message_read_cursors
       (booking_id, participant_user_id, last_read_message_id)
       VALUES (?, 'migration-couple', 'partial-read-first'),
              (?, 'migration-couple', NULL),
              (?, 'migration-vendor-user', NULL)`,
    )
    .run(populatedBooking.id, emptyBooking.id, emptyBooking.id);
  assert.equal(sqlite.prepare("SELECT MAX(id) AS version FROM _sql_schema_migrations").get().version, 6);

  const sql = {
    exec(statement, ...args) {
      const normalized = statement.trim().toUpperCase();
      if (args.length > 0 || normalized.startsWith("SELECT") || normalized.startsWith("PRAGMA")) {
        const rows = sqlite.prepare(statement).all(...args);
        return { toArray: () => rows };
      }
      sqlite.exec(statement);
      return { toArray: () => [] };
    },
  };
  let initialized;
  const ctx = {
    storage: {
      sql,
      async getAlarm() { return 1; },
      async setAlarm() {},
    },
    blockConcurrencyWhile(callback) {
      initialized = callback();
    },
  };

  new MelaivaStore(ctx, { ENVIRONMENT: "production" });
  await initialized;

  assert.equal(sqlite.prepare("SELECT MAX(id) AS version FROM _sql_schema_migrations").get().version, STORE_SCHEMA_VERSION);
  assert.deepEqual(
    sqlite
      .prepare(
        `SELECT participant_user_id, last_read_message_id
         FROM booking_message_read_cursors
         WHERE booking_id = ? ORDER BY participant_user_id`,
      )
      .all(populatedBooking.id)
      .map((row) => ({ ...row })),
    [
      { participant_user_id: "migration-couple", last_read_message_id: "partial-read-first" },
      { participant_user_id: "migration-vendor-user", last_read_message_id: "partial-read-head" },
    ],
  );
  assert.deepEqual(
    sqlite
      .prepare(
        `SELECT participant_user_id, last_read_message_id
         FROM booking_message_read_cursors
         WHERE booking_id = ? ORDER BY participant_user_id`,
      )
      .all(emptyBooking.id)
      .map((row) => ({ ...row })),
    [
      { participant_user_id: "migration-couple", last_read_message_id: null },
      { participant_user_id: "migration-vendor-user", last_read_message_id: null },
    ],
  );
});

test("schema initialization resumes after the v6 stream column was already added", async () => {
  const sqlite = createV3AwardDatabase();
  const seeded = seedAcceptedAward(sqlite, "partial-stream", { auditCreatedAt: "2027-10-01T04:05:06.000Z" });
  sqlite.exec(STORE_SCHEMA_V4_MIGRATION_SQL);
  sqlite.exec(STORE_SCHEMA_V5_MIGRATION_SQL);
  const booking = sqlite.prepare("SELECT id FROM bookings WHERE accepted_bid_id = ?").get(seeded.bidId);
  sqlite
    .prepare(
      `INSERT INTO booking_messages (id, booking_id, sender_user_id, body, created_at)
       VALUES ('partial-stream-message', ?, 'migration-couple', 'Retain this message across migration restart.',
               '2027-10-03T10:00:00.000Z')`,
    )
    .run(booking.id);
  sqlite.exec("ALTER TABLE booking_messages ADD COLUMN stream_position INTEGER");

  const sql = {
    exec(statement, ...args) {
      const normalized = statement.trim().toUpperCase();
      if (args.length > 0 || normalized.startsWith("SELECT") || normalized.startsWith("PRAGMA")) {
        const rows = sqlite.prepare(statement).all(...args);
        return { toArray: () => rows };
      }
      sqlite.exec(statement);
      return { toArray: () => [] };
    },
  };
  let initialized;
  const ctx = {
    storage: {
      sql,
      async getAlarm() { return 1; },
      async setAlarm() {},
    },
    blockConcurrencyWhile(callback) {
      initialized = callback();
    },
  };

  new MelaivaStore(ctx, { ENVIRONMENT: "production" });
  await initialized;

  assert.equal(sqlite.prepare("SELECT MAX(id) AS version FROM _sql_schema_migrations").get().version, STORE_SCHEMA_VERSION);
  assert.equal(
    sqlite.prepare("SELECT stream_position FROM booking_messages WHERE id = 'partial-stream-message'").get().stream_position,
    1,
  );
  assert.deepEqual(
    sqlite
      .prepare(
        `SELECT participant_user_id, last_read_message_id
         FROM booking_message_read_cursors
         WHERE booking_id = ? ORDER BY participant_user_id`,
      )
      .all(booking.id)
      .map((row) => ({ ...row })),
    [
      { participant_user_id: "migration-couple", last_read_message_id: "partial-stream-message" },
      { participant_user_id: "migration-vendor-user", last_read_message_id: "partial-stream-message" },
    ],
  );
});

test("schema initialization resumes from an already-added v3 column through the latest migration", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE _sql_schema_migrations (
    id INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  sqlite.exec(STORE_SCHEMA_V1_SQL);
  sqlite.exec(STORE_SCHEMA_V2_MIGRATION_SQL);
  sqlite.exec(`ALTER TABLE bids ADD COLUMN exclusions_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(exclusions_json) AND json_type(exclusions_json) = 'array' AND json_array_length(exclusions_json) <= 30)`);

  const sql = {
    exec(statement, ...args) {
      const normalized = statement.trim().toUpperCase();
      if (args.length > 0 || normalized.startsWith("SELECT") || normalized.startsWith("PRAGMA")) {
        const rows = sqlite.prepare(statement).all(...args);
        return { toArray: () => rows };
      }
      sqlite.exec(statement);
      return { toArray: () => [] };
    },
  };
  let initialized;
  const ctx = {
    storage: {
      sql,
      async getAlarm() { return 1; },
      async setAlarm() {},
    },
    blockConcurrencyWhile(callback) {
      initialized = callback();
    },
  };

  new MelaivaStore(ctx, { ENVIRONMENT: "production" });
  await initialized;

  assert.equal(sqlite.prepare("SELECT MAX(id) AS version FROM _sql_schema_migrations").get().version, STORE_SCHEMA_VERSION);
  const columns = new Set(sqlite.prepare("PRAGMA table_info(bids)").all().map((column) => column.name));
  for (const name of [
    "exclusions_json",
    "gst_included",
    "gst_rate",
    "travel_policy",
    "travel_fee",
    "add_ons_json",
    "cancellation_terms",
    "delivery_plan",
    "structured_terms_provided",
  ]) {
    assert.ok(columns.has(name), `missing resumed bids.${name}`);
  }
  assert.ok(sqlite.prepare("PRAGMA table_info(bookings)").all().some((column) => column.name === "accepted_scope_json"));
  const messageColumns = new Set(sqlite.prepare("PRAGMA table_info(booking_messages)").all().map((column) => column.name));
  assert.ok(messageColumns.has("sender_user_id"));
  assert.ok(messageColumns.has("stream_position"));
});
