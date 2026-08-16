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
    preferredVendorId: profileOne.id,
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
  assert.deepEqual(Object.keys(auction.preferredVendor).sort(), [
    "businessName",
    "category",
    "city",
    "id",
    "inviteStatus",
    "slug",
    "verified",
  ]);
  assert.deepEqual(auction.preferredVendor, {
    id: profileOne.id,
    slug: profileOne.slug,
    businessName: profileOne.businessName,
    category: "photography",
    city: "Jaipur",
    verified: true,
    inviteStatus: "invited",
  });

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
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM auction_vendor_invites").get().count, 1);

  const conflictingReplay = await requestJson(app, env, "/auctions", {
    cookie: couple.cookie,
    headers: idempotencyHeaders,
    body: { ...auctionBody, title: "A changed Jaipur wedding brief" },
  });
  assert.equal(conflictingReplay.status, 409, await conflictingReplay.clone().text());
  assert.equal((await conflictingReplay.json()).error.code, "idempotency_conflict");
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM auctions").get().count, 1);

  const missingCreateKey = await requestJson(app, env, "/auctions", {
    cookie: couple.cookie,
    body: { ...auctionBody, title: "A request without a replay guard" },
  });
  assert.equal(missingCreateKey.status, 400, await missingCreateKey.clone().text());
  assert.equal((await missingCreateKey.json()).error.code, "idempotency_key_required");
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM auctions").get().count, 1);

  const genericAuctionBody = structuredClone(auctionBody);
  delete genericAuctionBody.preferredVendorId;
  genericAuctionBody.title = "A newer generic Jaipur photography brief";
  const genericCreated = await requestJson(app, env, "/auctions", {
    cookie: couple.cookie,
    headers: { "idempotency-key": "auction-create-generic-0001" },
    body: genericAuctionBody,
  });
  assert.equal(genericCreated.status, 201, await genericCreated.clone().text());
  const genericAuction = (await genericCreated.json()).data;
  assert.equal(genericAuction.preferredVendor, null);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM auctions").get().count, 2);

  const ownerList = await requestJson(app, env, "/auctions", { cookie: couple.cookie });
  assert.equal(ownerList.status, 200, await ownerList.clone().text());
  const ownerAuctions = (await ownerList.json()).data;
  assert.equal(ownerAuctions.find((item) => item.id === auction.id).preferredVendor.id, profileOne.id);
  assert.equal(ownerAuctions.find((item) => item.id === genericAuction.id).preferredVendor, null);

  const anonymous = await requestJson(app, env, `/auctions/${auction.id}`);
  assert.equal(anonymous.status, 401);
  assert.doesNotMatch(await anonymous.text(), /family preferences/);

  const unrelated = await requestJson(app, env, `/auctions/${auction.id}`, { cookie: otherCouple.cookie });
  assert.equal(unrelated.status, 404);
  assert.doesNotMatch(await unrelated.text(), /family preferences/);

  const ownerDetail = await requestJson(app, env, `/auctions/${auction.id}`, { cookie: couple.cookie });
  assert.equal(ownerDetail.status, 200, await ownerDetail.clone().text());
  assert.equal((await ownerDetail.json()).data.preferredVendor.id, profileOne.id);

  const vendorBrowse = await requestJson(app, env, `/auctions/${auction.id}`, { cookie: vendorOne.cookie });
  assert.equal(vendorBrowse.status, 200, await vendorBrowse.clone().text());
  assert.equal((await vendorBrowse.json()).data.directInvite, true);

  const invitedOpportunities = await requestJson(app, env, "/auctions", { cookie: vendorOne.cookie });
  assert.equal(invitedOpportunities.status, 200, await invitedOpportunities.clone().text());
  const invitedOpportunityData = (await invitedOpportunities.json()).data;
  assert.equal(invitedOpportunityData[0].id, auction.id);
  assert.equal(invitedOpportunityData[0].directInvite, true);
  assert.equal(invitedOpportunityData[0].directInviteStatus, "invited");
  assert.equal(invitedOpportunityData.find((item) => item.id === genericAuction.id).directInvite, false);

  const genericVendorOpportunities = await requestJson(app, env, "/auctions", { cookie: vendorTwo.cookie });
  assert.equal(genericVendorOpportunities.status, 200, await genericVendorOpportunities.clone().text());
  const genericVendorData = (await genericVendorOpportunities.json()).data;
  const genericViewOfInvitedAuction = genericVendorData.find((item) => item.id === auction.id);
  assert.equal(genericViewOfInvitedAuction.directInvite, false);
  assert.equal(genericViewOfInvitedAuction.directInviteStatus, null);
  assert.equal("preferredVendor" in genericViewOfInvitedAuction, false);
  assert.doesNotMatch(JSON.stringify(genericVendorData), new RegExp(profileOne.id));
  assert.doesNotMatch(JSON.stringify(genericVendorData), /Vendor One/);
  const genericVendorDetail = await requestJson(app, env, `/auctions/${auction.id}`, { cookie: vendorTwo.cookie });
  assert.equal(genericVendorDetail.status, 200, await genericVendorDetail.clone().text());
  const genericVendorDetailData = (await genericVendorDetail.json()).data;
  assert.equal(genericVendorDetailData.directInvite, false);
  assert.equal(genericVendorDetailData.directInviteStatus, null);
  assert.doesNotMatch(JSON.stringify(genericVendorDetailData), new RegExp(profileOne.id));

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

  assert.equal(
    db.sqlite.prepare("SELECT status FROM auction_vendor_invites WHERE auction_id = ?").get(auction.id).status,
    "responded",
  );
  const respondedOpportunity = await requestJson(app, env, `/auctions/${auction.id}`, { cookie: vendorOne.cookie });
  assert.equal((await respondedOpportunity.json()).data.directInviteStatus, "responded");

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

  const missingAcceptKey = await requestJson(app, env, `/auctions/${auction.id}/bids/${bidIds[0]}`, {
    method: "PATCH",
    cookie: couple.cookie,
    body: { action: "accept" },
  });
  assert.equal(missingAcceptKey.status, 400, await missingAcceptKey.clone().text());
  assert.equal((await missingAcceptKey.json()).error.code, "idempotency_key_required");
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM bids WHERE status = 'accepted'").get().count, 0);

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

  const acceptPayloadConflict = await requestJson(app, env, `/auctions/${auction.id}/bids/${acceptedBidId}`, {
    method: "PATCH",
    cookie: couple.cookie,
    headers: { "idempotency-key": `bid-accept-test-000${acceptedIndex + 1}` },
    body: { action: "shortlist" },
  });
  assert.equal(acceptPayloadConflict.status, 409, await acceptPayloadConflict.clone().text());
  assert.equal((await acceptPayloadConflict.json()).error.code, "idempotency_conflict");

  const retriedBidResponse = await requestJson(app, env, `/auctions/${genericAuction.id}/bids`, {
    cookie: vendorOne.cookie,
    body: {
      amount: 285000,
      currency: "INR",
      proposal: "A complete photography proposal for retry testing with coverage, editing, delivery, and clear terms.",
      deliverables: ["Two photographers", "Edited photographs"],
    },
  });
  assert.equal(retriedBidResponse.status, 201, await retriedBidResponse.clone().text());
  const retriedBidId = (await retriedBidResponse.json()).data.id;
  const genericClosed = await requestJson(app, env, `/auctions/${genericAuction.id}/status`, {
    method: "PATCH",
    cookie: couple.cookie,
    body: { status: "closed" },
  });
  assert.equal(genericClosed.status, 200, await genericClosed.clone().text());

  const retryAccept = () => requestJson(app, env, `/auctions/${genericAuction.id}/bids/${retriedBidId}`, {
    method: "PATCH",
    cookie: couple.cookie,
    headers: { "idempotency-key": "same-bid-accept-retry-0001" },
    body: { action: "accept" },
  });
  const retryResponses = await Promise.all([retryAccept(), retryAccept()]);
  assert.deepEqual(retryResponses.map((response) => response.status), [200, 200]);
  const retryPayloads = await Promise.all(retryResponses.map((response) => response.json()));
  assert.equal(retryPayloads.filter((payload) => payload.meta?.replayed).length, 1);
  assert.equal(
    db.sqlite.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action = 'bid.accepted' AND entity_id = ?").get(retriedBidId).count,
    1,
  );
  assert.equal(
    db.sqlite.prepare("SELECT COUNT(*) AS count FROM idempotency_keys WHERE scope = ?").get(`bid-accept:${genericAuction.id}:${retriedBidId}`).count,
    1,
  );

  assert.throws(
    () => db.sqlite.prepare("UPDATE bids SET status = 'accepted' WHERE auction_id = ? AND status = 'rejected'").run(auction.id),
    /UNIQUE constraint failed/,
  );
});

