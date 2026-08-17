import assert from "node:assert/strict";
import test from "node:test";

import {
  buildVendorEvidence,
  buildVendorEvidenceSubmissionPayload,
  canCompleteVendorEvidence,
  createVendorEvidenceLifecycleState,
  evidenceFocusIndexAfterRemoval,
  evidenceFocusNeedsScroll,
  normalizeVendorEvidenceContext,
  prefillVendorEvidence,
  registrationReferenceError,
  shouldClearVendorEvidencePrivateDraft,
  shouldPreflightVendorEvidenceSubmission,
  VENDOR_EVIDENCE_DISCARD_FAILURE_MESSAGE,
  validateVendorApplication,
  validateVendorEvidence,
  vendorEvidenceCompletionEligibility,
  vendorEvidenceConflictState,
  vendorEvidenceContextRefreshDecision,
  vendorEvidenceContextsMatch,
  vendorEvidenceExplicitReloadPlan,
  vendorEvidenceLifecycleTransition,
  vendorEvidencePreflightIdentityMatches,
  vendorEvidencePreflightMatches,
} from "../src/components/vendorOnboarding.js";
import {
  supportsAdminVendorSummaryContract,
  supportsVendorApplicationEvidence,
  VENDOR_APPLICATION_EVIDENCE_HEADERS,
  workerVersionAffinityHeaders,
  WORKER_VERSION_AFFINITY_HEADER,
} from "../src/components/vendorApplicationCompatibility.js";

test("vendor evidence compatibility fails closed across mixed Worker versions", () => {
  assert.equal(supportsVendorApplicationEvidence({ data: { vendorApplicationEvidenceRevision: 5 } }), true);
  assert.equal(supportsVendorApplicationEvidence({ data: {} }), false);
  assert.equal(supportsVendorApplicationEvidence({ data: { vendorApplicationEvidenceRevision: "5" } }), false);
  assert.equal(supportsVendorApplicationEvidence({ data: { vendorApplicationEvidenceRevision: 4 } }), false);
  assert.equal(supportsVendorApplicationEvidence({ data: { vendorApplicationEvidenceRevision: 3 } }), false);
  assert.equal(supportsVendorApplicationEvidence({ data: { vendorApplicationEvidenceRevision: 2 } }), false);
  assert.equal(supportsVendorApplicationEvidence({ data: { vendorApplicationEvidenceRevision: 1 } }), false);
  assert.deepEqual(VENDOR_APPLICATION_EVIDENCE_HEADERS, { "X-Melaiva-Vendor-Evidence": "5" });
  assert.deepEqual(workerVersionAffinityHeaders("vendor-123"), {
    [WORKER_VERSION_AFFINITY_HEADER]: "vendor-123",
  });
  assert.deepEqual(workerVersionAffinityHeaders(" vendor-123 "), {});
  assert.deepEqual(workerVersionAffinityHeaders(`vendor-${"x".repeat(128)}`), {});

  const summaryPayload = { meta: { contract: "vendor-summary-v2" } };
  assert.equal(supportsAdminVendorSummaryContract(summaryPayload, "2"), true);
  assert.equal(supportsAdminVendorSummaryContract(summaryPayload, null), false);
  assert.equal(supportsAdminVendorSummaryContract({ meta: {} }, "2"), false);
  const legacyFullDetailPayload = {
    data: [{ legalName: "Private legal name", phone: "+91 99999 99999", owner: { email: "private@example.com" } }],
    meta: { total: 1 },
  };
  assert.equal(supportsAdminVendorSummaryContract(legacyFullDetailPayload, null), false);
});

test("evidence focus scrolling changes only when the target is outside the viewport", () => {
  assert.equal(evidenceFocusNeedsScroll({ top: 0, bottom: 40 }, 800), false);
  assert.equal(evidenceFocusNeedsScroll({ top: -1, bottom: 39 }, 800), true);
  assert.equal(evidenceFocusNeedsScroll({ top: 780, bottom: 820 }, 800), true);
  assert.equal(evidenceFocusNeedsScroll(null, 800), false);
});

