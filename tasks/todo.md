# Proposed implementation backlog

Status: planning deliverable only. These are future engineering tasks, not claims of completed implementation. Follow the product decisions and quality definitions in [plan.md](plan.md). Paths below are proposed boundaries, not existing source files. Most slices should touch 2–5 files; split a slice if implementation exceeds that scope.

## Feasibility

- [ ] **F01 — Establish the benchmark and baseline.** Dependencies: none. Scope: medium; benchmark/manifest, fixtures, baseline report. Acceptance: representative flex, grid, text, RTL, responsive, and fallback cases are defined; source provenance and evaluation denominators are recorded; cleanup baseline exists. Verification: reproduce captures twice and review benchmark coverage with a designer.
- [ ] **F02 — Specify and validate the capture/scene contract.** Dependencies: F01. Scope: medium; packages/scene schema, validator, fixtures. Acceptance: measured/inferred fields are distinct; unknown schema versions and invalid bounds are rejected; assets and issues reference valid nodes. Verification: round-trip a valid fixture and reject malformed/oversized payloads.
- [ ] **F03 — Build a bounded public-page capture job.** Dependencies: F02. Scope: medium; service/jobs, worker/capture, worker/network-policy. Acceptance: one public page yields screenshot, layout evidence, and assets; resource/time caps are enforced; private/metadata destinations and redirects are blocked. Verification: deterministic owned-page capture plus redirect and subresource egress fixtures.
- [ ] **F04 — Import one native section into Figma.** Dependencies: F02, F03. Scope: medium; plugin/main, plugin/ui, renderer/section. Acceptance: a section has editable text, original imagery, and meaningful structure; fonts are preflighted; cancel removes only generated staging nodes. Verification: import/export and manually edit the result in the actual Figma editor.
- [ ] **F05 — Compare source and exported Figma regions.** Dependencies: F01, F04. Scope: medium; quality/alignment, quality/report, plugin/export. Acceptance: images align at matched scale; deliberate font/crop/gap defects are detected; editability and fallback coverage are reported separately. Verification: seeded defect fixtures and human inspection of false positives.
- [ ] **F06 — Spike hard cases and compare a vendor adapter.** Dependencies: F05. Scope: medium per spike; split font/grid/RTL and vendor work if needed. Acceptance: font availability and grid mapping are demonstrated; the same corpus is evaluated for owned/vendor conversion; actual integration and data-handling limits are recorded. Verification: export comparisons, resize tests, and a written decision with measured tradeoffs.

**Checkpoint A:** Decide whether to continue, narrow supported scope, or use a vendor adapter. Re-estimate schedule and quality targets from evidence. A prototype screenshot alone is not a pass.

## Alpha

- [ ] **A01 — Deliver a complete one-URL user journey.** Dependencies: Checkpoint A. Scope: medium; plugin/import-flow, service/job-status, shared/messages. Acceptance: analyze/import/review states work; authentication and job expiry are handled; retry is idempotent. Verification: successful, expired, cancelled, and failed-job integration journeys.
- [ ] **A02 — Implement reliable text and font resolution.** Dependencies: F04, F06. Scope: medium; renderer/text, capture/text, plugin/font-resolver. Acceptance: styled text remains editable; unavailable fonts are disclosed; fallback changes trigger layout validation. Verification: mixed-script, Arabic, variable-font, and long-heading fixtures in Figma.
- [ ] **A03 — Preserve asset appearance.** Dependencies: A01. Scope: medium; capture/assets, renderer/images, renderer/svg. Acceptance: source asset selection and crop match; supported SVG stays vector; inaccessible/unsupported assets have explicit issues. Verification: contain/cover, backgrounds, masked images, SVG filters, and missing-asset fixtures.
- [ ] **A04 — Convert common block/flex layouts.** Dependencies: A02, A03. Scope: medium; layout/flow, layout/flex, renderer/sizing. Acceptance: appropriate native layouts pass appearance comparisons; meaningless wrappers are removed safely; overlay exceptions preserve stacking. Verification: source/Figma exports plus content growth and resize exercises.
- [ ] **A05 — Add tested grid layouts.** Dependencies: A04, F06. Scope: medium; layout/grid, renderer/grid, benchmark/grid. Acceptance: supported tracks/spans use native grid; unsupported track behavior is reported; no undocumented fixed-layout substitution. Verification: grid fixtures at captured and held-out widths.
- [ ] **A06 — Create naming and bound foundations.** Dependencies: A02, A04. Scope: medium; analysis/names, analysis/foundations, renderer/styles. Acceptance: deterministic meaningful names; exact styles/variables deduplicate; bindings actually drive imported nodes. Verification: re-import fixture and change a generated variable/style to inspect linked output.
- [ ] **A07 — Deliver understandable issue recovery.** Dependencies: A01–A06, F05. Scope: medium; plugin/report, plugin/repair-actions, renderer/checkpoints. Acceptance: report selects affected nodes; retry can target one asset/section; existing unrelated content is untouched. Verification: partial import interruption, missing-font resolution, and targeted asset retry.

