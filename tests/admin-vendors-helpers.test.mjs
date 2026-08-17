import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  adjustAdminStatusCounts,
  classifyAdminVendorDecisionFailure,
  adminVendorDecisionAcknowledgement,
  adminVendorEvidenceState,
  adminVendorEvidenceSummaryLabel,
  adminVendorActions,
  focusFirstInvalidAdminDecisionControl,
  isAdminVendorActionAllowed,
  normalizeAdminStatusCounts,
  normalizeAdminVendorSummary,
  normalizeAdminVendorStatus,
  validateAdminInformationRequest,
  validateAdminReviewReason,
} from "../src/components/adminVendors.js";
import { parsePublicWebsiteUrl } from "../src/security/publicWebsiteUrl.js";

test("admin vendor status input fails closed to the pending queue", () => {
  assert.equal(normalizeAdminVendorStatus("approved"), "approved");
  assert.equal(normalizeAdminVendorStatus("deleted"), "pending");
  assert.equal(normalizeAdminVendorStatus(null), "pending");
});

test("admin vendor actions expose only the allowed next states", () => {
  assert.deepEqual(adminVendorActions("pending").map((action) => action.targetStatus), ["approved", "needs_information", "rejected"]);
  assert.deepEqual(adminVendorActions("approved").map((action) => action.targetStatus), ["suspended"]);
  assert.deepEqual(adminVendorActions("suspended").map((action) => action.targetStatus), ["approved"]);
  assert.deepEqual(adminVendorActions("rejected").map((action) => action.targetStatus), ["needs_information", "pending"]);
  assert.deepEqual(adminVendorActions("needs_information").map((action) => action.targetStatus), ["pending", "rejected"]);
  assert.deepEqual(adminVendorActions("unknown"), []);
});

test("review reasons enforce the API length contract after trimming", () => {
  assert.match(validateAdminReviewReason(" too short "), /at least 10/i);
  assert.equal(validateAdminReviewReason("Evidence checked with the partner."), "");
  assert.equal(validateAdminReviewReason("Evidence checked. Application meets the category requirements."), "");
  assert.equal(validateAdminReviewReason("Approved. Evidence is complete."), "");
  assert.match(validateAdminReviewReason("x".repeat(1_001)), /1,000/i);
  assert.match(validateAdminReviewReason("Evidence checked\u202E hidden"), /bidirectional/i);
});

test("review reasons keep evidence addresses and registration references out of audit text", () => {
  for (const unsafeReason of [
    "Reviewed https://portfolio.example.com/work before approval.",
    "Reviewed www.portfolio.example.com before approval.",
    "Reviewed portfolio.example.com before approval.",
    "Reviewed destination 192.168.0.20 before approval.",
    "Identity 1234 5678 9012 was checked independently.",
    "Registration 27AAPFU0939F1ZV was checked independently.",
    "Registration 27 AAPFU 0939 F 1 Z V was checked independently.",
    "Registration L12345RJ2020PLC123456 was checked independently.",
    "Registration L 12345 RJ 2020 PLC 123456 was checked independently.",
    "Registration UDYAM-RJ-12-1234567 was checked independently.",
    "Registration UDYAM RJ 12 1234567 was checked independently.",
  ]) {
    assert.match(validateAdminReviewReason(unsafeReason), /registration|evidence|address|identity/i, unsafeReason);
  }
  const vendor = {
    evidence: {
      portfolioUrls: ["https://work-samples.example.net/gallery"],
      referenceUrls: ["https://reviews.example.org/studio"],
      registrationReference: "UDYAM-RJ-12-1234567",
    },
  };
  assert.match(validateAdminReviewReason("Reviewed work samples example net before approval.", vendor), /evidence/i);
  assert.match(validateAdminReviewReason("Checked UDYAM RJ 12 1234567 independently.", vendor), /registration|identity/i);
  assert.equal(validateAdminReviewReason("Public work, references and service fit were reviewed."), "");
});

test("approval acknowledgements distinguish exact evidence from legacy alternate checks", () => {
  const approve = adminVendorActions("pending")[0];
  const evidenceBacked = adminVendorDecisionAcknowledgement(approve, {
    evidence: { revision: 3, registrationType: "not_registered" },
  });
  assert.match(evidenceBacked, /evidence revision 3/i);
  assert.match(evidenceBacked, /alternate business checks/i);

  const legacy = adminVendorDecisionAcknowledgement(approve, { evidence: null, evidenceRequired: false });
  assert.doesNotMatch(legacy, /submitted evidence/i);
  assert.match(legacy, /legacy application/i);
  assert.match(legacy, /work, reference and business checks/i);

  const required = adminVendorDecisionAcknowledgement(approve, { evidence: null, evidenceRequired: true });
  assert.doesNotMatch(required, /legacy/i);
  assert.match(required, /unavailable until/i);
});

