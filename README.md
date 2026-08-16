# Melaiva

Melaiva is a two-sided celebration marketplace for India. A customer creates one structured brief, relevant vendors respond with sealed offers, and the customer compares scope and price before choosing a partner.

Live release: [melaiva.prakhargupta267.workers.dev](https://melaiva.prakhargupta267.workers.dev)

The launch build is a single Cloudflare Worker: it serves the React application, exposes the Hono API, stores transactional state in a SQLite-backed Durable Object, and calls Gemini from the server for assisted planning.

## What is implemented

- Responsive customer marketplace and vendor discovery
- Four-step private request builder with sealed offer workflow
- Customer dashboard backed by the signed-in user's requests
- Vendor onboarding, opportunity feed, and bid submission
- Customer bid review, shortlist/reject/accept state transitions
- Gemini-assisted planning with schema validation, quotas, timeout, kill switch, and a transparent deterministic fallback
- Client-derived password verifiers, server-side peppering, revocable secure sessions, role checks, rate limits, origin checks, and idempotent critical mutations
- Hourly Durable Object cleanup/auction-close alarm, structured request IDs, fail-closed health endpoints, CI, and production runbooks

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
npx wrangler deploy --dry-run
npx wrangler deploy
```

The free launch target is the Worker `melaiva` on `workers.dev`. A paid custom domain, production email/payment providers, approved vendor supply, legal/trademark clearance, and operational verification are separate commercial launch gates—not claims made by this codebase.
