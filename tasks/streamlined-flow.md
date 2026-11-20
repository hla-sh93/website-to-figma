# Simple URL import · By Hla.Sh

Current override · 1 November 2026: actual Figma Desktop proved the old parent-window message guard incorrect. Private-channel validation and direct UI pairing now pass in the installed host. Normal paste with all three widths/Dark/Arabic has been exercised; diagnostic auto-capture is disabled. Full visual acceptance remains open. See [current-verification.md](current-verification.md). Earlier notes below are historical.

Current patch: 0.3.0-alpha.2. User screenshot exposed a connection failure despite the service being alive. The old main-sandbox HTTP path was replaced: the main bundle now supplies the private pairing credential over the trusted message channel, and the UI performs the authenticated request itself. Browser host tests now send the credential rather than a simulated session token, exercising real null-origin pairing and subsequent capture/import messages. Old compiled UI failed these revised tests; the patch passes all 54 unit/API and 16 browser tests. Registered runtime files were personalized and byte-verified again; reload in the actual Figma window is pending.

User requested URL input, size/theme dropdowns, website-language selection, and automatic design creation. Website language means Arabic/English source preference, not interface translation. Keep original text; no automatic translation or invented 100% guarantee.

| Task | Status | Verification |
|---|---|---|
| Simplify daily interface | Done | Four fields; one visible button; paste starts capture/import; conditional cancel and missing-font consent |
| Automatic local connection | Implemented; installed-host check pending | Private per-install credential in personalized main bundle; unauthenticated requests and origins cannot obtain session credentials; no token entry |
| Website language | Done | Validated Arabic/English preference reaches Chromium locale and Accept-Language; real locale-dependent source text test passes |
| Automatic native insertion | Locally verified | Capture > fonts > import; missing fonts pause; late replies ignored after cancellation; native insertion host boundary simulated in browser tests |
| Test and deploy | Done locally; installed-host reload pending | 54 unit/API + 16 Chromium tests; format, TypeScript, build; personalized registered version 0.3.0-alpha.1 byte-verified; restarted service and actual opaque-origin pairing/health check pass |

The session does not expose work_state tools. This file records the current implementation work until those tools are available. Existing native fidelity limitations remain open.

Work products: README.md; scripts/install-local.ts; release/website-to-figma-hlash-0.3.0-alpha.1.zip; output/playwright/plugin-simple.png; output/desktop-deployment.json. Pairing and authenticated health returned ready/0.3.0-alpha.1/Hla.Sh without printing credentials. Generic bundle was verified not to contain the private installation credential.

UI testing uses a real sandbox iframe without allow-forms and without randomUUID. It found and fixed native form submission being blocked; direct button/Enter handling works without adding iframe permissions. No per-device pairing secret is embedded in source or generic release bundles. install-local personalizes only the registered code.js and saves a backup. .data/plugin-key is ignored and stays outside release ZIPs. The same key allows automatic session renewal after a service restart. The updated installed main/UI workflow awaits a user reload; no new native Figma accuracy or 100% match result is claimed.