test("evidence lifecycle keeps a captured payload locked through ambiguous focus changes", () => {
  const initial = createVendorEvidenceLifecycleState();
  const focused = vendorEvidenceLifecycleTransition(initial, {
    type: "capture_focus",
    focusDescriptor: "portfolioUrls:0",
  });
  const locked = vendorEvidenceLifecycleTransition(focused, { type: "begin_submission" });
  assert.equal(locked.locked, true);
  assert.equal(locked.submissionSequence, 1);
  assert.equal(vendorEvidenceLifecycleTransition(locked, { type: "begin_submission" }), locked);
  assert.equal(locked.submissionSequence, 1);
  assert.deepEqual(vendorEvidenceLifecycleTransition(locked, { type: "form_changed" }), locked);

  const dispatched = vendorEvidenceLifecycleTransition(locked, { type: "mutation_started" });
  assert.equal(dispatched.mutationInFlight, true);
  assert.equal(dispatched.keyPreserved, true);
  const revalidating = vendorEvidenceLifecycleTransition(dispatched, {
    type: "focus_revalidation",
    mutationInFlight: true,
  });
  assert.equal(revalidating.generation, 1);
  assert.equal(revalidating.locked, true);
  assert.equal(revalidating.submissionUnconfirmed, true);
  assert.equal(revalidating.keyPreserved, true);
  assert.equal(revalidating.focusDescriptor, "portfolioUrls:0");

  const unconfirmed = vendorEvidenceLifecycleTransition(revalidating, { type: "mutation_unconfirmed" });
  const settled = vendorEvidenceLifecycleTransition(unconfirmed, { type: "mutation_settled" });
  assert.equal(settled.locked, false);
  assert.equal(settled.mutationInFlight, false);
  assert.equal(settled.submissionUnconfirmed, true);
  assert.equal(settled.keyPreserved, true);
  assert.equal(settled.focusDescriptor, "portfolioUrls:0");
  const focusConsumed = vendorEvidenceLifecycleTransition(settled, { type: "consume_focus" });
  assert.equal(focusConsumed.focusDescriptor, null);
  const confirmed = vendorEvidenceLifecycleTransition(settled, { type: "submission_confirmed" });
  assert.equal(confirmed.submissionUnconfirmed, false);
  assert.equal(confirmed.keyPreserved, false);
});

test("discard failure stays cleared and retry or account change removes stale copy", () => {
  let lifecycle = createVendorEvidenceLifecycleState();
  lifecycle = vendorEvidenceLifecycleTransition(lifecycle, {
    type: "capture_focus",
    focusDescriptor: "registration-reference",
  });
  lifecycle = vendorEvidenceLifecycleTransition(lifecycle, { type: "begin_submission" });
  lifecycle = vendorEvidenceLifecycleTransition(lifecycle, { type: "mutation_started" });
  lifecycle = vendorEvidenceLifecycleTransition(lifecycle, { type: "explicit_discard" });
  assert.deepEqual({
    draftCleared: lifecycle.draftCleared,
    explicitDiscard: lifecycle.explicitDiscard,
    locked: lifecycle.locked,
    mutationInFlight: lifecycle.mutationInFlight,
    focusDescriptor: lifecycle.focusDescriptor,
    keyPreserved: lifecycle.keyPreserved,
    submissionUnconfirmed: lifecycle.submissionUnconfirmed,
  }, {
    draftCleared: true,
    explicitDiscard: true,
    locked: false,
    mutationInFlight: false,
    focusDescriptor: null,
    keyPreserved: false,
    submissionUnconfirmed: false,
  });

  lifecycle = vendorEvidenceLifecycleTransition(lifecycle, {
    type: "focus_revalidation",
    mutationInFlight: false,
  });
  assert.equal(lifecycle.explicitDiscard, true);
  assert.equal(lifecycle.locked, false);
  lifecycle = vendorEvidenceLifecycleTransition(lifecycle, { type: "discard_load_failed" });
  assert.equal(lifecycle.draftCleared, true);
  assert.equal(lifecycle.accessErrorMessage, VENDOR_EVIDENCE_DISCARD_FAILURE_MESSAGE);

  const retried = vendorEvidenceLifecycleTransition(lifecycle, { type: "access_retry" });
  assert.equal(retried.draftCleared, true);
  assert.equal(retried.accessErrorMessage, "");

  const failedAgain = vendorEvidenceLifecycleTransition(lifecycle, { type: "discard_load_failed" });
  const accountChanged = vendorEvidenceLifecycleTransition(failedAgain, { type: "clear_private" });
  assert.equal(accountChanged.draftCleared, true);
  assert.equal(accountChanged.explicitDiscard, false);
  assert.equal(accountChanged.accessErrorMessage, "");
  assert.equal(accountChanged.generation, lifecycle.generation + 1);
});

