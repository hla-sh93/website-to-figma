# Website to Figma — product and quality plan

By Hla.Sh · 16 November 2026

Status: implementation in progress. Universal 100% fidelity and market leadership are not established. This plan defines how to measure progress and qualify a release. Competitor capabilities below are vendor documentation claims, not hands-on comparative results.

## Product promise

Paste a website URL, choose size, source theme and source language, then receive named, editable Figma layers. Preserve the page's actual content and appearance; expose any missing font, incomplete capture or unsupported effect before describing the result as verified. Language requests select a source locale; they do not translate a website. Light/Dark requests select the source preference; they do not guarantee the site provides a corresponding theme.

Keep the main UI to the existing URL and three dropdowns. Show additional decisions only when needed: missing font, capture limitation, cancellation or a result that needs review. Put diagnostic and advanced controls behind a details view. The long-term normal flow must not require a terminal or manually starting a service.

## Competitive evidence

Reviewed official pages on 16 November 2026. Features are time-sensitive; recheck before commercial decisions.

| Product | Documented strengths | Implication for this project |
| --- | --- | --- |
| [html.to.design](https://html.to.design/docs/free-features/) | URL and browser capture, several viewports/themes, Auto Layout, styles/variables, fixed/sticky behavior, hover components and recorded flows | These features are the competitive baseline. A URL-only importer is insufficient as a finished product. |
| [html.to.design browser extension](https://html.to.design/docs/what-is-the-browser-extension/) | Captures the user's current page, including logged-in pages and selected states | A browser capture path is necessary for private pages and the exact state a user sees. |
| [html.to.design font handling](https://html.to.design/docs/missing-fonts/) | Rendered font names, missing font replacement/download workflow | Preserve actual font evidence and explicit substitution decisions; installed fonts remain a real dependency. |
| [Builder.io](https://www.builder.io/blog/html-to-design) | URL/HTML import, element capture from private pages; Auto Layout described as beta | Compare editable structure and resize behavior, not only a static preview. Vendor's stated accuracy is not a cross-tool benchmark. |
| [Figma Chrome extension](https://www.figma.com/downloads/chrome-extension/) | Full-page or selected-element capture as design layers or interactive code layers | Native Figma capture is a direct competitive baseline. Our differentiation must be proven quality, structure and a better workflow. |
| [Magicul](https://magicul.io/converter/website-to-figma) | URL-to-Figma conversion | Include in a future hands-on benchmark; documentation alone establishes no fidelity ranking. |

Useful limitations are documented even by mature competitors: [bot-protected URLs](https://html.to.design/docs/bot-protected-sites/), [full-page capture failures](https://html.to.design/docs/capturing-full-page-length), and [source language behavior](https://html.to.design/docs/import-webpages-in-any-language). A protected, virtualized or personalized page is not guaranteed to match a fresh browser session opened by URL.

## Proposed differentiation

1. Evidence for every import: source snapshot, native export, geometry/text coverage and visible limitations tied to affected layers. Never present a single pixel-difference metric as a universal accuracy percentage.
2. Arabic and mixed-language quality: RTL ordering, Arabic shaping, punctuation/numbers, typography, responsive controls and component editing, verified against real native exports.
3. Useful Figma structure: preserve repeated content safely, semantic layer names, reusable styles/variables, editable icons and text, and responsive behavior that survives actual resize and copy changes.
4. A dependable local workflow: private capture data by default, bounded work, cancellation, crash recovery and automatic service startup. Add browser capture for exact sessions without weakening public URL network protection.
5. Re-import with review: identify source changes, preserve user modifications where safe, show conflicts, and create an undoable update. Do not overwrite a designer's work silently.

These are priorities and hypotheses, not claims of superiority. Validate them with designers doing the same tasks in each tool.

## Acceptance dimensions

| Dimension | Required evidence |
| --- | --- |
| Content completeness | Exact expected visible text, no duplicates, expected assets/sections present, footer and page extent accounted for. Virtualized/infinite content must have an explicit scope. |
| Visual fidelity | Browser and native PNG from the same frozen capture and same scale. Dimensions, regional overlays and geometry checked; typography and icons inspected at native scale. Antialiasing differences must not hide missing content. |
| Typography | Actual rendered font evidence where available, every substitution recorded, styled ranges retained, exact whitespace where CSS preserves it, no overflow or clipping after import. |
| Editability | Text changes as text; icons remain vectors when supported; repeated content keeps distinct text/images; styles and variables update their bound layers. Raster fallbacks are explicitly identified. |
| Responsiveness | Native resizing tested at observed widths and intermediate widths. Compare against new browser captures at those widths; measure overflow, reflow, wrap and fill/hug behavior. Capturing three frames alone does not prove responsiveness. |
| Reliability | Repeated imports, cancellation at each stage, service restart, Figma connection failure, missing fonts, budget failures and rollback all tested. No orphan native resources after failed imports. |
| Security/privacy | Public-address validation on every request and redirect, pinned egress, local API auth/origin/host checks, safe SVG, bounded data/decoding, no credentials in generic bundles, no capture text in unnecessary logs. |

Proposed release gates: zero unresolved critical/high defects; all required deterministic tests pass without skips; no missing expected content in the supported corpus; no silent substitutions; all native functional and visual checks reviewed. Set numeric visual thresholds per fixture and per region using actual browser/Figma rendering variance. A page with unsupported features receives a partial result label even when its other tests pass.

## Difficult scenario matrix

| Family | Cases |
| --- | --- |
| Layout | Nested Flex/Grid, unequal gaps, fixed/fractional/mixed tracks, spans/dense flow, reordered children, min/max widths, collapsed margins, positioned stacking, fixed/sticky headers, overflow and nested scrolling |
| Text | Arabic/English mixed runs, emoji and fallback fonts, variable fonts, ligatures, multiline rich text, decorations, pre/pre-wrap/break-spaces, ellipsis, vertical text, text transforms |
| Assets | Picture/display:contents, responsive srcset, background photos/sprites/repeats, styled SVG/currentColor, broken/large images, EXIF, animated formats, canvas, video and iframe |
| Content | Delayed hydration, same-length text changes, lazy loading, consent overlays, Shadow DOM, virtual lists, infinite scroll, language/theme negotiation, viewport and user-agent differences |
| Interaction/state | Live input/textarea values, placeholders, select/checkbox/radio, open menus, dialogs, hover/focus states and recorded flows |
| Failure/load | Invalid URL, redirects, login/CAPTCHA, timeouts, DNS rebinding/private addresses, too many nodes/depth, decoded image limits, repeated imports beyond six, service/Figma disconnection, cancellation and retry |

Current automated regression suite covers a subset; refer to the review report for cases actually run. Pending cases above are not completed tests.

## Delivery order

| Stage | Work | Exit condition |
| --- | --- | --- |
| 0 — Restore trustworthy baseline | Reproduce current defects; preserve evidence; fix content loss and lifecycle failures; pinpoint actual native host failure | Local regression suite green and a real native import works with styles/components enabled |
| 1 — Complete supported pages | Direct/unboxed text, live controls, SVG styles, whitespace, stable source snapshots; accurate page clipping | Owned fixture content expectations pass; source/native snapshots are tied to one run |
| 2 — Native visual fidelity | Borders, gradients, pseudo-elements, inline boxes, clipping, stacking contexts, typography; explicit treatment of canvas/video/iframes | Regional native comparisons pass on the supported corpus; unsupported cases disclosed |
| 3 — Responsive design quality | Observe geometry changes at multiple widths; encode supported grid tracks and sizing; preserve component instances and style semantics | Real resize and content-growth tests pass at source and intermediate widths |
| 4 — Seamless capture | Browser extension for current/private page state; packaged companion service with automatic startup; recovery and cancellation | Cold-start URL paste works without terminal instructions; exact-session capture works with user-selected page permissions |
| 5 — Competitive workflow | Re-import/diff, reusable design system mapping, selections, hover/flow prototypes, batch queue behind advanced UI | Designer task study shows lower cleanup time and equal/better correctness against selected competitors |
| 6 — Release qualification | Repeatable native harness, broad corpus, install/reload/upgrade/uninstall testing, privacy review and support docs | All release gates signed off; claims limited to the tested scope |

## Benchmark protocol

Start with owned deterministic fixtures where every expected string, asset and layout behavior is known. Add public pages from commerce, documentation, Arabic content, marketing and design systems. Preserve the frozen source for each comparison because public pages change. Suggested expansion: 25 owned fixtures across five widths, Light/Dark and Arabic/English only where meaningful; at least ten representative public pages with reviewed scopes. This is a target corpus, not a count already tested.

Compare tools on the same source, device settings and available fonts using ordinary permitted workflows. Record missing sections, text/asset errors, native geometry, cleanup time, editability, responsiveness, import duration and failure recovery. Use at least two designers and repeated tasks before ranking results. Competitor marketing claims or our local test count cannot establish “#1.”

Track each run by source hash, build identity, capture settings, native node IDs, font substitutions, artifacts and verdict. Keep source-only capture success distinct from native functional success and visual acceptance.
