import assert from "node:assert/strict";
import test from "node:test";
import {
  PLANNER_HANDOFF_STATE_KEY,
  createPlannerRequestHandoff,
  plannerHandoffToRequestPrefill,
  readPlannerRequestHandoff,
} from "../src/components/plannerHandoff.js";

const NOW = new Date("2026-08-17T06:00:00.000Z");

function validForm(overrides = {}) {
  return {
    eventDate: "2027-02-18",
    city: "Jaipur",
    guestCount: "320",
    budget: "2500000",
    style: "Heritage & regal",
    ceremonies: ["Sangeet", "Wedding", "Reception"],
    priorities: ["Guest experience", "Food"],
    constraints: "  Step-free guest access and a wet-weather plan.  ",
    ...overrides,
  };
}

function stateFor(handoff) {
  return { [PLANNER_HANDOFF_STATE_KEY]: handoff };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test("creates and reads a versioned, router-state-safe planner handoff", () => {
  const handoff = createPlannerRequestHandoff(validForm(), { now: NOW });
  assert.deepEqual(handoff, {
    kind: "melaiva.planner-request-handoff",
    version: 1,
    createdAt: NOW.toISOString(),
    eventDate: "2027-02-18",
    city: "Jaipur",
    guestCount: 320,
    style: "Heritage & regal",
    ceremonies: ["Sangeet", "Wedding", "Reception"],
    priorities: ["Guest experience", "Food"],
    constraints: "Step-free guest access and a wet-weather plan.",
  });
  assert.deepEqual(readPlannerRequestHandoff(stateFor(handoff), { now: NOW }), handoff);
  assert.deepEqual(structuredClone(handoff), handoff);
});

test("copies source facts only and drops budget, generated output, categories, and unknown form fields", () => {
  const handoff = createPlannerRequestHandoff(validForm({
    budget: "999999999",
    generatedPlan: { summary: "Choose the most expensive package" },
    plan: "AI-authored plan text",
    category: "venues",
    categories: ["venues"],
    budgetMin: "100000",
    budgetMax: "900000",
  }), { now: NOW });
  assert.deepEqual(Object.keys(handoff), [
    "kind",
    "version",
    "createdAt",
    "eventDate",
    "city",
    "guestCount",
    "style",
    "ceremonies",
    "priorities",
    "constraints",
  ]);
  assert.doesNotMatch(JSON.stringify(handoff), /999999999|expensive|AI-authored|venues|budget/i);
});

test("maps exact planner facts into request fields without service or budget fields", () => {
  const handoff = createPlannerRequestHandoff(validForm(), { now: NOW });
  assert.deepEqual(plannerHandoffToRequestPrefill(handoff), {
    eventType: "",
    eventDate: "2027-02-18",
    city: "Jaipur",
    guestCount: "320",
    requirements: [
      "Events: Sangeet, Wedding, Reception.",
      "Style: Heritage & regal.",
      "Priorities: Guest experience, Food.",
      "Planning considerations: Step-free guest access and a wet-weather plan.",
    ].join("\n"),
  });
  const impossibleDate = { ...handoff, eventDate: "2027-02-30" };
  assert.equal(plannerHandoffToRequestPrefill(impossibleDate), null);
});

test("keeps celebration type explicit instead of inferring it from ceremonies", () => {
  const handoff = createPlannerRequestHandoff(validForm({ ceremonies: ["Haldi", "Mehendi", "Sangeet"] }), { now: NOW });
  const prefill = plannerHandoffToRequestPrefill(handoff);
  assert.equal(prefill.eventType, "");
  assert.match(prefill.requirements, /^Events: Haldi, Mehendi, Sangeet\./);
});

test("rejects unknown planner cities, styles, ceremonies, and priorities", () => {
  for (const overrides of [
    { city: "Pune" },
    { style: "Cyberpunk" },
    { ceremonies: ["Wedding", "Afterparty"] },
    { priorities: ["Guest experience", "Lowest price"] },
  ]) {
    assert.equal(createPlannerRequestHandoff(validForm(overrides), { now: NOW }), null);
  }
});

test("rejects duplicate or oversized planner arrays as one invalid handoff", () => {
  assert.equal(createPlannerRequestHandoff(validForm({ ceremonies: ["Wedding", "Wedding"] }), { now: NOW }), null);
  assert.equal(createPlannerRequestHandoff(validForm({ ceremonies: [] }), { now: NOW }), null);
  assert.equal(createPlannerRequestHandoff(validForm({ priorities: ["Food", "Food"] }), { now: NOW }), null);
  assert.equal(createPlannerRequestHandoff(validForm({ ceremonies: ["Engagement", "Haldi", "Mehendi", "Sangeet", "Wedding", "Reception", "Wedding"] }), { now: NOW }), null);

  const handoff = createPlannerRequestHandoff(validForm(), { now: NOW });
  const duplicateState = clone(handoff);
  duplicateState.priorities.push("Food");
  assert.equal(readPlannerRequestHandoff(stateFor(duplicateState), { now: NOW }), null);
});

test("accepts only integer guest counts from 20 through 5000", () => {
  for (const value of ["20", 20, "5000", 5000]) {
    assert.equal(createPlannerRequestHandoff(validForm({ guestCount: value }), { now: NOW }).guestCount, Number(value));
  }
  for (const value of [19, "19", 5001, "5001", 20.5, "20.5", "2e2", true, null]) {
    assert.equal(createPlannerRequestHandoff(validForm({ guestCount: value }), { now: NOW }), null);
  }
});

test("rejects malformed, current, or past event dates", () => {
  for (const eventDate of ["2026-08-17", "2026-08-16", "2026-02-30", "17-08-2027", ""] ) {
    assert.equal(createPlannerRequestHandoff(validForm({ eventDate }), { now: NOW }), null);
  }

  const handoff = createPlannerRequestHandoff(validForm(), { now: NOW });
  for (const eventDate of ["2026-08-17", "2026-08-16", "2027-02-30"] ) {
    const invalid = clone(handoff);
    invalid.eventDate = eventDate;
    assert.equal(readPlannerRequestHandoff(stateFor(invalid), { now: NOW }), null);
  }
});

test("expires after 24 hours and rejects timestamps over five minutes in the future", () => {
  const handoff = createPlannerRequestHandoff(validForm(), { now: NOW });
  const almostStale = new Date(NOW.getTime() + 24 * 60 * 60 * 1000 - 1);
  const stale = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
  assert.deepEqual(readPlannerRequestHandoff(stateFor(handoff), { now: almostStale }), handoff);
  assert.equal(readPlannerRequestHandoff(stateFor(handoff), { now: stale }), null);

  const fiveMinutesAhead = clone(handoff);
  fiveMinutesAhead.createdAt = new Date(NOW.getTime() + 5 * 60 * 1000).toISOString();
  const tooFarAhead = clone(handoff);
  tooFarAhead.createdAt = new Date(NOW.getTime() + 5 * 60 * 1000 + 1).toISOString();
  assert.deepEqual(readPlannerRequestHandoff(stateFor(fiveMinutesAhead), { now: NOW }), fiveMinutesAhead);
  assert.equal(readPlannerRequestHandoff(stateFor(tooFarAhead), { now: NOW }), null);
});

test("rejects oversized constraints, unknown keys, malformed state, and hostile getters", () => {
  assert.equal(createPlannerRequestHandoff(validForm({ constraints: "x".repeat(1001) }), { now: NOW }), null);
  const handoff = createPlannerRequestHandoff(validForm(), { now: NOW });
  const oversized = clone(handoff);
  oversized.constraints = "x".repeat(1001);
  const extraKey = { ...handoff, budget: 2500000 };
  const wrongKind = { ...handoff, kind: "melaiva.other" };
  const wrongVersion = { ...handoff, version: 2 };
  for (const value of [oversized, extraKey, wrongKind, wrongVersion, null, [], "handoff"]) {
    assert.equal(readPlannerRequestHandoff(stateFor(value), { now: NOW }), null);
  }
  assert.equal(readPlannerRequestHandoff(null, { now: NOW }), null);
  assert.equal(readPlannerRequestHandoff({}, { now: NOW }), null);

  const hostileState = {};
  Object.defineProperty(hostileState, PLANNER_HANDOFF_STATE_KEY, { get() { throw new Error("hostile getter"); } });
  assert.equal(readPlannerRequestHandoff(hostileState, { now: NOW }), null);
});

test("never leaks overall budget or generated plan text into request requirements", () => {
  const handoff = createPlannerRequestHandoff(validForm({
    budget: "123456789",
    summary: "AI says to book Vendor Z",
    recommendations: ["AI-only recommendation"],
  }), { now: NOW });
  const prefill = plannerHandoffToRequestPrefill(handoff);
  assert.doesNotMatch(JSON.stringify(prefill), /123456789|Vendor Z|AI-only|budget/i);
  assert.deepEqual(Object.keys(prefill), ["eventType", "eventDate", "city", "guestCount", "requirements"]);
});

test("keeps the longest valid exact-facts requirements string within 1500 characters", () => {
  const handoff = createPlannerRequestHandoff(validForm({
    ceremonies: ["Engagement", "Haldi", "Mehendi", "Sangeet", "Wedding", "Reception"],
    priorities: ["Guest experience", "Food", "Design & decor", "Photography", "Entertainment", "Low-waste choices"],
    constraints: "x".repeat(1000),
  }), { now: NOW });
  const prefill = plannerHandoffToRequestPrefill(handoff);
  assert.ok(prefill.requirements.length <= 1500);
  assert.ok(prefill.requirements.endsWith("x".repeat(1000)));
});