test("vendor evidence requires distinct public portfolio and reference links", () => {
  const errors = validateVendorEvidence({
    portfolioUrls: ["https://portfolio-studio.com/work#first", "https://portfolio-studio.com/work#second"],
    referenceUrls: ["https://127.0.0.1/review"],
    registrationType: "not_registered",
    attested: true,
  });
  assert.equal(errors["portfolioUrls.0"], "Use a different link for each evidence item.");
  assert.equal(errors["portfolioUrls.1"], "Use a different link for each evidence item.");
  assert.match(errors["referenceUrls.0"], /public https/);
});

test("vendor evidence rejects IDN hosts that cannot be safely matched in audit text", () => {
  const errors = validateVendorEvidence({
    portfolioUrls: ["https://例子.公司/work"],
    referenceUrls: ["https://independent-reviews.com/studio"],
    registrationType: "not_registered",
    attested: true,
  });
  assert.match(errors["portfolioUrls.0"], /public https/i);
});

test("vendor evidence normalizes fragments and registration references", () => {
  const evidence = buildVendorEvidence({
    portfolioUrls: [" https://portfolio-studio.com:443/work#gallery ", "https://portfolio-studio.com/film"],
    referenceUrls: ["https://independent-reviews.com/studio#recent"],
    registrationType: "udyam",
    registrationReference: "udyam-rj-12-1234567",
    attested: true,
  });
  assert.deepEqual(evidence, {
    portfolioUrls: ["https://portfolio-studio.com/work", "https://portfolio-studio.com/film"],
    referenceUrls: ["https://independent-reviews.com/studio"],
    registrationType: "udyam",
    registrationReference: "UDYAM-RJ-12-1234567",
    attested: true,
  });
  assert.deepEqual(validateVendorEvidence(evidence), {});
});

test("registration evidence uses narrow public-business identifier formats", () => {
  assert.equal(registrationReferenceError("gstin", "27AAPFU0939F1ZV"), "");
  assert.equal(registrationReferenceError("udyam", "UDYAM-RJ-12-1234567"), "");
  assert.match(registrationReferenceError("gstin", "1234 5678 9012"), /valid/);
  assert.match(registrationReferenceError("cin", "ABCDE1234F"), /valid/);
  assert.equal(registrationReferenceError("not_registered", ""), "");
});

test("vendor evidence requires an explicit applicant attestation", () => {
  const errors = validateVendorEvidence({
    portfolioUrls: ["https://portfolio-studio.com/one", "https://portfolio-studio.com/two"],
    referenceUrls: ["https://independent-reviews.com/studio"],
    registrationType: "not_registered",
    attested: false,
  });
  assert.match(errors.attested, /Confirm/);
});

test("one public link cannot count as both a work sample and reference", () => {
  const errors = validateVendorEvidence({
    portfolioUrls: ["https://studio-work.com/proof#portfolio"],
    referenceUrls: ["https://studio-work.com/proof#reference"],
    registrationType: "not_registered",
    attested: true,
  });
  assert.match(errors["portfolioUrls.0"], /different links/);
  assert.match(errors["referenceUrls.0"], /different links/);
});

test("terminal DNS root dots cannot bypass duplicate evidence detection", () => {
  const errors = validateVendorEvidence({
    portfolioUrls: ["https://studio-work.com./proof"],
    referenceUrls: ["https://studio-work.com/proof"],
    registrationType: "not_registered",
    attested: true,
  });
  assert.match(errors["portfolioUrls.0"], /different links/);
  assert.match(errors["referenceUrls.0"], /different links/);
});

