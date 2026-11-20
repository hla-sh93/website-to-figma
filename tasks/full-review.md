# Full review and difficult-case testing

By Hla.Sh · 16 November 2026 · 0.3.0-alpha.5-debug

Verdict: development continues. This build improves verified capture and reliability defects, but it does not meet universal visual fidelity or complete responsive design acceptance. The current Figma validation file opens with **Ask to edit**; no new native import or native visual pass is claimed for this build. A choice of a new Drafts test file or an editable account is pending.

## Work performed

Reviewed capture, scene validation, rendering, component analysis, font resolution, local service lifecycle, public-network policy, UI workflow, build and installation behavior. Reviewed competitor documentation and created the [product and quality plan](product-quality-plan.md). This is an engineering review with explicit remaining work, not an assertion that every possible website scenario has passed.

The baseline full check passed 58 unit/API and 27 Chromium tests. New tests reproduced the review defects before correction. The first unboxed-text test initially exercised aggregation rather than the intended loss path; it was corrected to include an asset sibling, then caught an actual promoted-text ordering defect. That order defect was corrected and retested.

Final full `npm run check`: **60 unit/API tests + 37 Chromium tests = 97 passed**, zero failures and zero skips; formatting, TypeScript and build passed. `npm audit --json` reported zero known advisories for the installed dependency tree. `git diff --check` passed. These results do not establish a native Figma visual accuracy score.

## Confirmed findings and disposition

| Priority | Finding | Current disposition and evidence |
| --- | --- | --- |
| P1 | Image/background crossing y=16000 failed scene validation because bounds shrank while contentBox did not | Fixed: clip the outer capture frame and preserve original image geometry. Long-page browser regression passes. The 16000px coverage limit remains disclosed. |
| P1 | The seventh sequential capture failed because six terminal jobs occupied the cache | Fixed: evict the oldest terminal result under cache pressure, preserving active/queued work. Twelve sequential captures and six-pending backpressure tests pass. Evicted retry keys are removed with their cached results. |
| P1 | Direct text in promoted unboxed wrappers could disappear or reorder | Fixed for the tested nested display:contents case: measured direct text is retained once and ordered by its immediate DOM ancestor. Browser regression passes. |
| P1 | Inputs lost visible text; edited textarea imported stale textContent | Fixed for supported visible control text: read current value/selection and mask password characters. Native control appearance/internal clipping remains explicitly marked for review. Control-only page regression passes. |
| P1 | An access interstitial could be imported as if it were the requested page | Known visible CAPTCHA/verification markers and Amazon's observed access gate now reject with PAGE_BLOCKED. A CAPTCHA fixture and the final actual Amazon URL run confirm rejection. Detection is intentionally bounded and does not recognize every protection system. No barrier is automatically solved. |
| P1 | Same-length changing text was treated as a stable page | Fixed for tested content: fingerprint includes a text hash, image source/readiness, control state and bounded geometry/style samples. Continuously changing text is rejected. Changes beyond bounded samples or unobserved renderer state remain a limitation. |
| P2 | CSS/currentColor SVG paints disappeared when assets were cloned | Fixed for tested SVG paint: embed computed paint and typography before sanitizing, retain local fragment references. An independently rasterized SVG asset is verified green by pixel assertions. All SVG/CSS effects are not thereby proven. |
| P2 | Preformatted indentation, trailing spaces and newlines were stripped | Fixed for pre/pre-wrap/break-spaces fixtures; exact characters are asserted. Native typography and tab-width behavior still need review. |
| P2 | Unequal Grid gaps and fixed tracks were expanded incorrectly | Column/row gaps now remain distinct. Incompatible measured grid occupancy falls back to fixed positions with a warning. Supported grid proportions remain inferred and explicitly require resize review. Full fixed/fractional/mixed track semantics are pending. |
| P2 | Merged inline spans silently lost background/opacity/box effects | A targeted warning now exposes the loss. Rendering those boxes accurately remains **open**, rather than being counted as a fidelity fix. |

## Real public-page exercises

Run with `npx tsx scripts/review-public-sites.ts`; latest evidence is in `output/review-public-sites/report.json` and immutable run `2026-11-16T05-56-32-431Z-2e196d9b`. Every successful case records an artifact directory and SHA-256 source hash. Earlier top-level case folders are historical and must not be paired with the latest report. The reporting change passed formatting and TypeScript and was exercised on all four URLs. This script captures source scenes and screenshots; it does not run Figma or grade native fidelity.

