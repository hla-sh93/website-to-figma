# Installed-plugin verification

Current override · 16 November 2026: alpha.5 is installed in normal mode. Full local check passes 60 unit/API + 37 Chromium tests. The actual Desktop validation file now opens with **Ask to edit**, so a new native run is pending an editable destination. Public source exercises include an Amazon budget failure followed by correct access-gate rejection, and an explicitly truncated W3C page; no full Home or native visual pass is claimed. See [full-review.md](full-review.md) and [product-quality-plan.md](product-quality-plan.md). Records below are historical.

Latest work · 1 November 2026: 0.3.0-alpha.4-debug adds homepage coverage, stacking, clipping and static video-frame fixes. Two actual Desktop comparisons have run, and visual acceptance remains open. The latest full check passes 58 unit/API and 27 Chromium tests. The latest native rerun failed with Figma's own connection timeout at the first text layer, while capture/pairing succeeded. Normal mode has been restored. Evidence and remaining work are tracked in [home-coverage.md](home-coverage.md); the alpha.3 table below is historical.

By Hla.Sh · 1 November 2026 · 0.3.0-alpha.3-debug

Status: development continues. The connection failure is reproduced and corrected in the actual Desktop host. Full website fidelity has not passed acceptance. This record supersedes earlier statements that an external pairing check or simulated host proved the installed workflow.

| Check | Actual result | Evidence |
|---|---|---|
| Main/UI message delivery | Passed in Figma Desktop | Host replies have source category `other`, not `parent`. The old strict parent-window check discarded these replies. Both directions now validate a private installation channel. Real opaque-frame regressions cover null/self sources. |
| Automatic local connection | Passed in Figma Desktop | UI obtains its session directly; renewal after restarting the service passed during the actual Amazon retry. |
| Normal URL paste, without verification mode | Passed in Figma Desktop | example.com created frames 29:2622, 29:2659 and 29:2681; 21 text layers, 3 vectors, 6 Auto Layout frames, 13 variables and 4 text styles; no renderer issues or font substitution. |
| Size/theme/website-language controls | Passed for the tested request | Real UI selected widths 1440/768/390, Dark and Arabic. Source capture contains all three widths. Website locale preference does not translate a page. |
| Initially hidden / delayed content | Regression tests passed | Hidden body and visible loading-shell fixtures were red before their respective fixes. Capture now waits for sustained stability, scrolls for lazy content and retries changed measurements without reloading the page. |
| Changing-page consistency | Regression test passed | Continuously moving geometry is rejected. Scene/screenshot fingerprint mismatch triggers at most two in-page retries, then a clear failure. |
| Actual Amazon import | Functional import passed; visual acceptance FAILED | Real Desktop import created 257 texts, 89 images, 18 vectors, 730 Auto Layout frames, 71 variables, 24 text styles, 7 component masters and 39 instances. Verification explicitly used one font substitution, Ember Modern Display UI H to Inter Bold. |
| Measured centered children | Passed in Figma Desktop | Example-page SVG x=698 matches source x=698; narrow link x=680 versus source 679.9375. Frame-level alignment replaced an ineffective deprecated child property. |
| Local checks | Passed | Latest full check: formatting, TypeScript, 56 unit/API tests, build and 18 real Chromium tests. No skips. These are not a native visual fidelity score. |
| Installed normal mode | Passed | output/desktop-deployment.json has verificationMode=false. Latest actual ui-boot also reports false; no automatic sample insertion or automatic font substitution remains enabled. |

Actual editor file: https://www.figma.com/design/qTgTA125JqaCSg4Yo6xxdJ

Local evidence:

- output/installed-verification/normal-flow.json
- output/installed-verification/three-sizes/report.json, source.png and figma.png
- output/installed-verification/amazon/report.json, source.png and figma.png
- output/installed-verification/native-measurements.json
- output/desktop-deployment.json

## Work still open

- CSS background images/sprites and generated pseudo content are missing from some Amazon regions. The hero is visibly incomplete.
- Some inline/hidden accessibility text is duplicated; complex table/inline positioning and spacing need further work.
- Native text rounding accumulates: the tested 900px example source becomes approximately 907px in Figma. No exact typography/height claim is justified.
- The Amazon display font is unavailable in the editor. Normal mode pauses for a font decision; the diagnostic substitution only demonstrated functional import.
- Three separate captured widths do not prove continuous responsive behavior across arbitrary widths or exact CSS breakpoint recovery.
- Held-out corpus, full native fidelity regressions, cancellation during a large native import, startup after machine restart, clean installation and production hosting remain unverified or unimplemented.

Next acceptance stage: resolve missing backgrounds and duplicate inline content with controlled failing fixtures; compare actual native output with the same captured source again. Keep visual acceptance open until those differences are measured and reviewed.

The session exposes no work_state tools. This file is the fallback record for ongoing verification and outstanding work.
