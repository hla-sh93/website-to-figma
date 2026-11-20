# Review resolution · Hla.Sh

29 October 2026. Development build 0.1.0.

| Finding | Resolution | Evidence |
|---|---|---|
| Array subclasses and sparse tuples bypass scene traversal | Reject exotic array prototypes and require dense own indexed values | Reproduced, then validator regressions passed |
| Screenshot accepts non-PNG data | Check PNG signature and sane IHDR dimensions | Non-PNG/empty/truncated header regressions |
| Components lose distinct images/crops | Include asset identity and crop/fitting in signatures | Unit regression and owned browser capture |
| Parent/descendant replacements invalidate each other | Select non-overlapping outer repeated families | Nested card/button regression |
| Alignment/style differences disappear in a family | Include font style, alignment, direction, spacing and sizing | Alignment/italic regression |
| Cancelling insertion clears the source capture | Separate capture cancellation from insertion cancellation | Browser regression failed with 409 before the fix, then passed with source still available |

Figma Starter quota prevented the final added native preservation run. Earlier native rendering/editability evidence remains recorded; the local unit/API/browser suite is independent of that quota.

Design hook: fixed empty preview image elements by creating them only with real image data, including file imports without reference screenshots. No manual warning suppressions were added.

Final local verification: formatting, TypeScript, build, 37 unit/API tests and 9 real-browser tests passed. No skipped tests. Remote CI has not run.
