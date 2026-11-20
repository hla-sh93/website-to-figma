# Website to Figma

**By Hla.Sh · Development build 0.3.0-alpha.5-debug**

The current review build repairs long-page crop validation, retained-job exhaustion, unboxed text, live control values, preformatted text and CSS-painted SVG. It adds access-gate/stability checks and explicit warnings for incomplete inline/grid behavior. Full native visual acceptance remains open; the existing Figma validation file is currently view-only. See the [full review and actual test results](tasks/full-review.md) and [product quality plan](tasks/product-quality-plan.md). This is a diagnostic development build, not a completed fidelity release.

Paste a public website URL and create editable Figma layers. The everyday interface has the URL field and three dropdowns: size, source appearance and website language. Pasting a valid URL starts capture and import automatically after a short pause. A single button also supports typed URLs.

Size options are Desktop 1440, Tablet 768, Mobile 390 and all three. Settings are remembered. Language selects the browser's Arabic/English preference; it does not translate text or guarantee that a site provides that language. Light/Dark selects the website's preferred color scheme where supported.

Fonts are checked before insertion. Available fonts proceed automatically; missing fonts pause for an explicit substitute choice. Cancellation is available during work. Accuracy notes appear only when there are limitations to review. The previous demo, offline-file and comparison controls have been removed from the everyday plugin interface; capture and comparison remain available through the local dashboard/CLI.

## Local setup

Requirements: Node.js 24 recommended (22 minimum), npm, Chromium or Google Chrome, Figma Desktop, and permission to run development plugins.

1. Install dependencies and the browser:

       npm ci
       npx playwright install chromium

   The service can also use Chrome's standard Windows installation, or CHROMIUM_EXECUTABLE_PATH.

2. Create a development plugin in Figma Desktop. Configure the ID that Figma assigned to that registration:

       npm run configure-plugin -- --id YOUR_FIGMA_PLUGIN_ID
       npm run build

3. Install the built files into that registered folder:

       npm run install-local -- --target "C:/path/to/your/registered/plugin"

   The registered manifest must have the same Figma-assigned ID. Installation backs up its three runtime files, verifies deployed bytes and pairs that copy with this local service. It does not publish the plugin. See [Figma's manifest documentation](https://developers.figma.com/docs/plugins/manifest/).

4. Start the service:

       npm run dev

   Keep it running while importing. The personalized plugin connects automatically; no daily session-code entry is needed.

5. Open Website to Figma · Hla.Sh from Plugins > Development. Choose settings, then paste the URL. If the plugin was already open while files changed, close and reopen it.

Generic dist/code.js and release archives contain a pairing placeholder. install-local personalizes only the registered copy. The private device key stays in ignored .data/plugin-key and is reused after service restarts; temporary session credentials are not stored in Figma preferences. The local dashboard is available at http://localhost:4017 for development diagnostics and owned-demo capture. Service requests remain loopback-only and authenticated.

## Validation and commands

    npm run check
    npm run capture -- --url https://example.com --out output/example.json --widths 1440,390
    npm run capture -- --fixture fixtures/reference.html --selector "#features" --out output/features.json
    npm run benchmark
    npm run benchmark -- --source source.png --rendered figma.png --out output/comparison

Latest local verification: 60 unit/API tests and 37 Chromium tests, formatting, TypeScript and build. Browser workflow tests run the compiled UI inside an opaque sandbox iframe without form permissions or randomUUID, including synthetic null/self message sources. Actual Figma Desktop results and failures are recorded separately in [tasks/current-verification.md](tasks/current-verification.md). `npx tsx scripts/review-public-sites.ts` saves a separate source-only public-page exercise report; it does not establish native fidelity.

Actual Desktop replies used a window source different from parent. The earlier source guard rejected those replies despite successful external HTTP checks. The UI now connects directly and authenticates host messages with its personalized private channel. Real normal-mode URL paste created all three Figma frames without substitution. A separate actual Amazon test imported 89 images but failed visual acceptance; successful layer creation does not establish a match.

## Current support and limits

- Public HTTP(S) capture, real viewport measurements, bounded scrolling and original image assets.
- Editable styled text, measured font evidence, underline/strikethrough, supported variable-font axes and RTL alignment.
- Common Auto Layout flow, simple grid, fill/hug sizing, width limits, local styles, bound variables and conservative component families.
- Five image fit modes, padding and crop position; custom crops use editable clipping frames and need review after resize.
- Separate captured viewport frames preserve observed structure changes. Exact CSS breakpoint recovery and automatic structural switching in Design are not promised.

Some gradients, pseudo content, filters, media, transforms and complex layouts remain unsupported or approximate. Browser/Figma typography and unavailable fonts can change wrapping. The image model's 30 sampled browser pixels agree with its owned fixture; this is not a native-Figma visual accuracy score. Universal 100% website matching is not claimed.

The full roadmap remains open in [tasks/plan.md](tasks/plan.md). Production hosting, private-page capture, broad fixture evaluation and human cleanup studies are future work. Earlier 0.1 native evidence and the pending 0.2 native crop/component reruns remain documented; green local checks do not replace them.