| Case | Latest result | Important limitation |
| --- | --- | --- |
| Amazon UK Home / 1440 Light | Correctly refused an access interstitial with PAGE_BLOCKED after ~4s | The previous run exceeded the DOM node/depth budget after ~23s; an earlier 900px Continue shopping source was visually identified as the wrong page. Public content changed between runs. Full Home acceptance has not passed. |
| Arabic Wikipedia home / 390 Light | Source captured: 7915px, 322 text nodes, 57 images | Mixed rendered fonts, pseudo-content, transforms and some fixed layout fallbacks require review. An earlier capture was 9089px; use only the source/native artifacts from the same run. |
| MDN CSS Grid / 1440 + 390 Dark | Both source captures completed: heights 6465px and 8970px | Many inline/pseudo effects; desktop font evidence exceeds the 256-element inspection budget. This is not proof of complete editable native rendering. |
| W3C ARIA Combobox / 390 Light | Source captured to 16000px | Explicit height-truncated warning; complete page coverage failed. |

The latest source success count is three of four requested public URLs, with important warnings and one truncated page. It is not a 75% accuracy claim. No current public case has a new native visual verdict.

## Coverage actually exercised

- Content/layout: nested responsive fixtures, promoted picture/images, clipped/screen-reader content, reversed flow, grid placement, fixed widths, minimum/maximum widths, source margin spaces, stacking and consent rejection.
- Typography/assets: Arabic and English preference, actual font evidence, mixed runs/decorations/axes, preformatted text, ellipsis, image fit/position/crops, CSS backgrounds/sprites, static video poster and CSS-painted SVG pixels.
- Lifecycle: opaque plugin iframe, missing randomUUID, automatic pairing, delayed/hidden hydration, cancellation and late results, repeat keys/conflicts, repeated captures, six-job backpressure and unavailable service.
- Security/limits: local authentication/origin/host checks, private/reserved/mapped addresses, DNS rebinding, authenticated egress, unsafe SVG, schema depth/data bounds and decoded image budgets.

Browser UI tests simulate the Figma main message endpoint. They do not replace the actual native editor checks.

## Remaining release blockers

1. **P1 — Actual native acceptance:** current validation file is view-only. Previous alpha.4 native run failed at the first text style assignment with a 10-second Figma host connection error; the cause remains unconfirmed. Obtain an editable test file, rerun with foundations/components enabled, inspect cleanup on failure and compare the same run's source/native exports.
2. **P1 — Complete complex pages:** large Amazon Home exceeds the current DOM/depth budget; long ARIA content is truncated. Add measured, bounded segmentation and explicit coverage accounting rather than silently declaring a partial page complete.
3. **P1 — Responsive correctness:** repeated captured widths and inferred native sizing do not recover all CSS breakpoints or fixed/mixed grid tracks. Native resize/content-growth and intermediate browser comparisons are required.
4. **P1 — Source state and unsupported content:** private pages, exact user sessions, Shadow DOM, virtual/infinite lists, native controls, pseudo-elements, canvas/iframes and complex effects need dedicated handling and qualification. A browser capture path is planned.
5. **P2 — Typography/paint completeness:** mixed glyph fallback, missing licensed fonts, inline boxes, gradients, multiborder/shadow/clipping and SVG geometry styling remain incomplete. A visibility:hidden ancestor with explicitly visible descendants also needs a dedicated correction and regression.
6. **P2 — Everyday installation:** the local service still needs to run. Package and start the companion service automatically before describing the normal experience as paste-only.
7. **P2 — Maintainability:** the serialized browser collector is growing. Move to a built browser entrypoint with modular text/control/SVG/layout extraction before another large feature increment, while preserving serializable execution and existing tests.

## Deployment state

The registered development plugin folder was updated to alpha.5, its runtime files backed up and verified byte-for-byte. `verificationMode=false`: no automatic sample insertion or missing-font substitution is enabled. Generic bundles retain their credential placeholder. This is a development installation, not a published release.

Previous visual evidence remains in `output/installed-verification/home-reviewed`: the alpha.4 same-source comparison reported 22.44% of sampled pixels above threshold 24 and different source/native heights. That is a failed exact visual acceptance result, not a percentage accuracy statement.

Next acceptance order: obtain an editable native test file; prove native host/style creation works; run deterministic feature/resize fixtures; compare complete supported public pages region by region; then expand the corpus and benchmark cleanup tasks against the documented competitors.
