#!/usr/bin/env node

const baseUrl = (process.env.MELAIVA_SMOKE_BASE_URL || "").replace(/\/$/u, "");
if (!baseUrl.startsWith("https://")) {
  throw new Error("Set MELAIVA_SMOKE_BASE_URL to the deployed HTTPS origin.");
}

function parsePositiveInteger(value, name) {
  if (!/^[1-9][0-9]*$/u.test(value || "")) {
    throw new Error(`${name} must be a positive integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${name} is outside the supported range.`);
  return parsed;
}

function releaseIncludesRequestCoverage(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-|$)/u.exec(String(version || ""));
  if (!match) throw new Error("Health response did not include a valid application version.");
  const [, major, minor] = match.map(Number);
  return major > 0 || minor >= 13;
}

const expectedRevisionInput = (process.env.MELAIVA_SMOKE_EXPECTED_EVIDENCE_REVISION || "").trim();
const minimumRevisionInput = (process.env.MELAIVA_SMOKE_MINIMUM_EVIDENCE_REVISION || "").trim();
if (expectedRevisionInput && minimumRevisionInput) {
  throw new Error("Set only one evidence revision expectation.");
}
const expectedEvidenceRevision = expectedRevisionInput
  ? parsePositiveInteger(expectedRevisionInput, "MELAIVA_SMOKE_EXPECTED_EVIDENCE_REVISION")
  : minimumRevisionInput
    ? null
    : 5;
const minimumEvidenceRevision = minimumRevisionInput
  ? parsePositiveInteger(minimumRevisionInput, "MELAIVA_SMOKE_MINIMUM_EVIDENCE_REVISION")
  : null;

const expectedWorkerVersionId = (process.env.MELAIVA_SMOKE_EXPECTED_WORKER_VERSION_ID || "").trim();
if (expectedWorkerVersionId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(expectedWorkerVersionId)) {
  throw new Error("MELAIVA_SMOKE_EXPECTED_WORKER_VERSION_ID must be a Worker version UUID.");
}
const expectedWorkerVersionTag = (process.env.MELAIVA_SMOKE_EXPECTED_WORKER_VERSION_TAG || "").trim();
if (expectedWorkerVersionTag && !/^[0-9a-f]{40}$/u.test(expectedWorkerVersionTag)) {
  throw new Error("MELAIVA_SMOKE_EXPECTED_WORKER_VERSION_TAG must be a full lowercase Git SHA.");
}

const workerVersionOverride = (process.env.MELAIVA_SMOKE_WORKER_VERSION_OVERRIDE || "").trim();
const workerName = (process.env.MELAIVA_SMOKE_WORKER_NAME || "").trim();
if (Boolean(workerVersionOverride) !== Boolean(workerName)) {
  throw new Error("Set both MELAIVA_SMOKE_WORKER_VERSION_OVERRIDE and MELAIVA_SMOKE_WORKER_NAME.");
}
if (workerVersionOverride && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(workerVersionOverride)) {
  throw new Error("MELAIVA_SMOKE_WORKER_VERSION_OVERRIDE must be a Worker version UUID.");
}
if (workerName && !/^[a-z0-9][a-z0-9-]{0,62}$/u.test(workerName)) {
  throw new Error("MELAIVA_SMOKE_WORKER_NAME is invalid.");
}

const versionOverrideHeaders = workerVersionOverride
  ? { "Cloudflare-Workers-Version-Overrides": `${workerName}="${workerVersionOverride}"` }
  : {};

async function request(path, { accept = "application/json" } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { Accept: accept, ...versionOverrideHeaders },
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`GET ${path} failed (${response.status}).`);
  if (response.headers.get("x-content-type-options") !== "nosniff") {
    throw new Error(`GET ${path} is missing the nosniff security header.`);
  }
  return { response, body };
}

const healthResponse = await request("/health");
const health = JSON.parse(healthResponse.body);
if (health?.data?.status !== "ok" || health?.data?.database !== "ok" || health?.data?.authentication !== "ok") {
  throw new Error("Health response did not report all required services as healthy.");
}
if (expectedWorkerVersionId && health?.data?.workerVersionId !== expectedWorkerVersionId) {
  throw new Error(`Health response ran Worker version ${health?.data?.workerVersionId || "unknown"}, expected ${expectedWorkerVersionId}.`);
}
if (expectedWorkerVersionTag && health?.data?.workerVersionTag !== expectedWorkerVersionTag) {
  throw new Error(`Health response ran Worker tag ${health?.data?.workerVersionTag || "unknown"}, expected ${expectedWorkerVersionTag}.`);
}

const authConfigResponse = await request("/api/v1/auth/config");
const authConfig = JSON.parse(authConfigResponse.body);
const evidenceRevision = authConfig?.data?.vendorApplicationEvidenceRevision;
if (!Number.isSafeInteger(evidenceRevision)
  || (expectedEvidenceRevision !== null && evidenceRevision !== expectedEvidenceRevision)
  || (minimumEvidenceRevision !== null && evidenceRevision < minimumEvidenceRevision)) {
  const expectation = expectedEvidenceRevision !== null
    ? `exactly revision ${expectedEvidenceRevision}`
    : `at least revision ${minimumEvidenceRevision}`;
  throw new Error(`Vendor application evidence capability must be ${expectation}.`);
}

const catalogResponse = await request("/api/v1/catalog/vendors?limit=1");
const catalog = JSON.parse(catalogResponse.body);
if (!Array.isArray(catalog?.data) || catalog?.meta?.source !== "database") {
  throw new Error("Catalog readiness response is not backed by the database.");
}

const coverageRequired = releaseIncludesRequestCoverage(health.data.version);
if (coverageRequired) {
  const coverageResponse = await request("/api/v1/catalog/coverage?category=photography&city=Jaipur");
  const coverage = JSON.parse(coverageResponse.body);
  if (
    coverage?.data?.category !== "photography"
    || coverage?.data?.city !== "Jaipur"
    || !Number.isSafeInteger(coverage?.data?.eligibleVendorCount)
    || coverage.data.eligibleVendorCount < 0
    || coverage?.meta?.definition !== "approved_category_city"
  ) {
    throw new Error("Request coverage readiness response did not satisfy the approved category/city contract.");
  }
}

const home = await request("/", { accept: "text/html" });
if (!home.response.headers.get("content-type")?.includes("text/html") || !home.body.includes("id=\"root\"")) {
  throw new Error("Home page did not return the production application shell.");
}

const vendorOnboarding = await request("/vendor/onboarding", { accept: "text/html" });
if (!vendorOnboarding.response.headers.get("content-type")?.includes("text/html") || !vendorOnboarding.body.includes("id=\"root\"")) {
  throw new Error("Vendor onboarding did not return the production application shell.");
}

console.log(JSON.stringify({
  origin: baseUrl,
  version: health.data.version,
  workerVersionId: health.data.workerVersionId || null,
  workerVersionTag: health.data.workerVersionTag || null,
  services: {
    database: health.data.database,
    authentication: health.data.authentication,
    vendorApplicationEvidence: `revision-${evidenceRevision}`,
    catalog: "ok",
    requestCoverage: coverageRequired ? "ok" : "not-required-for-version",
    applicationShell: "ok",
  },
}));
