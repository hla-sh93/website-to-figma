# Website to Figma — product and engineering plan

Prepared 28 October 2026. Status: proposed plan; no plugin implementation or benchmark has been completed.

## 1. Recommendation

Build a website reconstruction plugin that produces a faithful, editable Figma Design file with a documented responsive structure, reusable foundations, and an actionable quality report.

The value proposition is: **Bring a real website into Figma, preserve how it looks, understand how it adapts, and make it practical to redesign.**

Treat this as a rendering and reconstruction product with a Figma interface. Most of the difficult work lives in browser capture, layout translation, typography, and verification. AI can assist with semantic interpretation, but measurements and source content should come from the rendered website.

Do not promise that every URL becomes a perfectly identical, fully native, fully responsive file. Fonts may be unavailable, pages may be inaccessible, and browser effects may lack a direct Figma equivalent. Define supported cases, preserve evidence, and disclose exceptions at the affected element.

Planning assumptions: a commercial-quality product is the long-term goal; Figma Design is the first destination; public pages are the initial capture surface; desktop and mobile are mandatory; the team can operate a small backend. A private personal tool can omit billing and team administration. Figma Sites output would need a separate feasibility study.

## 2. Product positioning and validation

Primary users: product designers reconstructing an existing product, agencies redesigning client websites, and design-system teams documenting implemented UI. The principal job is to reduce the time between finding a useful page and having a file that is safe and pleasant to edit.

URL import, multi-viewport capture, Auto Layout, local styles, font mapping, and even some hover-component capture already exist in html.to.design. These are baseline capabilities, not a unique position. This is based on the vendor's published feature descriptions, not an independent quality assessment. [Vendor features](https://html.to.design/docs/free-features)

The proposed advantages are hypotheses to validate:

- Measured fidelity, with a source/Figma overlay and element-level repair actions.
- Responsive behavior reconstructed from several real viewport captures.
- Useful component families with properties, rather than a canvas full of unrelated layers.
- A clear distinction between observed facts, inferred structure, and approximations.
- Repeatable naming and design-system extraction across several imported pages.
- Arabic and mixed RTL/LTR quality as a first-class test area.

Interview 8–12 target users and observe their current workflow. Time the import, cleanup, component creation, and resize repairs. Use the same pages to compare manual work, an established importer, and the prototype. A provisional product goal is at least 50% less cleanup time on the defined supported corpus. This is a proposed validation threshold, not a measured claim.

## 3. What “fully matches” means

There are three separate outcomes:

| Outcome | Required evidence | Tradeoff to expose |
|---|---|---|
| Visual fidelity | Source capture and Figma export agree at the same viewport and state | A raster region can look accurate while remaining structurally uneditable |
| Editability | Text, images, vectors, spacing, and repeated UI can be changed sensibly | Over-fragmented text and unnecessary wrappers undermine usability |
| Responsive behavior | Layout survives resize and content changes across declared ranges | Some structural changes require a different frame or variant |

One composite percentage must not hide these differences. Report them separately, with coverage and exception counts.

The source of truth is a particular rendered page state: URL, timestamp, viewport width and height, device scale, theme, locale, scroll position, and any explicit interaction state. A URL alone does not describe all of those conditions.

The plugin should offer these workflows:

1. **Faithful import — default.** Preserve measured values and visible content. Build native structure wherever it meets the fidelity threshold. Identify unsupported regions.
2. **Organize as a system — optional.** Propose aliases, component families, naming conventions, and deduplication. Show any visual changes before application.
3. **Apply my brand — later.** Map colors, typography, radii, and components to a chosen design system. Preserve the original import for comparison and make visual deviations intentional.

Do not silently round a 23px gap to 24px or replace a font merely because it fits a preferred spacing scale or brand system.

## 4. User experience

Keep the primary path short: **Paste URL → Analyze → Resolve important issues → Import → Review.**

### Screen A: Import

