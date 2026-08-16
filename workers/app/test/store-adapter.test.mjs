import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  MAINTENANCE_INTERVAL_MS,
  MelaivaStore,
  STORE_SCHEMA_V1_SQL,
  STORE_SCHEMA_V2_MIGRATION_SQL,
  STORE_SCHEMA_VERSION,
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

  assert.equal(sqlite.prepare("SELECT MAX(id) AS version FROM _sql_schema_migrations").get().version, STORE_SCHEMA_VERSION);
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
