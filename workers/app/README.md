# Melaiva Worker

One Cloudflare Worker serves the Melaiva SPA and the versioned `/api/v1` API. Stateful data lives in the `MelaivaStore` SQLite-backed Durable Object, so production does not require a D1 database. The Worker uses one named `global` object to provide relational constraints and serializable marketplace decisions.

## Local development

1. From this directory, run `npm ci`.
2. Copy `.dev.vars.example` to `.dev.vars`, replace `SESSION_SECRET`, and keep the file uncommitted.
3. Build the frontend from `app/` with `npm run build` so `dist/client` exists.
4. Run `npm run dev` here. SQLite tables and indexes initialize automatically on the first Durable Object request; there is no manual database-migration command.
5. Run `npm test` for the API/security suite. It includes a real SQLite marketplace integration test.

`GET /health` checks the Durable Object adapter and required authentication configuration, and returns `503` when either is unavailable. JSON errors use `{"error":{"code":"...","message":"...","requestId":"..."}}`.

## Authentication contract

Production never receives plaintext passwords and does not perform a costly password KDF inside the Free-plan Worker CPU budget.

The browser:

1. Normalizes email with `trim().toLowerCase()`.
2. Uses UTF-8 `melaiva:password:v1:<normalized-email>` as the salt.
3. Derives 256 bits with PBKDF2-SHA-256 at 310,000 iterations.
4. Encodes the result as unpadded base64url.
5. Sends `passwordVerifier` and `passwordKdf: "pbkdf2-sha256-v1"` to register/login.

The Worker HMAC-peppers that verifier with `PASSWORD_PEPPER` before storage and uses constant-time comparison. Treat the verifier as a password-equivalent: send it only over HTTPS and never log it. The test vector for password `StrongWedding123` and email `mira@example.com` is `2ElopB-2WRviXwYatnXCSMKokkqCZG-Ra8ARF5H7m4I`. `GET /api/v1/auth/config` exposes the non-secret KDF parameters.

Sessions are opaque signed cookies (`HttpOnly`, `Secure`, `SameSite=Lax`); only a SHA-256 token digest is stored. Plaintext-password hashing can be enabled only in a non-production local environment with `ALLOW_SERVER_PASSWORD_HASHING=true` and exists for migration/testing—not deployment.

## Configuration

Required secrets:

- `SESSION_SECRET`: at least 32 high-entropy characters; signs sessions and request fingerprints.
- `PASSWORD_PEPPER`: an independent high-entropy secret used only for stored password verifiers. Back it up securely—losing it prevents password login.

Optional secrets:

- `GEMINI_API_KEY`: server-only Google AI Studio key. Without it, the planner returns a validated deterministic fallback.
- `TURNSTILE_SECRET_KEY`: when set, registration and AI planning fail closed unless `X-Turnstile-Token` verifies with actions `register` or `planner`.
- `PASSWORD_PEPPER_PREVIOUS`: temporary rotation-only secret. When a login matches it, the Worker automatically re-peppers the verifier with `PASSWORD_PEPPER`; remove it after the migration window.

Set secrets with `wrangler secret put <NAME>`. Never place them in `wrangler.toml`, GitHub variables, frontend code, or logs.

Important non-secret variables in `wrangler.toml`:

- `ALLOWED_ORIGINS`: comma-separated cross-origin frontends. The production default is empty because SPA and API are same-origin. Localhost is trusted only outside `ENVIRONMENT=production`.
- `GEMINI_MODEL`: defaults to the free-tier-compatible `gemini-3.5-flash` and remains configurable.
- `AI_PLANNER_ENABLED`: emergency AI kill switch.
- `AI_DAILY_LIMIT`: global daily generation ceiling in addition to per-user limits.
- `ENABLE_DEMO_CATALOG`: development-only. Production ignores it and never fabricates or verifies demo businesses.

## Deployment

From `app/`, run the frontend build and API tests. From this directory, run `npm ci`, `npm run check`, and `npm exec wrangler -- deploy --dry-run` before `npm run deploy`.

Wrangler provisions the SQLite Durable Object class through the `v1` `new_sqlite_classes` migration and uploads `../../dist/client` as Static Assets. The schema is initialized/versioned inside `src/store.js` using `_sql_schema_migrations`; `PRAGMA user_version` is intentionally not used because Durable Objects do not support it.

Bootstrap the first administrator out of band through Cloudflare's Durable Object SQLite/Data Studio tooling by promoting one trusted user to `role='admin'`. There is intentionally no public admin-registration route. Protect admin use with Cloudflare Access/MFA before delegating it to staff.

The operator UI lives at `/admin/vendors`. Queue and history reads remain server-authorized and never fall back to demo data. The queue returns only summary fields and evidence counts/type; full private application/evidence detail comes from `/api/v1/admin/vendors/:id` for the selected row. Review mutations require an `Idempotency-Key`, the exact `expectedStatus` and `expectedRevision` being reviewed, plus a 10–1,000 character internal rationale. Evidence-backed approval also requires `evidenceAcknowledged: true` and the exact `expectedEvidenceRevision`. The allowed lifecycle is `pending → approved | rejected`, `approved → suspended`, `suspended → approved`, and `rejected → pending`; withdrawn offers and unavailable invitations are never resurrected by restoration. Evidence links must be canonical, distinct, credential-free public HTTPS destinations; local, private, reserved, duplicated, or cross-listed destinations are rejected, never fetched by the Worker, and opened by the operator UI only with referrer isolation.