One URL field and an Analyze action. Defaults: full page, desktop 1440px and mobile 390px, source theme, faithful import. Advanced controls: tablet/custom viewports, language, selected section, capture state, and output organization. These widths are starting samples, not assumptions about the site's actual breakpoints.

### Screen B: Preflight

Show source thumbnails and a concise readiness summary: fonts found/missing, image availability, estimated complexity, responsive samples, and unsupported regions. Let users select whole sections visually. Avoid a wall of CSS terminology.

Font decisions should be actionable: install or enable the original font and retry; select a fallback; or use a clearly labeled appearance-only representation for affected text where technically available. Font substitution must disclose likely line-wrap changes. A failed font must never silently look like an exact match.

### Screen C: Progress

Use truthful stages: Loading page, Collecting assets, Understanding layout, Creating Figma layers, Checking result. Show elapsed time and completed units when measurable. Allow cancellation. On timeout, retain completed sections and offer a targeted retry rather than an unexplained restart.

### Screen D: Result and repair

Show the imported frames, a before/after overlay, and a short issue list. Example: “Heading uses a substitute font,” “Hero background imported as image,” or “Mobile navigation needs a separate variant.” Selecting an issue selects the affected Figma node. Actions include Retry asset, Change font, Preserve appearance, Rebuild section, and Keep current result.

Error messages should distinguish inaccessible URL, bot challenge, expired session, missing asset, unsupported rendering, exhausted limits, and Figma insertion failure. They should not claim the same fix works for every failure.

## 5. Output contract

Create a named import section on the current page by default. Offer separate pages for larger files when the editor/account supports the chosen structure. Do not rename unrelated pages or modify existing styles automatically.

Suggested organization:

    Import / example.com / Home / 2026-10-28
      Screens
        Home / Desktop / 1440
        Home / Mobile / 390
      Components
        Navigation / Header
        Button
        Card / Feature
      Foundations
        Typography specimen
        Color and spacing references
      Import report

Within a frame:

    Home / Desktop / 1440
      Header
        Brand
        Navigation
        Actions
      Main
        Hero
          Content
            Heading
            Description
            Actions
          Media
        Features
          Feature grid
      Footer

Naming order: semantic HTML/ARIA role → meaningful stable source attribute → repeated UI role → optional AI suggestion → deterministic fallback. Keep arbitrary tracking IDs, hashed class strings, and personal text out of names. Resolve collisions with stable suffixes. Preserve the source identity separately so renaming a frame does not break provenance.

Every reconstructed region records source identity, viewport/state, capture version, conversion mode, and issues. Large artifacts stay outside node metadata; plugin data contains compact references. Generated names and component boundaries are inferred design intent, not claims to recover the original Figma file.

## 6. Responsive reconstruction

