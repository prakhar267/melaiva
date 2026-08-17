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

Current request-coverage boundary: public discovery carries only a validated service, city, future date, bounded guest estimate, and optional exact live vendor into the editable request builder. Before publish, the builder reports the exact count of currently approved vendors with an active account whose category and service area match, excluding the request owner's own vendor record. The create response keeps that point-in-time count for retry-stable confirmation, while the customer dashboard recomputes current coverage only while the response window remains open. Zero coverage does not fabricate a match or block a customer from saving an open brief; the product says no response is currently expected and does not claim that email, push, or a future coverage notification will be sent. A positive count means only that eligible partners can see the open brief, not that they are available or will respond. Before any request mutation, the browser must durably preserve the exact payload, idempotency key, original attempt time, preferred-vendor display context, and owning user id in tab-scoped session storage; unavailable storage blocks the write. The server atomically compares that expected owner with the authenticated mutation identity. A network-ambiguous publish restores the locked review only after the same account is re-proven, never refreshes the 24-hour retry window, and does not become editable after a definitive rejection until that owner explicitly unlocks it.

Current operator boundary: authorized administrators see a data-minimized oldest-first `vendor-summary-v2` queue and retrieve private business/contact/service detail, the current information request, and evidence history only for the selected application. New applications include canonical public work samples, public review/reference links, a narrow business-registration disclosure or an explicit declaration that the business is not formally registered, and a server-time applicant attestation. The service never fetches or embeds submitted links and does not collect identity-document uploads or third-party reference contact details. Summary reads omit submitted URLs, registration references, applicant-facing request text, and private review reasons.

An operator may request information with bounded requested fields, an applicant-visible message, and a separate private reason. The public/effective `needs_information` state is a derived overlay on the existing pending/rejected vendor lifecycle, not a new persisted eligibility status. The immutable request and every evidence snapshot remain in append-only history. A signed-in owner may answer only the exact active request they loaded and must submit a complete replacement snapshot with `expectedVendorId`, `expectedStatus`, `expectedRevision`, `expectedEvidenceRevision`, and `expectedInformationRequestRevision`; the client locks that captured snapshot through compatibility and identity preflight, pins those evidence API checks to one gradual-deployment version with the normalized vendor id, and the Worker requires the same capability marker on the write. A successful response appends the next contiguous evidence revision and clears the overlay atomically. Applicants cannot silently edit or delete an earlier snapshot, revise without an active request, change business-profile fields through this evidence route, see private operator rationale, or infer staff identity from the owner response. Private draft evidence is hidden while focus, authentication, route-mode, conflict, reload, and post-mutation checks re-prove the exact vendor. A resolved missing or different identity clears it; a transient check failure keeps the unchanged form and idempotency key hidden until the same vendor is verified, and an explicit discard clears the draft even if the application became non-editable. The workflow is in-product only and does not promise or send email, SMS, push, or another notification.

Every admin decision requires an internal rationale, the exact effective `expectedStatus`, and the current monotonic `expectedRevision`; approval additionally requires acknowledgement of the exact latest `expectedEvidenceRevision` and fails while an information request is open. Duplicate retries replay only the original matching result, stale applicant/admin writes fail closed, and decisions appear in immutable internal history without copying evidence links or registration references. A declaration-only application also requires suitable alternate offline checks. Public “Marketplace reviewed” status remains an operating decision, not government identity verification, KYC, legal certification, business-registration verification, or guaranteed performance; staff MFA/Access and the documented review procedure remain launch gates.

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
- Vendor (current persisted lifecycle): `pending → approved | rejected`, `approved ↔ suspended`, and `rejected → pending`; `needs_information` is derived while the latest immutable information request awaits a newer evidence revision
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
