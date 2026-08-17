# Melaiva

Melaiva is a two-sided celebration marketplace for India. A customer creates a category-specific structured brief, relevant vendors respond with sealed offers, and the customer compares scope and price before choosing a partner.

Live release: [melaiva.prakhargupta267.workers.dev](https://melaiva.prakhargupta267.workers.dev)

The launch build is a single Cloudflare Worker: it serves the React application, exposes the Hono API, stores transactional state in a SQLite-backed Durable Object, and calls Gemini from the server for assisted planning.

## What is implemented

- Responsive customer marketplace and vendor discovery
- A versioned, expiring planner-to-request handoff that carries only validated user-entered celebration facts into an editable brief; generated plan prose and the overall celebration budget stay out of service-specific requests
- Four-step, single-service private request builder with sealed offer workflow and explicit preferred-partner invitations
- Customer dashboard backed by the signed-in user's requests, with a private sealed state and an explicit close-and-reveal decision
- Evidence-backed vendor onboarding with canonical public work/reference links, narrow business-registration disclosures, explicit applicant attestation, retry-safe submission, a completion path for legacy applications, and append-only corrected snapshots when an operator requests specific information
- A private operator-only vendor review queue with `vendor-summary-v2` data-minimized list reads, selected-record detail loading, a derived `needs_information` overlay, explicit request/approve/reject/suspend/restore actions, separate private rationale and applicant-visible request copy, exact revision preconditions, evidence acknowledgement, retry-safe decisions, and immutable history
- Vendor opportunity feed and normalized offer submission covering inclusions, exclusions, GST, travel, priced add-ons, delivery, cancellation, and validity
- Customer commercial-term comparison plus shortlist/reject/accept state transitions, with a review-and-acknowledge award dialog and exact offer counts
- Immutable, access-scoped award handoffs shared with the couple and winning vendor, explicitly marked contract pending without implying signatures, booking, or payment
- Award-linked, text-only conversations shared only with the request owner and winning vendor; participant-private unread badges stay in sync across workspaces without exposing read receipts, prior history remains readable while sending pauses for a non-approved partner, and administrators are read-only
- Gemini-assisted planning with schema validation, quotas, timeout, kill switch, and a transparent deterministic fallback
- Client-derived password verifiers, server-side peppering, revocable secure sessions, capability-aware access checks, rate limits, origin checks, and idempotent critical mutations
- Hourly Durable Object cleanup/auction-close alarm, structured request IDs, fail-closed health endpoints, CI, and production runbooks
- Isolated staging configuration, Git-provenanced releases, CodeQL merge protection, and read-only production readiness monitoring

Post-award messages are coordination records, not contracts, signatures, invoices, booking confirmations, or payment evidence. Unread state is private to each participant and never shown to the counterparty as a receipt. Attachments, email notifications, signatures, and payments are not implemented.

Marketplace approval records an internal operating decision after review of applicant-supplied evidence; public surfaces call it “Marketplace reviewed.” It is not a government identity check, legal certification, KYC result, or guarantee of vendor performance. A “not registered” disclosure remains declaration-only and requires suitable alternate checks before approval. An information request does not rewrite or delete prior evidence: the applicant may append one complete replacement snapshot only against the exact active request, status, review revision, and evidence revision they loaded. Requesting information is an in-product workflow and does not send email, SMS, push, or another notification. Staff access remains an out-of-band role assignment and must be protected with Cloudflare Access/MFA before it is delegated beyond the founder.

Demo vendor cards and workspace figures are clearly labelled examples. Production never represents them as verified businesses.

## Run locally

Prerequisites: Node.js 20+ and a Cloudflare account authenticated with Wrangler.

```bash
npm ci
npm run build
npm run test:sites
npm run check:api
npm run test:api
cd workers/app
npm ci
npm run dev
```

The integrated local Worker serves both the SPA and API. For a frontend-only preview, run `npm run dev` from the repository root; network-dependent actions then fail transparently or save an explicitly local draft.

## Production configuration

Required encrypted Worker secrets:

- `SESSION_SECRET`
- `PASSWORD_PEPPER`

Optional encrypted secrets:

- `GEMINI_API_KEY` — without it the planner uses the deterministic fallback
- `TURNSTILE_SECRET_KEY` — enable only after the frontend widget/site key is configured

Never place secrets in `.env.example`, `wrangler.toml`, client code, logs, or GitHub variables. See [workers/app/README.md](workers/app/README.md) for the exact auth and deployment contract.

## Architecture and product decisions

- [Product specification](docs/PRODUCT_SPEC.md)
- [Architecture and SRE baseline](docs/ARCHITECTURE.md)
- [Brand system](docs/BRAND.md)
- [Go-live checklist](docs/GO_LIVE_CHECKLIST.md)
- [Reference audit](docs/REFERENCE_AUDIT.md)

## Release commands

```bash
npm ci
npm run build
npm run test:sites
npm run check:api
npm run test:api
cd workers/app
npm ci
npm run check
npm test
npx wrangler deploy --env="" --dry-run
npx wrangler deploy --env staging --dry-run
MELAIVA_SMOKE_BASE_URL=https://melaiva.prakhargupta267.workers.dev npm run smoke:readiness
```

Production promotion is intentionally handled by the protected deployment workflow rather than a direct `wrangler deploy`: the exact commit must pass CI and CodeQL analysis, run as the sole staging version long enough to soak under the same Git tag, upload as an immutable zero-traffic Worker version, prove its runtime version ID and tag during an override smoke, and then cut over atomically at 100%. Recovery inputs and the candidate are finalized in a separate prepare job before any traffic mutation. After each mutation, deployment history must prove that the captured predecessor was not replaced between the precheck and write; if it was, the displaced one- or two-version state is restored exactly. The movable `production` Git tag records the source currently serving production, is rechecked against the Worker after it moves, and gives scheduled monitoring the matching release-specific readiness contract. Failed promotions reconcile only this run's annotated deployments and preserve any newer unrelated Worker or source-tag state.

Until least-privilege Cloudflare credentials are installed in the protected GitHub environments, an authenticated founder may execute that same workflow locally from a clean checkout of the merged `main` SHA. The release must keep the checked-in order and gates: deploy the tagged SHA to isolated staging; pass exact-version readiness plus the cleanup-safe write smoke; wait at least 15 minutes and recheck the unchanged staging deployment; record the current production deployment, Worker version, and `production` tag; upload the candidate without serving traffic; add it at 0%; pass readiness through `Cloudflare-Workers-Version-Overrides` with the exact candidate version ID and Git tag; cut directly to a single 100% version; rerun readiness and the write smoke; then move `production` with a force-with-lease compare-and-swap and immediately recheck the Worker. On any failure after production changes, restore the recorded state only while the release still owns the latest deployment; restore an intervening predecessor exactly if the release displaced it, and never overwrite a newer unrelated deployment or source tag. Record every deployment/version ID and smoke result in the PR before considering the release complete.

The free launch target is the Worker `melaiva` on `workers.dev`. A paid custom domain, production email/payment providers, approved vendor supply, legal/trademark clearance, and operational verification are separate commercial launch gates—not claims made by this codebase.