test("vendor application validation mirrors API integer and length constraints", () => {
  const base = {
    businessName: "Studio Name",
    legalName: "Studio Proprietor",
    category: "photography",
    city: "Jaipur",
    serviceAreas: ["Jaipur"],
    description: "A".repeat(80),
    minBudget: "1000",
    maxBudget: "2000",
    phone: "9876543210",
    websiteUrl: "https://studio.example.com",
    instagramHandle: "@studio.name",
  };
  assert.deepEqual(validateVendorApplication(base), {});

  const errors = validateVendorApplication({
    ...base,
    businessName: "B".repeat(141),
    legalName: "L".repeat(181),
    serviceAreas: Array.from({ length: 31 }, (_, index) => `Area ${index}`),
    description: "D".repeat(3_001),
    minBudget: "1000.5",
    maxBudget: "2000.5",
    phone: "9".repeat(25),
    websiteUrl: `https://studio.example.com/${"w".repeat(300)}`,
    instagramHandle: "not a handle",
  });
  for (const field of ["businessName", "legalName", "serviceAreas", "description", "minBudget", "maxBudget", "phone", "websiteUrl", "instagramHandle"]) {
    assert.ok(errors[field], field);
  }
  assert.match(errors.minBudget, /whole-rupee/i);
  assert.match(errors.websiteUrl, /300 characters/i);
});

test("evidence links enforce both raw and normalized API length limits", () => {
  const rawTooLong = `https://portfolio.example.com/${"a".repeat(500)}`;
  const normalizedTooLong = `https://portfolio.example.com/${"b".repeat(280)}`;
  const errors = validateVendorEvidence({
    portfolioUrls: [rawTooLong],
    referenceUrls: [normalizedTooLong],
    registrationType: "not_registered",
    attested: true,
  });
  assert.match(errors["portfolioUrls.0"], /500 characters/i);
  assert.match(errors["referenceUrls.0"], /300 characters/i);
});

test("dynamic evidence fields keep a deterministic focus target", () => {
  assert.equal(evidenceFocusIndexAfterRemoval(3, 0), 0);
  assert.equal(evidenceFocusIndexAfterRemoval(3, 1), 1);
  assert.equal(evidenceFocusIndexAfterRemoval(3, 2), 1);
  assert.equal(evidenceFocusIndexAfterRemoval(1, 0), null);
});

test("evidence completion is offered only where the endpoint accepts it", () => {
  assert.equal(canCompleteVendorEvidence("pending", false), true);
  assert.equal(canCompleteVendorEvidence("rejected", false), true);
  assert.equal(canCompleteVendorEvidence("suspended", false), false);
  assert.equal(canCompleteVendorEvidence("approved", false), false);
  assert.equal(canCompleteVendorEvidence("pending", true), false);
  assert.equal(canCompleteVendorEvidence("needs_information", true), true);
  assert.equal(vendorEvidenceCompletionEligibility({ status: "pending", evidenceComplete: false }), "eligible");
  assert.equal(vendorEvidenceCompletionEligibility({ status: "rejected", evidenceComplete: false }), "eligible");
  assert.equal(vendorEvidenceCompletionEligibility({ status: "suspended", evidenceComplete: false }), "status_unavailable");
  assert.equal(vendorEvidenceCompletionEligibility({ status: "approved", evidenceComplete: false }), "status_unavailable");
  assert.equal(vendorEvidenceCompletionEligibility({ status: "pending", evidenceComplete: true }), "complete");
  assert.equal(vendorEvidenceCompletionEligibility({
    status: "pending",
    effectiveStatus: "needs_information",
    evidenceRevision: 2,
    informationRequestRevision: 4,
    evidence: {
      revision: 2,
      portfolioUrls: ["https://portfolio.example.com/current"],
      referenceUrls: ["https://reviews.example.com/current"],
      registrationType: "not_registered",
      attested: true,
    },
    currentInformationRequest: {
      revision: 4,
      evidenceRevision: 2,
      requestedFields: ["portfolio"],
      applicantMessage: "Please replace the inaccessible portfolio example.",
    },
  }), "revision");
  assert.equal(vendorEvidenceCompletionEligibility({
    effectiveStatus: "needs_information",
    evidenceRevision: 2,
    informationRequestRevision: 4,
    evidence: null,
    currentInformationRequest: {
      revision: 4,
      evidenceRevision: 2,
      requestedFields: ["portfolio"],
      applicantMessage: "Please replace the inaccessible portfolio example.",
    },
  }), "status_unavailable");
  assert.equal(vendorEvidenceCompletionEligibility({
    effectiveStatus: "needs_information",
    evidenceRevision: 2,
    informationRequestRevision: 4,
    evidence: { revision: 2 },
    currentInformationRequest: {
      revision: 4,
      evidenceRevision: 2,
      requestedFields: ["portfolio", "future_field"],
      applicantMessage: "Please replace the inaccessible portfolio example.",
    },
  }), "status_unavailable");
  assert.equal(vendorEvidenceCompletionEligibility({ status: "needs_information", evidenceComplete: true }), "status_unavailable");
  assert.equal(vendorEvidenceCompletionEligibility({ status: "mystery", evidenceComplete: false }), "status_unavailable");
  assert.equal(vendorEvidenceCompletionEligibility(null), "no_application");
});