test("required and genuine legacy evidence states gate approval accurately", () => {
  const approve = adminVendorActions("pending")[0];
  const required = { status: "pending", evidenceRequired: true, evidenceSummary: null, evidence: null };
  const legacy = { status: "pending", evidenceRequired: false, evidenceSummary: null, evidence: null };
  const submitted = {
    status: "pending",
    evidenceRequired: true,
    evidenceSummary: { revision: 2, portfolioUrlCount: 1, referenceUrlCount: 1 },
  };
  const malformedDetail = {
    status: "pending",
    evidenceRequired: true,
    evidence: null,
    evidenceSummary: { revision: 2, portfolioUrlCount: 1, referenceUrlCount: 1 },
  };

  assert.equal(adminVendorEvidenceState(required), "required");
  assert.equal(adminVendorEvidenceSummaryLabel(required), "Evidence required · submission incomplete");
  assert.equal(isAdminVendorActionAllowed(approve, required), false);
  assert.equal(adminVendorEvidenceState(legacy), "legacy");
  assert.equal(adminVendorEvidenceSummaryLabel(legacy), "Legacy · no structured evidence");
  assert.equal(isAdminVendorActionAllowed(approve, legacy), true);
  assert.equal(adminVendorEvidenceState(submitted), "submitted");
  assert.match(adminVendorEvidenceSummaryLabel(submitted), /Evidence revision 2 · 2 submitted links/);
  assert.equal(isAdminVendorActionAllowed(approve, submitted), true);
  assert.equal(adminVendorEvidenceState(malformedDetail), "required");
  assert.equal(isAdminVendorActionAllowed(approve, malformedDetail), false);
});

test("queue normalization strictly drops legacy full-detail fields", () => {
  const summary = normalizeAdminVendorSummary({
    id: "vendor-1",
    businessName: "Private Studio",
    status: "pending",
    category: "photography",
    city: "Jaipur",
    createdAt: "2026-08-17T00:00:00.000Z",
    reviewRevision: 4,
    evidenceReviewedRevision: 2,
    evidenceRequired: true,
    evidenceSummary: null,
    informationRequestSummary: {
      revision: 3,
      evidenceRevision: 2,
      requestedFields: ["portfolio"],
      requestedAt: "2026-08-17T01:00:00.000Z",
      applicantMessage: "This detail-only message must be discarded.",
    },
    legalName: "Private Studio Legal Name",
    phone: "+91 99999 99999",
    websiteUrl: "https://private-studio.example.com",
    owner: { email: "owner@example.com" },
    evidence: { portfolioUrls: ["https://private-studio.example.com/work"] },
  });

  assert.deepEqual(Object.keys(summary).sort(), [
    "businessName",
    "category",
    "city",
    "createdAt",
    "evidenceRequired",
    "evidenceReviewedRevision",
    "evidenceSummary",
    "id",
    "informationRequestSummary",
    "revision",
    "status",
  ]);
  for (const privateField of ["legalName", "phone", "websiteUrl", "owner", "evidence"]) {
    assert.equal(Object.hasOwn(summary, privateField), false, privateField);
  }
  assert.deepEqual(summary.informationRequestSummary, {
    revision: 3,
    evidenceRevision: 2,
    requestedFields: ["portfolio"],
    requestedAt: "2026-08-17T01:00:00.000Z",
  });
  assert.equal(Object.hasOwn(summary.informationRequestSummary, "applicantMessage"), false);
  assert.equal(normalizeAdminVendorSummary({
    ...summary,
    status: "needs_information",
    reviewRevision: summary.revision,
    informationRequestSummary: {
      revision: 4,
      evidenceRevision: 2,
      requestedFields: ["portfolio", "future_field"],
    },
  }).informationRequestSummary, null);
  assert.equal(normalizeAdminVendorSummary({
    ...summary,
    status: "needs_information",
    reviewRevision: summary.revision,
    informationRequestSummary: {
      revision: 4,
      evidenceRevision: 2,
      requestedFields: ["portfolio", "portfolio"],
    },
  }).informationRequestSummary, null);
});

test("status count normalization preserves unavailable counts", () => {
  assert.deepEqual(normalizeAdminStatusCounts({ pending: 3, approved: "4", rejected: -1 }), {
    pending: 3,
    needs_information: null,
    approved: 4,
    rejected: null,
    suspended: null,
  });
});

test("status counts move once and never become negative", () => {
  assert.deepEqual(
    adjustAdminStatusCounts({ pending: 1, approved: 2, rejected: 0, suspended: 0 }, "pending", "approved"),
    { pending: 0, approved: 3, rejected: 0, suspended: 0 },
  );
  assert.deepEqual(
    adjustAdminStatusCounts({ pending: 0, rejected: 0 }, "pending", "rejected"),
    { pending: 0, rejected: 1 },
  );
});