**Checkpoint B:** A designer imports and edits a full public page at desktop and mobile sizes. Review content preservation, appearance, generated structure, exceptions, and cleanup time.

## Beta

- [ ] **B01 — Match nodes across captured viewports.** Dependencies: Checkpoint B. Scope: medium; responsive/matching, responsive/evidence, benchmark/matching. Acceptance: correspondence carries confidence; reordered/replaced nodes are handled; ambiguity is retained instead of forced. Verification: curated truth pairs including responsive DOM replacement.
- [ ] **B02 — Reconstruct and test responsive intervals.** Dependencies: B01, A04, A05. Scope: medium; responsive/inference, responsive/sampling, plugin/viewport-report. Acceptance: fluid behavior and structural changes are distinct; boundary intervals are documented; held-out width failures are surfaced. Verification: resize source and imported output at boundaries and interior widths, including with the plugin closed.
- [ ] **B03 — Detect one repeated component family.** Dependencies: A06, B01. Scope: medium; components/signature, components/clustering, components/evidence. Acceptance: repeated cards/buttons match despite text changes; unrelated lookalikes remain separate; precision is measured. Verification: positive and adversarial component fixtures.
- [ ] **B04 — Generate editable components and instances.** Dependencies: B03. Scope: medium; renderer/components, renderer/properties, plugin/component-review. Acceptance: labels and optional icons are exposed; instance overrides survive; inferred variants are labeled and evidence-backed. Verification: modify master/instance properties and compare output before and after replacement.
- [ ] **B05 — Import a selected section.** Dependencies: A07. Scope: medium; capture/selection, plugin/section-preview, service/partial-job. Acceptance: user can choose a region; required assets and ancestor context are retained; neighboring content is not accidentally imported. Verification: sections with inherited styles, clipping, and full-bleed backgrounds.
- [ ] **B06 — Bound performance and recover interruptions.** Dependencies: B02, B04, B05. Scope: medium; renderer/batching, service/limits, diagnostics/timing. Acceptance: node/assets/page-length limits are visible; progress is truthful; resumes do not duplicate committed nodes. Verification: long-page stress case, cancellation at insertion boundaries, and Figma closure/reopen recovery.
- [ ] **B07 — Harden hostile-input and privacy handling.** Dependencies: F03, B06. Scope: medium per subsystem; split worker, scene, and media audits if needed. Acceptance: egress checks cover navigation and assets; oversized/SVG/payload inputs are bounded; tenant ownership, signed URL expiry, deletion, and log redaction work. Verification: malicious fixtures, authorization tests, and manual threat review.

**Checkpoint C:** Run the held-out corpus and observed designer pilot. Confirm quality targets, component precision, meaningful cleanup savings, and cost per successful import before broadening coverage.

## Release preparation

- [ ] **R01 — Onboard users and document the support matrix.** Dependencies: Checkpoint C. Scope: medium; plugin/onboarding, docs/support-matrix, docs/privacy. Acceptance: limitations and missing-font remedies are clear; screenshots reflect actual behavior; no unsupported universal accuracy claims. Verification: first-use sessions with new designers.
- [ ] **R02 — Add visible usage limits and operational monitoring.** Dependencies: B06, B07. Scope: medium; service/usage, plugin/usage, diagnostics/events. Acceptance: retries cannot double-charge usage; job-stage latency/cost is observable; diagnostics exclude captured content by default. Verification: repeated job submissions, quota edge cases, and log inspection. Billing integration is a separate task only if commercial launch requires it.
- [ ] **R03 — Package and perform release acceptance.** Dependencies: R01, R02. Scope: medium; plugin/manifest, release/checklist, docs/known-issues. Acceptance: declared network access and permissions match behavior; clean-install import succeeds; supported benchmark and recovery checks pass. Verification: real-editor smoke test on intended platforms, final corpus run, and store submission review. Submission approval timing is external.

**Checkpoint D:** Release only the demonstrated support scope; keep unresolved exceptions visible in documentation and the plugin.

## Later work — schedule separately

- [ ] **L01 — Browser capture extension.** Dependencies: stable scene contract and B07. Begin with an active-tab capture feasibility slice; test fonts, assets, iframes, permissions, and local package transfer before promising parity with cloud capture.
- [ ] **L02 — State and prototype capture.** Dependencies: L01, B04. Use explicit user-selected states; validate interaction mappings rather than inventing hidden states.
- [ ] **L03 — Existing design-system mapping.** Dependencies: A06, B04. Preview changes on a copy and respect library availability and user overrides.
- [ ] **L04 — Selective re-import.** Dependencies: stable provenance and node mapping. Design three-way source/design reconciliation and conflict handling before implementation.
- [ ] **L05 — Cross-page extraction.** Dependencies: B04, L04. Add scoped URL lists, shared-component evidence, and duplicate handling; do not start with unrestricted crawling.

These later items are epics and must be decomposed into small verified slices when scheduled.
