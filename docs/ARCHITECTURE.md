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

- `MelaivaStore` is the authoritative store for users, revocable sessions, vendor applications, immutable application-evidence revisions and information requests, auctions, preferred-vendor invitations, bids, immutable award handoffs, award-linked messages, AI quota usage, idempotency results, and rate-limit buckets.
- The Durable Object uses SQLite tables, constraints, indexes, and transactions. Its schema is initialized and versioned in `workers/app/src/store.js`.
- All money values are integer **whole INR rupees** in this MVP. Payments are not implemented, so no code represents the platform as holding funds or escrow.
- A partial unique index allows at most one accepted bid per auction.
- New requests contain exactly one service category, so every offer in a pool is comparable and one award cannot silently close unrelated work. Legacy multi-service requests remain readable but cannot be shortlisted or awarded.
- Accepting a bid atomically awards it, closes the auction, rejects remaining open bids, and records the accepted request/offer/vendor snapshot as `contract_pending`.
- Award snapshots cannot be updated or deleted. Only the request owner, winning vendor, and administrators can read them.
- Award-linked messages do not modify the frozen accepted scope. The request owner and currently approved winning vendor can send plain text; administrators are read-only, unrelated users receive a not-found response, and partner suspension pauses new messages for both parties while preserving prior history.
- Each booking conversation has a stable, contiguous `stream_position`; message records cannot be deleted or renumbered, so the indexed latest position is also the exact message count without a per-poll table scan. Existing history pages backward with `cursor`; lightweight refresh pages forward with the mutually exclusive `after` cursor, and each response returns the authoritative poll cursor, message count, and current send permissions. Message timestamps remain display metadata and are never used as a synchronization watermark. A guarded schema-v5 rolling-deploy fallback keeps raw SQLite rowids private as cursor watermarks, exposes their per-booking insertion rank as `sequence`, and v6 backfills that same order so cursors and client merges remain stable through a deployment.
- Message writes require idempotency, validate bounded plain text, atomically allocate the next per-booking stream position, recheck current participant and vendor approval state, and record only the message and booking identifiers—not message bodies—in audit metadata. During rolling deploys or rollback, schema v6 also assigns a position inside SQLite when an older Worker omits the new column.
- Schema v7 keeps one private, monotonic exact-message cursor per booking participant. Existing threads baseline at the current stream head; an additive booking trigger creates empty participant cursors for awards written by v6 during a rollout or rollback. Unread totals range over the indexed stream and count only messages sent by someone other than the current participant. A participant can acknowledge only a message in their own thread, stale acknowledgements cannot move backward, administrators have no cursor, and no API exposes the counterparty's state. A paged summary endpoint returns only booking IDs, audience roles, indexed message counts, and optional local unread counts for inexpensive background refresh.
- Schema v8 adds a monotonic vendor-review revision maintained by SQLite whenever any Worker version changes a vendor status. Operator decisions require a bounded rationale and idempotency key, follow a fixed transition graph, compare the expected status/revision, recheck the active admin role inside the conditional write, and append the decision audit in the same transaction. Audit facts cannot be changed or deleted; only an actor reference may be nulled during legitimate user anonymization. Older Workers remain compatible because the database trigger advances the revision even when their update statement does not know the new column.
- Schema v9 stores one immutable evidence revision per vendor application: one to five canonical public portfolio URLs, one to three distinct public review/reference URLs, a narrow GSTIN/CIN/Udyam registration disclosure or an explicit `not_registered` declaration, and a server-time applicant attestation. URLs are never fetched or embedded by the service. List reads expose counts/type only; full evidence is retrieved only for one selected admin record and is never copied into audit metadata.
- Evidence-backed approval requires the operator to acknowledge the exact evidence revision. SQLite records the reviewed revision in the same conditional transaction and blocks any pending/suspended-to-approved change whose evidence revision is newer, so a rolled-back schema-v8 Worker fails closed instead of approving unseen evidence. Evidence-less legacy applications remain operable and visibly distinct, and pending/rejected owners can attach their first evidence snapshot through a dedicated completion endpoint.
- Schema v10 keeps the v9 `vendor_application_evidence` revision-1 row as an immutable rollback-compatibility snapshot and seeds that same record into an append-only evidence-revision history keyed by vendor and contiguous revision. New snapshots never update or delete an earlier record. The vendor row stores only monotonic current pointers/flags: the latest evidence revision, information-request revision, and whether an information response is outstanding.
- Information requests are immutable records containing bounded requested fields, applicant-visible copy, and separately scoped private operator rationale. The API derives the effective `needs_information` state from the outstanding-request flag while the persisted vendor eligibility status remains one of pending, approved, rejected, or suspended. `vendor-summary-v2` list reads expose only counts, effective state, and revision metadata; full evidence, applicant copy, and private rationale remain restricted to the selected authorized context. Opening or resolving a request advances the existing review revision so queue decisions cannot race applicant activity.
- The owner evidence-context read and full-snapshot write reuse `/api/v1/vendors/onboarding/evidence`. A write requires the active owner plus exact `expectedVendorId`, `expectedStatus`, `expectedRevision`, `expectedEvidenceRevision`, and `expectedInformationRequestRevision`, an idempotency key, and the next bounded contiguous evidence revision. The vendor id is enforced after user-scoped idempotency lookup and before any mutation, so a preserved retry cannot cross accounts even when their counters match. The client invalidates stale async generations and hides private state while focus, authentication, route-mode, conflict, reload, and every post-mutation outcome re-prove that same vendor. A resolved missing or different identity clears the draft; a transient verification failure keeps the unchanged draft and exact key hidden until a same-vendor recheck succeeds. An explicit discard clears the draft even when the refreshed application is no longer editable. Legacy-compatible revision-one inserts also recheck the owner's active status at the database boundary, closing the authenticate-then-suspend race for old and new Workers. The transaction appends the snapshot and resolves only that request; it cannot edit the business profile, revise without an active request, overwrite history, or expose private operator rationale/staff identity. Admin mutations require exact effective status/review revision, and approval also requires the exact acknowledged latest evidence revision and no open request.
- Schema v10 installs database guards so older Workers fail closed for evidence/admin writes rather than approving or overwriting state they cannot understand. Capability revision 5 binds evidence retries to the exact loaded vendor, locks the captured snapshot through preflight and mutation, requires the client to re-prove that identity after every outcome, and binds the revision marker to the write so mixed Worker/client traffic cannot pass a check on one version and mutate through another. The summary-contract version likewise makes mixed generations pause safely until rollout convergence. Information requests are visible only in the product; this storage/API contract does not send or promise email, SMS, push, or another notification.
- Auction creation and bid acceptance require/replay an `Idempotency-Key` result.
- A preferred vendor is attached only when the vendor remains approved and matches the brief's category and city at the atomic create boundary. Other matched vendors cannot see that preference.
- Suspending or rejecting a vendor withdraws open proposals and makes unanswered direct invitations unavailable; award selection rechecks current vendor approval.
- Submitted offers stay sealed while an auction is open. Customer contact data remains private.
- New offers persist bounded, normalized commercial terms for explicit comparison; schema-v3 legacy rows remain readable and are labelled incomplete instead of receiving invented disclosures.
- Owner-initiated status changes update the auction and append their audit event in one transaction. Replayed or concurrent requests converge on the same status without duplicating the audit record.
- Production storage failures fail closed; demo state is never substituted for a write.

