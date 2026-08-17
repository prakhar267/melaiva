import assert from "node:assert/strict";
import test from "node:test";

import {
  marketplaceEmptyStateCopy,
  marketplaceRequestHref,
  marketplaceVendorRequestHref,
  normalizeEligibleVendorCount,
  requestCoverageCopy,
  requestPrefillFromSearch,
} from "../src/components/requestCoverage.js";
import {
  clearPendingRequestSubmission,
  markPendingRequestSubmissionRejected,
  pendingSubmissionBelongsToUser,
  readPendingRequestSubmission,
  rejectedRequestEditStep,
  requestDraftFromPayload,
  requestPreferredVendorInitials,
  validateRequestDraft,
  writePendingRequestSubmission,
} from "../src/components/requestSubmission.js";

test("eligible partner counts fail closed when the response is absent or malformed", () => {
  for (const value of [null, undefined, "", -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "not-a-count"]) {
    assert.equal(normalizeEligibleVendorCount(value), null, String(value));
  }
  assert.equal(normalizeEligibleVendorCount(0), 0);
  assert.equal(normalizeEligibleVendorCount("3"), 3);
});

test("coverage copy never promises responses or unavailable notifications", () => {
  const emptyDraft = requestCoverageCopy(0);
  assert.equal(emptyDraft.tone, "warning");
  assert.match(emptyDraft.title, /no reviewed partner currently matches/i);
  assert.match(emptyDraft.message, /no response is currently expected/i);

  const emptySuccess = requestCoverageCopy(0, "success");
  assert.match(emptySuccess.message, /does not send coverage notifications yet/i);
  assert.match(emptySuccess.title, /matched when this brief opened/i);
  assert.doesNotMatch(emptySuccess.message, /we(?:’|')ll let you know/i);

  const ready = requestCoverageCopy(2, "success");
  assert.match(ready.title, /2 marketplace-reviewed partners/i);
  assert.match(ready.title, /matched when this brief opened/i);
  assert.match(ready.message, /not a response guarantee/i);
  assert.match(ready.message, /does not send email or push notifications yet/i);

  const replay = requestCoverageCopy(2, "replay");
  assert.match(replay.message, /confirmed the original publish without creating another request/i);
  assert.match(replay.message, /publish-time snapshot, not current availability/i);
});

test("marketplace search details prefill only bounded supported request fields", () => {
  const now = Date.parse("2026-08-17T00:00:00.000Z");
  const valid = new URLSearchParams({
    category: "photography",
    city: "Jaipur",
    date: "2027-02-13",
    guests: "240",
  });
  assert.deepEqual(requestPrefillFromSearch(valid, {
    categoryIds: ["venues", "photography"],
    cityNames: ["Jaipur", "Goa"],
    now,
  }), {
    categories: ["photography"],
    city: "Jaipur",
    eventDate: "2027-02-13",
    guestCount: "240",
  });

  const invalid = new URLSearchParams({
    category: "unknown",
    city: "Jaipur\u202E",
    date: "2020-01-01",
    guests: "5001",
  });
  assert.deepEqual(requestPrefillFromSearch(invalid, {
    categoryIds: ["photography"],
    cityNames: ["Jaipur"],
    now,
  }), {});
});

test("marketplace handoff preserves safe celebration context", () => {
  assert.equal(
    marketplaceRequestHref({ category: "photography", city: "Jaipur", date: "2027-02-13", guests: 240 }),
    "/request?category=photography&city=Jaipur&date=2027-02-13&guests=240",
  );
  assert.equal(
    marketplaceRequestHref({ category: "photography\u202E", city: "Jaipur", date: "", guests: "" }),
    "/request?city=Jaipur",
  );
});

test("vendor-card handoff preserves discovery context and only includes a real vendor slug", () => {
  const context = {
    category: "photography",
    city: "Jaipur",
    date: "2027-02-13",
    guests: "240",
    search: "documentary",
    max: "300000",
    verified: true,
  };
  const vendor = { category: "venues", slug: "the-wedding-journal" };

  assert.equal(
    marketplaceVendorRequestHref(vendor, context),
    "/request?category=photography&city=Jaipur&date=2027-02-13&guests=240&vendor=the-wedding-journal",
  );
  assert.equal(
    marketplaceVendorRequestHref(vendor, context, { demo: true }),
    "/request?category=photography&city=Jaipur&date=2027-02-13&guests=240",
  );
  assert.equal(
    marketplaceVendorRequestHref({ category: "venues", slug: "unsafe\u202Eslug" }, { city: "Goa" }),
    "/request?category=venues&city=Goa",
  );
});

test("marketplace empty-state copy separates live inventory gaps from browsing filters", () => {
  const inventory = marketplaceEmptyStateCopy({ baseInventoryAvailable: false, scope: "Photography in Jaipur" });
  assert.equal(inventory.kind, "inventory");
  assert.match(inventory.title, /no reviewed partners match photography in jaipur yet/i);
  assert.match(inventory.message, /without promising an offer/i);

  const filtered = marketplaceEmptyStateCopy({ baseInventoryAvailable: true, scope: "Photography in Jaipur" });
  assert.equal(filtered.kind, "filters");
  assert.match(filtered.title, /active filter/i);
  assert.match(filtered.message, /partners are available for photography in jaipur/i);
  assert.match(filtered.message, /full approved service-and-city pool/i);

  const preview = marketplaceEmptyStateCopy({ baseInventoryAvailable: false, preview: true });
  assert.equal(preview.kind, "preview");
  assert.doesNotMatch(preview.title, /reviewed partners/i);
  assert.match(preview.message, /live catalog could not be reached/i);
});

test("an in-flight publish survives a same-tab remount with its exact key and payload", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const now = Date.parse("2026-08-18T00:00:00.000Z");
  const payload = {
    title: "Jaipur photography coverage check",
    eventType: "family_celebration",
    eventDate: "2027-02-13",
    city: "Jaipur",
    guestCount: 240,
    budgetMin: 200000,
    budgetMax: 500000,
    currency: "INR",
    categories: ["photography"],
    requirements: "Candid photography with a clear delivery plan for the full celebration day.",
    biddingEndsAt: "2026-08-21T00:00:00.000Z",
    preferredVendorId: "vendor-123",
  };
  const preferredVendor = {
    id: "vendor-123",
    slug: "the-wedding-journal",
    name: "The Wedding Journal",
    categoryLabel: "Photography",
    city: "Jaipur",
    initials: "TW",
    tone: "rose",
  };

  assert.equal(writePendingRequestSubmission(storage, {
    key: "request-stable-key-123",
    ownerUserId: "user-owner-123",
    payload,
    preferredVendor,
  }, now), true);
  const recovered = readPendingRequestSubmission(storage, now + 1_000);
  assert.equal(recovered.key, "request-stable-key-123");
  assert.equal(recovered.ownerUserId, "user-owner-123");
  assert.equal(recovered.state, "pending");
  assert.deepEqual(recovered.payload, payload);
  assert.deepEqual(recovered.preferredVendor, preferredVendor);
  assert.deepEqual(recovered.draft, requestDraftFromPayload(payload));
  assert.equal(recovered.draft.eventType, "Family celebration");
  assert.equal(recovered.draft.guestCount, "240");
  assert.equal(pendingSubmissionBelongsToUser(recovered, "user-owner-123"), true);
  assert.equal(pendingSubmissionBelongsToUser(recovered, "different-user-456"), false);

  clearPendingRequestSubmission(storage);
  assert.equal(readPendingRequestSubmission(storage, now + 2_000), null);

  const multilingualVendor = {
    ...preferredVendor,
    name: "शुभ विवाह स्टूडियो",
    initials: "शव",
  };
  assert.equal(writePendingRequestSubmission(storage, {
    key: "request-multilingual-key-123",
    ownerUserId: "user-owner-123",
    payload,
    preferredVendor: multilingualVendor,
  }, now + 3_000), true);
  assert.equal(readPendingRequestSubmission(storage, now + 4_000).preferredVendor.name, "शुभ विवाह स्टूडियो");
  assert.equal(requestPreferredVendorInitials("𐐀 Studio"), "𐐀S");
  assert.equal(requestPreferredVendorInitials("✨ Shaadi Studio"), "SS");
  assert.equal(requestPreferredVendorInitials("✨"), "VP");
});

test("stale or malformed pending publishes are never replayed with a fresh server window", () => {
  let stored = JSON.stringify({ version: 2, key: "unsafe key", ownerUserId: "user-owner-123", payload: {}, createdAt: "invalid" });
  const storage = {
    getItem: () => stored,
    setItem: (_key, value) => { stored = value; },
    removeItem: () => { stored = null; },
  };
  assert.equal(readPendingRequestSubmission(storage, Date.parse("2026-08-18T00:00:00.000Z")), null);
  assert.equal(stored, null);

  const validPayload = {
    title: "Stale Jaipur photography brief",
    eventType: "wedding",
    eventDate: "2027-02-13",
    city: "Jaipur",
    guestCount: 240,
    budgetMin: 200000,
    budgetMax: 500000,
    currency: "INR",
    categories: ["photography"],
    requirements: "A complete stale request payload that must not be replayed after key retention.",
    biddingEndsAt: "2026-08-21T00:00:00.000Z",
  };
  assert.equal(writePendingRequestSubmission(storage, {
    key: "request-stale-key-123",
    ownerUserId: "user-owner-123",
    payload: validPayload,
  }, Date.parse("2026-08-17T00:00:00.000Z")), true);
  assert.equal(readPendingRequestSubmission(storage, Date.parse("2026-08-18T00:00:00.000Z")), null);
  assert.equal(stored, null);
});

test("publish retries stay account-bound and never extend the first-attempt window", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const firstAttempt = Date.parse("2026-08-17T00:00:00.000Z");
  const payload = {
    title: "Account-bound Jaipur photography brief",
    eventType: "wedding",
    eventDate: "2027-02-13",
    city: "Jaipur",
    guestCount: 240,
    budgetMin: 200000,
    budgetMax: 500000,
    currency: "INR",
    categories: ["photography"],
    requirements: "A complete request payload whose retry must remain with its original account.",
    biddingEndsAt: "2026-08-21T00:00:00.000Z",
  };
  const submission = { key: "request-account-key-123", ownerUserId: "user-owner-123", payload };

  assert.equal(writePendingRequestSubmission(storage, submission, firstAttempt), true);
  assert.equal(writePendingRequestSubmission(storage, submission, firstAttempt + 23 * 60 * 60 * 1_000), true);
  assert.equal(readPendingRequestSubmission(storage, firstAttempt + 23 * 60 * 60 * 1_000).createdAt, "2026-08-17T00:00:00.000Z");

  assert.equal(writePendingRequestSubmission(storage, {
    ...submission,
    ownerUserId: "different-user-456",
  }, firstAttempt + 23 * 60 * 60 * 1_000), false);
  assert.equal(readPendingRequestSubmission(storage, firstAttempt + 23 * 60 * 60 * 1_000).ownerUserId, "user-owner-123");
  assert.equal(readPendingRequestSubmission(storage, firstAttempt + 25 * 60 * 60 * 1_000), null);
});

