# Go-live checklist

## Product and operations

- [ ] One launch city and active categories are selected.
- [ ] Each category has enough approved, responsive vendors to deliver the promised offer count.
- [ ] At least 20 end-to-end sandbox requests have completed through the contract-pending award handoff.
- [ ] Concierge ownership and support escalation are staffed.
- [ ] All public proof points are real and auditable.
- [ ] Pricing/commission experiments and refund handling are documented.

## Legal and trust

- [ ] Melaiva trademark, company name, domains, and handles are formally cleared and reserved.
- [ ] Terms, privacy, cookie, vendor, cancellation/refund, acceptable-use, and dispute policies receive Indian counsel review.
- [ ] The payment provider contract supports the marketed marketplace/milestone flow.
- [ ] No unlicensed “escrow” claim is present.
- [ ] Vendor verification, content moderation, data retention, export, and deletion processes are operating.

## Security

- [ ] Production secrets exist only in Cloudflare secret storage.
- [ ] Email verification and a secure password-recovery flow are configured and tested.
- [ ] Turnstile frontend widget and secret are enabled together; origin checks, rate limits, password/session controls, and RBAC/IDOR tests pass.
- [ ] Admin access is separately protected and MFA is required.
- [ ] CSP and all security headers pass on the final hostname.
- [ ] Dependency, static, secret, and dynamic scans have no unresolved high/critical findings.
- [ ] Any future payment-webhook replay/signature/idempotency tests pass before payment features are enabled.
- [ ] Logs contain no secrets, PII, payment payloads, or raw AI prompts.
- [ ] Vendor evidence/history reads preserve summary-versus-detail authorization: queue summaries contain no URLs, registration references, applicant messages, private reasons, or staff identity, and applicant context never exposes private operator rationale.

## Reliability and recovery

- [ ] Staging uses isolated Cloudflare bindings and anonymized data only.
- [ ] The SQLite Durable Object migration has been applied on a clean deployment and a production recovery bookmark recorded.
- [ ] Schema-v9→v10 migration, cold restart, mixed-version rollout, and rollback have proved that revision-1 evidence is preserved exactly, later revisions remain append-only, and old Workers fail closed.
- [ ] Restore, rollback, leaked-key, stuck-request, payment-mismatch, and provider-outage runbooks have been exercised.
- [ ] External synthetics cover homepage, health, catalog, authentication, request submission, vendor offer, and AI fallback.
- [ ] Alerting covers error rate, quota/CPU, Durable Object storage/alarm freshness, and AI errors/cost.
- [ ] The release has soaked in staging, passed a zero-traffic version-override smoke, and completed an atomic 100% production cutover. Do not use a non-zero percentage split on `workers.dev` until whole-session affinity also covers initial HTML and hashed assets.
- [ ] While hosted production promotion is disabled, each release uses the authenticated local release procedure from the exact merged SHA and records staging soak, candidate/version IDs, deployment predecessors, tag compare-and-swap, rollback ownership, and final default production traffic smoke evidence. Do not treat the validation-only hosted workflow as deployment evidence or enable hosted mutation until its system-tools finalizer and downstream reconciler have passed executable race tests.

## Experience and quality

- [ ] Critical flows pass on current Chrome, Safari, Firefox, Android, and iOS breakpoints.
- [ ] Keyboard, screen reader, focus, contrast, zoom, reduced motion, and tap targets pass.
- [ ] Loading, empty, validation, provider-error, offline, retry, expired, and forbidden states are tested.
- [ ] Core Web Vitals and bundle budgets pass on a mid-tier mobile network/device.
- [ ] No chat/help UI covers a primary control at any breakpoint.
- [ ] Search, structured brief, AI fallback, auction submission, comparison, vendor onboarding, and dashboards render without client exceptions.
- [ ] Planner-to-request handoff preserves only reviewed user-entered facts, rejects malformed or stale navigation state, leaves service and service budget explicit, and lets provenance be dismissed without erasing draft edits or changing direct request links.
- [ ] Award conversations pass owner/winner/admin/outsider authorization, idempotent retry, suspension pause, long-text wrapping, and 390 px composer checks without exposing customer contact details.
- [ ] Vendor information requests pass operator/applicant/outsider authorization, exact status/review/evidence/request revision conflicts, idempotent replay, concurrent request/response/approval races, immutable-history checks, and responsive/accessibility review.
- [ ] Applicant-facing copy says `needs_information` is an in-product state and does not claim an email, SMS, push, or other notification was sent.

## Launch decision

The public marketing site and `workers.dev` preview may go live before every commerce integration. Taking real bookings or money is a separate gate and requires the real vendor supply, policies, payment/email providers, operational staffing, monitoring, and legal review above.
