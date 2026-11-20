# Fidelity stage · By Hla.Sh

Started 30 October 2026. Continues the 0.1.0 alpha; the full roadmap remains open.

| Task | Status | Acceptance / verification |
|---|---|---|
| Identify rendered fonts | Implemented; local tests passed | Chromium platform-font evidence for up to 256 elements; actual-family preference; quoted CSS stacks; variable-axis capability checks; mixed evidence reported |
| Preserve typography detail | Implemented; native rerun pending | Measured normal line boxes using source characters; underline/strikethrough and range spacing/line height; typography style reuse; conservative component exclusion |
| Preserve image fit and crop | Implemented; native rerun pending | Five fit modes, computed percentage/pixel/calc position, padding/border content box and CSS intrinsic size; 30 browser pixel samples across six cases |
| Improve layout honesty | Implemented; native width-constraint rerun pending | Border-box min/max widths and CSS min precedence; fixed-position fallback for grid spans/placement, reverse/reordered flex |
| Verify and package | Local verification passed; native gate open | 49 unit/API + 12 Chromium tests; 0.2.0-alpha.1 package; native attempt found zero min-width API incompatibility, corrected to null; connector quota blocked retry |

State tracking note: work_state tools are not exposed in this session. This file and implementation-status.md record actual work until those tools are available.

Native attempt: 30 October, existing Newteam validation file qTgTA125JqaCSg4Yo6xxdJ. Error: `minWidth cannot be set to 0, use null to unset`. Renderer now uses null for zero minima. The follow-up canvas read was refused by the Starter connector quota; whoami confirmed Starter/View. The native routine is tests/native-fidelity.ts, bundled as dist/native-fidelity.js. This stage has no passing new native screenshot or pixel result yet. The renderer includes rollback of its own staged resources, but the follow-up cleanup inspection could not run.