test("publishing fails closed when durable tab storage is unavailable", () => {
  const payload = {
    title: "Storage-protected Jaipur photography brief",
    eventType: "wedding",
    eventDate: "2027-02-13",
    city: "Jaipur",
    guestCount: 240,
    budgetMin: 200000,
    budgetMax: 500000,
    currency: "INR",
    categories: ["photography"],
    requirements: "A complete request payload that must not publish without durable retry protection.",
    biddingEndsAt: "2026-08-21T00:00:00.000Z",
  };
  const throwingStorage = {
    getItem: () => null,
    setItem: () => { throw new Error("quota exceeded"); },
    removeItem: () => {},
  };
  assert.equal(writePendingRequestSubmission(throwingStorage, {
    key: "request-storage-key-123",
    ownerUserId: "user-owner-123",
    payload,
  }, Date.parse("2026-08-17T00:00:00.000Z")), false);
});

test("a definitive rejection stays durable and non-replayable until explicit clearing", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const now = Date.parse("2026-08-17T00:00:00.000Z");
  const submission = {
    key: "request-rejected-key-123",
    ownerUserId: "user-owner-123",
    payload: {
      title: "Rejected Jaipur photography brief",
      eventType: "wedding",
      eventDate: "2027-02-13",
      city: "Jaipur",
      guestCount: 240,
      budgetMin: 200000,
      budgetMax: 500000,
      currency: "INR",
      categories: ["photography"],
      requirements: "A definitively rejected request that remains protected without being replayable.",
      biddingEndsAt: "2026-08-21T00:00:00.000Z",
    },
  };
  assert.equal(writePendingRequestSubmission(storage, submission, now), true);
  assert.equal(markPendingRequestSubmissionRejected(storage, submission, "The response window has ended.", now + 1_000), true);
  const rejected = readPendingRequestSubmission(storage, now + 2_000);
  assert.equal(rejected.state, "rejected");
  assert.equal(rejected.rejectionMessage, "The response window has ended.");
  assert.equal(writePendingRequestSubmission(storage, submission, now + 3_000), false);
  assert.equal(readPendingRequestSubmission(storage, now + 48 * 60 * 60 * 1_000).state, "rejected");
  clearPendingRequestSubmission(storage);
  assert.equal(readPendingRequestSubmission(storage, now + 4_000), null);
});

