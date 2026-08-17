import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  MAINTENANCE_INTERVAL_MS,
  MelaivaStore,
  STORE_SCHEMA_V1_SQL,
  STORE_SCHEMA_V2_MIGRATION_SQL,
  STORE_SCHEMA_V3_MIGRATION_SQL,
  STORE_SCHEMA_V4_MIGRATION_SQL,
  STORE_SCHEMA_V5_MIGRATION_SQL,
  STORE_SCHEMA_V6_FINALIZE_SQL,
  STORE_SCHEMA_V6_MIGRATION_SQL,
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

test("Durable Object storage errors preserve only safe unique-constraint classification", async () => {
  const store = Object.create(MelaivaStore.prototype);
  store.sql = {
    exec() {
      throw new Error("UNIQUE constraint failed: users.email");
    },
  };
  const response = await store.fetch(new Request("https://melaiva-store.internal/sql", {
    method: "POST",
    body: JSON.stringify({ operation: "statement", statement: { mode: "run", sql: "INSERT", args: [] } }),
  }));
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.deepEqual(body, { error: "storage_error", code: "unique_constraint" });
  assert.doesNotMatch(JSON.stringify(body), /users\.email|UNIQUE constraint/i);

  const database = createDurableDatabase({
    getByName() {
      return {
        async fetch() {
          return new Response(JSON.stringify(body), {
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

test("schema v6 initialization resumes after the stream column was already added", async () => {
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

  assert.equal(sqlite.prepare("SELECT MAX(id) AS version FROM _sql_schema_migrations").get().version, 6);
  assert.equal(
    sqlite.prepare("SELECT stream_position FROM booking_messages WHERE id = 'partial-stream-message'").get().stream_position,
    1,
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
