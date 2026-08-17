import { readApiResponse } from "../api.js";

export const VENDOR_APPLICATION_EVIDENCE_REVISION = 1;
export const ADMIN_VENDOR_SUMMARY_CONTRACT = "vendor-summary-v1";

export const ADMIN_VENDOR_SUMMARY_HEADERS = Object.freeze({
  "X-Melaiva-Admin-Vendor-Summary": "1",
});

export function supportsVendorApplicationEvidence(payload) {
  return payload?.data?.vendorApplicationEvidenceRevision === VENDOR_APPLICATION_EVIDENCE_REVISION;
}

export function supportsAdminVendorSummaryContract(payload, responseHeaderValue) {
  return responseHeaderValue === "1" && payload?.meta?.contract === ADMIN_VENDOR_SUMMARY_CONTRACT;
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
