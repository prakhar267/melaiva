# Melaiva product specification

## Product thesis

Melaiva is a two-sided celebration procurement marketplace. A customer submits one category-specific structured brief per service; the platform matches relevant vendors; vendors submit sealed, itemized offers; the customer compares scope, quality, terms, and price before choosing a partner.

The durable advantage is not a large directory. It is a normalized workflow and data set connecting requirements, offers, accepted scope, fulfillment, and verified outcomes.

## Launch beachhead

The data model supports many celebrations, but operations should launch in one city and four high-consideration categories:

1. Venues
2. Catering
3. Decor
4. Photography and film

A city/category should be marketed as active only after it has 20–30 approved vendors, at least five eligible vendors for a normal request, and a repeatable ability to deliver three compliant offers inside the stated response window.

The first 100 bookings should include human concierge support. Start with sealed competitive quotations rather than a live price-decreasing auction; event services are multi-attribute and cheapest rarely means best.

## Users and jobs

### Customers

Couples, families, event hosts, independent planners, and corporate teams need to:

- turn a vague idea into a realistic brief and budget;
- find available, trustworthy vendors without dozens of calls;
- compare equivalent inclusions, exclusions, tax, quality, and price;
- negotiate without sharing personal contact details with every vendor;
- freeze an agreed scope and coordinate delivery, changes, and payments.

### Vendors

Venues, service providers, suppliers, performers, and agencies need to:

- receive complete, relevant, bookable opportunities;
- fill available dates without eroding margin;
- quote quickly using reusable packages;
- demonstrate value beyond headline price;
- secure scope, contract, milestone, and payment records;
- understand conversion, demand, and profitability.

### Operations

Verification, marketplace operations, support, disputes, finance, moderation, and administrators need evidence-backed queues, scoped access, immutable audit history, and intervention controls.

## Core journeys

### Customer discovery and brief

- Search by celebration, category, city, date, budget, and guests.
- Inspect real vendor profiles, packages, portfolios, service areas, capacity, availability, policies, and verified reviews.
- Save and compare vendors.
- Create a multi-event brief with date flexibility, venue status, style, rituals, dietary/accessibility needs, logistics, timing, and uploads.
- Invite collaborators and keep drafts/revisions.
- Use AI to structure natural language, find missing constraints, and suggest a transparent budget allocation.
- Carry the customer’s bounded date, destination, guest estimate, event choices, style, priorities, and constraints into an editable request draft without copying AI-generated prose or treating the overall celebration budget as a service budget.

### Competitive quotation

- Keep each request to one service category so its offers are comparable and its award affects only that workstream.
- Match on category, city/radius, date, capacity, budget, verification, availability, and response performance.
- Mask customer contact details until the right stage.
- Invite a controlled vendor pool.
- Normalize itemized offers: inclusions, exclusions, GST, travel, add-ons, validity, cancellation terms, and delivery plan.
- Support clarification questions, sealed submissions, limited revisions, withdrawal, expiry, shortlist, site visit, counter-offer, and award.
- Compare best fit, best value, response speed, and lowest price without presenting lowest price as the default winner.

### Booking and fulfillment

- Freeze an immutable accepted-scope snapshot and expose it to the couple and winning vendor as a contract-pending handoff.
- Record contract/signature, deposit, milestones, receipts, and invoices.
- Track messages, files, tasks, calendar items, change orders, and completion evidence.
- Provide cancellation, replacement, refund, dispute, and escalation workflows.
- Permit reviews only after verified fulfillment.

Current MVP boundary: after an award, the request owner and winning approved vendor can exchange private, text-only coordination messages beside the immutable accepted scope. Participant-private unread badges update from durable server cursors and clear only after the exact latest rendered message reaches the reader's viewport; the counterparty never sees a read receipt. An open, visible conversation still checks incrementally for new records and provides a manual refresh fallback. Existing history remains readable if partner approval changes, but new messages pause for both parties. Messages do not represent a contract, signature, invoice, booking confirmation, or payment; attachments, notifications, signatures, and payment-provider workflows remain future work.