Figma supports horizontal, vertical, and grid Auto Layout, along with sizing behaviors useful for flexible layouts. Native grid support should be evaluated directly instead of treating all two-dimensional layouts as rows of nested frames. [Auto Layout guide](https://help.figma.com/hc/en-us/articles/360040451373-Guide-to-auto-layout-in-Figma), [Plugin grid API](https://developers.figma.com/docs/plugins/api/properties/nodes-gridcolumncount/)

However, producing several screenshots does not reconstruct responsiveness. This product must distinguish fluid resizing from a change in structure. The plan does not assume ordinary Design frames execute arbitrary CSS media/container queries or automatically switch component variants at a width. Figma Sites has a separate breakpoint model; do not silently treat Sites behavior as a Design-plugin capability. [Sites breakpoints](https://help.figma.com/hc/en-us/articles/31242797809815-Add-or-delete-breakpoints-in-a-webpage)

The proposed algorithm:

1. Capture the page independently at the requested widths, preserving consistent state and theme.
2. Match corresponding elements using source keys, semantic roles, structure, and asset/text signatures. Mark ambiguous matches, especially when JavaScript replaces the DOM.
3. Extract explicit flex/grid/sizing evidence and available relevant media/container rules. Computed styles alone describe the current result, not every rule that produced it.
4. Detect changes in columns, ordering, visibility, navigation, typography, and spacing. Sample additional widths around detected changes, within a bounded capture budget.
5. Create a responsive layout model for each supported interval. Use fill, hug, min/max sizing, wrap, grid, aspect-ratio constraints where suitable, and explicit exceptions for overlays.
6. Represent structural discontinuities as named viewport frames or component variants. Document how to switch them. Optional plugin-assisted preview can select a variant while running; it must not be advertised as persistent browser-like behavior after the plugin closes.
7. Test held-out widths inside each interval and around the sampled boundaries.

Example: a feature section might remain a flexible three-column grid from 1100–1440px, become two columns around tablet widths, and become a single column on mobile. Recover those observed layouts. Do not claim an exact breakpoint threshold if only a transition interval is known.

If the original website itself does not adapt well, faithful import preserves that fact. “Improve responsiveness” should be a separate redesign operation with a preview.

## 7. Capture and conversion architecture

    Figma plugin UI ──→ Authenticated job API ──→ Queue ──→ Isolated browser worker
           ↑                                                    │
           │                                      Capture package + assets
           │                                                    ↓
           └──── Versioned scene model ← Layout / asset / font analysis
           │
           ↓
    Figma main code → Native nodes, styles, variables, components
           │
           └──→ Export + structural inspection → Comparison → Repair report

An optional browser extension later supplies a capture package for the user's current authorized page. Both sources feed the same model, while declaring their different capture capabilities.

**Plugin UI:** URL input, settings, authentication handoff, job polling, font decisions, preview, and report. Keep cloud credentials and vendor API secrets on the backend. Validate every UI/main-code message.

**Plugin main code:** document mutations, available font enumeration, node building, style/variable binding, component creation, export, and source-node mapping. Use the documented UI/message boundary for browser-facing work. [How plugins run](https://developers.figma.com/docs/plugins/how-plugins-run/)

**API and job manager:** create/retrieve/cancel jobs; enforce quotas and size limits; use idempotency keys; return short-lived signed asset references. Proposed lifecycle: queued → capturing → analyzing → ready → importing → verifying → complete, with explicit failed/cancelled/expired outcomes. Store cloud progress separately from plugin import progress so closing Figma does not falsely mark insertion complete.

**Browser workers:** Playwright with a pinned Chromium build, fresh isolated browser context per job, controlled egress, bounded CPU/memory/time, and no shared authenticated state. Pin capture and converter versions into the result. This is a proposed stack, not an assertion that a particular library version has been tested.

**Capture package:** rendered DOM/layout data, filtered computed styles, text runs, source identities, assets, screenshots, viewport/state, and limitations. Use Chromium protocol data where it improves evidence; DOMSnapshot exposes layout/style information, and CSS inspection can help identify fonts actually used. Those interfaces need versioned adapters and tests. [DOMSnapshot](https://chromedevtools.github.io/devtools-protocol/tot/DOMSnapshot/), [CSS protocol](https://chromedevtools.github.io/devtools-protocol/tot/CSS/)

**Infrastructure:** TypeScript across plugin and service; a small SQL store for jobs/accounts/provenance; object storage for capture artifacts; a managed queue and container workers. Avoid additional infrastructure until throughput demands it. Keep conversion adapters independent of the UI and database.

### Browser capture details

- Wait for DOM readiness, document fonts, relevant image decoding, and bounded layout stability. Network-idle alone is insufficient for pages with continuous requests.
- Record whether capture was stable or timed out; never call an unsettled result exact.
- Load lazy content through bounded scrolling, then return to the intended capture position and stabilize again. Cap page length; disclose truncated and virtualized content.
- Preserve the rendered image selection and crop: currentSrc, intrinsic size, object-fit, object-position, and background placement.
- Collect visible pseudo-elements, clipping, transforms, stacking contexts, opacity, borders, shadows, and gradients as needed by the support matrix.
- Record the chosen animation time/state. Playwright animation disabling changes animation behavior, so it is a capture policy to disclose and test, not a universal visual fix. [Screenshot options](https://playwright.dev/docs/api/class-page#page-screenshot)
- Keep hover, menu-open, and accordion-expanded states opt-in. Only execute explicit bounded actions; do not submit forms or perform account actions automatically.
- Treat nested frames, shadow content, canvas, and virtualization according to actual capture capability. Server instrumentation and a minimally privileged extension are not equivalent.

## 8. Intermediate scene model

Create a renderer-independent, versioned model before building Figma layers. It makes failures reproducible and allows a future change of browser or conversion vendor without rewriting the plugin interface.

| Record | Key fields |
|---|---|
| Capture | ID, schema version, source URL, timestamp, viewport, DPR, locale, theme, state, engine version |
| Scene node | Stable source ID, parent ID, role, kind, children, bounds, stacking and clip data |
| Layout evidence | Computed properties, observed geometry, inferred behavior, supported width interval, confidence |
| Text | Exact visible content, styled runs, direction, font request and resolved evidence, line metrics |
| Asset | Content hash, media type, dimensions, original reference, payload location, crop/transform |
| Foundation candidate | Source custom-property evidence, exact value, usage count, proposed semantic alias |
| Component candidate | Structural signature, instance matches, variant evidence, editable properties |
| Issue | Type, severity, affected source IDs, capability/fallback, proposed action |
| Import mapping | Capture/source ID ↔ Figma node ID, generated-property snapshot, user overrides |

Validate the schema at every boundary. Carry measured values separately from inferred rules. Never replace missing text or imagery with generated approximations while describing the output as a faithful import.

## 9. Translation policy

| Website feature | Preferred Figma output | Explicit limitation/fallback |
|---|---|---|
| Block flow | Vertical Auto Layout where equivalent | Margins, inline flow, and collapse may require wrappers or custom handling |
| Flex | Horizontal/vertical layout, wrap, sizing | Browser flex algorithms are not universally identical to Figma sizing |
| CSS grid | Native grid when tested equivalent | Unsupported placement/track rules use nested layout or a fixed region |
| Absolute decoration | Absolutely positioned child in a semantic frame | Keep exceptions intentional; do not force everything into flow |
| Text and inline spans | Editable text with styled ranges | Browser/Figma shaping and line breaks require measurement and verification |
| Images | Original decoded asset as image fill with accurate crop | Missing asset gets a visible issue and retry, never a stock replacement |
| SVG/icon | Native vector import where compatible | Unsupported filters/effects use a labeled image region |
| Icon font | Available font glyph or verified vector source | Never substitute a visually similar unrelated icon silently |
| Pseudo-element | Named native child where supported | Flatten only the affected unsupported region |
| Gradients/shadows | Native paint/effect when equivalent | Complex compositing or blend effects may require raster fallback |
| Canvas/WebGL/video | Captured poster/region plus source metadata | Static capture does not reconstruct internal objects or playback logic |
| Fixed/sticky content | Position in the chosen state; prototype mapping later | A screenshot cannot establish full scroll behavior |
| Interactive states | Explicit captured states and later component variants | No invented loading, error, hover, or hidden states |

Publish a versioned support matrix with “native,” “approximate,” “image fallback,” and “unsupported” statuses. Native status requires a fixture and a passing Figma export comparison.

Do not map every HTML div to a frame. Remove only wrappers that have no layout, painting, clipping, identity, or semantic purpose. Preserve meaningful region boundaries. Avoid splitting a paragraph into one text layer per line just to improve a screenshot score.

## 10. Typography, styles, variables, and components

### Fonts

Resolve family, style/weight, variable axes when supported, font size, line height, letter spacing, text decoration, direction, and mixed runs. Browser fallback can occur for individual scripts or glyphs; a computed font-family list is not proof of the font used.

Figma's loadFontAsync makes already available editor fonts usable; it does not install arbitrary web fonts from URLs. The user may need to install or enable the licensed font in their environment. Enumerate available fonts, match exact faces first, and expose remaining differences. [Figma font loading](https://developers.figma.com/docs/plugins/api/properties/figma-loadfontasync/)

Font replacement must trigger re-measurement and resize validation. Include Arabic, mixed scripts, ligatures, emoji, long headings, and variable-font cases in fixtures. Do not use tiny font-size or letter-spacing changes as an undisclosed way to fake a match.

### Foundations

Create local text styles for repeated typographic recipes and effect styles for repeated supported shadows. Create color and numeric variables and bind them to supported properties. Figma supports creating variables and binding them, but an unbound variable library alone does not make the imported file customizable. [Variables guide](https://developers.figma.com/docs/plugins/working-with-variables/)

Maintain two levels: exact primitive values and proposed semantic aliases. For example, primitive/color/blue-01 can feed color/action/primary only when usage evidence supports that interpretation. Preserve meaningful source custom-property names when available. Coincidentally equal values do not necessarily share design intent.

For typography, use font/size/weight/line-height/spacing combinations to identify recipes; for spacing, collect exact repeated values and suggest a scale later. Do not normalize during faithful import. Support theme modes only when captured evidence and the user's Figma capabilities permit it; use separate themed frames otherwise.

Prefix generated assets by source/project and deduplicate within an import lineage. Mapping to an existing library must be explicit and must not rewrite unrelated styles.

### Components

Detect repetition using semantic role, normalized structure, layout, paint, and content slots. Text differences alone should not prevent detecting repeated cards, while similar colors alone should not merge unrelated UI.

Start with buttons, cards, badges, inputs, and navigation items. Create a main component plus instances. Expose labels, optional icons, nested swaps, and evidence-backed variants. Figma's component-property APIs support these kinds of editable controls. [Component properties](https://developers.figma.com/docs/plugins/working-with-component-properties/)

Use confidence thresholds: high-confidence families can be created automatically; ambiguous families appear as proposals. Do not create a master component for every unique element. Preserve per-instance overrides and validate that substitution did not change the layout. Cross-page family deduplication belongs after single-page accuracy is stable.

## 11. Fidelity verification and release gates

A screenshot-only match can reward flattening. Therefore compare appearance and inspect structure separately.

Verification loop: capture source → create native Figma output → export at matched scale → align corresponding regions → compare image and structural evidence → propose a bounded repair → re-export. Limit automated repair iterations and retain the earlier version if the repair worsens another metric.

Use source reference images, normalized color/scale, and section-based comparisons for long pages. Separate glyph antialiasing noise from wrong text wrapping and geometry. Perceptual metrics can rank defects but should not be advertised as a universal human accuracy percentage.

Create a benchmark with approximately 30 owned/licensed fixtures plus 10 permitted real pages. Include flex, grid, overlap, inline text, lazy images, SVG, responsive navigation, dark mode, RTL, missing fonts, unsupported media, and malicious/oversized inputs. Keep a held-out set separate from tuning fixtures.

Provisional gates to calibrate during the feasibility phase:

| Dimension | Initial target on the explicitly supported corpus |
|---|---|
| Content | 100% of visible source text preserved under documented whitespace/text-transform handling; no invented copy/assets |
| Typography | Zero undisclosed font substitutions; all missing faces identified |
| Geometry | At least 95% of matched supported boxes within 2 CSS px per edge at 1× scale, plus no severe overflow |
| Visual result | Human review finds no severe section-level mismatch; benchmark perceptual thresholds set after collecting baseline data |
| Editability | At least 95% of supported visible text characters remain editable; rasterized region area reported separately |
| Layout | At least 90% of containers classified in advance as flow/grid use native layout; overlays excluded transparently |
| Responsive | No unexpected clipping/overlap at sampled and held-out widths within declared intervals; structural switches documented |
| Components | At least 95% precision on curated repeated families; prefer missing a family over merging unrelated ones |
| Reliability | Cancel/retry does not damage existing content or duplicate committed imports; failure leaves a recoverable result |
| Product outcome | At least 50% lower median cleanup time in the pilot against the measured baseline |

These are engineering targets, not current results or contractual guarantees. Fix the denominators before measuring; do not quietly remove difficult pages from the supported corpus to improve scores.

For latency, measure source load, capture, analysis, insertion, and verification separately. A provisional goal is p95 under two minutes for an already-loaded, moderate page with two viewports and bounded assets; set final limits from the prototype. Long pages and slow sources need explicit estimates and caps.

Editability tasks: double a button label, replace an image of a different ratio, add a card, remove a navigation item, and resize around a structural boundary. Perform them with the plugin closed as well as open, so users know what behavior is native.

## 12. Operational design and trust

Arbitrary URL rendering is a concrete infrastructure risk. Isolate browser workers; permit HTTP(S) only; validate DNS and redirect destinations; block private, loopback, link-local, and metadata networks; enforce the same policy on subresources and at egress. Limit redirects, response sizes, decoded image dimensions, page length, job duration, and concurrency. Retain browser sandboxing and restrict process privileges.

Use content hashes for asset reuse, but isolate tenant permissions and avoid cross-tenant caching of private captures. Strip credentials from logs and signed URLs from diagnostic messages. Never execute page-derived strings as plugin code. Sanitize imported SVG and validate scene packages before consuming them.

For private-page capture, use a user-invoked browser extension and transfer a scoped package of the selected visible content. Do not ask users to send their passwords or whole browser profile. Package review and redaction must happen before cloud upload. The initial extension can use activeTab plus scripting for user-selected capture; deeper frame/asset instrumentation may need additional permissions and separate feasibility work. [Chrome activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)

Offer a local package import path and be explicit about any later server processing. Local capture does not automatically mean local-only conversion. Proposed retention: short expiry for raw captures, user deletion, and no page content in analytics by default. The actual policy must match the implementation.

Preserve source attribution and support authorized use of content, fonts, and assets. Capturing a page does not transfer ownership of its assets. Do not bypass access controls or bot challenges; offer user capture when appropriate.

Figma insertion needs checkpoints: preflight fonts/assets, build in a staging section, create nodes in bounded batches, record completed units, and finalize visibly. Cancellation cleans only generated staging content. There is no assumption of a database-style atomic transaction across every Figma mutation; test undo and interruption recovery in the editor.

## 13. MVP scope and delivery roadmap

| Stage | Included outcome | Exit decision |
|---|---|---|
| Feasibility, 2–3 weeks | Reference corpus, one capture-to-Figma slice, real font checks, export comparison, grid/flex/RTL spikes, vendor comparison | Can the supported cases meet useful fidelity and cleanup targets? |
| Alpha, next 4–6 weeks | Public URL import, desktop/mobile, native text/assets, basic layout, names, local foundations, issue report, cancel/retry | Designers can complete real redesign exercises without extensive cleanup |
| Beta, next 4–6 weeks | Responsive inference, component families, better visual repair, selected-section import, performance and hostile-input hardening | Reliability and held-out corpus pass; pilot retention shows recurring value |
| V1 hardening, next 3–5 weeks | Onboarding, usage controls, support diagnostics, packaging, documentation, store submission preparation | Pilot feedback resolved; operating costs and support burden acceptable |
| Later milestones | Private-page extension, state capture, library mapping, cross-page systems, selective re-import | Each justified by user demand and separate risk tests |

Estimate: approximately 13–20 weeks to a focused V1 with two experienced full-time engineers, an engaged product designer, and part-time QA/security support. This is a planning range, not a delivery commitment. A solo developer should plan for materially longer, often 6–9+ months at this quality level. Broad “any website” support is continuing product development, not a finite first-release task. Re-estimate after the feasibility benchmark.

Do not delay all hostile-input protection until beta: basic isolation and egress restrictions are required before the first arbitrary public URL is rendered. Beta expands adversarial coverage and operational hardening.

Initial exclusions: automatic whole-site crawling, arbitrary authenticated URLs from the server, animated/WebGL reconstruction, full interaction recovery, original framework component recovery, code export, and automatic team-library publication. Narrowing these keeps the initial promise testable.

## 14. Build versus buy

Evaluate a commercial conversion adapter during feasibility. code.to.design documents HTML/CSS/JS conversion with plugin and clipboard integration modes. This is a candidate to evaluate, not an assumed dependency. [API overview](https://docs-code.to.design/overview)

| Approach | Benefit | Main cost/risk |
|---|---|---|
| Own capture and converter | Full control of provenance, diagnostics, and responsive structure | Highest engineering and maintenance effort |
| Licensed conversion engine | Faster test of user value and potentially strong initial coverage | Per-job costs, contractual limits, data handling, and limited control over output |
| Hybrid through an adapter | Lets the team benchmark vendor conversion while owning product/reporting | Integration overhead; vendor output may not expose the evidence needed |

Recommendation: run a time-boxed bake-off on the same corpus before committing to a custom engine. Verify commercial embedding rights, payload semantics, component support, privacy, and output stability directly. If a vendor output cannot support provenance and deterministic repairs, use it for comparison or a limited prototype rather than promising features the integration cannot deliver.

Never place a vendor API key in the distributed plugin or rely on undocumented private Figma import formats.

## 15. Economics and commercial scope

Track cost per successful import, not only per request. A useful model is: browser seconds × worker cost + conversion fees + storage/egress + optional model inference + retry overhead. Viewport count, page length, media size, and dynamic behavior are the main cost drivers to measure.

Cache public assets by content hash, reuse capture evidence within a job, and use AI only for ambiguous semantics. Do not describe a multi-viewport page as one cheap unit if it incurs several rendering passes.

Validate free trial limits and paid usage after observing costs and repeat use; do not set prices from guesswork. A personal version can use a job cap and API usage tracking without adding billing. A commercial version needs account recovery, quota visibility, job history, deletion, and support diagnostics. Define which system charges for retries and avoid charging twice for an idempotent retry.

## 16. Additional ideas, ordered by value

1. **Import just this section.** Let a designer capture a navigation bar, pricing section, or card instead of processing a whole page.
2. **Repair selected region.** Rebuild a broken section after resolving its font/asset issue without touching successful sections.
3. **Design-system inventory.** Show exact observed styles alongside proposed tokens and repeated components, with source evidence.
4. **Responsive inspector.** Explain what changes across widths and highlight untested or inferred intervals.
5. **Arabic/RTL quality mode.** Preserve logical order, shaping, mixed-script alignment, and direction-sensitive icons; use explicit fixtures from the start.
6. **State capture.** User-selected menu, hover, modal, and accordion states become documented variants. No hidden-state invention.
7. **Brand adaptation preview.** Apply a chosen library to a copy, show the differences, and preserve the imported baseline.
8. **Selective re-import.** Compare the previous source, new source, and edited Figma nodes; update untouched fields and ask about actual conflicts. This requires three-way reconciliation, not replacing the whole frame.
9. **Cross-page extraction.** Import a controlled list of related pages and propose shared headers, footers, cards, and token aliases.
10. **Accessibility repair suggestions.** Flag contrast or hierarchy issues in the captured design and show optional corrections separately from faithful import. Do not present static capture as a full accessibility audit.

## 17. Decisions to carry into implementation

Recommended defaults: Figma Design; public URL first; TypeScript; isolated browser capture; versioned scene model; faithful import first; native layout where verified; fonts resolved before insertion; small high-precision component families; per-region diagnostics; two mandatory viewports; no silent substitutions.

The first investment should be the feasibility slice, not a polished settings panel. Its deliverable is a small set of difficult pages imported into Figma, exported back out, compared to the source, and edited by designers. That establishes whether the product can meet the quality promise and whether an owned or licensed converter is the better route.

Execution backlog with dependencies and verification is in [todo.md](todo.md). All development work there is proposed and unstarted.
