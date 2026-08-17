# Melaiva

Melaiva is a two-sided celebration marketplace for India. A customer creates a category-specific structured brief, relevant vendors respond with sealed offers, and the customer compares scope and price before choosing a partner.

Live release: [melaiva.prakhargupta267.workers.dev](https://melaiva.prakhargupta267.workers.dev)

The launch build is a single Cloudflare Worker: it serves the React application, exposes the Hono API, stores transactional state in a SQLite-backed Durable Object, and calls Gemini from the server for assisted planning.

## What is implemented

- Responsive customer marketplace and vendor discovery
- A versioned, expiring planner-to-request handoff that carries only validated user-entered celebration facts into an editable brief; generated plan prose and the overall celebration budget stay out of service-specific requests
- Four-step, single-service private request builder with sealed offer workflow and explicit preferred-partner invitations
- Customer dashboard backed by the signed-in user's requests, with a private sealed state and an explicit close-and-reveal decision
- Evidence-backed vendor onboarding with canonical public work/reference links, narrow business-registration disclosures, explicit applicant attestation, retry-safe submission, and a completion path for legacy applications
- A private operator-only vendor review queue with summary-only list reads, selected-record detail loading, explicit approve/reject/suspend/restore transitions, required internal rationale, evidence-revision acknowledgement, retry-safe decisions, stale-review protection, and immutable decision history
- Vendor opportunity feed and normalized offer submission covering inclusions, exclusions, GST, travel, priced add-ons, delivery, cancellation, and validity
- Customer commercial-term comparison plus shortlist/reject/accept state transitions, with a review-and-acknowledge award dialog and exact offer counts
- Immutable, access-scoped award handoffs shared with the couple and winning vendor, explicitly marked contract pending without implying signatures, booking, or payment
- Award-linked, text-only conversations shared only with the request owner and winning vendor; participant-private unread badges stay in sync across workspaces without exposing read receipts, prior history remains readable while sending pauses for a non-approved partner, and administrators are read-only
- Gemini-assisted planning with schema validation, quotas, timeout, kill switch, and a transparent deterministic fallback
- Client-derived password verifiers, server-side peppering, revocable secure sessions, capability-aware access checks, rate limits, origin checks, and idempotent critical mutations
- Hourly Durable Object cleanup/auction-close alarm, structured request IDs, fail-closed health endpoints, CI, and production runbooks
- Isolated staging configuration, Git-provenanced releases, CodeQL merge protection, and read-only production readiness monitoring

Post-award messages are coordination records, not contracts, signatures, invoices, booking confirmations, or payment evidence. Unread state is private to each participant and never shown to the counterparty as a receipt. Attachments, email notifications, signatures, and payments are not implemented.

Marketplace approval records an internal operating decision after review of applicant-supplied evidence; public surfaces call it “Marketplace reviewed.” It is not a government identity check, legal certification, KYC result, or guarantee of vendor performance. A “not registered” disclosure remains declaration-only and requires suitable alternate checks before approval. Staff access remains an out-of-band role assignment and must be protected with Cloudflare Access/MFA before it is delegated beyond the founder.

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
npx wrangler deploy --env=""
MELAIVA_SMOKE_BASE_URL=https://melaiva.prakhargupta267.workers.dev npm run smoke:readiness
```

The free launch target is the Worker `melaiva` on `workers.dev`. A paid custom domain, production email/payment providers, approved vendor supply, legal/trademark clearance, and operational verification are separate commercial launch gates—not claims made by this codebase.
