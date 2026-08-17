import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { buildApp } from "../src/app.js";
import {
  STORE_SCHEMA_SQL,
  STORE_SCHEMA_V1_SQL,
  STORE_SCHEMA_V2_MIGRATION_SQL,
  STORE_SCHEMA_V3_MIGRATION_SQL,
  STORE_SCHEMA_V4_MIGRATION_SQL,
  STORE_SCHEMA_V5_MIGRATION_SQL,
  STORE_SCHEMA_V6_MIGRATION_SQL,
} from "../src/store.js";

const SESSION_SECRET = "booking-message-test-secret-with-at-least-thirty-two-characters";
const STORE_SCHEMA_V5_SQL = `${STORE_SCHEMA_V1_SQL}\n${STORE_SCHEMA_V2_MIGRATION_SQL}\n${STORE_SCHEMA_V3_MIGRATION_SQL}\n${STORE_SCHEMA_V4_MIGRATION_SQL}\n${STORE_SCHEMA_V5_MIGRATION_SQL}`;

class SqliteStatement {
  constructor(database, sql, args = []) {
    this.database = database;
    this.sql = sql;
    this.args = args;
  }

  bind(...args) {
    return new SqliteStatement(this.database, this.sql, args);
  }

  async first() {
    return this.database.sqlite.prepare(this.sql).get(...this.args) || null;
  }

  async all() {
    return { success: true, results: this.database.sqlite.prepare(this.sql).all(...this.args) };
  }

  async run() {
    return this.runSync();
  }

  runSync() {
    const result = this.database.sqlite.prepare(this.sql).run(...this.args);
    return { success: true, meta: { changes: Number(result.changes || 0) } };
  }
}

