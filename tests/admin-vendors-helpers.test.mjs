import test from "node:test";
import assert from "node:assert/strict";
import {
  adjustAdminStatusCounts,
  adminVendorDecisionAcknowledgement,
  adminVendorEvidenceState,
  adminVendorEvidenceSummaryLabel,
  adminVendorActions,
  isAdminVendorActionAllowed,
  normalizeAdminStatusCounts,
  normalizeAdminVendorSummary,
  normalizeAdminVendorStatus,
  validateAdminReviewReason,
} from "../src/components/adminVendors.js";
import { parsePublicWebsiteUrl } from "../src/security/publicWebsiteUrl.js";

test("admin vendor status input fails closed to the pending queue", () => {
  assert.equal(normalizeAdminVendorStatus("approved"), "approved");
  assert.equal(normalizeAdminVendorStatus("deleted"), "pending");
  assert.equal(normalizeAdminVendorStatus(null), "pending");
});

test("admin vendor actions expose only the allowed next states", () => {
  assert.deepEqual(adminVendorActions("pending").map((action) => action.targetStatus), ["approved", "rejected"]);
  assert.deepEqual(adminVendorActions("approved").map((action) => action.targetStatus), ["suspended"]);
  assert.deepEqual(adminVendorActions("suspended").map((action) => action.targetStatus), ["approved"]);
  assert.deepEqual(adminVendorActions("rejected").map((action) => action.targetStatus), ["pending"]);
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
  const required = { evidenceRequired: true, evidenceSummary: null, evidence: null };
  const legacy = { evidenceRequired: false, evidenceSummary: null, evidence: null };
  const submitted = {
    evidenceRequired: true,
    evidenceSummary: { revision: 2, portfolioUrlCount: 1, referenceUrlCount: 1 },
  };
  const malformedDetail = {
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
  assert.match(adminVendorEvidenceSummaryLabel(submitted), /2 submitted evidence links · Revision 2/);
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
    evidenceRequired: true,
    evidenceSummary: null,
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
    "evidenceSummary",
    "id",
    "revision",
    "status",
  ]);
  for (const privateField of ["legalName", "phone", "websiteUrl", "owner", "evidence"]) {
    assert.equal(Object.hasOwn(summary, privateField), false, privateField);
  }
});

test("status count normalization preserves unavailable counts", () => {
  assert.deepEqual(normalizeAdminStatusCounts({ pending: 3, approved: "4", rejected: -1 }), {
    pending: 3,
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