Current operator boundary: authorized administrators can review submitted vendor applications in a private oldest-first queue, inspect the exact submitted business/contact/service information, and record approve, reject, suspend, restore, or reopen decisions through scoped state transitions. Every decision requires an internal rationale, is protected against duplicate retries and stale concurrent reviews, and appears in immutable internal history. Marketplace approval does not claim government identity verification, KYC, legal certification, or guaranteed performance; staff MFA/Access and the actual evidence-review procedure remain launch gates.

### Vendor workspace

- Registration, verification, organization/team, categories, locations, capacity, documents, portfolio, packages, price floors, availability, and lead preferences.
- Opportunity feed, accept/decline reasons, quote templates, revisions, attachments, profitability checks, and AI-assisted drafting.
- CRM pipeline, site visits, contracts, milestones, invoices, payouts, reviews, and demand/conversion analytics.

### Admin and trust

- Taxonomy/CMS, verification and moderation queues, RFQ quality review, match overrides, concierge assignment, fraud/off-platform leakage controls, disputes, reconciliation, payout holds, audit logs, consent, export/deletion, and feature flags.

## State machines

- Request: `draft → submitted → reviewed → matched → live → closed → awarded | expired | cancelled`
- Offer: `draft → submitted → revised → shortlisted → accepted | rejected | withdrawn | expired`
- Booking: `contract_pending → deposit_due → confirmed → active → completion_pending → completed | disputed | cancelled | refunded`
- Vendor (current MVP): `pending → approved | rejected`, `approved ↔ suspended`, and `rejected → pending`
- Vendor (target workflow): `draft → submitted → needs_information → verified | rejected | suspended`

## Metrics

Pre-product-market fit north star: **qualified requests receiving at least three compliant offers within the promised response window.**

Post-product-market fit north star: **monthly completed, non-disputed protected-booking GMV.**

Guardrails include time to first/third offer, eligible vendors per request, quote compliance, shortlist-to-book, multi-category attachment, cancellation/dispute/refund rates, on-time fulfillment, vendor retention, referral, contribution margin, and suspected off-platform leakage.

## Monetization experiments

- Free discovery and request submission.
- Category-dependent vendor success fee, initially testing 5–12%.
- Optional transparent customer protection/payment fee, roughly 1–2% and capped.
- Vendor Pro (starting hypothesis ₹1,499/month) for templates, analytics, larger service areas, and enhanced CRM.
- Vendor Business (starting hypothesis ₹4,999/month) for teams, branches, integrations, and reporting.
- Clearly labelled promotions, concierge packages, and corporate procurement subscriptions.

These are test ranges, not launch promises. Validate them over the first 50–100 completed events.

## Delivery roadmap

### Sellable MVP

- One active city/four categories with real supply.
- Customer and vendor authentication.
- Structured brief and Gemini-assisted compilation.
- Vendor onboarding/manual verification.
- Rules-based matching, masked opportunities, itemized sealed offers, compare/shortlist/accept.
- Basic contract and milestone record.
- Admin queues, audit trail, analytics, support, policies, and provider payment links.

### Marketplace V1

- Chat/site visits, counter-offers, payment-provider webhooks, change orders, invoices, refunds/disputes, verified reviews, availability/packages, vendor CRM, and an event workspace.

### Growth and enterprise

- Multi-vendor plans, budgets, tasks, guest collaboration, corporate roles/approvals/POs, recurring events, risk scoring, SSO/SCIM, webhooks/API, audit export, and account SLAs.

## Principal risks

Cold-start liquidity, race-to-the-bottom pricing, incomparable quotes, fake demand, off-platform leakage, fraud, fulfillment failure, payment regulation, AI hallucination/privacy, low consumer frequency, support-heavy unit economics, and IP/trust claims all have explicit product and operational mitigations. Do not scale geography before local liquidity and fulfillment quality are repeatable.
