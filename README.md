# Website to Figma

**By Hla.Sh · 0.4.0-alpha.1**

Paste a public website URL and get editable Figma layers: frames with auto layout, real text, images, gradients, borders, shadows and effects, with layer names that describe what each element is. A local Playwright service measures the page in Chromium; the Figma plugin rebuilds it natively.

## What's new in 0.4

**Faster**
- Original JPEG, PNG and GIF bytes are kept; only other formats, EXIF-rotated or very large images are re-encoded.
- The editor receives the scene once, without screenshots, and the font check sends only the font list.
- Widths are captured in parallel; the renderer yields to Figma, so large imports keep the editor responsive.
- Apple home at 1440: 3.1 MB editor payload instead of 18.7 MB sent twice.

**More solid**
- Request, image and network limits skip extra downloads instead of failing the capture; over-budget regions become images.
- Pages that keep moving are frozen at one frame (Stripe now captures).
- After scrolling, capture waits for every image to finish, so slow sites keep their photos.
- The shipped plugin excludes verification hooks; a separate diagnostic build keeps them.

**More accurate**
- Linear, radial and conic gradients, gradient text and overlays on photos.
- Per-side, dashed and dotted borders; multiple and inset shadows; text shadow; blur and backdrop blur.
- `::before` / `::after` boxes and inline glyphs, CSS rotation, text case.
- CSS colour filters (grayscale, saturate, contrast, brightness) become Figma image filters; icon fonts become icon images.
- Right-to-left pages keep auto layout: rows, grids and columns follow browser order and alignment, and mixed Arabic and Latin copy keeps its order.
- Text uses line boxes, grids keep every CSS track, boxes stretched by their container keep their height, and only shrink-wrapped boxes (buttons, links, chips, badges) hug their content.
- SVG icons are imported at their measured size, so strokes scale correctly.

**Ready to design with**
- Layers are named by role and content (`Header`, `Navigation`, `Card / product title`, `Link / label`, `Button / label`, `Icon`, `Grid`, `Section / heading`). Utility classes and generated names are replaced; author labels and descriptive class names are kept.
- Each import is one Figma section named after the site, with every screen as a top-level frame, ready to export or prototype.

## Using the plugin

The interface has a URL field and three settings:

- **Size:** Desktop 1440, Tablet 768, Mobile 390, Desktop + Mobile, or all three.
- **Appearance:** Light or Dark, the colour scheme the website is asked to use where it supports one.
- **Website language:** Original, Arabic or English, the browser's language preference. It does not translate text or guarantee that a site has that language.

Pasting a valid URL starts capture and import after a short pause; the button also works for typed URLs. Settings are remembered. Fonts are checked first: available fonts continue automatically, missing fonts pause for an explicit substitute choice. Accuracy notes appear only when something needs review, and the import can be cancelled while it runs.

## Local setup

Requirements: Node.js 24 recommended (22 minimum), npm, Chromium or Google Chrome, Figma Desktop, and permission to run development plugins.

1. Install dependencies and the browser:

       npm ci
       npx playwright install chromium

   The service can also use Chrome's standard Windows installation, or `CHROMIUM_EXECUTABLE_PATH`.

2. Create a development plugin in Figma Desktop and configure the ID Figma assigned to it:

       npm run configure-plugin -- --id YOUR_FIGMA_PLUGIN_ID
       npm run build

3. Install the built files into that registered folder:

       npm run install-local -- --target "C:/path/to/your/registered/plugin"

   The registered manifest must have the same Figma-assigned ID. Installation backs up the three runtime files (`manifest.json`, `code.js`, `ui.html`), personalizes `code.js` and `ui.html` with the local pairing key and verifies the deployed bytes. It does not publish the plugin. See [Figma's manifest documentation](https://developers.figma.com/docs/plugins/manifest/).

4. Start the service and keep it running while importing:

       npm run dev

5. Open **Website to Figma · Hla.Sh** from Plugins > Development, choose the settings and paste the URL. If the plugin was open while its files changed, close and reopen it.

Generic `dist/` files and release archives contain a pairing placeholder; only the registered copy is personalized. The private device key stays in the ignored `.data/plugin-key` and is reused after service restarts. The service listens on `http://localhost:4017`, accepts loopback requests only and requires authentication.

## Commands

    npm run check          # formatting, TypeScript, unit/API tests, build, Chromium tests
    npm run capture -- --url https://example.com --widths 1440,390 --out output/example.json
    npm run capture -- --fixture fixtures/reference.html --selector "#features" --out output/features.json
    npm run benchmark

`npm run build` writes the shipped plugin to `dist/` and a diagnostic build to `dist/diagnostic/`. Installing with `--verify-url https://…` deploys the diagnostic build: it imports that URL automatically and sends an export of every imported screen, with per-layer geometry, to the local service for comparison with the live page.

Latest verification: 80 unit/API tests and 53 Chromium tests pass. Two Arabic stores were imported in Figma Desktop at 1440 and 390 and compared with the live sites screenshot to screenshot and layer by layer; results are in [tasks/v0.4-results.md](tasks/v0.4-results.md).

## Limits

- Rotated containers keep their children's measured positions; rotation is native on leaf layers only.
- Repeating or sized gradients are drawn once across the box; different border colours per side use one stroke colour.
- Browser and Figma glyph metrics differ slightly (emoji in particular), and unavailable fonts change wrapping.
- Moving content is captured at one frame; carousels show whichever slide was active.
- Text styles and variables are kept per site and reused by later imports of that site; colours take the names of the page's CSS custom properties when it declares them. Tokens overridden inside a section (a dark block, for example) keep the root value's name only where the colour matches.
- Exact CSS breakpoints are not recovered: each captured width is a separate frame.
- Private pages, production hosting and publishing to the Figma Community are out of scope.

Universal 100% website matching is not claimed; check each import against its source.
