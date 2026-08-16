import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { buildApp } from "../src/app.js";
import { STORE_SCHEMA_SQL } from "../src/store.js";

const SESSION_SECRET = "integration-session-secret-with-at-least-thirty-two-characters";

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function canonicalRequestHash(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("base64url");
}

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
    await this.database.beforeFirst?.(this.sql, this.args);
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
    this.beforeFirst = null;
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

function normalizedOfferTerms(overrides = {}) {
  return {
    exclusions: ["Raw footage and physical albums are excluded unless selected as add-ons."],
    gstIncluded: false,
    gstRate: 18,
    travelPolicy: "fixed_fee",
    travelFee: 25000,
    addOns: [
      { name: "Same-day edit", amount: 45000 },
      { name: "Premium album", amount: 30000 },
    ],
    cancellationTerms: "The booking fee is non-refundable; later cancellations follow the written milestone schedule.",
    deliveryPlan: "Preview photographs arrive within seven days and the edited gallery and film within twelve weeks.",
    ...overrides,
  };
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
  const legacyBidResponse = await requestJson(app, env, `/auctions/${genericAuction.id}/bids`, {
    cookie: vendorTwo.cookie,
    body: {
      amount: 265000,
      currency: "INR",
      proposal: "A legacy photography proposal retained without inventing normalized commercial disclosures.",
      deliverables: ["Legacy photography coverage", "Legacy edited gallery"],
    },
  });
  assert.equal(legacyBidResponse.status, 201, await legacyBidResponse.clone().text());
  const legacyBidData = (await legacyBidResponse.json()).data;
  const legacyBidId = legacyBidData.id;
  assert.equal(legacyBidData.structuredTermsProvided, false);
  assert.deepEqual(legacyBidData.exclusions, []);
  assert.equal(legacyBidData.gstIncluded, false);
  assert.equal(legacyBidData.gstRate, 0);
  assert.equal(legacyBidData.travelPolicy, "not_applicable");
  assert.equal(legacyBidData.travelFee, 0);
  assert.deepEqual(legacyBidData.addOns, []);
  assert.equal(legacyBidData.cancellationTerms, "");
  assert.equal(legacyBidData.deliveryPlan, "");
  assert.equal(db.sqlite.prepare("SELECT structured_terms_provided FROM bids WHERE id = ?").get(legacyBidId).structured_terms_provided, 0);

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
      ...normalizedOfferTerms(),
    },
  });
  assert.equal(mismatchedBid.status, 404);

  const validBidBase = {
    amount: 275000,
    currency: "INR",
    proposal: "A complete photography proposal with coverage, editing, delivery, and clear commercial terms.",
    deliverables: ["Two photographers", "Edited photographs", "Wedding film"],
    ...normalizedOfferTerms(),
  };
  const oversizedBid = await requestJson(app, env, `/auctions/${auction.id}/bids`, {
    cookie: vendorOne.cookie,
    body: { ...validBidBase, deliveryPlan: "oversized-private-plan-".repeat(12000) },
  });
  assert.equal(oversizedBid.status, 413, await oversizedBid.clone().text());
  assert.equal((await oversizedBid.json()).error.code, "payload_too_large");
  const invalidBidCases = [
    {
      name: "partial normalized fields",
      body: {
        amount: validBidBase.amount,
        currency: validBidBase.currency,
        proposal: validBidBase.proposal,
        deliverables: validBidBase.deliverables,
        exclusions: [],
      },
    },
    {
      name: "fixed travel fee omitted",
      body: { ...validBidBase, travelPolicy: "fixed_fee", travelFee: undefined },
    },
    {
      name: "fee attached to included travel",
      body: { ...validBidBase, travelPolicy: "included", travelFee: 1 },
    },
    {
      name: "too many add-ons",
      body: {
        ...validBidBase,
        addOns: Array.from({ length: 21 }, (_, index) => ({ name: `Extra ${index}`, amount: 1000 })),
      },
    },
    {
      name: "duplicate add-on names",
      body: { ...validBidBase, addOns: [{ name: "Album", amount: 1000 }, { name: " album ", amount: 2000 }] },
    },
    {
      name: "combined add-on amount too large",
      body: { ...validBidBase, addOns: [{ name: "First package", amount: 600000000 }, { name: "Second package", amount: 600000000 }] },
    },
    {
      name: "oversized exclusion",
      body: { ...validBidBase, exclusions: ["x".repeat(201)] },
    },
    {
      name: "oversized cancellation terms",
      body: { ...validBidBase, cancellationTerms: "x".repeat(3001) },
    },
    {
      name: "fractional GST rate",
      body: { ...validBidBase, gstRate: 28.5 },
    },
    {
      name: "GST rate above the supported maximum",
      body: { ...validBidBase, gstRate: 29 },
    },
  ];
  for (const invalidCase of invalidBidCases) {
    const invalidBid = await requestJson(app, env, `/auctions/${auction.id}/bids`, {
      cookie: vendorOne.cookie,
      body: invalidCase.body,
    });
    assert.equal(invalidBid.status, 422, `${invalidCase.name}: ${await invalidBid.clone().text()}`);
    assert.equal((await invalidBid.json()).error.code, "validation_failed", invalidCase.name);
  }
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM bids WHERE auction_id = ?").get(auction.id).count, 0);

  const tooShortValidity = await requestJson(app, env, `/auctions/${auction.id}/bids`, {
    cookie: vendorOne.cookie,
    body: {
      ...validBidBase,
      validUntil: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    },
  });
  assert.equal(tooShortValidity.status, 422, await tooShortValidity.clone().text());
  assert.equal((await tooShortValidity.json()).error.code, "invalid_valid_until");
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM bids WHERE auction_id = ?").get(auction.id).count, 0);

  const indiaValidityDate = new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const indiaBoundaryCreated = await requestJson(app, env, "/auctions", {
    cookie: couple.cookie,
    headers: { "idempotency-key": "auction-create-india-validity-0001" },
    body: {
      ...genericAuctionBody,
      title: "An India validity boundary photography brief",
      biddingEndsAt: `${indiaValidityDate}T20:00:00.000Z`,
    },
  });
  assert.equal(indiaBoundaryCreated.status, 201, await indiaBoundaryCreated.clone().text());
  const indiaBoundaryAuction = (await indiaBoundaryCreated.json()).data;
  const indiaBoundaryBid = await requestJson(app, env, `/auctions/${indiaBoundaryAuction.id}/bids`, {
    cookie: vendorOne.cookie,
    body: { ...validBidBase, validUntil: indiaValidityDate },
  });
  assert.equal(indiaBoundaryBid.status, 422, await indiaBoundaryBid.clone().text());
  assert.equal((await indiaBoundaryBid.json()).error.code, "invalid_valid_until");
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM bids WHERE auction_id = ?").get(indiaBoundaryAuction.id).count, 0);

  const multilingualCreated = await requestJson(app, env, "/auctions", {
    cookie: couple.cookie,
    headers: { "idempotency-key": "auction-create-multilingual-0001" },
    body: { ...genericAuctionBody, title: "A multilingual Jaipur photography brief" },
  });
  assert.equal(multilingualCreated.status, 201, await multilingualCreated.clone().text());
  const multilingualAuction = (await multilingualCreated.json()).data;
  const multilingualBidBody = {
    amount: 325000,
    currency: "INR",
    proposal: "प".repeat(8000),
    deliverables: Array.from({ length: 30 }, () => "प".repeat(200)),
    exclusions: Array.from({ length: 30 }, () => "भ".repeat(200)),
    gstIncluded: false,
    gstRate: 18,
    travelPolicy: "fixed_fee",
    travelFee: 25000,
    addOns: Array.from({ length: 20 }, (_, index) => ({
      name: `विकल्प-${index}-`.padEnd(120, "प"),
      amount: 10000,
    })),
    cancellationTerms: "क".repeat(3000),
    deliveryPlan: "य".repeat(3000),
    validUntil: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  };
  const multilingualBidBytes = Buffer.byteLength(JSON.stringify(multilingualBidBody), "utf8");
  assert.ok(multilingualBidBytes > 32 * 1024);
  assert.ok(multilingualBidBytes < 256 * 1024);
  const multilingualBid = await requestJson(app, env, `/auctions/${multilingualAuction.id}/bids`, {
    cookie: vendorOne.cookie,
    body: multilingualBidBody,
  });
  assert.equal(multilingualBid.status, 201, await multilingualBid.clone().text());
  assert.equal((await multilingualBid.json()).data.structuredTermsProvided, true);

  const bidIds = [];
  for (const [index, vendor] of [vendorOne, vendorTwo].entries()) {
    const normalizedTerms = index === 0
      ? normalizedOfferTerms()
      : normalizedOfferTerms({
          exclusions: [],
          gstIncluded: true,
          travelPolicy: "included",
          travelFee: undefined,
          addOns: [],
          cancellationTerms: "Cancellation is permitted under the signed schedule with notice-based milestone charges.",
          deliveryPlan: "Edited photographs arrive within ten weeks, followed by the final wedding film within twelve weeks.",
        });
    const bid = await requestJson(app, env, `/auctions/${auction.id}/bids`, {
      cookie: vendor.cookie,
      body: {
        amount: 275000 + index * 25000,
        currency: "INR",
        proposal: `A complete photography proposal number ${index + 1} with coverage, editing, delivery, and clear commercial terms.`,
        deliverables: ["Two photographers", "Edited photographs", "Wedding film"],
        ...normalizedTerms,
        validUntil: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      },
    });
    assert.equal(bid.status, 201, await bid.clone().text());
    const bidData = (await bid.json()).data;
    assert.deepEqual(
      {
        exclusions: bidData.exclusions,
        gstIncluded: bidData.gstIncluded,
        gstRate: bidData.gstRate,
        travelPolicy: bidData.travelPolicy,
        travelFee: bidData.travelFee,
        addOns: bidData.addOns,
        cancellationTerms: bidData.cancellationTerms,
        deliveryPlan: bidData.deliveryPlan,
      },
      {
        ...normalizedTerms,
        travelFee: normalizedTerms.travelFee || 0,
      },
    );
    assert.equal(bidData.structuredTermsProvided, true);
    assert.equal(db.sqlite.prepare("SELECT structured_terms_provided FROM bids WHERE id = ?").get(bidData.id).structured_terms_provided, 1);
    bidIds.push(bidData.id);
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
  assert.doesNotMatch(
    JSON.stringify(sealedPayload),
    /Vendor One|Vendor Two|275000|300000|Raw footage|Same-day edit|non-refundable|twelve weeks/,
  );

  const unrelatedSealedBids = await requestJson(app, env, `/auctions/${auction.id}/bids`, { cookie: otherCouple.cookie });
  assert.equal(unrelatedSealedBids.status, 404);
  assert.doesNotMatch(
    await unrelatedSealedBids.text(),
    /Raw footage|Same-day edit|non-refundable|twelve weeks/,
  );

  const unrelatedClose = await requestJson(app, env, `/auctions/${auction.id}/status`, {
    method: "PATCH",
    cookie: otherCouple.cookie,
    body: { status: "closed" },
  });
  assert.equal(unrelatedClose.status, 404);
  assert.equal(db.sqlite.prepare("SELECT status FROM auctions WHERE id = ?").get(auction.id).status, "open");

  db.sqlite.exec(`CREATE TRIGGER fail_status_audit
    BEFORE INSERT ON audit_events
    WHEN NEW.action = 'auction.status_changed'
    BEGIN SELECT RAISE(ABORT, 'forced audit failure'); END`);
  const originalConsoleError = console.error;
  let failedClose;
  try {
    console.error = () => {};
    failedClose = await requestJson(app, env, `/auctions/${auction.id}/status`, {
      method: "PATCH",
      cookie: couple.cookie,
      body: { status: "closed" },
    });
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(failedClose.status, 500);
  assert.equal((await failedClose.json()).error.code, "internal_error");
  assert.equal(db.sqlite.prepare("SELECT status FROM auctions WHERE id = ?").get(auction.id).status, "open");
  assert.equal(
    db.sqlite.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action = 'auction.status_changed' AND entity_id = ?").get(auction.id).count,
    0,
  );
  db.sqlite.exec("DROP TRIGGER fail_status_audit");

  let initialStatusReads = 0;
  let staleStatusRereads = 0;
  let releaseInitialReads;
  const bothInitialReads = new Promise((resolve) => { releaseInitialReads = resolve; });
  db.beforeFirst = async (sql, args) => {
    if (sql === "SELECT id, couple_user_id, status FROM auctions WHERE id = ? LIMIT 1" && args[0] === auction.id) {
      initialStatusReads += 1;
      if (initialStatusReads === 2) releaseInitialReads();
      await bothInitialReads;
    }
    if (sql === "SELECT status FROM auctions WHERE id = ? LIMIT 1" && args[0] === auction.id) staleStatusRereads += 1;
  };
  let closeResponses;
  try {
    closeResponses = await Promise.all(
      ["first", "concurrent"].map(() => requestJson(app, env, `/auctions/${auction.id}/status`, {
        method: "PATCH",
        cookie: couple.cookie,
        body: { status: "closed" },
      })),
    );
  } finally {
    db.beforeFirst = null;
  }
  assert.equal(initialStatusReads, 2);
  assert.equal(staleStatusRereads, 1);
  for (const response of closeResponses) assert.equal(response.status, 200, await response.clone().text());
  const closePayloads = await Promise.all(closeResponses.map((response) => response.json()));
  assert.ok(closePayloads.every((payload) => payload.data.status === "closed" && payload.data.bidCount === 2));
  assert.equal(closePayloads.filter((payload) => payload.meta?.unchanged).length, 1);
  assert.equal(
    db.sqlite.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action = 'auction.status_changed' AND entity_id = ?").get(auction.id).count,
    1,
  );

  const ownerBids = await requestJson(app, env, `/auctions/${auction.id}/bids`, { cookie: couple.cookie });
  assert.equal(ownerBids.status, 200);
  const ownerBidData = (await ownerBids.json()).data;
  assert.equal(ownerBidData.length, 2);
  const fixedTravelOffer = ownerBidData.find((item) => item.travelPolicy === "fixed_fee");
  assert.equal(fixedTravelOffer.structuredTermsProvided, true);
  assert.deepEqual(fixedTravelOffer.exclusions, normalizedOfferTerms().exclusions);
  assert.equal(fixedTravelOffer.gstIncluded, false);
  assert.equal(fixedTravelOffer.gstRate, 18);
  assert.equal(fixedTravelOffer.travelFee, 25000);
  assert.deepEqual(fixedTravelOffer.addOns, normalizedOfferTerms().addOns);
  assert.equal(fixedTravelOffer.cancellationTerms, normalizedOfferTerms().cancellationTerms);
  assert.equal(fixedTravelOffer.deliveryPlan, normalizedOfferTerms().deliveryPlan);

  const ownOfferHistory = await requestJson(app, env, "/bids/mine", { cookie: vendorOne.cookie });
  assert.equal(ownOfferHistory.status, 200, await ownOfferHistory.clone().text());
  const ownOffer = (await ownOfferHistory.json()).data.find((item) => item.id === bidIds[0]);
  assert.deepEqual(ownOffer.exclusions, normalizedOfferTerms().exclusions);
  assert.deepEqual(ownOffer.addOns, normalizedOfferTerms().addOns);
  const otherVendorHistory = await requestJson(app, env, "/bids/mine", { cookie: vendorTwo.cookie });
  assert.equal(otherVendorHistory.status, 200, await otherVendorHistory.clone().text());
  assert.doesNotMatch(JSON.stringify((await otherVendorHistory.json()).data), /Raw footage|Same-day edit|Premium album/);

  const firstShortlist = await requestJson(app, env, `/auctions/${auction.id}/bids/${bidIds[0]}`, {
    method: "PATCH",
    cookie: couple.cookie,
    body: { action: "shortlist" },
  });
  assert.equal(firstShortlist.status, 200, await firstShortlist.clone().text());
  const repeatedShortlist = await requestJson(app, env, `/auctions/${auction.id}/bids/${bidIds[0]}`, {
    method: "PATCH",
    cookie: couple.cookie,
    body: { action: "shortlist" },
  });
  assert.equal(repeatedShortlist.status, 200, await repeatedShortlist.clone().text());
  const repeatedShortlistPayload = await repeatedShortlist.json();
  assert.equal(repeatedShortlistPayload.data.status, "shortlisted");
  assert.equal(repeatedShortlistPayload.meta.unchanged, true);
  assert.equal(
    db.sqlite.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action = 'bid.shortlisted' AND entity_id = ?").get(bidIds[0]).count,
    1,
  );

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
  const decisionPayloads = await Promise.all(decisions.map((response) => response.json()));
  const successfulDecision = decisionPayloads.find((payload) => payload.data?.status === "accepted");
  assert.match(successfulDecision.data.awardId, /^[0-9a-f-]{36}$/i);
  assert.equal(successfulDecision.data.awardStatus, "contract_pending");
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM bids WHERE status = 'accepted'").get().count, 1);
  assert.equal(db.sqlite.prepare("SELECT status FROM auctions WHERE id = ?").get(auction.id).status, "awarded");
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM bookings WHERE auction_id = ?").get(auction.id).count, 1);

  const acceptedBidId = db.sqlite.prepare("SELECT id FROM bids WHERE status = 'accepted'").get().id;
  const acceptedIndex = bidIds.indexOf(acceptedBidId);
  const acceptedOfferBeforeAward = ownerBidData.find((offer) => offer.id === acceptedBidId);
  const winningVendor = [vendorOne, vendorTwo][acceptedIndex];
  const losingVendor = [vendorOne, vendorTwo][acceptedIndex === 0 ? 1 : 0];
  const ownerAward = await requestJson(app, env, `/auctions/${auction.id}/award`, { cookie: couple.cookie });
  assert.equal(ownerAward.status, 200, await ownerAward.clone().text());
  const ownerAwardData = (await ownerAward.json()).data;
  assert.equal(ownerAwardData.id, successfulDecision.data.awardId);
  assert.equal(ownerAwardData.acceptedBidId, acceptedBidId);
  assert.equal(ownerAwardData.status, "contract_pending");
  assert.equal(ownerAwardData.audienceRole, "owner");
  assert.equal(ownerAwardData.snapshot.request.id, auction.id);
  assert.equal(ownerAwardData.snapshot.request.status, "awarded");
  assert.equal(ownerAwardData.snapshot.request.requirements, auctionBody.requirements);
  assert.equal(ownerAwardData.snapshot.offer.status, "accepted");
  for (const key of [
    "amount",
    "currency",
    "proposal",
    "deliverables",
    "exclusions",
    "gstIncluded",
    "gstRate",
    "travelPolicy",
    "travelFee",
    "addOns",
    "cancellationTerms",
    "deliveryPlan",
    "structuredTermsProvided",
    "validUntil",
  ]) {
    assert.deepEqual(ownerAwardData.snapshot.offer[key], acceptedOfferBeforeAward[key], `snapshot mismatch for offer.${key}`);
  }
  assert.deepEqual(ownerAwardData.snapshot.vendor, acceptedOfferBeforeAward.vendor);

  const winnerAward = await requestJson(app, env, `/auctions/${auction.id}/award`, { cookie: winningVendor.cookie });
  assert.equal(winnerAward.status, 200, await winnerAward.clone().text());
  assert.equal((await winnerAward.json()).data.audienceRole, "vendor");
  const adminAward = await requestJson(app, env, `/auctions/${auction.id}/award`, { cookie: admin.cookie });
  assert.equal(adminAward.status, 200, await adminAward.clone().text());
  assert.equal((await adminAward.json()).data.audienceRole, "admin");
  const losingVendorAward = await requestJson(app, env, `/auctions/${auction.id}/award`, { cookie: losingVendor.cookie });
  assert.equal(losingVendorAward.status, 404);
  const unrelatedAward = await requestJson(app, env, `/auctions/${auction.id}/award`, { cookie: otherCouple.cookie });
  assert.equal(unrelatedAward.status, 404);
  const anonymousAward = await requestJson(app, env, `/auctions/${auction.id}/award`);
  assert.equal(anonymousAward.status, 401);

  const ownerBookings = await requestJson(app, env, "/bookings", { cookie: couple.cookie });
  assert.equal(ownerBookings.status, 200, await ownerBookings.clone().text());
  assert.deepEqual((await ownerBookings.json()).data.map((booking) => booking.id), [ownerAwardData.id]);
  const winnerBookings = await requestJson(app, env, "/bookings", { cookie: winningVendor.cookie });
  assert.equal(winnerBookings.status, 200, await winnerBookings.clone().text());
  assert.deepEqual((await winnerBookings.json()).data.map((booking) => booking.id), [ownerAwardData.id]);
  const loserBookings = await requestJson(app, env, "/bookings", { cookie: losingVendor.cookie });
  assert.equal(loserBookings.status, 200, await loserBookings.clone().text());
  assert.deepEqual((await loserBookings.json()).data, []);
  assert.throws(
    () => db.sqlite.prepare("UPDATE bookings SET status = 'contract_pending' WHERE id = ?").run(ownerAwardData.id),
    /booking records are immutable/,
  );
  assert.throws(
    () => db.sqlite.prepare("DELETE FROM bookings WHERE id = ?").run(ownerAwardData.id),
    /booking records are immutable/,
  );

  const acceptReplay = await requestJson(app, env, `/auctions/${auction.id}/bids/${acceptedBidId}`, {
    method: "PATCH",
    cookie: couple.cookie,
    headers: { "idempotency-key": `bid-accept-test-000${acceptedIndex + 1}` },
    body: { action: "accept" },
  });
  assert.equal(acceptReplay.status, 200, await acceptReplay.clone().text());
  const acceptReplayPayload = await acceptReplay.json();
  assert.equal(acceptReplayPayload.meta.replayed, true);
  assert.equal(acceptReplayPayload.data.awardId, ownerAwardData.id);

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
      ...normalizedOfferTerms({ travelPolicy: "not_applicable", travelFee: 0, addOns: [] }),
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
  const genericOffers = await requestJson(app, env, `/auctions/${genericAuction.id}/bids`, { cookie: couple.cookie });
  assert.equal(genericOffers.status, 200, await genericOffers.clone().text());
  const legacyOffer = (await genericOffers.json()).data.find((item) => item.id === legacyBidId);
  assert.ok(legacyOffer);
  assert.equal(legacyOffer.structuredTermsProvided, false);
  assert.deepEqual(legacyOffer.deliverables, ["Legacy photography coverage", "Legacy edited gallery"]);
  assert.deepEqual(legacyOffer.exclusions, []);
  assert.equal(legacyOffer.gstIncluded, false);
  assert.equal(legacyOffer.gstRate, 0);
  assert.equal(legacyOffer.travelPolicy, "not_applicable");
  assert.equal(legacyOffer.travelFee, 0);
  assert.deepEqual(legacyOffer.addOns, []);
  assert.equal(legacyOffer.cancellationTerms, "");
  assert.equal(legacyOffer.deliveryPlan, "");

  db.sqlite.exec(`CREATE TRIGGER fail_acceptance_audit
    BEFORE INSERT ON audit_events
    WHEN NEW.action = 'bid.accepted'
    BEGIN SELECT RAISE(ABORT, 'forced acceptance audit failure'); END`);
  let failedAccept;
  try {
    console.error = () => {};
    failedAccept = await requestJson(app, env, `/auctions/${genericAuction.id}/bids/${retriedBidId}`, {
      method: "PATCH",
      cookie: couple.cookie,
      headers: { "idempotency-key": "forced-accept-audit-failure-0001" },
      body: { action: "accept" },
    });
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(failedAccept.status, 500);
  assert.equal(db.sqlite.prepare("SELECT status FROM auctions WHERE id = ?").get(genericAuction.id).status, "closed");
  assert.equal(db.sqlite.prepare("SELECT status FROM bids WHERE id = ?").get(retriedBidId).status, "submitted");
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM bookings WHERE auction_id = ?").get(genericAuction.id).count, 0);
  assert.equal(
    db.sqlite.prepare("SELECT COUNT(*) AS count FROM idempotency_keys WHERE scope = ?").get(`bid-accept:${genericAuction.id}:${retriedBidId}`).count,
    0,
  );
  db.sqlite.exec("DROP TRIGGER fail_acceptance_audit");

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
  assert.equal(new Set(retryPayloads.map((payload) => payload.data.awardId)).size, 1);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM bookings WHERE auction_id = ?").get(genericAuction.id).count, 1);
  assert.equal(
    db.sqlite.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action = 'bid.accepted' AND entity_id = ?").get(retriedBidId).count,
    1,
  );
  assert.equal(
    db.sqlite.prepare("SELECT COUNT(*) AS count FROM idempotency_keys WHERE scope = ?").get(`bid-accept:${genericAuction.id}:${retriedBidId}`).count,
    1,
  );

  const cancellableCreated = await requestJson(app, env, "/auctions", {
    cookie: couple.cookie,
    headers: { "idempotency-key": "auction-create-cancel-replay-0001" },
    body: { ...genericAuctionBody, title: "A cancellable Jaipur photography brief" },
  });
  assert.equal(cancellableCreated.status, 201, await cancellableCreated.clone().text());
  const cancellableAuction = (await cancellableCreated.json()).data;
  const cancelRequest = () => requestJson(app, env, `/auctions/${cancellableAuction.id}/status`, {
    method: "PATCH",
    cookie: couple.cookie,
    body: { status: "cancelled" },
  });
  const firstCancel = await cancelRequest();
  assert.equal(firstCancel.status, 200, await firstCancel.clone().text());
  assert.equal((await firstCancel.json()).data.status, "cancelled");
  const replayedCancel = await cancelRequest();
  assert.equal(replayedCancel.status, 200, await replayedCancel.clone().text());
  const replayedCancelPayload = await replayedCancel.json();
  assert.equal(replayedCancelPayload.data.status, "cancelled");
  assert.equal(replayedCancelPayload.meta.unchanged, true);
  assert.equal(
    db.sqlite.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action = 'auction.status_changed' AND entity_id = ?").get(cancellableAuction.id).count,
    1,
  );

  assert.throws(
    () => db.sqlite.prepare("UPDATE bids SET status = 'accepted' WHERE auction_id = ? AND status = 'rejected'").run(auction.id),
    /UNIQUE constraint failed/,
  );
});

test("single-category creation preserves legacy replays and blocks ambiguous legacy awards", async () => {
  const db = new SqliteD1(STORE_SCHEMA_SQL);
  const env = {
    DB: db,
    SESSION_SECRET,
    PASSWORD_PEPPER: "category-test-password-pepper-with-at-least-thirty-two-characters",
    ENVIRONMENT: "production",
    COOKIE_SECURE: "true",
  };
  const app = buildApp();
  const couple = await register(app, env, { name: "Category Couple", email: "category-couple@example.com", verifier: "K".repeat(43) });
  const vendor = await register(app, env, { name: "Category Vendor", email: "category-vendor@example.com", verifier: "L".repeat(43) });
  const admin = await register(app, env, { name: "Category Admin", email: "category-admin@example.com", verifier: "M".repeat(43) });
  db.sqlite.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(admin.user.id);
  const profile = await onboardVendor(app, env, vendor.cookie, "Category");
  const approval = await requestJson(app, env, `/admin/vendors/${profile.id}`, {
    method: "PATCH",
    cookie: admin.cookie,
    body: { status: "approved", note: "Category contract test" },
  });
  assert.equal(approval.status, 200, await approval.clone().text());

  const eventDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const biddingEndsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const validUntil = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const requestBody = {
    title: "A category-safe Jaipur request",
    eventType: "wedding",
    eventDate,
    city: "Jaipur",
    guestCount: 150,
    budgetMin: 200000,
    budgetMax: 450000,
    currency: "INR",
    categories: ["photography"],
    requirements: "A category-specific brief with enough detail for a comparable and safely awarded proposal.",
    biddingEndsAt,
  };

  const rejectedMultiCategory = await requestJson(app, env, "/auctions", {
    cookie: couple.cookie,
    headers: { "idempotency-key": "new-multi-category-reject-0001" },
    body: { ...requestBody, categories: ["photography", "catering"] },
  });
  assert.equal(rejectedMultiCategory.status, 422, await rejectedMultiCategory.clone().text());
  assert.equal((await rejectedMultiCategory.json()).error.code, "single_category_required");
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM auctions").get().count, 0);

  const replayKey = "legacy-multi-category-replay-0001";
  const original = await requestJson(app, env, "/auctions", {
    cookie: couple.cookie,
    headers: { "idempotency-key": replayKey },
    body: requestBody,
  });
  assert.equal(original.status, 201, await original.clone().text());
  const originalAuction = (await original.json()).data;
  const legacyCategories = ["photography", "catering"];
  const legacyRequestBody = { ...requestBody, categories: legacyCategories };
  const legacyReplayValue = { ...originalAuction, categories: legacyCategories };
  db.sqlite.prepare("UPDATE auctions SET categories_json = ? WHERE id = ?").run(JSON.stringify(legacyCategories), originalAuction.id);
  db.sqlite
    .prepare("UPDATE idempotency_keys SET request_hash = ?, response_json = ? WHERE scope = 'auction-create' AND user_id = ?")
    .run(
      canonicalRequestHash({
        ...legacyRequestBody,
        biddingEndsAt: new Date(legacyRequestBody.biddingEndsAt).toISOString(),
        preferredVendorId: null,
      }),
      JSON.stringify(legacyReplayValue),
      couple.user.id,
    );
  const legacyReplay = await requestJson(app, env, "/auctions", {
    cookie: couple.cookie,
    headers: { "idempotency-key": replayKey },
    body: legacyRequestBody,
  });
  assert.equal(legacyReplay.status, 201, await legacyReplay.clone().text());
  const legacyReplayPayload = await legacyReplay.json();
  assert.equal(legacyReplayPayload.meta.replayed, true);
  assert.deepEqual(legacyReplayPayload.data.categories, legacyCategories);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM auctions").get().count, 1);

  const submitted = await requestJson(app, env, `/auctions/${originalAuction.id}/bids`, {
    cookie: vendor.cookie,
    body: {
      amount: 300000,
      currency: "INR",
      proposal: "A complete photography proposal for exercising the legacy multi-category decision guard.",
      deliverables: ["Two photographers", "Edited gallery"],
      validUntil,
      ...normalizedOfferTerms({ travelPolicy: "included", travelFee: undefined, addOns: [] }),
    },
  });
  assert.equal(submitted.status, 201, await submitted.clone().text());
  const bidId = (await submitted.json()).data.id;
  const closed = await requestJson(app, env, `/auctions/${originalAuction.id}/status`, {
    method: "PATCH",
    cookie: couple.cookie,
    body: { status: "closed" },
  });
  assert.equal(closed.status, 200, await closed.clone().text());
  const legacyShortlist = await requestJson(app, env, `/auctions/${originalAuction.id}/bids/${bidId}`, {
    method: "PATCH",
    cookie: couple.cookie,
    body: { action: "shortlist" },
  });
  assert.equal(legacyShortlist.status, 409, await legacyShortlist.clone().text());
  assert.equal((await legacyShortlist.json()).error.code, "legacy_multi_category_request");
  const legacyAccept = await requestJson(app, env, `/auctions/${originalAuction.id}/bids/${bidId}`, {
    method: "PATCH",
    cookie: couple.cookie,
    headers: { "idempotency-key": "legacy-multi-category-accept-0001" },
    body: { action: "accept" },
  });
  assert.equal(legacyAccept.status, 409, await legacyAccept.clone().text());
  assert.equal((await legacyAccept.json()).error.code, "legacy_multi_category_request");
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM bookings").get().count, 0);
  assert.equal(db.sqlite.prepare("SELECT status FROM bids WHERE id = ?").get(bidId).status, "submitted");
});

test("vendor capability preserves the customer workspace and enforces linked self-bid boundaries", async () => {
  const db = new SqliteD1(STORE_SCHEMA_SQL);
  const env = {
    DB: db,
    SESSION_SECRET,
    PASSWORD_PEPPER: "dual-capability-password-pepper-with-at-least-thirty-two-characters",
    ENVIRONMENT: "production",
    COOKIE_SECURE: "true",
  };
  const app = buildApp();
  const dual = await register(app, env, { name: "Dual Workspace", email: "dual@example.com", verifier: "N".repeat(43) });
  const otherCouple = await register(app, env, { name: "Other Workspace", email: "other-workspace@example.com", verifier: "O".repeat(43) });
  const admin = await register(app, env, { name: "Dual Admin", email: "dual-admin@example.com", verifier: "P".repeat(43) });
  db.sqlite.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(admin.user.id);
  const eventDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const biddingEndsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const requestBody = (title) => ({
    title,
    eventType: "wedding",
    eventDate,
    city: "Jaipur",
    guestCount: 120,
    budgetMin: 150000,
    budgetMax: 400000,
    currency: "INR",
    categories: ["photography"],
    requirements: "A private single-category request used to verify independent customer and vendor capabilities.",
    biddingEndsAt,
  });
  const ownCreated = await requestJson(app, env, "/auctions", {
    cookie: dual.cookie,
    headers: { "idempotency-key": "dual-own-request-create-0001" },
    body: requestBody("Dual account's own photography request"),
  });
  assert.equal(ownCreated.status, 201, await ownCreated.clone().text());
  const ownAuction = (await ownCreated.json()).data;

  const profile = await onboardVendor(app, env, dual.cookie, "Dual");
  assert.equal(db.sqlite.prepare("SELECT role FROM users WHERE id = ?").get(dual.user.id).role, "couple");
  const me = await requestJson(app, env, "/auth/me", { cookie: dual.cookie });
  assert.equal(me.status, 200, await me.clone().text());
  const meData = (await me.json()).data;
  assert.equal(meData.user.role, "couple");
  assert.equal(meData.vendor.id, profile.id);
  assert.equal(meData.vendor.status, "pending");
  const pendingMine = await requestJson(app, env, "/auctions?mine=true", { cookie: dual.cookie });
  assert.equal(pendingMine.status, 200, await pendingMine.clone().text());
  assert.deepEqual((await pendingMine.json()).data.map((auction) => auction.id), [ownAuction.id]);
  const pendingFeed = await requestJson(app, env, "/auctions", { cookie: dual.cookie });
  assert.equal(pendingFeed.status, 403);

  const approval = await requestJson(app, env, `/admin/vendors/${profile.id}`, {
    method: "PATCH",
    cookie: admin.cookie,
    body: { status: "approved", note: "Dual capability test" },
  });
  assert.equal(approval.status, 200, await approval.clone().text());
  const otherCreated = await requestJson(app, env, "/auctions", {
    cookie: otherCouple.cookie,
    headers: { "idempotency-key": "dual-other-request-create-0001" },
    body: requestBody("Another couple's photography request"),
  });
  assert.equal(otherCreated.status, 201, await otherCreated.clone().text());
  const otherAuction = (await otherCreated.json()).data;

  const mine = await requestJson(app, env, "/auctions?mine=true", { cookie: dual.cookie });
  assert.equal(mine.status, 200, await mine.clone().text());
  assert.deepEqual((await mine.json()).data.map((auction) => auction.id), [ownAuction.id]);
  const opportunityFeed = await requestJson(app, env, "/auctions", { cookie: dual.cookie });
  assert.equal(opportunityFeed.status, 200, await opportunityFeed.clone().text());
  const opportunityIds = (await opportunityFeed.json()).data.map((auction) => auction.id);
  assert.ok(opportunityIds.includes(otherAuction.id));
  assert.ok(!opportunityIds.includes(ownAuction.id));

  const offerBody = {
    amount: 275000,
    currency: "INR",
    proposal: "A complete linked-vendor photography proposal with clear scope and commercial terms.",
    deliverables: ["Photography team", "Edited gallery"],
    ...normalizedOfferTerms({ travelPolicy: "included", travelFee: undefined, addOns: [] }),
  };
  const selfBid = await requestJson(app, env, `/auctions/${ownAuction.id}/bids`, { cookie: dual.cookie, body: offerBody });
  assert.equal(selfBid.status, 403, await selfBid.clone().text());
  assert.equal((await selfBid.json()).error.code, "self_bid_not_allowed");
  const otherBid = await requestJson(app, env, `/auctions/${otherAuction.id}/bids`, { cookie: dual.cookie, body: offerBody });
  assert.equal(otherBid.status, 201, await otherBid.clone().text());
  const ownOffers = await requestJson(app, env, "/bids/mine", { cookie: dual.cookie });
  assert.equal(ownOffers.status, 200, await ownOffers.clone().text());
  assert.deepEqual((await ownOffers.json()).data.map((offer) => offer.auction.id), [otherAuction.id]);

  db.sqlite.prepare("UPDATE users SET role = 'vendor' WHERE id = ?").run(dual.user.id);
  const legacyVendorMine = await requestJson(app, env, "/auctions?mine=true", { cookie: dual.cookie });
  assert.equal(legacyVendorMine.status, 200, await legacyVendorMine.clone().text());
  assert.deepEqual((await legacyVendorMine.json()).data.map((auction) => auction.id), [ownAuction.id]);
  const legacyVendorCreate = await requestJson(app, env, "/auctions", {
    cookie: dual.cookie,
    headers: { "idempotency-key": "legacy-vendor-customer-create-0001" },
    body: requestBody("A legacy vendor role's new customer request"),
  });
  assert.equal(legacyVendorCreate.status, 201, await legacyVendorCreate.clone().text());
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
      ...normalizedOfferTerms({ travelPolicy: "included", travelFee: undefined }),
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
