import assert from "node:assert/strict";
import test from "node:test";

import {
  buildVendorEvidence,
  buildVendorEvidenceSubmissionPayload,
  canCompleteVendorEvidence,
  evidenceFocusIndexAfterRemoval,
  normalizeVendorEvidenceContext,
  prefillVendorEvidence,
  registrationReferenceError,
  shouldPreflightVendorEvidenceSubmission,
  validateVendorApplication,
  validateVendorEvidence,
  vendorEvidenceCompletionEligibility,
  vendorEvidenceConflictState,
  vendorEvidenceContextRefreshDecision,
  vendorEvidenceContextsMatch,
} from "../src/components/vendorOnboarding.js";
import {
  supportsAdminVendorSummaryContract,
  supportsVendorApplicationEvidence,
} from "../src/components/vendorApplicationCompatibility.js";

test("vendor evidence compatibility fails closed across mixed Worker versions", () => {
  assert.equal(supportsVendorApplicationEvidence({ data: { vendorApplicationEvidenceRevision: 2 } }), true);
  assert.equal(supportsVendorApplicationEvidence({ data: {} }), false);
  assert.equal(supportsVendorApplicationEvidence({ data: { vendorApplicationEvidenceRevision: "2" } }), false);
  assert.equal(supportsVendorApplicationEvidence({ data: { vendorApplicationEvidenceRevision: 1 } }), false);

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

test("ambiguous unchanged retries bypass only the stale preflight and preserve server CAS", () => {
  assert.equal(shouldPreflightVendorEvidenceSubmission({ evidenceOnly: true, submissionUnconfirmed: false }), true);
  assert.equal(shouldPreflightVendorEvidenceSubmission({ evidenceOnly: true, submissionUnconfirmed: true }), false);
  assert.equal(shouldPreflightVendorEvidenceSubmission({ evidenceOnly: false, submissionUnconfirmed: true }), false);
});