class SqliteD1 {
  constructor(schemaSql = STORE_SCHEMA_SQL) {
    this.sqlite = new DatabaseSync(":memory:");
    this.beforeBatch = null;
    this.sqlite.exec(`CREATE TABLE IF NOT EXISTS _sql_schema_migrations (
      id INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    this.sqlite.exec(schemaSql);
  }

  prepare(sql) {
    return new SqliteStatement(this, sql);
  }

  async batch(statements) {
    if (this.beforeBatch) {
      const beforeBatch = this.beforeBatch;
      this.beforeBatch = null;
      beforeBatch(this.sqlite);
    }
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((statement) => statement.runSync());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}

function requestJson(app, env, path, { body, cookie, headers = {}, method = body ? "POST" : "GET" } = {}) {
  return app.request(
    `https://api.example.test/api/v1${path}`,
    {
      method,
      headers: {
        ...(body ? { "content-type": "application/json" } : {}),
        ...(cookie ? { cookie } : {}),
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
    env,
  );
}

async function register(app, env, { name, email, verifier }) {
  const response = await requestJson(app, env, "/auth/register", {
    body: { name, email, passwordVerifier: verifier, passwordKdf: "pbkdf2-sha256-v1" },
  });
  assert.equal(response.status, 201, await response.clone().text());
  return {
    cookie: response.headers.get("set-cookie").split(";", 1)[0],
    user: (await response.json()).data.user,
  };
}

function seedBooking(db, { suffix, auctionId, ownerId, vendorUserId, vendorStatus }) {
  const vendorId = `vendor-${suffix}`;
  const bidId = `bid-${suffix}`;
  const bookingId = `booking-${suffix}`;
  db.sqlite
    .prepare(
      `INSERT INTO vendors
       (id, user_id, slug, business_name, status, category, categories_json, city,
        service_areas_json, description, min_budget, max_budget, currency, verified)
       VALUES (?, ?, ?, ?, ?, 'photography', '["photography"]', 'Jaipur', '["Jaipur"]',
               'A booking messaging integration-test vendor profile.', 100000, 500000, 'INR', 1)`,
    )
    .run(vendorId, vendorUserId, `studio-${suffix}`, `Studio ${suffix[0].toUpperCase()}${suffix.slice(1)}`, vendorStatus);
  db.sqlite
    .prepare(
      `INSERT INTO auctions
       (id, couple_user_id, title, event_type, event_date, city, guest_count, budget_min,
        budget_max, currency, categories_json, requirements, status, bidding_ends_at)
       VALUES (?, ?, ?, 'wedding', '2028-02-10', 'Jaipur', 120, 150000, 350000, 'INR',
               '["photography"]', 'Private coordination details for a confirmed booking.', 'awarded',
               '2027-12-01T12:00:00.000Z')`,
    )
    .run(auctionId, ownerId, `Messaging award ${suffix}`);
  db.sqlite
    .prepare(
      `INSERT INTO bids
       (id, auction_id, vendor_id, amount, currency, proposal, deliverables_json,
        exclusions_json, gst_included, gst_rate, travel_policy, travel_fee, add_ons_json,
        cancellation_terms, delivery_plan, structured_terms_provided, status)
       VALUES (?, ?, ?, 225000, 'INR',
               'A complete accepted proposal retained for booking messaging integration coverage.',
               '["Photography coverage","Edited gallery"]', '[]', 1, 18, 'included', 0, '[]',
               'Cancellation follows the written booking schedule agreed by both parties.',
               'The completed gallery will be delivered within twelve weeks.', 1, 'accepted')`,
    )
    .run(bidId, auctionId, vendorId);
  db.sqlite
    .prepare(
      `INSERT INTO bookings
       (id, auction_id, accepted_bid_id, couple_user_id, vendor_id, status, accepted_scope_json, awarded_at)
       VALUES (?, ?, ?, ?, ?, 'contract_pending', ?, ?)`,
    )
    .run(
      bookingId,
      auctionId,
      bidId,
      ownerId,
      vendorId,
      JSON.stringify({ request: { id: auctionId }, offer: { id: bidId }, vendor: { id: vendorId } }),
      suffix === "approved" ? "2027-10-01T00:00:00.000Z" : "2027-10-02T00:00:00.000Z",
    );
  return { auctionId, bidId, bookingId, vendorId };
}

async function createFixture({ schemaSql = STORE_SCHEMA_SQL } = {}) {
  const db = new SqliteD1(schemaSql);
  const env = {
    DB: db,
    SESSION_SECRET,
    PASSWORD_PEPPER: "booking-message-password-pepper-with-at-least-thirty-two-characters",
    ENVIRONMENT: "production",
    COOKIE_SECURE: "true",
  };
  const app = buildApp();
  const owner = await register(app, env, {
    name: "Booking Owner",
    email: "booking-owner@example.com",
    verifier: "A".repeat(43),
  });
  const approvedVendor = await register(app, env, {
    name: "Approved Vendor",
    email: "approved-vendor@example.com",
    verifier: "B".repeat(43),
  });
  const pausedVendor = await register(app, env, {
    name: "Paused Vendor",
    email: "paused-vendor@example.com",
    verifier: "C".repeat(43),
  });
  const outsider = await register(app, env, {
    name: "Unrelated User",
    email: "unrelated-user@example.com",
    verifier: "D".repeat(43),
  });
  const admin = await register(app, env, {
    name: "Read Only Admin",
    email: "read-only-admin@example.com",
    verifier: "E".repeat(43),
  });
  db.sqlite.prepare("UPDATE users SET role = 'vendor' WHERE id IN (?, ?)").run(approvedVendor.user.id, pausedVendor.user.id);
  db.sqlite.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(admin.user.id);
  const approved = seedBooking(db, {
    suffix: "approved",
    auctionId: "11111111-1111-4111-8111-111111111111",
    ownerId: owner.user.id,
    vendorUserId: approvedVendor.user.id,
    vendorStatus: "approved",
  });
  const paused = seedBooking(db, {
    suffix: "paused",
    auctionId: "22222222-2222-4222-8222-222222222222",
    ownerId: owner.user.id,
    vendorUserId: pausedVendor.user.id,
    vendorStatus: "suspended",
  });
  return { db, env, app, owner, approvedVendor, pausedVendor, outsider, admin, approved, paused };
}

function postMessage(fixture, actor, bookingId, key, body) {
  return requestJson(fixture.app, fixture.env, `/bookings/${bookingId}/messages`, {
    cookie: actor.cookie,
    headers: key ? { "idempotency-key": key } : {},
    body,
  });
}

function insertStoredMessage(db, { id, bookingId, senderUserId, body, createdAt }) {
  return db.sqlite
    .prepare(
      `INSERT INTO booking_messages
       (id, booking_id, sender_user_id, body, created_at, stream_position)
       VALUES (?, ?, ?, ?, ?,
               COALESCE(
                 (SELECT MAX(stream_position) + 1 FROM booking_messages WHERE booking_id = ?),
                 1
               ))`,
    )
    .run(id, bookingId, senderUserId, body, createdAt, bookingId);
}

async function responseErrorCode(response) {
  return (await response.json()).error.code;
}

test("booking conversations authorize only the owner, winning vendor, and read-only admin", async () => {
  const fixture = await createFixture();
  const { app, env, db, owner, approvedVendor, pausedVendor, outsider, admin, approved, paused } = fixture;

  const anonymous = await requestJson(app, env, `/bookings/${approved.bookingId}/messages`);
  assert.equal(anonymous.status, 401);
  const outsiderRead = await requestJson(app, env, `/bookings/${approved.bookingId}/messages`, { cookie: outsider.cookie });
  assert.equal(outsiderRead.status, 404);
  assert.equal(await responseErrorCode(outsiderRead), "conversation_not_found");

  for (const actor of [owner, approvedVendor]) {
    const response = await requestJson(app, env, `/bookings/${approved.bookingId}/messages`, { cookie: actor.cookie });
    assert.equal(response.status, 200, await response.clone().text());
    assert.deepEqual((await response.json()).meta.permissions, { canSend: true, pausedReason: null });
  }
  const adminRead = await requestJson(app, env, `/bookings/${approved.bookingId}/messages`, { cookie: admin.cookie });
  assert.equal(adminRead.status, 200, await adminRead.clone().text());
  assert.deepEqual((await adminRead.json()).meta.permissions, {
    canSend: false,
    pausedReason: "Administrator access is read-only.",
  });

  const ownerSend = await postMessage(fixture, owner, approved.bookingId, "owner-message-0001", {
    body: "Can we confirm the first coordination call?",
  });
  assert.equal(ownerSend.status, 201, await ownerSend.clone().text());
  const ownerPayload = await ownerSend.json();
  const ownerMessage = ownerPayload.data;
  assert.equal(ownerMessage.senderRole, "couple");
  assert.equal(ownerMessage.senderLabel, "Celebration host");
  assert.equal(ownerMessage.mine, true);
  assert.equal(ownerMessage.sequence, 1);
  assert.equal(ownerPayload.meta.messageCount, 1);

  const vendorSend = await postMessage(fixture, approvedVendor, approved.bookingId, "vendor-message-0001", {
    body: "Yes, Tuesday afternoon works for our team.",
  });
  assert.equal(vendorSend.status, 201, await vendorSend.clone().text());
  const vendorPayload = await vendorSend.json();
  const vendorMessage = vendorPayload.data;
  assert.equal(vendorMessage.senderRole, "vendor");
  assert.equal(vendorMessage.senderLabel, "Studio Approved");
  assert.equal(vendorMessage.mine, true);
  assert.equal(vendorMessage.sequence, 2);
  assert.equal(vendorPayload.meta.messageCount, 2);

  const ownerReplay = await postMessage(fixture, owner, approved.bookingId, "owner-message-0001", {
    body: "Can we confirm the first coordination call?",
  });
  assert.equal(ownerReplay.status, 201, await ownerReplay.clone().text());
  const ownerReplayPayload = await ownerReplay.json();
  assert.equal(ownerReplayPayload.meta.replayed, true);
  assert.equal(ownerReplayPayload.meta.messageCount, 2);
  assert.equal(ownerReplayPayload.data.id, ownerMessage.id);
  assert.equal(ownerReplayPayload.data.sequence, 1);

  const vendorView = await requestJson(app, env, `/bookings/${approved.bookingId}/messages`, { cookie: approvedVendor.cookie });
  const vendorViewData = (await vendorView.json()).data;
  assert.equal(vendorViewData.find((message) => message.id === ownerMessage.id).mine, false);
  assert.equal(vendorViewData.find((message) => message.id === vendorMessage.id).mine, true);
  const adminView = await requestJson(app, env, `/bookings/${approved.bookingId}/messages`, { cookie: admin.cookie });
  assert.equal(adminView.status, 200, await adminView.clone().text());
  assert.deepEqual(new Set((await adminView.json()).data.map((message) => message.id)), new Set([ownerMessage.id, vendorMessage.id]));

  const adminWrite = await postMessage(fixture, admin, approved.bookingId, "admin-message-0001", {
    body: "An administrator must not join this private conversation.",
  });
  assert.equal(adminWrite.status, 403, await adminWrite.clone().text());
  assert.equal(await responseErrorCode(adminWrite), "messaging_paused");
  const outsiderWrite = await postMessage(fixture, outsider, approved.bookingId, "outsider-message-0001", {
    body: "An unrelated account must not discover this booking.",
  });
  assert.equal(outsiderWrite.status, 404, await outsiderWrite.clone().text());
  assert.equal(await responseErrorCode(outsiderWrite), "conversation_not_found");
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM booking_messages WHERE booking_id = ?").get(approved.bookingId).count, 2);

  insertStoredMessage(db, {
    id: "message-before-suspension",
    bookingId: paused.bookingId,
    senderUserId: owner.user.id,
    body: "A retained message from before partner suspension.",
    createdAt: "2027-10-03T09:00:00.000Z",
  });
  const pausedVendorRead = await requestJson(app, env, `/bookings/${paused.bookingId}/messages`, { cookie: pausedVendor.cookie });
  assert.equal(pausedVendorRead.status, 200, await pausedVendorRead.clone().text());
  const pausedVendorPayload = await pausedVendorRead.json();
  assert.equal(pausedVendorPayload.meta.permissions.canSend, false);
  assert.match(pausedVendorPayload.meta.permissions.pausedReason, /not currently approved/i);
  assert.deepEqual(pausedVendorPayload.data.map((message) => message.id), ["message-before-suspension"]);
  const pausedVendorWrite = await postMessage(fixture, pausedVendor, paused.bookingId, "paused-message-0001", {
    body: "A suspended partner must not be able to send this.",
  });
  assert.equal(pausedVendorWrite.status, 403, await pausedVendorWrite.clone().text());
  assert.equal(await responseErrorCode(pausedVendorWrite), "messaging_paused");

  const ownerPausedRead = await requestJson(app, env, `/bookings/${paused.bookingId}/messages`, { cookie: owner.cookie });
  const ownerPausedPayload = await ownerPausedRead.json();
  assert.equal(ownerPausedPayload.meta.permissions.canSend, false);
  assert.match(ownerPausedPayload.meta.permissions.pausedReason, /not currently approved/i);
  const ownerPausedWrite = await postMessage(fixture, owner, paused.bookingId, "owner-paused-message-0001", {
    body: "The booking owner must not bypass a paused conversation.",
  });
  assert.equal(ownerPausedWrite.status, 403, await ownerPausedWrite.clone().text());
  assert.equal(await responseErrorCode(ownerPausedWrite), "messaging_paused");
  assert.deepEqual(ownerPausedPayload.data.map((message) => message.id), ["message-before-suspension"]);
});

test("message writes validate input, replay atomically, isolate scopes, and enforce rate limits", async () => {
  const fixture = await createFixture();
  const { app, env, db, owner, approvedVendor, approved, paused } = fixture;

  const missingKey = await postMessage(fixture, owner, approved.bookingId, null, { body: "A valid body without a replay key." });
  assert.equal(missingKey.status, 400);
  assert.equal(await responseErrorCode(missingKey), "idempotency_key_required");
  const shortBody = await postMessage(fixture, owner, approved.bookingId, "invalid-short-0001", { body: "x" });
  assert.equal(shortBody.status, 422);
  assert.equal(await responseErrorCode(shortBody), "validation_failed");
  const oversizedBody = await postMessage(fixture, owner, approved.bookingId, "invalid-long-0001", { body: "x".repeat(2_001) });
  assert.equal(oversizedBody.status, 422);
  assert.equal(await responseErrorCode(oversizedBody), "validation_failed");
  const spoofedSender = await postMessage(fixture, owner, approved.bookingId, "invalid-spoof-0001", {
    body: "A sender identity must only come from the authenticated session.",
    senderRole: "admin",
  });
  assert.equal(spoofedSender.status, 422);
  assert.equal(await responseErrorCode(spoofedSender), "validation_failed");
  const bidiControl = await postMessage(fixture, owner, approved.bookingId, "invalid-bidi-0001", {
    body: "Confirm this hidden\u202Edirection change",
  });
  assert.equal(bidiControl.status, 422);
  assert.equal(await responseErrorCode(bidiControl), "validation_failed");

  const replayKey = "message-replay-0001";
  const original = await postMessage(fixture, owner, approved.bookingId, replayKey, {
    body: "  Please share the final arrival window.  ",
  });
  assert.equal(original.status, 201, await original.clone().text());
  const originalData = (await original.json()).data;
  assert.equal(originalData.body, "Please share the final arrival window.");
  assert.equal(originalData.sequence, 1);
  const replay = await postMessage(fixture, owner, approved.bookingId, replayKey, {
    body: "Please share the final arrival window.",
  });
  assert.equal(replay.status, 201, await replay.clone().text());
  const replayPayload = await replay.json();
  assert.equal(replayPayload.meta.replayed, true);
  assert.equal(replayPayload.meta.messageCount, 1);
  assert.equal(replayPayload.data.id, originalData.id);
  assert.equal(replayPayload.data.sequence, originalData.sequence);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM booking_messages WHERE id = ?").get(originalData.id).count, 1);
  assert.equal(db.sqlite.prepare("SELECT stream_position FROM booking_messages WHERE id = ?").get(originalData.id).stream_position, 1);
  assert.equal(
    db.sqlite.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action = 'booking.message_sent' AND entity_id = ?").get(originalData.id).count,
    1,
  );

  const conflict = await postMessage(fixture, owner, approved.bookingId, replayKey, {
    body: "This changed payload must not create a second message.",
  });
  assert.equal(conflict.status, 409, await conflict.clone().text());
  assert.equal(await responseErrorCode(conflict), "idempotency_conflict");

  db.sqlite
    .prepare("UPDATE idempotency_keys SET expires_at = '2000-01-01T00:00:00.000Z' WHERE scope = ? AND user_id = ?")
    .run(`booking-message:${approved.bookingId}`, owner.user.id);
  const reusedAfterExpiry = await postMessage(fixture, owner, approved.bookingId, replayKey, {
    body: "An expired key can be safely reused without waiting for hourly maintenance.",
  });
  assert.equal(reusedAfterExpiry.status, 201, await reusedAfterExpiry.clone().text());
  assert.notEqual((await reusedAfterExpiry.json()).data.id, originalData.id);
  assert.equal(
    db.sqlite.prepare("SELECT COUNT(*) AS count FROM idempotency_keys WHERE scope = ? AND user_id = ?").get(
      `booking-message:${approved.bookingId}`,
      owner.user.id,
    ).count,
    1,
  );

  const otherUserSameKey = await postMessage(fixture, approvedVendor, approved.bookingId, replayKey, {
    body: "The winning vendor can independently use the same client key.",
  });
  assert.equal(otherUserSameKey.status, 201, await otherUserSameKey.clone().text());
  db.sqlite.prepare("UPDATE vendors SET status = 'approved' WHERE id = ?").run(paused.vendorId);
  const otherBookingSameKey = await postMessage(fixture, owner, paused.bookingId, replayKey, {
    body: "The same owner key is isolated to this other booking thread.",
  });
  assert.equal(otherBookingSameKey.status, 201, await otherBookingSameKey.clone().text());

  const messageCountBeforeFailure = db.sqlite.prepare("SELECT COUNT(*) AS count FROM booking_messages").get().count;
  const idempotencyCountBeforeFailure = db.sqlite.prepare("SELECT COUNT(*) AS count FROM idempotency_keys").get().count;
  db.sqlite.exec(`CREATE TRIGGER fail_message_audit
    BEFORE INSERT ON audit_events
    WHEN NEW.action = 'booking.message_sent'
    BEGIN SELECT RAISE(ABORT, 'forced message audit failure'); END`);
  const originalConsoleError = console.error;
  let failedWrite;
  try {
    console.error = () => {};
    failedWrite = await postMessage(fixture, owner, approved.bookingId, "message-atomic-0001", {
      body: "This write should roll back with its audit failure.",
    });
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(failedWrite.status, 500);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM booking_messages").get().count, messageCountBeforeFailure);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM idempotency_keys").get().count, idempotencyCountBeforeFailure);
  db.sqlite.exec("DROP TRIGGER fail_message_audit");
  const successfulRetry = await postMessage(fixture, owner, approved.bookingId, "message-atomic-0001", {
    body: "This write should roll back with its audit failure.",
  });
  assert.equal(successfulRetry.status, 201, await successfulRetry.clone().text());
  assert.deepEqual(
    db.sqlite
      .prepare("SELECT stream_position FROM booking_messages WHERE booking_id = ? ORDER BY stream_position")
      .all(approved.bookingId)
      .map((row) => row.stream_position),
    [1, 2, 3, 4],
  );

  const nowSeconds = Math.floor(Date.now() / 1_000);
  const bucket = Math.floor(nowSeconds / 3_600) * 3_600;
  const rateLimitKey = createHash("sha256")
    .update(`booking-message:${owner.user.id}:unknown`)
    .digest("base64url");
  db.sqlite
    .prepare(
      `INSERT INTO rate_limits (key, bucket_start, count, expires_at)
       VALUES (?, ?, 120, ?)
       ON CONFLICT(key, bucket_start) DO UPDATE SET count = 120, expires_at = excluded.expires_at`,
    )
    .run(rateLimitKey, bucket, bucket + 7_200);
  const countBeforeLimit = db.sqlite.prepare("SELECT COUNT(*) AS count FROM booking_messages").get().count;
  const limited = await postMessage(fixture, owner, approved.bookingId, "message-limited-0001", {
    body: "This message is over the per-user hourly limit.",
  });
  assert.equal(limited.status, 429, await limited.clone().text());
  assert.equal(await responseErrorCode(limited), "rate_limit_exceeded");
  assert.ok(Number(limited.headers.get("retry-after")) > 0);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM booking_messages").get().count, countBeforeLimit);
});

test("message write rechecks current approval atomically before storing any private content", async () => {
  const fixture = await createFixture();
  const { db, owner, approved } = fixture;
  const messageCount = db.sqlite.prepare("SELECT COUNT(*) AS count FROM booking_messages").get().count;
  const idempotencyCount = db.sqlite.prepare("SELECT COUNT(*) AS count FROM idempotency_keys").get().count;
  const auditCount = db.sqlite
    .prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action = 'booking.message_sent'")
    .get().count;

  db.beforeBatch = (sqlite) => {
    sqlite.prepare("UPDATE vendors SET status = 'suspended' WHERE id = ?").run(approved.vendorId);
  };
  const response = await postMessage(fixture, owner, approved.bookingId, "moderation-race-0001", {
    body: "This must not be stored after the partner is suspended.",
  });

  assert.equal(response.status, 409, await response.clone().text());
  assert.equal(await responseErrorCode(response), "message_not_sent");
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM booking_messages").get().count, messageCount);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM idempotency_keys").get().count, idempotencyCount);
  assert.equal(
    db.sqlite.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action = 'booking.message_sent'").get().count,
    auditCount,
  );
});

