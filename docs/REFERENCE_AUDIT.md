# Happiffie reference audit

Captured 16 August 2026 at desktop `1440 × 1000` and mobile `390 × 844`. This audit is product evidence for an original implementation; it is not permission to copy Happiffie’s brand, copy, characters, images, or trade dress.

## Overall verdict

The strongest product mechanism is a structured celebration brief followed by matched vendors, competitive offers, comparison, and booking. The public site communicates that value, but the experience behaves more like a broad SEO and lead-generation surface than a proven end-to-end marketplace. The opportunity is to narrow the promise, make the offer workflow genuinely transactional, and earn trust through real inventory, normalized scope, and fulfillment evidence.

## Captured journey

1. **Homepage and celebration search — mixed.** Clear category promise and useful event/experience/city/date model. Search suggestions are extensive, but the page tries to communicate too many products at once.
2. **Customer and partner entry — healthy with caveats.** Role-specific login is clear and supports Google plus direct credentials. The modal copy is wedding-only despite a much broader platform, and the two forms are nearly identical.
3. **Reverse-auction education — conceptually strong, visually unreliable.** The page explains post → match → compete → compare → book and shows an interactive savings preview. In the captured desktop state, significant layout/styling did not load correctly.
4. **Core auction request — unhealthy.** The route rendered a header over an otherwise blank content area, blocking the platform’s main promised action.
5. **Vendor acquisition — broken.** The onboarding route failed with a client-side chunk-load exception, leaving no recoverable form or guidance.
6. **Mobile navigation — mostly understandable.** The menu exposes the full information architecture, but a persistent support widget intrudes into both navigation and content.
7. **Mobile planning and discovery — poor task protection.** WhatsApp plus chat prompts repeatedly cover form controls, comparison cards, headings, categories, vendor CTA, newsletter, and footer content.
8. **Marketplace breadth — strong taxonomy, weak prioritization.** Events, experience categories, cities, insights, brands, and vendor acquisition demonstrate breadth, but make the homepage extremely long and dilute the primary conversion path.
9. **Long-form SEO content and footer — unhealthy on mobile.** Very long keyword-heavy sections dominate the lower page and reduce readability and perceived quality.

## Highest-impact product changes

1. Make one action primary: “Describe your celebration” → structured brief → invite vendors → compare offers.
2. Launch one city and a small set of categories with visible real supply before advertising national scale.
3. Call the mechanic “sealed offers” or “competitive quotes” in customer UI; reserve “reverse auction” for explanatory contexts.
4. Normalize every offer by category-specific inclusions, exclusions, GST, travel, add-ons, validity, cancellation, and delivery plan.
5. Show trust proof tied to completed transactions rather than large unsupported statistics.
6. Make AI the brief compiler, missing-question detector, and comparison explainer—not a decorative mascot.
7. Move broad inspiration/SEO content to focused collection and guide pages.
8. Guarantee that help UI never obscures primary controls; use a single collapsed entry point with safe-area spacing.
9. Provide explicit loading, retry, and error states so chunk/provider failures never become blank screens.

## Accessibility risks visible from captures

- Persistent overlays obscure controls and text, a severe operability risk on small screens.
- Several muted purple-on-purple text treatments appear likely to have weak contrast.
- Small social/header controls and crowded icon categories may fall below practical tap-target size.
- Heavy sticky UI reduces usable viewport and may worsen at 200% zoom or with larger text.
- Screenshot evidence cannot establish keyboard order, screen-reader naming, focus trapping, live-region announcements, reduced motion, or dynamic validation behavior; those require direct testing.

## Evidence limitations

The audit covers public, unauthenticated routes and visible login modals. It could not verify Happiffie’s real customer dashboard, vendor dashboard, submitted auction, offer revision, comparison, contract, payment, or fulfillment behavior. Those public claims were therefore treated as positioning rather than implementation evidence.
