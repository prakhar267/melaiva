# Melaiva design QA

Date: 16 August 2026

## Visual sources

- Reference full-page capture: `/Users/prakhar/Desktop/weddingplanner/reference-audit/happiffie-desktop-full.png` (`1440 × 9747`, desktop, signed-out homepage).
- Reference top-viewport crop: `/Users/prakhar/Desktop/weddingplanner/app/qa-artifacts/happiffie-desktop-viewport.png` (`1440 × 1000`).
- Final production capture: `/Users/prakhar/Desktop/weddingplanner/app/qa-artifacts/melaiva-live-desktop-final.png` (`1440 × 1000`, signed-out homepage).
- Final mobile capture: `/Users/prakhar/Desktop/weddingplanner/app/qa-artifacts/melaiva-live-mobile.png` (`390 × 844`, signed-out homepage).
- Combined comparison input: `/Users/prakhar/Desktop/weddingplanner/app/qa-artifacts/reference-implementation-comparison-final.png` (same desktop viewport and state, side by side).

The reference and implementation were judged together in the combined input. Melaiva preserves the useful information hierarchy—brand/navigation, decisive celebration promise, visual hero, structured discovery controls, category exploration, competitive-offer education, and partner conversion—while deliberately replacing Happiffie’s protected brand, character art, copy, unsupported scale claims, crowded navigation, and dark neon trade dress with an original editorial system.

## Responsive and visual checks

| Surface | Viewport/state | Result |
| --- | --- | --- |
| Homepage | 1440 × 1000, signed out | Hero crop, headline measure, nav spacing, search-card alignment, type hierarchy, contrast, and below-fold handoff passed. |
| Homepage | 390 × 844, signed out | No horizontal overflow (`390px` content on a `390px` viewport); hero subjects remain legible and search controls stack without obstruction. |
| Mobile drawer | 390 × 844, open | Modal semantics, initial close-button focus, keyboard focus loop, Escape/close behavior, and full navigation passed. |
| Marketplace | desktop, empty production catalog | Honest zero-result state rendered; no example listing was presented as a verified production vendor. |
| Request builder | desktop, steps 1–4 | Required-field errors, service selection, budget/brief validation, review, auth/network handling, and no fake publish success passed. |
| Customer dashboard | signed out / API unavailable / authenticated contract | Explicit auth, empty, unavailable, and live-data states exist; no unrelated customer data is presented as real. |
| Vendor workspace | signed out / API unavailable / approved-vendor contract | Approval gate, live opportunity contract, example-only fallback, sealed-offer form, and date format passed. |
| Legal and errors | privacy, terms, unknown route | Every route has a single descriptive H1 and a recoverable navigation path. |

## Interaction and runtime checks

- Primary navigation, mobile navigation, search/filter controls, save toggle, accordion, auth modal, request wizard, planner form, dashboard tabs/actions, vendor tabs/forms, legal links, and 404 recovery were exercised in the in-app browser.
- Authentication and publishing failures never report a successful server write.
- Live deep links return the SPA with HTTP `200`; missing non-HTML assets remain `404`; API misses remain JSON `404`.
- Production browser console after the route suite: 0 warnings, 0 errors.
- Production health, registration/session, owner request create/list/cancel, and Gemini planner were exercised by the release smoke test.

## Finding history

- **P0 — production deep links redirected to `/`: fixed.** Cloudflare Static Assets returned an HTML redirect for missing routes; the Worker now treats HTML redirects as SPA misses and serves the root shell while preserving the requested URL. Covered by a regression test and live `curl`/browser verification.
- **P0 — customer dashboard used unrelated demonstration data: fixed.** It now loads the signed-in customer’s own requests and selected-request bids, with truthful auth, role, empty, unavailable, and demo states.
- **P0 — vendor workspace posted static demo opportunity IDs: fixed.** It now loads matched live opportunities, never submits a demo ID, and sends `validUntil` as `YYYY-MM-DD`.
- **P1 — frontend/backend planner, category, onboarding, and timeline contracts diverged: fixed.** Canonical categories, milestone fields, validation limits, service areas, date constraints, and idempotency now align.
- **P1 — free Cloudflare Cron Trigger capacity was exhausted: fixed.** Bounded hourly cleanup moved to the SQLite Durable Object’s alarm, with a unit test.
- **P1 — Gemini output was slow or structurally variable: fixed.** Minimal thinking, bounded retry/timeout, provider-side JSON Schema, server-side schema validation, semantic date clamping, and a clearly labelled deterministic fallback are in place.
- **P2 — modal/drawer focus could escape: fixed.** Both overlays now trap focus, restore the prior trigger, close on Escape, and expose modal semantics.
- **P2 — font build emitted unnecessary language subsets: fixed.** The launch bundle now includes only the Latin font files used by the English interface.

## Known launch gates, not visual defects

Email verification/password recovery, real vendor inventory and human verification, staff Access/MFA, transactional email, payment/contracts, Indian legal review, trademark/domain clearance, external synthetics, and a recovery drill remain required before accepting money or claiming an enterprise SLA.

## Final status

passed