test("message paging is deterministic and rejects cursors from other booking threads", async () => {
  const fixture = await createFixture();
  const { app, env, db, owner, approvedVendor, admin, approved, paused } = fixture;
  const messages = [
    ["message-01", owner.user.id, "First coordination note", "2027-10-03T10:00:00.000Z"],
    ["message-02", approvedVendor.user.id, "Second coordination note", "2027-10-03T10:01:00.000Z"],
    ["message-03", owner.user.id, "Third coordination note", "2027-10-03T10:02:00.000Z"],
    ["message-04", approvedVendor.user.id, "Fourth coordination note", "2027-10-03T10:02:00.000Z"],
    ["message-05", owner.user.id, "Fifth coordination note", "2027-10-03T10:03:00.000Z"],
  ];
  for (const [id, senderId, body, createdAt] of messages) {
    insertStoredMessage(db, { id, bookingId: approved.bookingId, senderUserId: senderId, body, createdAt });
  }
  insertStoredMessage(db, {
    id: "paused-cursor",
    bookingId: paused.bookingId,
    senderUserId: owner.user.id,
    body: "A cursor in another private thread",
    createdAt: "2027-10-03T11:00:00.000Z",
  });

  const first = await requestJson(app, env, `/bookings/${approved.bookingId}/messages?limit=2`, { cookie: owner.cookie });
  assert.equal(first.status, 200, await first.clone().text());
  const firstPayload = await first.json();
  assert.deepEqual(firstPayload.data.map((message) => message.id), ["message-04", "message-05"]);
  assert.deepEqual(firstPayload.data.map((message) => message.mine), [false, true]);
  assert.equal(firstPayload.meta.hasMore, true);
  assert.equal(firstPayload.meta.nextCursor, "message-04");
  assert.equal(firstPayload.meta.pollCursor, "message-05");
  assert.equal(firstPayload.meta.messageCount, 5);

  const second = await requestJson(
    app,
    env,
    `/bookings/${approved.bookingId}/messages?limit=2&cursor=${firstPayload.meta.nextCursor}`,
    { cookie: owner.cookie },
  );
  const secondPayload = await second.json();
  assert.deepEqual(secondPayload.data.map((message) => message.id), ["message-02", "message-03"]);
  assert.equal(secondPayload.meta.hasMore, true);
  assert.equal(secondPayload.meta.nextCursor, "message-02");

  const third = await requestJson(
    app,
    env,
    `/bookings/${approved.bookingId}/messages?limit=2&cursor=${secondPayload.meta.nextCursor}`,
    { cookie: owner.cookie },
  );
  const thirdPayload = await third.json();
  assert.deepEqual(thirdPayload.data.map((message) => message.id), ["message-01"]);
  assert.equal(thirdPayload.meta.hasMore, false);
  assert.equal(thirdPayload.meta.nextCursor, null);

  const vendorView = await requestJson(app, env, `/bookings/${approved.bookingId}/messages?limit=2`, {
    cookie: approvedVendor.cookie,
  });
  assert.deepEqual((await vendorView.json()).data.map((message) => message.mine), [true, false]);
  const adminView = await requestJson(app, env, `/bookings/${approved.bookingId}/messages?limit=2`, { cookie: admin.cookie });
  assert.deepEqual((await adminView.json()).meta.permissions, {
    canSend: false,
    pausedReason: "Administrator access is read-only.",
  });

  for (const [bookingId, cursor] of [
    [approved.bookingId, "paused-cursor"],
    [paused.bookingId, "message-04"],
    [approved.bookingId, "not/a/safe/cursor"],
  ]) {
    const isolated = await requestJson(app, env, `/bookings/${bookingId}/messages?cursor=${encodeURIComponent(cursor)}`, {
      cookie: owner.cookie,
    });
    assert.equal(isolated.status, 422, await isolated.clone().text());
    assert.equal(await responseErrorCode(isolated), "invalid_cursor");
  }

  const mixedDirections = await requestJson(
    app,
    env,
    `/bookings/${approved.bookingId}/messages?cursor=message-04&after=message-04`,
    { cookie: owner.cookie },
  );
  assert.equal(mixedDirections.status, 422, await mixedDirections.clone().text());
  assert.equal(await responseErrorCode(mixedDirections), "invalid_pagination");

  const bookings = await requestJson(app, env, "/bookings", { cookie: owner.cookie });
  const bookingData = (await bookings.json()).data;
  assert.equal(bookingData.find((booking) => booking.id === approved.bookingId).messageCount, 5);
  assert.equal(bookingData.find((booking) => booking.id === paused.bookingId).messageCount, 1);
  const award = await requestJson(app, env, `/auctions/${approved.auctionId}/award`, { cookie: owner.cookie });
  assert.equal(award.status, 200, await award.clone().text());
  assert.equal((await award.json()).data.messageCount, 5);
});