test("preferred-vendor validation and moderation changes are atomic against selection races", async () => {
  const db = new SqliteD1(STORE_SCHEMA_SQL);
  const env = {
    DB: db,
    SESSION_SECRET,
    PASSWORD_PEPPER: "integration-password-pepper-with-at-least-thirty-two-characters",
    ENVIRONMENT: "production",
    COOKIE_SECURE: "true",
  };
  const app = buildApp();

  const couple = await register(app, env, { name: "Nila Kapoor", email: "nila@example.com", verifier: "G".repeat(43) });
  const invitedVendor = await register(app, env, {
    name: "Invited Vendor Owner",
    email: "invited-vendor@example.com",
    verifier: "H".repeat(43),
  });
  const mismatchedVendor = await register(app, env, {
    name: "Mismatched Vendor Owner",
    email: "mismatched-target@example.com",
    verifier: "I".repeat(43),
  });
  const admin = await register(app, env, { name: "Second Admin", email: "admin-two@example.com", verifier: "J".repeat(43) });
  db.sqlite.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(admin.user.id);

  const invitedProfile = await onboardVendor(app, env, invitedVendor.cookie, "Invited");
  const mismatchedProfile = await onboardVendor(app, env, mismatchedVendor.cookie, "TargetMismatch", {
    category: "catering",
    city: "Bengaluru",
    serviceAreas: ["Bengaluru"],
  });
  for (const profile of [invitedProfile, mismatchedProfile]) {
    const approval = await requestJson(app, env, `/admin/vendors/${profile.id}`, {
      method: "PATCH",
      cookie: admin.cookie,
      body: { status: "approved" },
    });
    assert.equal(approval.status, 200, await approval.clone().text());
  }

  const eventDate = new Date(Date.now() + 300 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const biddingEndsAt = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString().replace("Z", "+00:00");
  const auctionBody = (title, preferredVendorId) => ({
    title,
    eventType: "wedding",
    eventDate,
    city: "Jaipur",
    guestCount: 180,
    budgetMin: 1200000,
    budgetMax: 1800000,
    currency: "INR",
    categories: ["photography"],
    requirements: "A detailed wedding photography request with coverage, delivery, and family privacy requirements.",
    biddingEndsAt,
    preferredVendorId,
  });
  const assertNoAuctionArtifacts = () => {
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM auctions").get().count, 0);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM auction_vendor_invites").get().count, 0);
    assert.equal(
      db.sqlite.prepare("SELECT COUNT(*) AS count FROM idempotency_keys WHERE scope = 'auction-create'").get().count,
      0,
    );
    assert.equal(
      db.sqlite.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action = 'auction.created'").get().count,
      0,
    );
  };

  const unknownTarget = await requestJson(app, env, "/auctions", {
    cookie: couple.cookie,
    headers: { "idempotency-key": "unknown-preferred-target-0001" },
    body: auctionBody("Unknown preferred-vendor request", "00000000-0000-4000-8000-000000000000"),
  });
  assert.equal(unknownTarget.status, 422, await unknownTarget.clone().text());
  assert.equal((await unknownTarget.json()).error.code, "preferred_vendor_unavailable");
  assertNoAuctionArtifacts();

  const mismatchedTarget = await requestJson(app, env, "/auctions", {
    cookie: couple.cookie,
    headers: { "idempotency-key": "mismatched-preferred-target-0001" },
    body: {
      ...auctionBody("Category-mismatched preferred-vendor request", mismatchedProfile.id),
      city: "Bengaluru",
    },
  });
  assert.equal(mismatchedTarget.status, 422, await mismatchedTarget.clone().text());
  assert.equal((await mismatchedTarget.json()).error.code, "preferred_vendor_unavailable");
  assertNoAuctionArtifacts();

  const cityMismatchedTarget = await requestJson(app, env, "/auctions", {
    cookie: couple.cookie,
    headers: { "idempotency-key": "city-mismatched-preferred-0001" },
    body: {
      ...auctionBody("City-mismatched preferred-vendor request", mismatchedProfile.id),
      categories: ["catering"],
    },
  });
  assert.equal(cityMismatchedTarget.status, 422, await cityMismatchedTarget.clone().text());
  assert.equal((await cityMismatchedTarget.json()).error.code, "preferred_vendor_unavailable");
  assertNoAuctionArtifacts();

  const firstCreated = await requestJson(app, env, "/auctions", {
    cookie: couple.cookie,
    headers: { "idempotency-key": "moderation-race-auction-0001" },
    body: auctionBody("Invited vendor offer request one", invitedProfile.id),
  });
  assert.equal(firstCreated.status, 201, await firstCreated.clone().text());
  const firstAuction = (await firstCreated.json()).data;
  const secondCreated = await requestJson(app, env, "/auctions", {
    cookie: couple.cookie,
    headers: { "idempotency-key": "moderation-race-auction-0002" },
    body: auctionBody("Invited vendor offer request two", invitedProfile.id),
  });
  assert.equal(secondCreated.status, 201, await secondCreated.clone().text());
  const secondAuction = (await secondCreated.json()).data;
  assert.equal(
    db.sqlite
      .prepare("SELECT COUNT(*) AS count FROM idempotency_keys WHERE scope = 'auction-create' AND request_hash IS NOT NULL")
      .get().count,
    2,
  );

  const bid = await requestJson(app, env, `/auctions/${firstAuction.id}/bids`, {
    cookie: invitedVendor.cookie,
    body: {
      amount: 240000,
      currency: "INR",
      proposal: "A complete invited photography offer with two photographers, editing, delivery, and transparent commercial terms.",
      deliverables: ["Photography team", "Edited gallery"],
    },
  });
  assert.equal(bid.status, 201, await bid.clone().text());
  const bidId = (await bid.json()).data.id;
  const closed = await requestJson(app, env, `/auctions/${firstAuction.id}/status`, {
    method: "PATCH",
    cookie: couple.cookie,
    body: { status: "closed" },
  });
  assert.equal(closed.status, 200, await closed.clone().text());

  const suspended = await requestJson(app, env, `/admin/vendors/${invitedProfile.id}`, {
    method: "PATCH",
    cookie: admin.cookie,
    body: { status: "suspended", note: "Adversarial moderation race" },
  });
  assert.equal(suspended.status, 200, await suspended.clone().text());
  assert.equal(db.sqlite.prepare("SELECT status FROM bids WHERE id = ?").get(bidId).status, "withdrawn");
  assert.equal(
    db.sqlite.prepare("SELECT status FROM auction_vendor_invites WHERE auction_id = ?").get(firstAuction.id).status,
    "unavailable",
  );
  assert.equal(
    db.sqlite.prepare("SELECT status FROM auction_vendor_invites WHERE auction_id = ?").get(secondAuction.id).status,
    "unavailable",
  );

  const acceptAfterSuspension = await requestJson(app, env, `/auctions/${firstAuction.id}/bids/${bidId}`, {
    method: "PATCH",
    cookie: couple.cookie,
    headers: { "idempotency-key": "accept-after-suspension-0001" },
    body: { action: "accept" },
  });
  assert.equal(acceptAfterSuspension.status, 409, await acceptAfterSuspension.clone().text());
  assert.equal((await acceptAfterSuspension.json()).error.code, "vendor_not_approved");
  assert.equal(db.sqlite.prepare("SELECT status FROM auctions WHERE id = ?").get(firstAuction.id).status, "closed");
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM bids WHERE status = 'accepted'").get().count, 0);

  const suspendedTarget = await requestJson(app, env, "/auctions", {
    cookie: couple.cookie,
    headers: { "idempotency-key": "suspended-preferred-target-0001" },
    body: auctionBody("Suspended preferred-vendor request", invitedProfile.id),
  });
  assert.equal(suspendedTarget.status, 422, await suspendedTarget.clone().text());
  assert.equal((await suspendedTarget.json()).error.code, "preferred_vendor_unavailable");
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM auctions").get().count, 2);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM auction_vendor_invites").get().count, 2);
  assert.equal(
    db.sqlite.prepare("SELECT COUNT(*) AS count FROM idempotency_keys WHERE scope = 'auction-create'").get().count,
    2,
  );
  assert.equal(
    db.sqlite.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action = 'auction.created'").get().count,
    2,
  );
});
