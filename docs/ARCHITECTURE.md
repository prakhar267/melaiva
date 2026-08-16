# Melaiva architecture

## Launch topology

Melaiva ships as a Cloudflare-native modular monolith. One Worker serves the Vite-built React SPA and the versioned Hono JSON API. Transactional state lives in one SQLite-backed Durable Object class, `MelaivaStore`; Gemini is called only from the Worker.

```text
Browser
  → Cloudflare edge (TLS, Static Assets, Worker)
      → React SPA
      → Hono /api/v1
          → MelaivaStore SQLite Durable Object
          → Gemini API (planner only, optional)
      → hourly Durable Object cleanup / auction-close alarm
```

This shape is intentional for the free launch tier: it preserves relational constraints and serialized marketplace decisions without requiring an eleventh D1 database on an account already at its free D1 database limit. It also avoids distributed transactions while the product is proving marketplace liquidity.

## Storage and invariants

- `MelaivaStore` is the authoritative store for users, revocable sessions, vendor applications, auctions, preferred-vendor invitations, bids, AI quota usage, idempotency results, and rate-limit buckets.
- The Durable Object uses SQLite tables, constraints, indexes, and transactions. Its schema is initialized and versioned in `workers/app/src/store.js`.
- All money values are integer **whole INR rupees** in this MVP. Payments are not implemented, so no code represents the platform as holding funds or escrow.
- A partial unique index allows at most one accepted bid per auction.
- Accepting a bid atomically awards it, closes the auction, and rejects remaining open bids.
- Auction creation and bid acceptance require/replay an `Idempotency-Key` result.
- A preferred vendor is attached only when the vendor remains approved and matches the brief's category and city at the atomic create boundary. Other matched vendors cannot see that preference.
- Suspending or rejecting a vendor withdraws open proposals and makes unanswered direct invitations unavailable; award selection rechecks current vendor approval.
- Submitted offers stay sealed while an auction is open. Customer contact data remains private.
- Owner-initiated status changes update the auction and append their audit event in one transaction. Replayed or concurrent requests converge on the same status without duplicating the audit record.
- Production storage failures fail closed; demo state is never substituted for a write.

## Product modules

- Identity: registration, client-derived password verifiers, server peppering, session issuance/revocation, role authorization.
- Catalog: public vendor discovery with honest empty/example states.
- Planning: deterministic brief rules plus optional Gemini planning.
- Requests: private structured briefs, optional explicit preferred-partner invitations, and date-bounded auctions.
- Offers: vendor bids and customer shortlist/reject/accept decisions.
- Partners: vendor onboarding and manual approval state.
- Reliability: rate limits, quotas, idempotency, fail-closed health checks, cleanup alarm, request IDs, safe telemetry.

## API boundaries

- `/health` and `/api/v1/health`
- `/api/v1/auth/*`
- `/api/v1/vendors` and `/api/v1/vendors/onboarding`
- `/api/v1/auctions`, `/api/v1/auctions/:id/status`, and `/api/v1/auctions/:id/bids`
- `/api/v1/ai/plan`
- `/api/v1/admin/*`

JSON errors use a stable error code, human-safe message, and request ID. Mutations validate content type, body size, origin posture, authentication, authorization, schema, lengths, state transition, and rate limits.

## Authentication

The browser derives a 256-bit PBKDF2-SHA-256 verifier at 310,000 iterations using an email-scoped salt and sends the verifier over HTTPS. The Worker HMAC-peppers it with an independent `PASSWORD_PEPPER`, then compares stored credentials in constant time. This keeps the server inside the Workers Free CPU budget while ensuring plaintext passwords never reach the Worker.

Sessions are opaque cookies with `HttpOnly`, `Secure`, and `SameSite=Lax`; only token digests are stored and sessions can be revoked. This is an MVP authentication design. Before material customer data, privileged operations, or payments, add email verification, credential-stuffing protection, session rotation, recent-auth checks, and passkey/TOTP enforcement for staff.

## Gemini safety

- `GEMINI_API_KEY` is an encrypted Worker secret and is never shipped to the client.
- The model is used only for planning guidance; it cannot book, accept an offer, or mutate commercial state.
- Inputs and outputs are bounded. Calls have a timeout, daily/per-user quota, emergency kill switch, and validated structured response.
- Budget amounts are recomputed server-side and milestone dates are bounded by today and the event date.
- Telemetry excludes prompts and personal planning content.
- Provider/key/model failure returns a plainly labelled deterministic planning result.

## Security baseline

- Strict CSP, `frame-ancestors`, `nosniff`, Referrer Policy, Permissions Policy, secure cookies, and same-origin production API calls.
- Per-IP/actor rate limits, exact AI quota records, bounded request bodies, and prepared SQLite statements.
- Role and ownership checks on every private brief, bid, and decision path, with integration tests for horizontal/vertical authorization.
- Turnstile hooks for registration and planning; production remains disabled until both frontend widget and secret are configured together.
- No secrets, auth headers, plaintext passwords/verifiers, prompts, private briefs, or payment payloads in logs.
- No public administrator registration route. Initial staff promotion is an out-of-band operational action and staff access should be placed behind Cloudflare Access/MFA.

## Reliability and operations

The Durable Object's hourly alarm removes expired sessions, idempotency records, and rate-limit buckets and closes expired auctions. It does not consume an account-level Cron Trigger. Durable Object point-in-time recovery is the primary launch recovery mechanism; recovery drills and independent encrypted exports are required before the system holds irreplaceable data.

Initial internal objectives:

- non-AI API availability: 99.9%;
- 5xx rate below 1%;
- authenticated read/write p95 tracked separately;
- oldest expired-but-open auction below two alarm intervals;
- AI provider failure never blocks deterministic planning.

Use an external synthetic monitor for `/health` because a Worker cannot reliably detect a Cloudflare-wide outage from inside Cloudflare. The scheduled GitHub readiness workflow checks health, database-backed catalog reads, security headers, and the application shell without creating data. Cloudflare observability is enabled with full launch sampling; reduce success sampling after traffic and error baselines are understood.

## Delivery policy

- CI gates frozen installs, frontend build, SPA fallback tests, syntax checks, SQLite integration/security tests, and a Wrangler bundle dry run. The protected default branch also requires CodeQL security analysis.
- Production deployment is manual through the GitHub environment until a least-privilege Cloudflare API token is installed as a repository secret.
- Staging targets the separate `melaiva-staging` Worker and Durable Object namespace with production-strength runtime posture but AI, demo data, and Turnstile disabled until their integrations are ready.
- `wrangler deploy` provisions the Durable Object class via Cloudflare migration `v1`; the class then applies its resumable internal SQLite schema migrations through schema version 2.
- Free-plan limits are capacity limits, not an enterprise SLA. A custom domain, production support, transactional email, payments, legal/KYC, and model usage need explicit operating budgets and vendor contracts.
