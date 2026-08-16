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

## Reliability and recovery

- [ ] Staging uses isolated Cloudflare bindings and anonymized data only.
- [ ] The SQLite Durable Object migration has been applied on a clean deployment and a production recovery bookmark recorded.
- [ ] Restore, rollback, leaked-key, stuck-request, payment-mismatch, and provider-outage runbooks have been exercised.
- [ ] External synthetics cover homepage, health, catalog, authentication, request submission, vendor offer, and AI fallback.
- [ ] Alerting covers error rate, quota/CPU, Durable Object storage/alarm freshness, and AI errors/cost.
- [ ] The release has soaked in staging and completed a gradual production rollout.

## Experience and quality

- [ ] Critical flows pass on current Chrome, Safari, Firefox, Android, and iOS breakpoints.
- [ ] Keyboard, screen reader, focus, contrast, zoom, reduced motion, and tap targets pass.
- [ ] Loading, empty, validation, provider-error, offline, retry, expired, and forbidden states are tested.
- [ ] Core Web Vitals and bundle budgets pass on a mid-tier mobile network/device.
- [ ] No chat/help UI covers a primary control at any breakpoint.
- [ ] Search, structured brief, AI fallback, auction submission, comparison, vendor onboarding, and dashboards render without client exceptions.

## Launch decision

The public marketing site and `workers.dev` preview may go live before every commerce integration. Taking real bookings or money is a separate gate and requires the real vendor supply, policies, payment/email providers, operational staffing, monitoring, and legal review above.