test("evidence revision payload includes every optimistic concurrency counter", () => {
  const context = normalizeVendorEvidenceContext({
    data: {
      vendorId: "vendor-1",
      status: "pending",
      effectiveStatus: "needs_information",
      reviewRevision: 8,
      informationRequestRevision: 3,
      evidenceSummary: { revision: 2 },
      evidence: {
        revision: 2,
        portfolioUrls: ["https://portfolio.example.com/old"],
        referenceUrls: ["https://reviews.example.com/studio"],
        registrationType: "not_registered",
        registrationReference: "",
        attested: true,
      },
      currentInformationRequest: {
        revision: 3,
        evidenceRevision: 2,
        requestedFields: ["portfolio"],
        applicantMessage: "Please replace the inaccessible portfolio example.",
      },
    },
  });
  const prefilled = prefillVendorEvidence(context);
  assert.deepEqual(prefilled, {
    portfolioUrls: ["https://portfolio.example.com/old"],
    referenceUrls: ["https://reviews.example.com/studio"],
    registrationType: "not_registered",
    registrationReference: "",
    attested: false,
  });
  assert.deepEqual(buildVendorEvidenceSubmissionPayload({
    ...prefilled,
    portfolioUrls: ["https://portfolio.example.com/new"],
    attested: true,
  }, context), {
    evidence: {
      portfolioUrls: ["https://portfolio.example.com/new"],
      referenceUrls: ["https://reviews.example.com/studio"],
      registrationType: "not_registered",
      attested: true,
    },
    expectedVendorId: "vendor-1",
    expectedStatus: "needs_information",
    expectedRevision: 8,
    expectedEvidenceRevision: 2,
    expectedInformationRequestRevision: 3,
  });
});

test("inactive information requests retain their monotonic revision counter", () => {
  const context = normalizeVendorEvidenceContext({
    vendorId: "vendor-2",
    status: "rejected",
    effectiveStatus: "rejected",
    reviewRevision: 5,
    informationRequestRevision: 4,
    evidence: null,
    currentInformationRequest: null,
  });
  const payload = buildVendorEvidenceSubmissionPayload({
    portfolioUrls: ["https://portfolio.example.com/work"],
    referenceUrls: ["https://reviews.example.com/studio"],
    registrationType: "not_registered",
    attested: true,
  }, context);
  assert.equal(payload.expectedInformationRequestRevision, 4);
  assert.equal(payload.expectedStatus, "rejected");
  assert.equal(buildVendorEvidenceSubmissionPayload(payload.evidence, normalizeVendorEvidenceContext({
    ...context,
    informationRequestRevision: null,
  })), null);
  assert.equal(buildVendorEvidenceSubmissionPayload(payload.evidence, normalizeVendorEvidenceContext({
    ...context,
    effectiveStatus: undefined,
  })), null);

  assert.equal(buildVendorEvidenceSubmissionPayload(payload.evidence, {
    ...context,
    effectiveStatus: "needs_information",
    currentInformationRequest: { revision: 3 },
  }), null);
});

