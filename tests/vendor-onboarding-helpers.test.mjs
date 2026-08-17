import assert from "node:assert/strict";
import test from "node:test";

import {
  buildVendorEvidence,
  canCompleteVendorEvidence,
  evidenceFocusIndexAfterRemoval,
  registrationReferenceError,
  validateVendorApplication,
  validateVendorEvidence,
  vendorEvidenceCompletionEligibility,
} from "../src/components/vendorOnboarding.js";
import {
  supportsAdminVendorSummaryContract,
  supportsVendorApplicationEvidence,
} from "../src/components/vendorApplicationCompatibility.js";

test("vendor evidence compatibility fails closed across mixed Worker versions", () => {
  assert.equal(supportsVendorApplicationEvidence({ data: { vendorApplicationEvidenceRevision: 1 } }), true);
  assert.equal(supportsVendorApplicationEvidence({ data: {} }), false);
  assert.equal(supportsVendorApplicationEvidence({ data: { vendorApplicationEvidenceRevision: "1" } }), false);
  assert.equal(supportsVendorApplicationEvidence({ data: { vendorApplicationEvidenceRevision: 2 } }), false);

  const summaryPayload = { meta: { contract: "vendor-summary-v1" } };
  assert.equal(supportsAdminVendorSummaryContract(summaryPayload, "1"), true);
  assert.equal(supportsAdminVendorSummaryContract(summaryPayload, null), false);
  assert.equal(supportsAdminVendorSummaryContract({ meta: {} }, "1"), false);
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
  assert.equal(vendorEvidenceCompletionEligibility({ status: "pending", evidenceComplete: false }), "eligible");
  assert.equal(vendorEvidenceCompletionEligibility({ status: "rejected", evidenceComplete: false }), "eligible");
  assert.equal(vendorEvidenceCompletionEligibility({ status: "suspended", evidenceComplete: false }), "status_unavailable");
  assert.equal(vendorEvidenceCompletionEligibility({ status: "approved", evidenceComplete: false }), "status_unavailable");
  assert.equal(vendorEvidenceCompletionEligibility({ status: "pending", evidenceComplete: true }), "complete");
  assert.equal(vendorEvidenceCompletionEligibility(null), "no_application");
});
