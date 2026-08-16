# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## Product decisions

- The working brand is **Melaiva**, with the promise “Your celebration, beautifully matched.”
- The visual system uses warm ivory, aubergine `#3A193B`, marigold `#F2A900`, peacock teal `#167D7F`, and restrained rose `#E86A76`; Fraunces is the display face and Manrope is the product/body face.
- Use original editorial celebration photography and library icons. Never reuse Happiffie branding, characters, copy, images, unsupported proof points, or trade dress.
- The primary flow is structured brief → controlled vendor matching → sealed comparable offers → shortlist/accept. Customer-facing copy should prefer “offers” or “competitive quotes” over “reverse auction.”
- Help/chat UI must never cover a form field, CTA, navigation item, or other primary control at any breakpoint.