The Durable Object maintains an hourly alarm that deletes expired sessions, rate-limit buckets, and idempotency records, then closes expired auctions. This avoids consuming an account-level Cron Trigger and keeps maintenance colocated with the authoritative store. SQLite Durable Objects provide point-in-time recovery; include recovery drills in production operations.

## Production behavior and invariants

- Catalog failures return explicit `503`; an empty real catalog returns an empty list. Demo listings are unverified and development-only.
- Wedding briefs require authentication. Only the owning couple, an administrator, or an approved vendor whose categories and service areas match can read full requirements or bid.
- Money fields are integer whole rupees for this INR-only MVP (`moneyUnit: "whole_rupees"`), not paise. Change the schema/API together before adding payments or another currency.
- Bidding timestamps are normalized to UTC. Conditional writes prevent submit-versus-close races.
- Offers are sealed while a request is open. Couples can list, shortlist, reject, or accept proposals only after the request closes; administrators retain moderation access.
- New requests require exactly one service category. Existing multi-service requests remain readable, but shortlist and award decisions are blocked because one accepted offer cannot safely represent unrelated services.
- New offers use a normalized commercial-terms contract: `deliverables` (inclusions), `exclusions`, `gstIncluded`, `gstRate`, `travelPolicy`, conditional `travelFee`, optional priced `addOns`, `cancellationTerms`, `deliveryPlan`, and optional `validUntil`. Arrays, text, rates, and whole-rupee amounts are bounded server-side. `fixed_fee` travel requires a positive fee; `included` and `not_applicable` allow only an omitted or zero fee.
- Schema-v3 preserves older offers without inventing disclosures. Legacy rows and backward-compatible v1 payloads return safe empty/zero defaults with `structuredTermsProvided: false`; the current product form submits the complete normalized contract and returns `structuredTermsProvided: true`.
- Schema-v4 adds an immutable award handoff containing the accepted request, offer, and vendor snapshot. The request owner, winning vendor, and administrators may read it through `/api/v1/auctions/:id/award` or `/api/v1/bookings`; update/delete triggers protect the record after creation.
- A partial unique index permits at most one accepted bid per auction. Accepting a bid atomically awards the auction, rejects remaining open bids, and creates its `contract_pending` handoff in the same transaction.
- Schema-v5 adds award-linked, text-only messages without mutating the immutable accepted-scope snapshot. Only the request owner, winning vendor, and administrators can read a thread; only the owner and currently approved winner can send, while administrators are read-only and a non-approved winner pauses sending for both participants. Message creation requires an idempotency key, rechecks membership and approval atomically, and never records message bodies in audit metadata.
- Schema-v6 assigns an immutable per-booking stream position to every message. Existing history pages backward with `cursor`, incremental refresh pages forward with the mutually exclusive `after` cursor, and every response returns the authoritative message count, poll cursor, and current send permissions.
- Schema-v7 stores a private, monotonic read cursor for each booking participant. Existing conversations baseline at their current stream head, new awards receive empty cursor rows even when written by a rolled-back Worker, and unread totals count only counterparty messages after the participant's exact acknowledged message. The API never exposes the other participant's cursor or an administrator cursor, so this does not create read receipts. `/api/v1/bookings/message-summary` supplies lightweight paged counts for background refresh; `PUT /api/v1/bookings/:id/messages/read` advances only to an exact message in that thread.
- Schema-v8 adds a database-maintained review revision to vendor records and protects audit facts from modification or deletion. Admin vendor decisions use that revision for stale-review protection, append their reasoned history atomically, and replay the original result for duplicate network attempts. Rolled-back schema-v7 Workers remain write-compatible because a SQLite trigger advances the new revision on every real status change.
- Schema-v9 adds an immutable, attested vendor-application evidence snapshot and the reviewed-evidence revision on vendors. New onboarding stores the vendor, evidence, and optional idempotency result atomically; legacy pending/rejected vendors can attach their first snapshot through `PUT /api/v1/vendors/onboarding/evidence`. A database approval guard blocks older Workers from approving evidence they have not acknowledged. Audit metadata receives only revision/count/type summaries—never evidence URLs or registration references.
- Vendor access is capability-based: a customer account may retain its owned requests after completing vendor onboarding, while approved vendor capabilities authorize partner routes without rewriting the account's base role.
- Offer validity dates expire at the end of the selected day in India Standard Time rather than at UTC midnight.
- Auction creation and bid acceptance honor `Idempotency-Key` (8-128 safe characters) and replay the original result for retry-safe clients.
- Gemini responses are schema-checked; amounts are recomputed server-side to total the requested budget, milestone dates are bounded by today/event date, calls time out, and safe telemetry excludes prompts and personal planning data.
- Production writes fail closed if SQLite is unavailable. Security-sensitive routes never switch to mock state.
