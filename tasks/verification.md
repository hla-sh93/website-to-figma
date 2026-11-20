# Verification record

Latest record · 1 November 2026: [current-verification.md](current-verification.md) supersedes the older installed-host statements below. Actual Desktop URL paste/import now passes for the tested scope; Amazon visual acceptance still fails. Full check passes 56 unit/API and 18 Chromium tests, formatting, TypeScript and build.

By Hla.Sh · 30 October 2026 · Development build 0.3.0-alpha.2

Latest completed local npm run check: passed with 54 unit/API tests, 16 real Chromium tests, formatting, TypeScript and plugin build. No tests skipped. Current UI is the simplified automatic URL flow; earlier offline/compare controls are removed from that interface by user request.

## 0.3 simplified workflow

Connection patch: the user saw a generic service-offline message even though the installed credential and running service passed an external health check. Those external checks did not prove the original main-sandbox transport. Main now passes its private credential to its own UI; the opaque iframe performs the authenticated pairing request directly. Revised browser tests failed against the old compiled UI and pass against this patch, exercising actual credential-based HTTP/CORS instead of a mocked connected token. All 70 local checks pass. Misleading instructions to start an already-running service were replaced with connection/retry messages. Actual editor reload is still pending.

The compiled UI runs in an opaque sandbox iframe, without form permissions and without randomUUID. Tests pass for one visible action, three dropdowns, URL paste triggering capture and insertion automatically, website-language/theme/size requests, font substitution consent, late font replies after cancel and offline service recovery. Host native Figma messages are simulated in those browser tests; no new actual editor import is claimed.

Real Chromium locale tests render different owned source text for Arabic and English. This is language negotiation, not translation or guaranteed navigation to a site's language variant. Local pairing requires a private per-install key, including for null-origin requests; missing/wrong credentials cannot obtain session tokens. install-local personalizes the registered main bundle only. The updated installed bundle and restarted service passed an actual null-origin pairing and authenticated health request. Generic bundles do not contain the device key. User reload of the installed plugin remains pending. See tasks/streamlined-flow.md.

## Figma UI request-key compatibility

The actual plugin UI opened and connected, but capture failed because crypto.randomUUID was unavailable. The built-UI regression reproduced the same error with the method explicitly disabled. A request-key helper now supports random bytes and a time/counter fallback for non-secret idempotency keys, independently of bearer authentication. Unit checks cover distinct API-compatible keys with missing or throwing random-byte APIs. The existing real browser capture/preflight/import-message workflow now passes with randomUUID disabled. Footer version is inserted from package.json at build time and verified in that browser test. Fixed runtime/UI files are deployed and hash-verified; actual host capture/import retry remains pending.

## Desktop manifest fix

Actual user-installed Figma rejected numeric loopback in devAllowedDomains. Manifest and plugin UI now use http://localhost:4017. The local service accepts its exact localhost and numeric loopback authorities, remains bound to 127.0.0.1 and retains bearer and origin checks. The localhost integration test failed before the change and passes after it; it also checks unauthenticated access, null-origin preflight, foreign origins, dashboard token isolation and foreign Host denial. Browser workflow tests exercise localhost. Corrected registered files are hash-verified, and the authenticated health check passes after restart. Actual editor reload/import awaits user confirmation.

## 0.2 fidelity stage

Capture now records Chromium platform-font family/PostScript/glyph-count evidence for up to 256 elements per viewport. A single detected family takes precedence over an unavailable first CSS family; mixed fallbacks are reported. Normal line height is measured using an offscreen line box with source characters. Editable underline/strikethrough, range spacing/line height and variable-font requests are retained. Font axes are applied only when the editor reports support. Glyph-level font spans and cross-renderer font baselines remain incomplete.

Six owned image cases exercise cover, contain, padded cover with calc position, none, scale-down and fill. Thirty sampled image/background pixels agree with Chromium within two channel values; content-box and position-offset assertions pass. The shared placement model feeds editable native clipping frames. This is a browser capture/model test, not a native-Figma image comparison. Custom crop geometry must be reviewed after resizing.

Layout checks cover captured width limits, content-box-to-border-box conversion, conflicting min/max precedence and measured fixed fallback for grid spans and reversed flex. Rich decorations, spacing and font axes cannot silently merge into plain component text properties; differing glyph counts do not split equivalent families.

