import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { buildApp } from "../src/app.js";
import { STORE_SCHEMA_SQL } from "../src/store.js";

const SESSION_SECRET = "integration-session-secret-with-at-least-thirty-two-characters";

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
  constructor(schema) {
    this.sqlite = new DatabaseSync(":memory:");
    this.sqlite.exec(`CREATE TABLE IF NOT EXISTS _sql_schema_migrations (
      id INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    this.sqlite.exec(schema);
  }

  prepare(sql) {
    return new SqliteStatement(this, sql);
  }

  async batch(statements) {
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

async function onboardVendor(
  app,
  env,
  cookie,
  suffix,
  { category = "photography", city = "Jaipur", serviceAreas = ["Jaipur", "Udaipur"] } = {},
) {
  const response = await requestJson(app, env, "/vendors/onboarding", {
    cookie,
    body: {
      businessName: `Vendor ${suffix}`,
      legalName: `Vendor ${suffix} Private Limited`,
      category,
      categories: [category],
      city,
      serviceAreas,
      description: "A detailed, development-test vendor profile with enough information for a couple to evaluate the proposed service safely.",
      minBudget: 100000,
      maxBudget: 500000,
      currency: "INR",
      phone: "+919999999999",
      websiteUrl: `https://vendor-${suffix.toLowerCase()}.example`,
    },
  });
  assert.equal(response.status, 201, await response.clone().text());
  return (await response.json()).data;
}

