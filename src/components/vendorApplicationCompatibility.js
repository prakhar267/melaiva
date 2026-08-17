import { readApiResponse } from "../api.js";

export const VENDOR_APPLICATION_EVIDENCE_REVISION = 3;
export const ADMIN_VENDOR_SUMMARY_CONTRACT = "vendor-summary-v2";

export const ADMIN_VENDOR_SUMMARY_HEADERS = Object.freeze({
  "X-Melaiva-Admin-Vendor-Summary": "2",
});

export function supportsVendorApplicationEvidence(payload) {
  return payload?.data?.vendorApplicationEvidenceRevision === VENDOR_APPLICATION_EVIDENCE_REVISION;
}

export function supportsAdminVendorSummaryContract(payload, responseHeaderValue) {
  return responseHeaderValue === "2" && payload?.meta?.contract === ADMIN_VENDOR_SUMMARY_CONTRACT;
}

export async function checkVendorApplicationEvidenceCompatibility({ signal } = {}) {
  const response = await fetch("/api/v1/auth/config", {
    cache: "no-store",
    credentials: "include",
    signal,
  });
  const payload = await readApiResponse(response, "Secure vendor-review compatibility could not be checked.");
  return supportsVendorApplicationEvidence(payload);
}
