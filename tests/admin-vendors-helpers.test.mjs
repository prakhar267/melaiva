import test from "node:test";
import assert from "node:assert/strict";
import {
  adjustAdminStatusCounts,
  adminVendorActions,
  normalizeAdminStatusCounts,
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
  assert.match(validateAdminReviewReason("x".repeat(1_001)), /1,000/i);
  assert.match(validateAdminReviewReason("Evidence checked\u202E hidden"), /bidirectional/i);
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
