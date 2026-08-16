#!/usr/bin/env node

import { derivePasswordVerifier, passwordKdf } from "../src/security/passwordVerifier.js";

const baseUrl = (process.env.MELAIVA_SMOKE_BASE_URL || "").replace(/\/$/u, "");
if (!baseUrl.startsWith("https://")) throw new Error("Set MELAIVA_SMOKE_BASE_URL to the deployed HTTPS origin.");
if (process.env.MELAIVA_SMOKE_ALLOW_WRITES !== "1") {
  throw new Error("Set MELAIVA_SMOKE_ALLOW_WRITES=1; this check creates one QA account and a cancelled request.");
}

const eventDate = new Date(Date.now() + 180 * 24 * 60 * 60 * 1_000).toISOString().slice(0, 10);
const biddingEndsAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1_000).toISOString();
const email = `release-${crypto.randomUUID()}@melaiva.invalid`;
const password = `SmokeA1!${crypto.randomUUID()}`;
const passwordVerifier = await derivePasswordVerifier(email, password);

async function request(path, { method = "GET", cookie, body, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      Origin: baseUrl,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(35_000),
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`${method} ${path} failed (${response.status}): ${payload?.error?.code || "unexpected_response"}`);
  }
  return { response, payload };
}

async function runSmoke() {
  let cookie;
  let auctionId;
  let primaryError;
  try {
    const health = await request("/health");
    const registration = await request("/api/v1/auth/register", {
      method: "POST",
      body: { name: "Melaiva release QA", email, passwordVerifier, passwordKdf },
    });
    cookie = registration.response.headers.get("set-cookie")?.split(";", 1)[0];
    if (!cookie) throw new Error("Registration did not issue a session cookie.");

    const identity = await request("/api/v1/auth/me", { cookie });
    const auction = await request("/api/v1/auctions", {
      method: "POST",
      cookie,
      headers: { "Idempotency-Key": `release-${crypto.randomUUID()}` },
      body: {
        title: "Release QA celebration request",
        eventType: "wedding",
        eventDate,
        city: "Jaipur",
        guestCount: 180,
        budgetMin: 300_000,
        budgetMax: 800_000,
        currency: "INR",
        categories: ["photography"],
        requirements: "Release smoke test for candid photography, a short film, and a private family gallery.",
        biddingEndsAt,
      },
    });
    auctionId = auction.payload?.data?.id;
    if (!auctionId) throw new Error("Auction response did not include an id.");

    const ownAuctions = await request("/api/v1/auctions?mine=true", { cookie });
    if (!ownAuctions.payload?.data?.some((item) => item.id === auctionId)) {
      throw new Error("Created request was not visible to its owner.");
    }

    const planner = process.env.MELAIVA_SMOKE_SKIP_PLANNER === "1"
      ? { payload: { meta: { source: "skipped", degraded: false, reason: "disabled_for_environment" } } }
      : await request("/api/v1/planner/generate", {
        method: "POST",
        cookie,
        body: {
          eventDate,
          city: "Jaipur",
          guestCount: 180,
          budget: 1_800_000,
          currency: "INR",
          style: "Warm contemporary Indian celebration",
          ceremonies: ["Sangeet", "Wedding"],
          priorities: ["Guest comfort", "Photography"],
          constraints: "Keep the plan practical and within the stated budget.",
        },
      });

    return {
      health: health.payload?.data?.status,
      role: identity.payload?.data?.user?.role,
      requestLifecycle: "created-listed-cancelled",
      plannerSource: planner.payload?.meta?.source,
      plannerDegraded: planner.payload?.meta?.degraded,
      plannerReason: planner.payload?.meta?.reason || null,
    };
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    const incomplete = [];
    if (auctionId && cookie) {
      try {
        await request(`/api/v1/auctions/${auctionId}/status`, {
          method: "PATCH",
          cookie,
          body: { status: "cancelled" },
        });
      } catch {
        incomplete.push("cancel_request");
      }
    }
    if (cookie) {
      try {
        await request("/api/v1/auth/logout", { method: "POST", cookie });
      } catch {
        incomplete.push("logout");
      }
    }
    if (incomplete.length) {
      if (!primaryError) throw new Error(`Smoke cleanup failed: ${incomplete.join(", ")}`);
      console.error(JSON.stringify({ smokeCleanup: "incomplete", steps: incomplete }));
    }
  }
}

console.log(JSON.stringify(await runSmoke()));