test("rejected drafts return to editing and fresh publishes revalidate every step", () => {
  const now = Date.parse("2026-08-18T00:00:00.000Z");
  const validDraft = {
    title: "Jaipur photography recovery",
    eventType: "Wedding",
    eventDate: "2027-02-13",
    city: "Jaipur",
    guestCount: "240",
    categories: ["photography"],
    budgetMin: "200000",
    budgetMax: "500000",
    biddingEndsAt: "2026-08-21T05:30",
    requirements: "Candid photography with a complete delivery plan for the celebration.",
  };

  assert.deepEqual(validateRequestDraft(validDraft, now), {
    errors: {},
    errorsByStep: { 1: {}, 2: {}, 3: {} },
    firstInvalidStep: null,
  });
  assert.equal(rejectedRequestEditStep(validDraft, { now }), 1);

  const endedWindow = { ...validDraft, biddingEndsAt: "2026-08-17T23:30" };
  const endedValidation = validateRequestDraft(endedWindow, now);
  assert.equal(endedValidation.firstInvalidStep, 3);
  assert.match(endedValidation.errors.biddingEndsAt, /future closing time/i);
  assert.equal(rejectedRequestEditStep(endedWindow, { responseWindowEnded: true, now }), 3);

  const invalidFirstStep = { ...validDraft, title: "Bad" };
  assert.equal(validateRequestDraft(invalidFirstStep, now).firstInvalidStep, 1);
  assert.equal(rejectedRequestEditStep(invalidFirstStep, { now }), 1);
  assert.equal(rejectedRequestEditStep({ ...endedWindow, title: "Bad" }, { responseWindowEnded: true, now }), 1);

  const invalidPayloadShape = { ...validDraft, title: "x".repeat(121), budgetMin: "200000.5" };
  const payloadValidation = validateRequestDraft(invalidPayloadShape, now);
  assert.match(payloadValidation.errors.title, /120 characters/i);
  assert.match(payloadValidation.errors.budgetMin, /whole-number/i);
});
