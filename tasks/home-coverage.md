# Home coverage repair

Current override · 16 November 2026: alpha.5 review fixes pass 60 unit/API + 37 Chromium tests and are installed in normal mode. Latest public Amazon Home attempt correctly rejects an access interstitial; a previous run exceeded the DOM/depth budget. The Desktop validation file currently opens view-only (**Ask to edit**); an editable destination is required for the new native run. Full Home and exact visual acceptance remain open. See [full-review.md](full-review.md). The alpha.4 evidence below remains historical.

By Hla.Sh · 1 November 2026 · 0.3.0-alpha.4-debug

Status: in progress. Actual Figma imports and visual comparisons have run; exact matching has not passed. The latest native rerun failed at the first text layer with Figma's message: `Unable to establish connection to Figma after 10 seconds. Please check your internet connection.` The local capture and pairing succeeded. The cause of that host connection failure has not been confirmed.

The current Desktop work is on the separate page **فحص Home — Amazon** in https://www.figma.com/design/qTgTA125JqaCSg4Yo6xxdJ. Earlier test frames on Page 1 were left intact.

Confirmed causes and changes:

- Visible hero images were lost because their `picture` ancestors used display:contents and had zero-size boxes. Visible descendants are now promoted while clipped zero-size wrappers stay excluded.
- Screen-reader copies and fully clipped navigation could become duplicate visible text. Capture excludes those regions.
- Supported single CSS background photos and sprites now become editable image layers with measured sizing/position. Unsupported repeat/gradient cases remain disclosed.
- Positioned headings could paint below later flow images. Capture records CSS stacking and the renderer preserves paint order while falling back to measured positions when Auto Layout would change flow order.
- Recognized Amazon/OneTrust rejection controls are clicked before measurement. A bounded failure is disclosed; a banner is not silently removed from a screenshot.
- Single-line ellipsis metadata is preserved and mapped to native truncation. Broader text clipping still needs actual visual review.
- Visible video frames are paused and captured as static image layers. Playback is not imported and the conversion is disclosed.
- New containers say `Editable layers`, and partial results explicitly show accuracy notes instead of implying a verified match.

Verification:

- Each new coverage regression was reproduced failing before its correction.
- Latest full local check passed formatting, TypeScript, 58 unit/API tests, build and 27 Chromium tests, without skips. String/cross-realm host failures now retain the actual message and affected layer instead of becoming `Operation failed.`
- Actual native first coverage rerun: frame 32:403; 109 images and 291 texts. Saved in output/installed-verification/home-current.
- Actual native stacking/cookie rerun: frame 32:2074; 81 images and 283 texts. Saved in output/installed-verification/home-reviewed. The live website served a different product set, so image counts are not a fidelity score or a cross-run denominator.
- The latter same-source comparison found 22.44% of sampled pixels above threshold 24, and source/native heights differed (2125 vs 2104 at width 640). This is a failure of exact visual acceptance, not a percentage accuracy claim.
- The Amazon display font remains unavailable in Figma; the functional verification explicitly used Inter Bold as a substitute. Normal mode still asks before substitution.
- Desktop input was interrupted by a minimized window and simultaneous input. Background plugin reload then completed source capture and exposed the precise native connection failure above. The failed layer was `nav-assistant-links-heading text`. No new successful native PNG is claimed for the latest fixes.
- The registered copy has been restored to normal mode (verificationMode=false); opening it will not automatically insert another sample or silently substitute a missing font. The local service remains running and paired.

Artifacts: output/installed-verification/home-reviewed/report.json; source-640.png; figma.png; comparison.json; difference.png; overlay.png. These are evidence from the same capture. They are not a finished design deliverable.

Latest failure evidence: output/installed-verification/home-final-check/failure.json and source.png. These record actual capture success followed by native import failure, not a finished design.

Next: establish a working Figma host connection and coordinate desktop input; rerun the latest build; inspect header, hero headings, video frame, product text and footer against that run's source; save results and restore normal mode again. User questions about desktop availability and Figma connectivity remain pending.

No work_state tools are exposed in this session; this file is the fallback state record.
