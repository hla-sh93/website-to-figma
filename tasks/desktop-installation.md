# Desktop installation · By Hla.Sh

Current override · 1 November 2026: registration 1697948645810602763 now runs 0.3.0-alpha.3-debug with verificationMode=false. Actual normal URL paste produced three native frames in Desktop Figma. The local service is running with the updated readiness/retry logic. Remaining visual failures and precise evidence are in [current-verification.md](current-verification.md). Earlier installation notes below are historical.

Current installation: 0.3.0-alpha.2. The user requested the simplified automatic URL workflow after the earlier 0.2 setup. install-local backed up and personalized the current registered main bundle, copied the new UI/manifest and verified deployed bytes. Temporary session tokens are now obtained automatically using a private local installation key. The service was restarted and pairing with Origin: null plus authenticated health passed. Generic bundles were verified not to contain that key. Latest local pipeline: 54 unit/API + 16 Chromium tests. User reload of this new UI/native import is still pending; the historical rows below describe the 0.2 setup and errors.

The user completed Figma development-plugin creation and then replaced the original D: registration with a new registration inside the project. Current registered directory: `C:/Users/hla2-/Documents/HTML Tool/figma-registration/Website to Figma _ Hla.Sh`.

| Task | Status | Evidence |
|---|---|---|
| Locate Figma-assigned identity | Done | User screenshot and actual manifest verify replacement registration ID 1697948645810602763. Earlier D: ID 1697947928596564742 is superseded. |
| Configure assigned ID | Done | Source and compiled manifests use the new verified ID. |
| Rebuild and verify manifest entry points | Done | npm run build and typecheck pass. All three deployed files match compiled SHA256 hashes. |
| Update registered development plugin | Done | Latest backup output/desktop-registration-backup/20261030-150811771; deployed request-key compatibility fix and correct footer version. All SHA256 values match dist. Report: output/desktop-deployment.json. |
| Check local capture service | Done | Restarted after localhost fix. Authenticated health check at localhost:4017 returned ready, 0.2.0-alpha.1, Hla.Sh. Session code was not printed. |
| Run in Figma Desktop | Confirmed by user screenshot | Plugin opens and reaches the capture form after connection. |
| Complete installed-plugin smoke test | Partial; capture retry pending | Actual host exposed missing crypto.randomUUID. Fixed and locally reproduced with that method disabled; updated registered files. Native import through the installed UI still needs confirmation. |

The session has no callable work_state tools; this file tracks installation until those tools become available. The full implementation roadmap and native fidelity rerun remain open.

User-installed Figma rejected numeric loopback in devAllowedDomains. Manifest and plugin UI now use http://localhost:4017, as documented at https://developers.figma.com/docs/plugins/manifest/. The service accepts only its exact localhost and numeric loopback authorities on the bound port, while preserving bearer authentication, origin restrictions and loopback binding. The regression failed with 403 before the change and passes afterward. Full npm run check passes: 50 unit/API tests and 12 Chromium tests, formatting, TypeScript and build. Actual Figma manifest reload awaits user confirmation. The restarted service has a new session code.

Earlier 0.2 user check (historical): reopen the plugin, connect with a session code and try the demo. Superseded by 0.3: reopen the registered plugin, choose size/theme/website language and paste a public URL. Connection and insertion proceed automatically; missing-font consent appears only when needed. No additional manifest import is needed. Successful native import through the updated installed UI remains to be confirmed.

Request-key compatibility fix: the user's next screenshot confirms successful plugin loading and connection, then `crypto.randomUUID is not a function` on capture. Browser reproduction failed with that exact text after disabling randomUUID. The plugin now generates non-secret request deduplication keys from random bytes with a time/counter fallback when random APIs are absent or restricted; authentication remains the service-issued bearer code. The same built UI workflow passes with randomUUID unavailable and the server accepts the generated key. Full check: 52 unit/API + 12 browser tests, formatting, typecheck and build. Build footer now comes from package.json and displays 0.2.0-alpha.1. Registered files were backed up, copied and hash-verified; output/desktop-deployment.json records the latest deployment. Service restart is unnecessary for this client-only fix.