test("evidence conflicts compare exact context versions and preserve safe categories", () => {
  const expected = {
    vendorId: "vendor-1",
    effectiveStatus: "needs_information",
    reviewRevision: 6,
    evidenceRevision: 1,
    informationRequestRevision: 2,
    currentInformationRequest: { revision: 2 },
  };
  assert.equal(vendorEvidenceContextsMatch(expected, { ...expected }), true);
  assert.equal(vendorEvidenceContextsMatch(expected, { ...expected, evidenceRevision: 2 }), false);
  assert.equal(vendorEvidenceContextsMatch(expected, { ...expected, informationRequestRevision: 3 }), false);
  assert.equal(vendorEvidenceConflictState({ status: 409, code: "vendor_information_request_conflict" }), "request_changed");
  assert.equal(vendorEvidenceConflictState({ status: 412, code: "unknown_conflict" }), "application_changed");
  assert.equal(vendorEvidenceConflictState({ status: 422 }), null);
});

test("dirty evidence drafts never inherit newer concurrency counters silently", () => {
  const currentContext = {
    vendorId: "vendor-1",
    effectiveStatus: "needs_information",
    reviewRevision: 6,
    evidenceRevision: 1,
    informationRequestRevision: 2,
    currentInformationRequest: { revision: 2 },
  };
  const incomingContext = {
    ...currentContext,
    reviewRevision: 7,
    informationRequestRevision: 3,
    currentInformationRequest: { revision: 3 },
  };

  assert.deepEqual(vendorEvidenceContextRefreshDecision({
    currentContext,
    incomingContext,
    dirty: true,
    formInitialized: true,
    loadedVendorId: currentContext.vendorId,
  }), {
    accountChanged: false,
    shouldResetForm: false,
    conflict: true,
  });
  assert.deepEqual(vendorEvidenceContextRefreshDecision({
    currentContext,
    incomingContext,
    dirty: false,
    formInitialized: true,
    loadedVendorId: currentContext.vendorId,
  }), {
    accountChanged: false,
    shouldResetForm: true,
    conflict: false,
  });
  assert.deepEqual(vendorEvidenceContextRefreshDecision({
    currentContext,
    incomingContext: { ...incomingContext, vendorId: "vendor-2" },
    dirty: true,
    formInitialized: true,
    loadedVendorId: currentContext.vendorId,
  }), {
    accountChanged: true,
    shouldResetForm: true,
    conflict: false,
  });
  assert.deepEqual(vendorEvidenceContextRefreshDecision({
    currentContext,
    incomingContext: { ...currentContext },
    dirty: true,
    formInitialized: true,
    loadedVendorId: currentContext.vendorId,
  }), {
    accountChanged: false,
    shouldResetForm: false,
    conflict: false,
  });
  assert.deepEqual(vendorEvidenceContextRefreshDecision({
    currentContext: null,
    incomingContext,
    dirty: true,
    formInitialized: true,
  }), {
    accountChanged: false,
    shouldResetForm: false,
    conflict: true,
  });
  assert.deepEqual(vendorEvidenceContextRefreshDecision({
    currentContext: null,
    incomingContext: { ...incomingContext, vendorId: "vendor-2" },
    dirty: true,
    formInitialized: true,
    loadedVendorId: currentContext.vendorId,
  }), {
    accountChanged: true,
    shouldResetForm: true,
    conflict: false,
  });
});

test("account transitions clear private evidence before another onboarding flow can render it", () => {
  assert.equal(shouldClearVendorEvidencePrivateDraft({
    evidenceOnly: true,
    accessResolved: true,
    incomingContext: null,
  }), true);
  assert.equal(shouldClearVendorEvidencePrivateDraft({
    evidenceOnly: false,
    wasEvidenceOnly: true,
  }), true);
  assert.equal(shouldClearVendorEvidencePrivateDraft({
    evidenceOnly: true,
    wasEvidenceOnly: false,
  }), true);
  assert.equal(shouldClearVendorEvidencePrivateDraft({
    evidenceOnly: true,
    identityChanged: true,
    incomingContext: { vendorId: "vendor-2" },
  }), true);
  assert.equal(shouldClearVendorEvidencePrivateDraft({
    evidenceOnly: false,
    identityChanged: true,
  }), false);
  assert.equal(shouldClearVendorEvidencePrivateDraft({
    evidenceOnly: true,
    accessResolved: true,
    incomingContext: { vendorId: "vendor-1" },
  }), false);
});

