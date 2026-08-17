import { readApiResponse } from "../api.js";

export const VENDOR_APPLICATION_EVIDENCE_REVISION = 5;
export const ADMIN_VENDOR_SUMMARY_CONTRACT = "vendor-summary-v2";
export const WORKER_VERSION_AFFINITY_HEADER = "Cloudflare-Workers-Version-Key";
const WORKER_VERSION_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;

export const VENDOR_APPLICATION_EVIDENCE_HEADERS = Object.freeze({
  "X-Melaiva-Vendor-Evidence": String(VENDOR_APPLICATION_EVIDENCE_REVISION),
});

export function workerVersionAffinityHeaders(versionKey) {
  return typeof versionKey === "string" && WORKER_VERSION_KEY_PATTERN.test(versionKey)
    ? { [WORKER_VERSION_AFFINITY_HEADER]: versionKey }
    : {};
}

export const ADMIN_VENDOR_SUMMARY_HEADERS = Object.freeze({
  "X-Melaiva-Admin-Vendor-Summary": "2",
});

export function supportsVendorApplicationEvidence(payload) {
  return payload?.data?.vendorApplicationEvidenceRevision === VENDOR_APPLICATION_EVIDENCE_REVISION;
}

export function supportsAdminVendorSummaryContract(payload, responseHeaderValue) {
  return responseHeaderValue === "2" && payload?.meta?.contract === ADMIN_VENDOR_SUMMARY_CONTRACT;
}

export async function checkVendorApplicationEvidenceCompatibility({ signal, versionKey } = {}) {
  const response = await fetch("/api/v1/auth/config", {
    cache: "no-store",
    credentials: "include",
    headers: workerVersionAffinityHeaders(versionKey),
    signal,
  });
  const payload = await readApiResponse(response, "Secure vendor-review compatibility could not be checked.");
  return supportsVendorApplicationEvidence(payload);
}