The new actual-Figma attempt failed on the API's rejection of `minWidth = 0`. The mapping now uses `null` to unset zero minima. The follow-up canvas inspection was refused by the Starter connector tool-call limit; whoami confirmed Newteam Starter/View. The correction and new crop/typography native regression have not passed a rerun. Rollback is implemented, but its result could not be inspected. tests/native-fidelity.ts and dist/native-fidelity.js preserve the exact native check for when access is available. Earlier 0.1 native results below do not certify these new behaviors.

## Executed checks

- Shared scene validation: versions, JSON safety, cycles, array subclasses/sparse tuples, finite geometry, counts, depth, references, styled text ranges and PNG headers.
- Network boundary: unsafe schemes, credentials, private/metadata/reserved addresses, mixed DNS answers, per-capture proxy authentication, DNS pinning and denied HTTPS tunnels.
- Local API: bearer authentication, foreign origins, session-code isolation from null-origin requests, bounded input, retry idempotency/conflicts, capture cancellation and late-result suppression.
- Real browser capture: desktop/mobile visibility, 3/1-column grid changes, English/Arabic text, logical RTL alignment, bold ranges, original PNG/SVG assets, sanitized SVG, margins, inherited backgrounds, source screenshots, repeated geometry, selected sections, capture caps, instability and cancellation.
- Real browser interface: the dashboard completes an owned demo capture and download; the built plugin UI connects, captures, reviews missing fonts, and sends explicit import settings. Its host message boundary is simulated in this browser test.
- Public URL smoke test: example.com captured at desktop/mobile widths through the authenticated egress proxy.

## Actual Figma renderer evidence

[Validation file](https://www.figma.com/design/qTgTA125JqaCSg4Yo6xxdJ)

The same compiled native renderer used by the plugin was executed against the captured feature section. The latest successful routine created 11 editable text nodes, 7 Auto Layout containers, 17 bound variables, 5 text styles, 1 main card component, and 3 instances.

Checks passed:

- Component replacement preserved 3 columns in 1 row and instance order.
- The native grid fit after resizing the frame to 1000px.
- A substantially longer heading increased the instance height from approximately 245px to 560px; restoring the text restored the layout.
- Updating a bound color variable updated an instance paint; the original value was restored.
- Inline label properties grew to their own content widths.
- A separate native asset check imported one original PNG and one SVG vector with no conversion notices.

Full returned IDs, source mappings, checks and geometry are in [native-verification.json](native-verification.json). Native validation code is in tests/native-validation.ts.

The checks found and fixed real defects before passing: use of a browser-only URL global in Figma main code; extra/manual grid rows during component replacement; fixed grid-child widths during resize; text resizing reset by geometry/component operations; fixed-width component labels; and source preview frame bounds that omitted page margins/background.

## Fidelity limits observed

Arial was not available in the connected Figma environment. The test explicitly allowed Inter and returned substitution notices. Native line metrics and final height consequently differ from the source. The latest saved comparison reports 7.53% of pixels above its threshold and different heights (source approximately 497px, Figma approximately 510px). This is a diagnostic, not a 92.47% accuracy claim. Earlier comparison numbers are superseded. Artifacts are in output/validation/final-comparison.

Final review found two further component regressions: different images/crops could be grouped without image overrides, and nested families could invalidate one another during replacement. The fixes preserve asset/crop and typography identity and select non-overlapping outer families. Reproduction tests failed before the fixes and pass afterward; an owned browser fixture covers nested cards/buttons and distinct red/blue images. The additional native Figma regression was stopped by the Starter plan's tool-call limit, so that specific native rerun remains pending. Earlier native resize/edit/variable/asset evidence remains available.

The current release does not meet the roadmap's universal fidelity ambition or its proposed broad-corpus thresholds. One owned page and a small public smoke test are not the 30+ fixture benchmark or human cleanup study proposed in the plan. Complex effects, precise typography, more CSS coverage and held-out website evaluation remain open.

## Packaging and remaining manual check

The development manifest, code and UI are built locally. Figma-assigned plugin identity and loading the distributed development manifest in the user's Desktop environment still need the setup described in README.md. The actual renderer is verified; the complete installed plugin main/UI lifecycle has not been exercised through a user-installed development plugin.

CI configuration is included. Local commands are run here; remote CI execution has not occurred because no remote repository/push was requested.
