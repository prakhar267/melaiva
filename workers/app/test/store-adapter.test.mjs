import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  MAINTENANCE_INTERVAL_MS,
  MelaivaStore,
  STORE_SCHEMA_V1_SQL,
  STORE_SCHEMA_V2_MIGRATION_SQL,
  STORE_SCHEMA_V3_MIGRATION_SQL,
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

test("schema v3 resumes from an already-added column before recording the migration", async () => {
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
    assert.ok(columns.has(name), `missing resumed bids.${name}`);
  }
});