test("forward message polling is gap-free across tied and backdated timestamps and refreshes permissions", async () => {
  const fixture = await createFixture();
  const { app, env, db, owner, outsider, approved, paused } = fixture;

  const empty = await requestJson(app, env, `/bookings/${approved.bookingId}/messages?limit=2`, { cookie: owner.cookie });
  assert.equal(empty.status, 200, await empty.clone().text());
  assert.deepEqual((await empty.clone().json()).data, []);
  const emptyMeta = (await empty.json()).meta;
  assert.equal(emptyMeta.pollCursor, "0");
  assert.equal(emptyMeta.messageCount, 0);

  const inserted = [
    ["poll-z", "Cursor anchor", "2027-10-03T10:00:00.000Z"],
    ["poll-a", "Later insert with the same timestamp and a lower identifier", "2027-10-03T10:00:00.000Z"],
    ["poll-backdated", "Later insert carrying an earlier display timestamp", "2027-09-01T10:00:00.000Z"],
    ["poll-03", "Third message in the forward burst", "2027-10-03T10:01:00.000Z"],
    ["poll-04", "Fourth message in the forward burst", "2027-10-03T10:02:00.000Z"],
    ["poll-05", "Fifth message in the forward burst", "2027-10-03T10:03:00.000Z"],
  ];
  insertStoredMessage(db, {
    id: inserted[0][0],
    bookingId: approved.bookingId,
    senderUserId: owner.user.id,
    body: inserted[0][1],
    createdAt: inserted[0][2],
  });

  const fromStart = await requestJson(app, env, `/bookings/${approved.bookingId}/messages?after=0&limit=2`, {
    cookie: owner.cookie,
  });
  assert.equal(fromStart.status, 200, await fromStart.clone().text());
  const fromStartPayload = await fromStart.json();
  assert.deepEqual(fromStartPayload.data.map((message) => message.id), ["poll-z"]);
  assert.equal(fromStartPayload.meta.pollCursor, "poll-z");
  assert.equal(fromStartPayload.meta.messageCount, 1);

  for (const [id, body, createdAt] of inserted.slice(1)) {
    insertStoredMessage(db, {
      id,
      bookingId: approved.bookingId,
      senderUserId: owner.user.id,
      body,
      createdAt,
    });
  }

  let pollCursor = fromStartPayload.meta.pollCursor;
  const received = [];
  const pageSizes = [];
  do {
    const response = await requestJson(
      app,
      env,
      `/bookings/${approved.bookingId}/messages?after=${pollCursor}&limit=2`,
      { cookie: owner.cookie },
    );
    assert.equal(response.status, 200, await response.clone().text());
    const payload = await response.json();
    received.push(...payload.data.map((message) => message.id));
    pageSizes.push(payload.data.length);
    assert.equal(payload.meta.messageCount, inserted.length);
    assert.equal(payload.meta.nextCursor, null);
    assert.deepEqual(
      payload.data.map((message) => message.sequence),
      payload.data.map((_, index) => received.length - payload.data.length + index + 2),
    );
    pollCursor = payload.meta.pollCursor;
    if (!payload.meta.hasMore) break;
  } while (pageSizes.length < 10);

  assert.deepEqual(received, inserted.slice(1).map(([id]) => id));
  assert.deepEqual(pageSizes, [2, 2, 1]);
  assert.equal(pollCursor, "poll-05");

  for (const [bookingId, after] of [
    [approved.bookingId, "missing-forward-cursor"],
    [paused.bookingId, "poll-z"],
    [approved.bookingId, "not/a/safe/cursor"],
  ]) {
    const isolated = await requestJson(app, env, `/bookings/${bookingId}/messages?after=${encodeURIComponent(after)}`, {
      cookie: owner.cookie,
    });
    assert.equal(isolated.status, 422, await isolated.clone().text());
    assert.equal(await responseErrorCode(isolated), "invalid_cursor");
  }
  const outsiderPoll = await requestJson(app, env, `/bookings/${approved.bookingId}/messages?after=${pollCursor}`, {
    cookie: outsider.cookie,
  });
  assert.equal(outsiderPoll.status, 404);
  assert.equal(await responseErrorCode(outsiderPoll), "conversation_not_found");

  db.sqlite.prepare("UPDATE vendors SET status = 'suspended' WHERE id = ?").run(approved.vendorId);
  const pausedPoll = await requestJson(app, env, `/bookings/${approved.bookingId}/messages?after=${pollCursor}`, {
    cookie: owner.cookie,
  });
  assert.equal(pausedPoll.status, 200, await pausedPoll.clone().text());
  const pausedPayload = await pausedPoll.json();
  assert.deepEqual(pausedPayload.data, []);
  assert.equal(pausedPayload.meta.pollCursor, pollCursor);
  assert.equal(pausedPayload.meta.messageCount, inserted.length);
  assert.equal(pausedPayload.meta.permissions.canSend, false);
  assert.match(pausedPayload.meta.permissions.pausedReason, /not currently approved/i);
});