## Product modules

- Identity: registration, client-derived password verifiers, server peppering, session issuance/revocation, role authorization.
- Catalog: public vendor discovery with honest empty/example states.
- Planning: deterministic brief rules plus optional Gemini planning. A versioned, 24-hour browser navigation handoff can carry validated user-entered planning facts into the request builder; the receiving route revalidates every field and never carries generated prose, the overall budget, a service choice, or service-specific prices.
- Requests: private structured briefs, optional explicit preferred-partner invitations, and date-bounded auctions.
- Offers: vendor bids and customer shortlist/reject/accept decisions.
- Awards: immutable accepted-scope handoffs plus private text coordination for the couple and winning vendor; attachments, contracts, signatures, invoices, notifications, and payments are deliberately out of scope.
- Partners: evidence-backed vendor onboarding plus a private, paginated operator queue for reasoned approval, rejection, suspension, restoration, and immutable review history. Marketplace approval is an operating decision, not KYC, business-registration verification, or a performance guarantee.
- Reliability: rate limits, quotas, idempotency, fail-closed health checks, cleanup alarm, request IDs, safe telemetry.

## API boundaries

- `/health` and `/api/v1/health`
- `/api/v1/auth/*`
- `/api/v1/vendors`, `/api/v1/vendors/onboarding`, and `/api/v1/vendors/onboarding/evidence`
- `/api/v1/auctions`, `/api/v1/auctions/:id/status`, `/api/v1/auctions/:id/bids`, `/api/v1/auctions/:id/award`, `/api/v1/bookings`, `/api/v1/bookings/message-summary`, `/api/v1/bookings/:id/messages`, and `/api/v1/bookings/:id/messages/read`
- `/api/v1/ai/plan`
- `/api/v1/admin/vendors`, `/api/v1/admin/vendors/:id`, and `/api/v1/admin/vendors/:id/reviews`

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
- Production deployment remains a manual authenticated Wrangler release until least-privilege Cloudflare credentials are installed in the protected GitHub environment; the checked-in workflow cannot deploy without them.
- Staging targets the separate `melaiva-staging` Worker and Durable Object namespace with production-strength runtime posture but AI, demo data, and Turnstile disabled until their integrations are ready.
- `wrangler deploy` provisions the Durable Object class via Cloudflare migration `v1`; the class then applies its resumable internal SQLite schema migrations through schema version 10.
- Free-plan limits are capacity limits, not an enterprise SLA. A custom domain, production support, transactional email, payments, legal/KYC, and model usage need explicit operating budgets and vendor contracts.
