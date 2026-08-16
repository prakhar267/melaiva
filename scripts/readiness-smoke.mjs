#!/usr/bin/env node

const baseUrl = (process.env.MELAIVA_SMOKE_BASE_URL || "").replace(/\/$/u, "");
if (!baseUrl.startsWith("https://")) {
  throw new Error("Set MELAIVA_SMOKE_BASE_URL to the deployed HTTPS origin.");
}

async function request(path, { accept = "application/json" } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { Accept: accept },
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

const catalogResponse = await request("/api/v1/catalog/vendors?limit=1");
const catalog = JSON.parse(catalogResponse.body);
if (!Array.isArray(catalog?.data) || catalog?.meta?.source !== "database") {
  throw new Error("Catalog readiness response is not backed by the database.");
}

const home = await request("/", { accept: "text/html" });
if (!home.response.headers.get("content-type")?.includes("text/html") || !home.body.includes("id=\"root\"")) {
  throw new Error("Home page did not return the production application shell.");
}

console.log(JSON.stringify({
  origin: baseUrl,
  version: health.data.version,
  services: {
    database: health.data.database,
    authentication: health.data.authentication,
    catalog: "ok",
    applicationShell: "ok",
  },
}));