test("message writes and replays remain atomic during a schema-v5 rolling window", async () => {
  const fixture = await createFixture({ schemaSql: STORE_SCHEMA_V5_SQL });
  const { db, owner, approvedVendor, approved, paused } = fixture;
  db.sqlite
    .prepare(
      `INSERT INTO booking_messages (id, booking_id, sender_user_id, body, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      "other-booking-legacy-message",
      paused.bookingId,
      owner.user.id,
      "An interleaved row must not create a gap in another booking's sequence.",
      "2027-10-03T09:00:00.000Z",
    );

  const first = await postMessage(fixture, owner, approved.bookingId, "v5-owner-message-0001", {
    body: "Can a newly deployed Worker still write to the previous schema?",
  });
  assert.equal(first.status, 201, await first.clone().text());
  const firstPayload = await first.json();
  assert.equal(firstPayload.data.sequence, 1);
  assert.equal(firstPayload.meta.messageCount, 1);

  const second = await postMessage(fixture, approvedVendor, approved.bookingId, "v5-vendor-message-0001", {
    body: "Yes, and its response remains exactly ordered and counted.",
  });
  assert.equal(second.status, 201, await second.clone().text());
  const secondPayload = await second.json();
  assert.equal(secondPayload.data.sequence, 2);
  assert.equal(secondPayload.meta.messageCount, 2);

  const replay = await postMessage(fixture, owner, approved.bookingId, "v5-owner-message-0001", {
    body: "Can a newly deployed Worker still write to the previous schema?",
  });
  assert.equal(replay.status, 201, await replay.clone().text());
  const replayPayload = await replay.json();
  assert.equal(replayPayload.meta.replayed, true);
  assert.equal(replayPayload.meta.messageCount, 2);
  assert.equal(replayPayload.data.id, firstPayload.data.id);
  assert.equal(replayPayload.data.sequence, 1);
  assert.equal(
    db.sqlite.prepare("SELECT COUNT(*) AS count FROM booking_messages WHERE booking_id = ?").get(approved.bookingId).count,
    2,
  );
  assert.equal(
    db.sqlite
      .prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action = 'booking.message_sent' AND entity_id = ?")
      .get(firstPayload.data.id).count,
    1,
  );
  assert.equal(
    db.sqlite.prepare("PRAGMA table_info(booking_messages)").all().some((column) => column.name === "stream_position"),
    false,
  );

  db.sqlite.exec(STORE_SCHEMA_V6_MIGRATION_SQL);
  const migratedReplay = await postMessage(fixture, owner, approved.bookingId, "v5-owner-message-0001", {
    body: "Can a newly deployed Worker still write to the previous schema?",
  });
  assert.equal(migratedReplay.status, 201, await migratedReplay.clone().text());
  const migratedReplayPayload = await migratedReplay.json();
  assert.equal(migratedReplayPayload.meta.replayed, true);
  assert.equal(migratedReplayPayload.meta.messageCount, 2);
  assert.equal(migratedReplayPayload.data.id, firstPayload.data.id);
  assert.equal(migratedReplayPayload.data.sequence, 1);
});

test("a schema-v5 polling cursor cannot skip a same-timestamp lower id after migration", async () => {
  const fixture = await createFixture({ schemaSql: STORE_SCHEMA_V5_SQL });
  const { app, env, db, owner, approved, paused } = fixture;
  const legacyInsert = db.sqlite.prepare(
    `INSERT INTO booking_messages (id, booking_id, sender_user_id, body, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  legacyInsert.run(
    "legacy-poll-z",
    approved.bookingId,
    owner.user.id,
    "A message written before the stream-position migration.",
    "2027-10-03T10:00:00.000Z",
  );

  const initial = await requestJson(app, env, `/bookings/${approved.bookingId}/messages`, { cookie: owner.cookie });
  assert.equal(initial.status, 200, await initial.clone().text());
  const initialPayload = await initial.json();
  assert.deepEqual(initialPayload.data.map((message) => message.id), ["legacy-poll-z"]);
  assert.deepEqual(initialPayload.data.map((message) => message.sequence), [1]);
  assert.equal(initialPayload.meta.pollCursor, "legacy-poll-z");
  assert.equal(initialPayload.meta.messageCount, 1);

  for (let index = 0; index < 100; index += 1) {
    legacyInsert.run(
      `interleaved-${String(index).padStart(3, "0")}`,
      paused.bookingId,
      owner.user.id,
      "A different booking must not leak its global rowid into this conversation's sequence.",
      `2027-10-03T10:00:${String(index % 60).padStart(2, "0")}.000Z`,
    );
  }
  legacyInsert.run(
    "legacy-poll-a",
    approved.bookingId,
    owner.user.id,
    "A later legacy insert with the same timestamp and a lower identifier.",
    "2027-10-03T10:00:00.000Z",
  );
  assert.equal(
    db.sqlite.prepare("SELECT rowid AS position FROM booking_messages WHERE id = 'legacy-poll-a'").get().position,
    102,
  );
  const legacyFromStart = await requestJson(app, env, `/bookings/${approved.bookingId}/messages?after=0`, {
    cookie: owner.cookie,
  });
  assert.equal(legacyFromStart.status, 200, await legacyFromStart.clone().text());
  const legacyFromStartPayload = await legacyFromStart.json();
  assert.deepEqual(legacyFromStartPayload.data.map((message) => message.id), ["legacy-poll-z", "legacy-poll-a"]);
  assert.deepEqual(legacyFromStartPayload.data.map((message) => message.sequence), [1, 2]);
  assert.equal(legacyFromStartPayload.meta.pollCursor, "legacy-poll-a");
  assert.equal(legacyFromStartPayload.meta.messageCount, 2);

  db.sqlite.exec(STORE_SCHEMA_V6_MIGRATION_SQL);
  assert.deepEqual(
    db.sqlite
      .prepare("SELECT id, stream_position FROM booking_messages WHERE booking_id = ? ORDER BY stream_position")
      .all(approved.bookingId)
      .map((row) => ({ ...row })),
    [
      { id: "legacy-poll-z", stream_position: 1 },
      { id: "legacy-poll-a", stream_position: 2 },
    ],
  );
  const refresh = await requestJson(
    app,
    env,
    `/bookings/${approved.bookingId}/messages?after=${initialPayload.meta.pollCursor}`,
    { cookie: owner.cookie },
  );
  assert.equal(refresh.status, 200, await refresh.clone().text());
  const refreshPayload = await refresh.json();
  assert.deepEqual(refreshPayload.data.map((message) => message.id), ["legacy-poll-a"]);
  assert.deepEqual(refreshPayload.data.map((message) => message.sequence), [2]);
  assert.equal(refreshPayload.meta.pollCursor, "legacy-poll-a");
  assert.equal(refreshPayload.meta.messageCount, 2);
});