test("marketplace authorization and state transitions remain private, atomic, and idempotent", async () => {
  const db = new SqliteD1(STORE_SCHEMA_SQL);
  const env = {
    DB: db,
    SESSION_SECRET,
    PASSWORD_PEPPER: "integration-password-pepper-with-at-least-thirty-two-characters",
    ENVIRONMENT: "production",
    COOKIE_SECURE: "true",
  };
  const app = buildApp();

  const couple = await register(app, env, { name: "Mira Shah", email: "mira@example.com", verifier: "A".repeat(43) });
  const otherCouple = await register(app, env, { name: "Aarav Shah", email: "aarav@example.com", verifier: "B".repeat(43) });
  const vendorOne = await register(app, env, { name: "Vendor Owner One", email: "vendor1@example.com", verifier: "C".repeat(43) });
  const vendorTwo = await register(app, env, { name: "Vendor Owner Two", email: "vendor2@example.com", verifier: "D".repeat(43) });
  const mismatchedVendor = await register(app, env, {
    name: "Vendor Owner Mismatch",
    email: "vendor-mismatch@example.com",
    verifier: "F".repeat(43),
  });
  const admin = await register(app, env, { name: "Melaiva Admin", email: "admin@example.com", verifier: "E".repeat(43) });
  db.sqlite.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(admin.user.id);

  const profileOne = await onboardVendor(app, env, vendorOne.cookie, "One");
  const profileTwo = await onboardVendor(app, env, vendorTwo.cookie, "Two");
  const mismatchProfile = await onboardVendor(app, env, mismatchedVendor.cookie, "Mismatch", {
    category: "catering",
    city: "Bengaluru",
    serviceAreas: ["Bengaluru", "Mysuru"],
  });

  const pendingBrowse = await requestJson(app, env, "/auctions", { cookie: vendorOne.cookie });
  assert.equal(pendingBrowse.status, 403);

  for (const profile of [profileOne, profileTwo, mismatchProfile]) {
    const approval = await requestJson(app, env, `/admin/vendors/${profile.id}`, {
      method: "PATCH",
      cookie: admin.cookie,
      body: { status: "approved", note: "Integration-test approval" },
    });
    assert.equal(approval.status, 200, await approval.clone().text());
  }

  const event = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  const biddingEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const auctionBody = {
    title: "A private Jaipur wedding brief",
    eventType: "wedding",
    eventDate: event.toISOString().slice(0, 10),
    city: "Jaipur",
    guestCount: 240,
    budgetMin: 1800000,
    budgetMax: 2400000,
    currency: "INR",
    categories: ["photography"],
    requirements: "Private ceremony logistics and family preferences that must never be exposed to anonymous visitors.",
    biddingEndsAt: biddingEnd.toISOString().replace("Z", "+00:00"),
  };
  const idempotencyHeaders = { "idempotency-key": "auction-create-test-0001" };
  const created = await requestJson(app, env, "/auctions", {
    cookie: couple.cookie,
    headers: idempotencyHeaders,
    body: auctionBody,
  });
  assert.equal(created.status, 201, await created.clone().text());
  const auction = (await created.json()).data;
  assert.match(auction.biddingEndsAt, /Z$/);

  const replay = await requestJson(app, env, "/auctions", {
    cookie: couple.cookie,
    headers: idempotencyHeaders,
    body: auctionBody,
  });
  assert.equal(replay.status, 201);
  const replayPayload = await replay.json();
  assert.equal(replayPayload.data.id, auction.id);
  assert.equal(replayPayload.meta.replayed, true);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM auctions").get().count, 1);

  const anonymous = await requestJson(app, env, `/auctions/${auction.id}`);
  assert.equal(anonymous.status, 401);
  assert.doesNotMatch(await anonymous.text(), /family preferences/);

  const unrelated = await requestJson(app, env, `/auctions/${auction.id}`, { cookie: otherCouple.cookie });
  assert.equal(unrelated.status, 404);
  assert.doesNotMatch(await unrelated.text(), /family preferences/);

  const vendorBrowse = await requestJson(app, env, `/auctions/${auction.id}`, { cookie: vendorOne.cookie });
  assert.equal(vendorBrowse.status, 200, await vendorBrowse.clone().text());

  const mismatchedList = await requestJson(app, env, "/auctions", { cookie: mismatchedVendor.cookie });
  assert.equal(mismatchedList.status, 200, await mismatchedList.clone().text());
  assert.deepEqual((await mismatchedList.json()).data, []);
  const mismatchedDetail = await requestJson(app, env, `/auctions/${auction.id}`, { cookie: mismatchedVendor.cookie });
  assert.equal(mismatchedDetail.status, 404);
  const mismatchedBid = await requestJson(app, env, `/auctions/${auction.id}/bids`, {
    cookie: mismatchedVendor.cookie,
    body: {
      amount: 300000,
      currency: "INR",
      proposal: "A deliberately mismatched catering proposal that must never enter a photography-only Jaipur request.",
      deliverables: ["Catering service"],
    },
  });
  assert.equal(mismatchedBid.status, 404);

  const bidIds = [];
  for (const [index, vendor] of [vendorOne, vendorTwo].entries()) {
    const bid = await requestJson(app, env, `/auctions/${auction.id}/bids`, {
      cookie: vendor.cookie,
      body: {
        amount: 275000 + index * 25000,
        currency: "INR",
        proposal: `A complete photography proposal number ${index + 1} with coverage, editing, delivery, and clear commercial terms.`,
        deliverables: ["Two photographers", "Edited photographs", "Wedding film"],
        validUntil: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      },
    });
    assert.equal(bid.status, 201, await bid.clone().text());
    bidIds.push((await bid.json()).data.id);
  }

  const sealedBids = await requestJson(app, env, `/auctions/${auction.id}/bids`, { cookie: couple.cookie });
  assert.equal(sealedBids.status, 409);
  const sealedPayload = await sealedBids.json();
  assert.equal(sealedPayload.error.code, "bids_sealed");
  assert.doesNotMatch(JSON.stringify(sealedPayload), /Vendor One|Vendor Two|275000|300000/);

  const closed = await requestJson(app, env, `/auctions/${auction.id}/status`, {
    method: "PATCH",
    cookie: couple.cookie,
    body: { status: "closed" },
  });
  assert.equal(closed.status, 200, await closed.clone().text());

  const ownerBids = await requestJson(app, env, `/auctions/${auction.id}/bids`, { cookie: couple.cookie });
  assert.equal(ownerBids.status, 200);
  assert.equal((await ownerBids.json()).data.length, 2);

  const decisions = await Promise.all(
    bidIds.map((bidId, index) =>
      requestJson(app, env, `/auctions/${auction.id}/bids/${bidId}`, {
        method: "PATCH",
        cookie: couple.cookie,
        headers: { "idempotency-key": `bid-accept-test-000${index + 1}` },
        body: { action: "accept" },
      }),
    ),
  );
  assert.deepEqual(decisions.map((response) => response.status).sort(), [200, 409]);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM bids WHERE status = 'accepted'").get().count, 1);
  assert.equal(db.sqlite.prepare("SELECT status FROM auctions WHERE id = ?").get(auction.id).status, "awarded");

  const acceptedBidId = db.sqlite.prepare("SELECT id FROM bids WHERE status = 'accepted'").get().id;
  const acceptedIndex = bidIds.indexOf(acceptedBidId);
  const acceptReplay = await requestJson(app, env, `/auctions/${auction.id}/bids/${acceptedBidId}`, {
    method: "PATCH",
    cookie: couple.cookie,
    headers: { "idempotency-key": `bid-accept-test-000${acceptedIndex + 1}` },
    body: { action: "accept" },
  });
  assert.equal(acceptReplay.status, 200, await acceptReplay.clone().text());
  assert.equal((await acceptReplay.json()).meta.replayed, true);

  assert.throws(
    () => db.sqlite.prepare("UPDATE bids SET status = 'accepted' WHERE auction_id = ? AND status = 'rejected'").run(auction.id),
    /UNIQUE constraint failed/,
  );
});
