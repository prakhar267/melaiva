# Melaiva

Melaiva is a two-sided celebration marketplace for India. A customer creates a category-specific structured brief, relevant vendors respond with sealed offers, and the customer compares scope and price before choosing a partner.

Live release: [melaiva.prakhargupta267.workers.dev](https://melaiva.prakhargupta267.workers.dev)

The launch build is a single Cloudflare Worker: it serves the React application, exposes the Hono API, stores transactional state in a SQLite-backed Durable Object, and calls Gemini from the server for assisted planning.

## What is implemented

- Responsive customer marketplace and vendor discovery, with an honest zero-inventory path that preserves service, city, date, and guest context into the request builder
- A versioned, expiring planner-to-request handoff that carries only validated user-entered celebration facts into an editable brief; generated plan prose and the overall celebration budget stay out of service-specific requests
- Four-step, single-service private request builder with live approved-partner coverage, sealed offer workflow, explicit preferred-partner invitations, and account-bound exact-payload retry after an ambiguous publish result
- Customer dashboard backed by the signed-in user's requests, with current eligible-partner coverage, a private sealed state, and an explicit close-and-reveal decision
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

Partner coverage is a point-in-time count of currently approved vendors with an active account whose category and service area exactly match the brief, excluding a vendor account that owns the request. It is not an availability check or response promise. Requests with zero current coverage remain open and visible in the customer dashboard; counts stop when the response window ends. Melaiva does not send coverage, email, or push notifications, so the product tells customers to check the dashboard before the offer window closes.

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

GitHub-hosted production promotion is disabled. The checked-in production workflow is deliberately validation-only: it requires exact-main CI and CodeQL checks, builds and tests both applications, creates production and staging bundles with locked Wrangler in `--dry-run` mode, smokes current default production traffic without a version override, and then exits unsuccessfully with an explicit no-deploy notice. It has read-only repository permissions, receives no Cloudflare credential, does not enter the production environment, and cannot upload a Worker version, change traffic, or move the `production` Git tag. A run of that workflow is never deployment evidence.

The production release path is therefore an authenticated local release by the founder from a clean checkout of the merged `main` SHA. The release must keep this order and these gates: deploy the tagged SHA to isolated staging; pass exact-version readiness plus the cleanup-safe write smoke; wait at least 15 minutes and recheck the unchanged staging deployment; record the current production deployment, Worker version, and `production` tag; upload the candidate without serving traffic; add it at 0%; pass readiness through `Cloudflare-Workers-Version-Overrides` with the exact candidate version ID and Git tag; cut directly to a single 100% version; rerun readiness against default traffic with no override and run the write smoke; then move `production` with a force-with-lease compare-and-swap and immediately recheck the Worker. On any failure after production changes, restore the recorded state only while the release still owns the latest deployment; restore an intervening predecessor exactly if the release displaced it, and never overwrite a newer unrelated deployment or source tag. Record every deployment/version ID, tag transition, and smoke result in the PR before considering the release complete.

Do not re-enable hosted production mutation merely by adding credentials. It requires a separately reviewed system-tools-only finalizer and downstream reconciler using only the Cloudflare REST API, `curl`, `jq`, and `git`: no checkout, package install, npm lifecycle code, Wrangler, or other third-party executable may share the production write token. Immutable prepare outputs must survive cancellation; every traffic or tag compare-and-swap must remain reversible until default production traffic, runtime version metadata, and the remote tag are stable; an `always()` reconciler must repair late accepted writes while preserving unrelated Worker and tag state; and executable mocked state-machine tests must cover those races.

The free launch target is the Worker `melaiva` on `workers.dev`. A paid custom domain, production email/payment providers, approved vendor supply, legal/trademark clearance, and operational verification are separate commercial launch gates—not claims made by this codebase.