test("information requests require safe applicant-visible instructions separate from private reasons", () => {
  const vendor = {
    evidence: {
      portfolioUrls: ["https://work-samples.example.net/gallery"],
      referenceUrls: ["https://reviews.example.org/studio"],
      registrationReference: "UDYAM-RJ-12-1234567",
    },
  };
  const applicantMessage = "Please replace the inaccessible work sample and add a current public review.";
  assert.deepEqual(validateAdminInformationRequest({ requestedFields: ["portfolio", "references"], applicantMessage }, vendor), {});
  assert.match(validateAdminInformationRequest({
    requestedFields: ["portfolio", "portfolio", "references"],
    applicantMessage,
  }, vendor).requestedFields, /only once/i);
  assert.match(validateAdminInformationRequest({ requestedFields: ["portfolio", "unknown"], applicantMessage }, vendor).requestedFields, /only the listed/i);
  assert.match(validateAdminInformationRequest({ requestedFields: [], applicantMessage: "Please update the evidence supplied." }, vendor).requestedFields, /at least one/i);
  for (const applicantMessage of [
    "Open https://private.example.com and replace this item.",
    "Confirm PAN ABCDE1234F before sending a revision.",
    "Update registration UDYAM-RJ-12-1234567 for review.",
    "Replace work samples example net with a current gallery.",
  ]) {
    assert.match(validateAdminInformationRequest({ requestedFields: ["portfolio"], applicantMessage }, vendor).applicantMessage, /address|identity|registration|evidence/i, applicantMessage);
  }
});

test("decision validation focuses the first enabled invalid control instead of an invalid group", () => {
  let selector = "";
  let focusCount = 0;
  const container = {
    querySelector(value) {
      selector = value;
      return { focus: () => { focusCount += 1; } };
    },
  };
  assert.equal(focusFirstInvalidAdminDecisionControl(container), true);
  assert.equal(focusCount, 1);
  assert.match(selector, /input\[aria-invalid="true"\]:not\(:disabled\)/u);
  assert.match(selector, /textarea\[aria-invalid="true"\]:not\(:disabled\)/u);
  assert.doesNotMatch(selector, /fieldset/u);
  assert.equal(focusFirstInvalidAdminDecisionControl({ querySelector: () => null }), false);
});

test("custom checkbox boundaries meet the 3:1 non-text contrast threshold", () => {
  const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const boundary = styles.match(/--control-boundary:\s*(#[0-9a-f]{6})/iu)?.[1];
  const paper = styles.match(/--paper:\s*(#[0-9a-f]{6})/iu)?.[1];
  const luminance = (color) => {
    const channels = color.slice(1).match(/../gu).map((value) => Number.parseInt(value, 16) / 255);
    const [red, green, blue] = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };
  assert.ok(boundary);
  assert.ok(paper);
  const lighter = Math.max(luminance(boundary), luminance(paper));
  const darker = Math.min(luminance(boundary), luminance(paper));
  assert.ok((lighter + 0.05) / (darker + 0.05) >= 3);
  assert.match(styles, /\.admin-information-request-form fieldset label > span \{[^\n]*var\(--control-boundary\)/u);
  assert.match(styles, /\.admin-decision-dialog__acknowledgement > span \{[^\n]*var\(--control-boundary\)/u);
});

test("needs-information status is non-approvable and accepts only its declared actions", () => {
  const needsInformation = {
    status: "needs_information",
    evidenceRequired: true,
    evidence: { revision: 2 },
  };
  const requestInformation = adminVendorActions("pending").find((action) => action.targetStatus === "needs_information");
  const approve = adminVendorActions("pending").find((action) => action.targetStatus === "approved");
  const cancel = adminVendorActions("needs_information").find((action) => action.targetStatus === "pending");
  assert.equal(isAdminVendorActionAllowed(approve, needsInformation), false);
  assert.equal(isAdminVendorActionAllowed(requestInformation, needsInformation), false);
  assert.equal(isAdminVendorActionAllowed(cancel, needsInformation), true);
});

test("decision failures distinguish safe replay from stale or conflicting keys", () => {
  assert.equal(classifyAdminVendorDecisionFailure(new TypeError("network failed")), "unconfirmed");
  assert.equal(classifyAdminVendorDecisionFailure({ status: 503, unavailable: true }), "unconfirmed");
  assert.equal(classifyAdminVendorDecisionFailure({ status: 409, code: "vendor_review_conflict" }), "application_changed");
  assert.equal(classifyAdminVendorDecisionFailure({ status: 409, code: "idempotency_conflict" }), "idempotency_conflict");
  assert.equal(classifyAdminVendorDecisionFailure({ status: 422, code: "validation_failed" }), "failed");
});

test("operator evidence links allow only public credential-free HTTPS destinations", () => {
  assert.deepEqual(parsePublicWebsiteUrl("https://www.vendor.example.com/portfolio"), {
    href: "https://www.vendor.example.com/portfolio",
    hostname: "vendor.example.com",
  });
  assert.deepEqual(parsePublicWebsiteUrl("https://www.vendor.example.com./portfolio#gallery"), {
    href: "https://www.vendor.example.com/portfolio",
    hostname: "vendor.example.com",
  });
  for (const unsafeUrl of [
    "http://vendor.example.com",
    "https://localhost/private",
    "https://127.0.0.1/private",
    "https://10.0.0.1/private",
    "https://169.254.169.254/latest/meta-data",
    "https://[::1]/private",
    "https://operator:secret@vendor.example.com",
    "https://vendor.onion/private",
    "https://vendor.test/private",
  ]) {
    assert.equal(parsePublicWebsiteUrl(unsafeUrl), null, unsafeUrl);
  }
});