test("explicit reload discards a dirty draft even when the application became terminal", () => {
  const completeContext = {
    vendorId: "vendor-1",
    effectiveStatus: "pending",
    reviewRevision: 7,
    evidenceRevision: 2,
    informationRequestRevision: 2,
  };
  assert.deepEqual(vendorEvidenceExplicitReloadPlan({
    state: "complete",
    context: completeContext,
  }), {
    vendorId: "vendor-1",
    shouldPrefill: false,
  });
  assert.deepEqual(vendorEvidenceExplicitReloadPlan({
    state: "status_unavailable",
    context: { ...completeContext, effectiveStatus: "approved" },
  }), {
    vendorId: "vendor-1",
    shouldPrefill: false,
  });

  const nextRequestContext = {
    ...completeContext,
    effectiveStatus: "needs_information",
    reviewRevision: 8,
    informationRequestRevision: 3,
    currentInformationRequest: { revision: 3 },
  };
  assert.deepEqual(vendorEvidenceContextRefreshDecision({
    currentContext: completeContext,
    incomingContext: nextRequestContext,
    dirty: false,
    formInitialized: false,
  }), {
    accountChanged: false,
    shouldResetForm: true,
    conflict: false,
  });
  assert.equal(vendorEvidenceExplicitReloadPlan({
    state: "revision",
    context: nextRequestContext,
  }).shouldPrefill, true);
});

test("ambiguous retries revalidate exact vendor identity before replaying", () => {
  assert.equal(shouldPreflightVendorEvidenceSubmission({ evidenceOnly: true, submissionUnconfirmed: false }), true);
  assert.equal(shouldPreflightVendorEvidenceSubmission({ evidenceOnly: true, submissionUnconfirmed: true }), true);
  assert.equal(shouldPreflightVendorEvidenceSubmission({ evidenceOnly: false, submissionUnconfirmed: true }), false);
  const expectedContext = {
    vendorId: "vendor-1",
    effectiveStatus: "needs_information",
    reviewRevision: 6,
    evidenceRevision: 1,
    informationRequestRevision: 2,
    currentInformationRequest: { revision: 2 },
  };
  assert.equal(vendorEvidencePreflightIdentityMatches(expectedContext, { context: { ...expectedContext } }), true);
  assert.equal(vendorEvidencePreflightIdentityMatches(expectedContext, { context: null }), false);
  assert.equal(vendorEvidencePreflightIdentityMatches(expectedContext, {
    context: { ...expectedContext, vendorId: "vendor-2" },
  }), false);
  assert.equal(vendorEvidencePreflightIdentityMatches(
    { ...expectedContext, vendorId: "   " },
    { context: { ...expectedContext, vendorId: "   " } },
  ), false);
  assert.equal(vendorEvidencePreflightIdentityMatches(
    { ...expectedContext, vendorId: `vendor-${"x".repeat(128)}` },
    { context: { ...expectedContext, vendorId: `vendor-${"x".repeat(128)}` } },
  ), false);
  assert.equal(normalizeVendorEvidenceContext({ vendorId: " vendor-1 " }).vendorId, "");
  assert.equal(vendorEvidencePreflightMatches({
    expectedContext,
    accessResult: { state: "complete", context: { ...expectedContext, reviewRevision: 7 } },
    submissionUnconfirmed: true,
  }), true);
  assert.equal(vendorEvidencePreflightMatches({
    expectedContext,
    accessResult: { state: "revision", context: { ...expectedContext, vendorId: "vendor-2" } },
    submissionUnconfirmed: true,
  }), false);
  assert.equal(vendorEvidencePreflightMatches({
    expectedContext,
    accessResult: { state: "revision", context: { ...expectedContext, reviewRevision: 7 } },
  }), false);

  for (const mutationStatus of [403, 404, 409]) {
    assert.equal(vendorEvidencePreflightIdentityMatches(expectedContext, {
      mutationStatus,
      context: null,
    }), false);
    assert.equal(vendorEvidencePreflightIdentityMatches(expectedContext, {
      mutationStatus,
      context: { ...expectedContext, vendorId: "vendor-2" },
    }), false);
    assert.equal(vendorEvidencePreflightIdentityMatches(expectedContext, {
      mutationStatus,
      context: { ...expectedContext },
    }), true);
  }
});
