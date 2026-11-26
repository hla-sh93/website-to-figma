import {
  chromium,
  request as playwrightRequest,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
} from 'playwright';
import { existsSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import {
  validateScene,
  type ScenePackage,
  type SceneNode,
  type SceneAsset,
  type SceneIssue,
  type SceneScreen,
  type ColorToken,
} from '../core/scene.js';
import { assertPublicUrl } from '../service/network-policy.js';
import { startEgressProxy } from '../service/egress-proxy.js';
import sharp from 'sharp';
import { collect } from './collector.js';
import { nameLayers } from '../core/naming.js';
import { textLineBoxes } from '../core/text-box.js';
import { inspectFonts } from './fonts.js';
import { captureGate, freezePage, pageFingerprint } from './page-state.js';
import {
  assignSiteFonts,
  parseFontFaces,
  saveSiteFonts,
  MAX_FONT_BYTES,
  MAX_FONT_FILES,
} from './site-fonts.js';
import { normalizeImage, isTiledScreenshot, MAX_ASSET_BYTES } from './images.js';
import { parseObjectPosition, backgroundSize, computeImagePlacement } from '../core/image.js';
export type CaptureOptions = {
  widths?: number[];
  height?: number;
  theme?: 'light' | 'dark';
  language?: 'ar' | 'en';
  signal?: AbortSignal;
  onProgress?: (stage: string) => void;
  selector?: string;
  /** Folder to save the page's web fonts in, as installable files. */
  fontsDir?: string;
};
const MAX_REQUESTS = 3000;
const MAX_IMAGE_BYTES = 64 * 1024 * 1024;
const UNREACHABLE =
  /ERR_(EMPTY_RESPONSE|NAME_NOT_RESOLVED|ADDRESS_UNREACHABLE|TIMED_OUT|CONNECTION_(REFUSED|RESET|CLOSED|ABORTED|FAILED|TIMED_OUT))/;
/** example.com for www.example.com and the reverse; nothing for deeper hosts or IPs. */
export function alternateAddress(input: string): string | undefined {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return;
  }
  const host = url.hostname;
  if (!/[a-z]/i.test(host.split('.').at(-1) ?? '') || !host.includes('.')) return;
  if (host.startsWith('www.')) url.hostname = host.slice(4);
  else if (host.split('.').length <= 3) url.hostname = 'www.' + host;
  else return;
  return url.href;
}
export const captureUrl = (url: string, options: CaptureOptions = {}) => capture({ url }, options);
/** Owned fixtures only. External resource access is blocked, including navigations. */
export const captureHtml = (html: string, options: CaptureOptions = {}) =>
  capture({ html }, options);
async function capture(
  input: { url?: string; html?: string },
  o: CaptureOptions,
): Promise<ScenePackage> {
  const widths = o.widths ?? [1440, 390],
    height = o.height ?? 900;
  if (
    !widths.length ||
    widths.length > 5 ||
    new Set(widths).size !== widths.length ||
    widths.some((w) => !Number.isInteger(w) || w < 320 || w > 3840)
  )
    throw new Error('Invalid capture widths');
  if (!Number.isInteger(height) || height < 200 || height > 2160)
    throw new Error('Invalid capture height');
  if (o.signal?.aborted) throw new Error('Capture aborted');
  if (o.language !== undefined && !['ar', 'en'].includes(o.language))
    throw new Error('Invalid capture language');
  let browser: Browser | undefined,
    context: BrowserContext | undefined,
    proxy: Awaited<ReturnType<typeof startEgressProxy>> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stop = false;
  let downloads: APIRequestContext | undefined;
  const close = async () => {
    stop = true;
    await downloads?.dispose().catch(() => {});
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  };
  const abort = () => {
    void close();
  };
  o.signal?.addEventListener('abort', abort, { once: true });
  const work = async () => {
    if (input.url) {
      await assertPublicUrl(input.url);
      if (stop) throw new Error('Capture aborted');
      // Each width loads the page in its own tab, so the budget scales with widths.
      proxy = await startEgressProxy({ maxBytes: 48 * 1024 * 1024 * widths.length });
      if (stop) {
        await proxy.close();
        throw new Error('Capture aborted');
      }
    }
    const executablePath = [
      process.env.CHROMIUM_EXECUTABLE_PATH,
      chromium.executablePath(),
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    ].find((p) => p && existsSync(p));
    browser = await chromium.launch({
      headless: true,
      executablePath,
      chromiumSandbox: true,
      args: ['--disable-quic', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'],
      ...(proxy
        ? {
            proxy: {
              server: proxy.url,
              username: proxy.username,
              password: proxy.password,
              bypass: '<-loopback>',
            },
          }
        : {}),
    });
    if (stop) {
      await browser.close();
      throw new Error('Capture aborted');
    }
    context = await browser.newContext({
      viewport: { width: widths[0]!, height },
      deviceScaleFactor: 1,
      colorScheme: o.theme ?? 'light',
      ...(o.language ? { locale: o.language === 'ar' ? 'ar-SA' : 'en-US' } : {}),
      serviceWorkers: 'block',
      acceptDownloads: false,
    });
    let requests = 0,
      requestLimited = false;
    await context.route('**/*', (route) => {
      const url = route.request().url();
      if ((input.html !== undefined && !url.startsWith('data:')) || !/^(https?:|data:)/.test(url))
        return route.abort();
      // Beyond the budget, skip further requests instead of abandoning the capture.
      if (!url.startsWith('data:') && ++requests > MAX_REQUESTS) {
        requestLimited = true;
        return route.abort();
      }
      return route.continue();
    });
    await context.routeWebSocket('**/*', (socket) => socket.close());
    // Close site-opened popups; capture pages have no opener.
    context.on('page', (p) => {
      void p
        .opener()
        .then((opener) => (opener ? p.close() : undefined))
        .catch(() => {});
    });
    // tsx preserves function names with a helper when serializing the collector.
    await context.addInitScript('globalThis.__name = (value) => value');
    const bodies = new Map<string, { mime: string; body: Buffer }>();
    // Image bodies arrive asynchronously; large photos can still be downloading
    // when measurement finishes, so the capture waits for these before using them.
    const pendingBodies = new Set<Promise<void>>();
    let bytes = 0,
      bytesLimited = false;
    const newCapturePage = async () => {
      const page = await context!.newPage();
      page.setDefaultTimeout(7000);
      page.on('download', (d) => void d.cancel());
      if (process.env.CAPTURE_TRACE) {
        page.on(
          'framenavigated',
          (f) =>
            f === page.mainFrame() &&
            process.stderr.write(`[nav] ${f.url().slice(0, 120)}
`),
        );
        page.on(
          'request',
          (r) =>
            r.isNavigationRequest() &&
            r.frame() === page.mainFrame() &&
            process.stderr.write(`[navreq] ${r.url().slice(0, 120)}
`),
        );
      }
      page.on('response', (response) => {
        if (!response.headers()['content-type']?.startsWith('image/')) return;
        if (bodies.has(response.url())) return;
        const pending = readBody(response).finally(() => pendingBodies.delete(pending));
        pendingBodies.add(pending);
      });
      return page;
    };
    const readBody = async (response: import('playwright').Response) => {
      try {
        const body = await response.body();
        if (bytes + body.length > MAX_IMAGE_BYTES) {
          bytesLimited = true;
          return;
        }
        bytes += body.length;
        const entry = { mime: response.headers()['content-type']!.split(';')[0]!, body };
        bodies.set(response.url(), entry);
        // A redirected image is known to the page by the address it asked for.
        for (let from = response.request().redirectedFrom(); from; from = from.redirectedFrom())
          bodies.set(from.url(), entry);
      } catch {}
    };
    const result: ScenePackage = {
      version: 1,
      capture: {
        id: randomUUID(),
        url: input.url ?? 'fixture:owned',
        title: '',
        capturedAt: new Date().toISOString(),
        engine: 'Chromium ' + browser.version(),
        ...(o.language ? { language: o.language } : {}),
      },
      screens: [],
      assets: [],
      issues: [],
    };
    // Font files the page loaded, by address (one copy for all widths).
    const fontDownloads = new Map<string, Uint8Array | undefined>();
    // Style sheet text by address: its @font-face rules name the fonts.
    const styleSheets = new Map<string, string>();
    // The address that answered; a later width starts from it.
    let target = input.url ?? '';
    const captureWidth = async (width: number) => {
      const local = {
        assets: [] as SceneAsset[],
        issues: [] as SceneIssue[],
        screens: [] as SceneScreen[],
        tokens: [] as ColorToken[],
        title: '',
      };
      const page = await newCapturePage();
      // Image downloads in flight, so waits can tell slow from finished.
      const imageDownloads = new Set<import('playwright').Request>();
      // Scripts, data and media in flight: late widgets (players, carousels) build
      // themselves from these after they scroll into view.
      const widgetDownloads = new Set<import('playwright').Request>();
      if (o.fontsDir)
        page.on('response', (response) => {
          const url = response.url();
          if (
            response.request().resourceType() === 'stylesheet' &&
            response.ok() &&
            !styleSheets.has(url) &&
            styleSheets.size < 60
          ) {
            styleSheets.set(url, '');
            void response
              .text()
              .then((css) => styleSheets.set(url, css))
              .catch(() => {});
            return;
          }
          if (
            response.request().resourceType() !== 'font' ||
            !response.ok() ||
            fontDownloads.has(url) ||
            fontDownloads.size >= MAX_FONT_FILES * 2
          )
            return;
          fontDownloads.set(url, undefined);
          void response
            .body()
            .then((body) => {
              if (body.length <= MAX_FONT_BYTES) fontDownloads.set(url, body);
            })
            .catch(() => {});
        });
      page.on('request', (request) => {
        const type = request.resourceType();
        if (type === 'image') imageDownloads.add(request);
        else if (['script', 'fetch', 'xhr', 'media', 'stylesheet', 'font'].includes(type))
          widgetDownloads.add(request);
      });
      const settled = (request: import('playwright').Request) => {
        imageDownloads.delete(request);
        widgetDownloads.delete(request);
      };
      page.on('requestfinished', settled);
      page.on('requestfailed', settled);
      try {
        o.onProgress?.(`capture-${width}`);
        const started = Date.now();
        const trace = (label: string) => {
          if (process.env.CAPTURE_TRACE)
            process.stderr.write(`[capture ${width}] ${label} +${Date.now() - started}ms\n`);
        };
        await page.setViewportSize({ width, height });
        if (input.html !== undefined)
          await page.setContent(input.html, { waitUntil: 'domcontentloaded', timeout: 12000 });
        else {
          const open = (url: string) =>
            page.goto(url, { waitUntil: 'domcontentloaded', timeout: 35000 });
          const response = await open(target)
            .catch(async (error: unknown) => {
              // Many sites answer on only one of example.com and www.example.com, and a
              // browser that visited before follows a remembered redirect. When the
              // address as given does not answer at all, the other form is tried.
              const other = alternateAddress(target);
              if (!other || !UNREACHABLE.test(String((error as Error)?.message))) throw error;
              await assertPublicUrl(other);
              // The browser's own error page for the first address can still be
              // arriving; it would interrupt the next navigation, so that one is repeated.
              const result = await open(other)
                .catch((second: unknown) => {
                  if (!/interrupted by another navigation/.test(String((second as Error)?.message)))
                    throw second;
                  return page.waitForTimeout(300).then(() => open(other));
                })
                .catch((second: unknown) => {
                  trace(
                    'the other address failed too: ' +
                      String((second as Error)?.message).slice(0, 160),
                  );
                  throw error;
                });
              target = other;
              local.issues.push({
                code: 'address-changed',
                severity: 'info',
                message: `${new URL(input.url!).host} did not answer; ${new URL(other).host} was captured instead.`,
                screenId: `viewport-${width}`,
              });
              return result;
            })
            .catch(async (error: unknown) => {
              // A slow site may have delivered its content while a late script still
              // blocks the load event. Continue with what is rendered instead of failing.
              const rendered = await Promise.race([
                page.evaluate(() => (document.body?.innerText.trim().length ?? 0) > 0),
                new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 4000)),
              ]).catch(() => false);
              if (!rendered) throw error;
              local.issues.push({
                code: 'slow-load',
                severity: 'warning',
                message:
                  'The page was still loading after 35 seconds; the capture continued with the content already shown.',
                screenId: `viewport-${width}`,
              });
              return null;
            });
          if (response && response.status() >= 400)
            throw new Error(
              `[HTTP_STATUS] Website returned HTTP ${response.status()}; the requested page was not captured.`,
            );
        }
        const steadyStyles = () =>
          page.addStyleTag({
            content:
              '*,*::before,*::after{transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}',
          });
        await steadyStyles();
        await page
          .waitForFunction(
            () => {
              const b = document.body;
              if (!b) return false;
              const rect = b.getBoundingClientRect(),
                style = getComputedStyle(b);
              return (
                style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                rect.width > 0 &&
                rect.height > 0 &&
                (b.innerText.trim().length > 0 ||
                  Boolean(
                    b.querySelector(
                      'img,svg,canvas,video,iframe,input:not([type="hidden"]),textarea,select',
                    ),
                  ))
              );
            },
            undefined,
            { timeout: 6000 },
          )
          .catch(() => {
            throw new Error('The website did not reveal visible content before capture.');
          });
        trace('loaded');
        const assetCount = local.assets.length,
          issueCount = local.issues.length;
        const CONSENT = '#sp-cc-rejectall-link, #onetrust-reject-all-handler';
        // Dismiss only recognized cookie-rejection controls, never general page actions.
        // Many consent managers reload the page after a choice; measuring across that
        // reload would wait on a document that no longer exists, so it is awaited here.
        const dismissConsent = async () => {
          let dismissed = false;
          for (const reject of await page.locator(CONSENT).all()) {
            if (!(await reject.isVisible().catch(() => false))) continue;
            dismissed = true;
            await reject.click({ timeout: 4000 }).catch(() => {
              local.issues.push({
                code: 'consent-dismissal-failed',
                severity: 'warning',
                message: 'The cookie banner could not be dismissed within the bounded wait.',
                screenId: `viewport-${width}`,
              });
            });
          }
          if (!dismissed) return false;
          await page.waitForTimeout(1200);
          await page.waitForLoadState('load', { timeout: 15000 }).catch(() => {});
          // A reload may still be parsing: measuring needs the new document's body.
          await page
            .waitForFunction(
              () => !!document.body && document.readyState !== 'loading',
              undefined,
              {
                timeout: 20000,
              },
            )
            .catch(() => {});
          // A reloaded document lost the capture's style sheet.
          await steadyStyles().catch(() => {});
          return true;
        };
        // Banners usually show within moments of load; handling one before the page is
        // scrolled and its images awaited avoids preparing the page twice.
        await page
          .locator(CONSENT)
          .first()
          .waitFor({ state: 'visible', timeout: 2500 })
          .catch(() => {});
        let consentHandled = await dismissConsent(),
          imagesAwaited = false;
        trace(consentHandled ? 'consent dismissed' : 'no consent banner');
        for (let attempt = 0; attempt < 3; attempt++) {
          if (await page.evaluate(captureGate))
            throw new Error(
              '[PAGE_BLOCKED] الموقع عرض صفحة تحقق أو حاجز وصول بدلاً من الصفحة المطلوبة. يلزم التقاط الصفحة من المتصفح بعد فتحها.',
            );
          await page.evaluate(async () => {
            // After a freeze, page timers are disabled; use the capture's saved timer.
            const timer = ((window as unknown as { __captureTimeout?: typeof setTimeout })
              .__captureTimeout ?? window.setTimeout.bind(window)) as typeof setTimeout;
            const sleep = (ms: number) => new Promise<void>((resolve) => timer(resolve, ms));
            await Promise.race([document.fonts.ready, sleep(3000)]);
            for (let y = 0; y < Math.min(document.documentElement.scrollHeight, 16000); y += 800) {
              scrollTo(0, y);
              await sleep(100);
            }
            scrollTo(0, 0);
            for (const video of document.querySelectorAll('video')) video.pause();
          });
          // Large photos decide their own height; measure only after they arrive.
          // 'networkidle' already resolved at page load, so it would not wait for the
          // images the scroll just requested: wait for every image to finish instead.
          // Only images that will finish count: rendered ones, and lazy ones the scroll
          // reached. Hidden carousel slides never load, and waiting again on a retry
          // only repeats the same wait.
          const lateConsent = consentHandled
            ? new Promise<never>(() => {})
            : page
                .locator(CONSENT)
                .first()
                .waitFor({ state: 'visible', timeout: 30000 })
                .then(
                  () => 'consent' as const,
                  () => new Promise<never>(() => {}),
                );
          if (!imagesAwaited) {
            const outcome = await Promise.race([
              lateConsent,
              (async () => {
                // Sections that build themselves when scrolled into view (video players,
                // embedded widgets) get a moment to finish: until their downloads have
                // been quiet for a second, twelve seconds at most.
                const settleBy = Date.now() + 12000;
                for (let calm = 0; calm < 1000 && Date.now() < settleBy && !stop;) {
                  // A sized custom element that is still empty (a player or widget whose
                  // script has not built it yet) also counts as unfinished.
                  const unbuilt = await page
                    .evaluate(() =>
                      [...document.querySelectorAll('*')].some((el) => {
                        if (!el.tagName.includes('-') || el.childElementCount || el.shadowRoot)
                          return false;
                        const box = el.getBoundingClientRect();
                        return box.width >= 40 && box.height >= 40 && !el.textContent?.trim();
                      }),
                    )
                    .catch(() => false);
                  calm = widgetDownloads.size || unbuilt ? 0 : calm + 200;
                  await page.waitForTimeout(200);
                }
                // Lazy images outside the viewport (carousel slides, late sections) would
                // never start loading; here every shown image is asked to load now.
                await page
                  .evaluate(() => {
                    for (const image of document.images)
                      if (image.loading === 'lazy' && image.getClientRects().length)
                        image.loading = 'eager';
                  })
                  .catch(() => {});
                // The wait follows the network: it ends when every shown image is complete,
                // or when images are still missing but no image download is active any
                // more (nothing else will arrive). Slow downloads are given up to 45 s.
                const deadline = Date.now() + 45000;
                let quiet = 0;
                while (Date.now() < deadline && !stop) {
                  const pending = await page
                    .evaluate(
                      () =>
                        [...document.images].filter(
                          (image) => !image.complete && image.getClientRects().length,
                        ).length,
                    )
                    .catch(() => 0);
                  if (!pending) break;
                  quiet = imageDownloads.size ? 0 : quiet + 250;
                  if (quiet >= 2500) break;
                  await page.waitForTimeout(250);
                }
              })()
                .catch(() => {})
                .then(async () => {
                  const pending = await page
                    .evaluate(() =>
                      [...document.images]
                        .filter((image) => !image.complete && image.getClientRects().length)
                        .map((image) => image.currentSrc || image.src)
                        .slice(0, 3),
                    )
                    .catch(() => [] as string[]);
                  if (pending.length)
                    local.issues.push({
                      code: 'images-still-loading',
                      severity: 'warning',
                      message:
                        `Some images did not finish loading and may be missing: ${pending.join(', ')}`.slice(
                          0,
                          500,
                        ),
                      screenId: `viewport-${width}`,
                    });
                }),
            ]);
            if (outcome === 'consent' && (await dismissConsent())) {
              consentHandled = true;
              trace('consent dismissed while images loaded, page prepared again');
              attempt--;
              continue;
            }
          }
          await page.evaluate(async () => {
            const timer = ((window as unknown as { __captureTimeout?: typeof setTimeout })
              .__captureTimeout ?? window.setTimeout.bind(window)) as typeof setTimeout;
            await Promise.race([
              Promise.all([...document.images].map((i) => i.decode().catch(() => {}))),
              new Promise<void>((resolve) => timer(resolve, 6000)),
            ]);
          });
          imagesAwaited = true;
          trace('images ready');
          // A banner that appeared late: dismiss it and prepare the page again once.
          if (!consentHandled && (await dismissConsent())) {
            consentHandled = true;
            trace('consent dismissed late, page prepared again');
            attempt--;
            imagesAwaited = false;
            continue;
          }
          // A page that stops answering must fail clearly, not hang until the capture limit.
          const fingerprint = () =>
            Promise.race([
              page.evaluate(pageFingerprint),
              new Promise<never>((_, reject) =>
                setTimeout(
                  () => reject(new Error('The page stopped responding while it was measured.')),
                  15000,
                ),
              ),
            ]);
          const settle = async (rounds: number) => {
            let previous = '',
              unchanged = 0;
            for (let i = 0; i < rounds; i++) {
              trace(`settle round ${i}`);
              const geometry = await fingerprint();
              if (geometry === previous) {
                if (++unchanged >= 5) return true;
              } else unchanged = 0;
              previous = geometry;
              await page.waitForTimeout(150);
            }
            return false;
          };
          // Let late hydration finish first; only a page that keeps moving is frozen
          // (carousels, canvas loops, tickers) so it can be captured at one frame.
          trace('before settle');
          let stable = await settle(24);
          if (!stable) {
            trace('freezing');
            // Freeze between movements, not in the middle of one: rotating headlines and
            // carousels hold still between transitions, so the page is sampled from
            // inside and stopped as soon as it has held one frame (five seconds at most).
            const held = await page
              .evaluate(
                `(async () => {
                  const fingerprint = ${pageFingerprint.toString()};
                  const freeze = ${freezePage.toString()};
                  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
                  let previous = fingerprint(), same = 0;
                  for (const end = Date.now() + 5000; Date.now() < end && same < 3; ) {
                    await sleep(90);
                    const current = fingerprint();
                    same = current === previous ? same + 1 : 0;
                    previous = current;
                  }
                  freeze();
                  return same >= 3;
                })()`,
              )
              .catch(() => undefined);
            // The page changed under the script (navigation): freeze it the plain way.
            if (held === undefined) await page.evaluate(freezePage);
            trace(held ? 'frozen at a held frame' : 'frozen while moving');
            if (attempt === 0)
              local.issues.push({
                code: 'motion-frozen',
                severity: 'info',
                message: 'Moving content was paused at one frame for capture.',
                screenId: `viewport-${width}`,
              });
            stable = await settle(16);
          }
          if (!stable && attempt === 0)
            local.issues.push({
              code: 'page-still-changing',
              severity: 'warning',
              message:
                'The page kept changing after motion was frozen; layers reflect one captured moment.',
              screenId: `viewport-${width}`,
            });
          trace('settled');
          const collectedState = await fingerprint();
          await page.evaluate('globalThis.__name = (value) => value');
          local.title = await page.title();
          // Return JSON text: deep trees exceed Playwright's structured serialization depth.
          const data = JSON.parse(
            await page.evaluate(
              `JSON.stringify((${collect.toString()})(${JSON.stringify(o.selector ?? null)}))`,
            ),
          ) as ReturnType<typeof collect>;
          trace('collector returned');
          local.tokens = data.tokens;
          const screenId = `viewport-${width}`;
          const nodes = new Map<string, SceneNode>();
          const visit = (n: SceneNode) => {
            nodes.set(n.id, n);
            n.children.forEach(visit);
          };
          visit(data.root);
          await inspectFonts(page, data.textSources, nodes, data.issues);
          trace('fonts inspected');
          for (const issue of data.issues) local.issues.push({ ...issue, screenId });
          // Image work runs first; screenshot-based media frames run after the change check,
          // because full-page screenshots resize the viewport and can disturb the page.
          const processSource = async (s: (typeof data.sources)[number]) => {
            const n = nodes.get(s.nodeId)!;
            if (n.image && s.objectPosition) {
              const position = parseObjectPosition(s.objectPosition);
              if (position) {
                n.image.position = position.position;
                n.image.positionOffset = position.offset;
              } else
                local.issues.push({
                  code: 'image-position-unsupported',
                  severity: 'warning',
                  message:
                    'Unsupported object-position expression; centered fallback requires review.',
                  screenId,
                  nodeId: n.id,
                });
            }
            let asset = bodies.get(s.url);
            if (s.mediaFrame) {
              const clip = {
                x: Math.max(0, n.bounds.x),
                y: Math.max(0, n.bounds.y),
                width: Math.max(
                  0,
                  Math.min(width, n.bounds.x + n.bounds.width) - Math.max(0, n.bounds.x),
                ),
                height: Math.max(
                  0,
                  Math.min(16000, n.bounds.y + n.bounds.height) - Math.max(0, n.bounds.y),
                ),
              };
              if (clip.width > 0 && clip.height > 0 && clip.width * clip.height <= 16000000) {
                try {
                  asset = {
                    mime: 'image/png',
                    body: await page.screenshot({
                      clip,
                      fullPage: true,
                      animations: 'allow',
                      timeout: 10000,
                    }),
                  };
                  n.image!.contentBox = {
                    x: clip.x - n.bounds.x,
                    y: clip.y - n.bounds.y,
                    width: clip.width,
                    height: clip.height,
                  };
                } catch {
                  asset = undefined;
                }
              }
            }
            if (s.url.startsWith('data:')) {
              const m = s.url.match(/^data:([^;,]+)(;base64)?,(.*)$/s);
              if (m)
                asset = {
                  mime: m[1]!,
                  body: m[2]
                    ? Buffer.from(m[3]!, 'base64')
                    : Buffer.from(decodeURIComponent(m[3]!)),
                };
            }
            // Images created by script (blob: URLs) never cross the network; their
            // bytes are read from the page that holds them.
            if (!asset && s.url.startsWith('blob:') && !bytesLimited) {
              const read = await page
                .evaluate(async (url) => {
                  try {
                    const blob = await (await fetch(url)).blob();
                    if (blob.size > 8 * 1024 * 1024) return null;
                    const bytes = new Uint8Array(await blob.arrayBuffer());
                    let binary = '';
                    for (let i = 0; i < bytes.length; i += 32768)
                      binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
                    return { mime: blob.type, data: btoa(binary) };
                  } catch {
                    // A content security policy may forbid fetch(blob:). The image the
                    // page already decoded is drawn instead, at up to three times its size.
                    const image = [...document.images].find(
                      (i) => i.currentSrc === url || i.src === url,
                    );
                    if (!image?.naturalWidth) return null;
                    const scale = Math.max(
                      1,
                      Math.min(3, 2048 / Math.max(image.naturalWidth, image.naturalHeight)),
                    );
                    const canvas = document.createElement('canvas');
                    canvas.width = Math.round(image.naturalWidth * scale);
                    canvas.height = Math.round(image.naturalHeight * scale);
                    canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
                    return {
                      mime: 'image/png',
                      data: canvas.toDataURL('image/png').split(',')[1]!,
                    };
                  }
                }, s.url)
                .catch(() => null);
              if (read && read.mime.startsWith('image/')) {
                const body = Buffer.from(read.data, 'base64');
                if (bytes + body.length <= MAX_IMAGE_BYTES) {
                  bytes += body.length;
                  asset = { mime: read.mime.split(';')[0]!, body };
                }
              }
            }
            // Only through the egress proxy, which admits public addresses alone; owned
            // fixtures have no proxy and download nothing.
            if (!asset && /^https?:/.test(s.url) && !bytesLimited && proxy) {
              downloads ??= await playwrightRequest.newContext({
                proxy: { server: proxy.url, username: proxy.username, password: proxy.password },
              });
              const again = await downloads
                .get(s.url, { timeout: 20000, failOnStatusCode: true })
                .catch(() => null);
              const mime = again?.headers()['content-type']?.split(';')[0] ?? '';
              if (again && mime.startsWith('image/')) {
                const body = await again.body().catch(() => null);
                if (body && bytes + body.length <= MAX_IMAGE_BYTES) {
                  bytes += body.length;
                  asset = { mime, body };
                  bodies.set(s.url, asset);
                }
              }
            }
            // Last resort for a picture the page shows but whose bytes cannot be read (a
            // revoked blob, a changing animated source): keep what is painted there.
            // A broken image (nothing decoded) stays a reported missing asset.
            if (
              !asset &&
              s.kind === 'image' &&
              !s.background &&
              !s.mediaFrame &&
              n.image &&
              // Script-made sources can report no size while they are being swapped.
              (s.width > 0 || !/^https?:/.test(s.url))
            ) {
              s.mediaFrame = true;
              s.url = 'frame:image';
              n.image = { fit: 'fill', position: [0.5, 0.5] };
              local.issues.push({
                code: 'raster-fallback',
                severity: 'info',
                message:
                  'Image source could not be read; kept as a picture of what the page showed.',
                screenId,
                nodeId: n.id,
              });
              return;
            }
            if (!asset || asset.body.length > 4 * MAX_ASSET_BYTES) {
              n.kind = 'frame';
              local.issues.push({
                code: 'missing-asset',
                severity: 'warning',
                message: 'Source image unavailable or exceeds asset budget.',
                screenId,
                nodeId: n.id,
              });
              return;
            }
            // SVG response images are sanitized using the browser DOM before packaging.
            // The artwork fills its box without letterboxing or stretching.
            const sameAspect = (svg: string, box: { width: number; height: number }) => {
              const view = /viewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(svg);
              if (!view || !box.height) return false;
              const ratio = Number(view[1]) / Number(view[2]);
              return Math.abs(ratio - box.width / box.height) <= 0.02 * ratio;
            };
            let vectorImage = false;
            if (asset.mime === 'image/svg+xml') {
              const sanitized = await page.evaluate((svg) => {
                const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
                doc
                  .querySelectorAll('script,foreignObject,animate,set,animateTransform')
                  .forEach((e) => e.remove());
                // Style sheets carry the image's colours; only remote references are dropped.
                for (const style of doc.querySelectorAll('style'))
                  style.textContent = (style.textContent ?? '')
                    .replace(/@import[^;]*;?/gi, '')
                    .replace(/url\((?!["']?#)[^)]*\)/gi, 'none');
                const rootSvg = doc.documentElement;
                // A viewBox lets the image scale to the size it is shown at.
                if (!rootSvg.getAttribute('viewBox')) {
                  const w = parseFloat(rootSvg.getAttribute('width') ?? ''),
                    h = parseFloat(rootSvg.getAttribute('height') ?? '');
                  if (w > 0 && h > 0) rootSvg.setAttribute('viewBox', `0 0 ${w} ${h}`);
                }
                for (const e of doc.querySelectorAll('*'))
                  for (const a of [...e.attributes])
                    if (
                      a.name.startsWith('on') ||
                      (/href/i.test(a.name) && !a.value.startsWith('#')) ||
                      /url\((?!["']?#)/i.test(a.value)
                    )
                      e.removeAttribute(a.name);
                return new XMLSerializer().serializeToString(doc.documentElement);
              }, asset.body.toString());
              asset = { mime: asset.mime, body: Buffer.from(sanitized) };
              // Simple SVG files shown through <img> (icons, logos) stay editable vectors.
              const box = n.image?.contentBox;
              vectorImage =
                s.kind === 'image' &&
                !s.background &&
                // Icons and logos only: larger artwork behaves like a photo (crop, fit).
                Math.max(n.bounds.width, n.bounds.height) <= 240 &&
                // An image cut by the capture boundary keeps its crop geometry.
                n.bounds.y + n.bounds.height <= 16000 &&
                (n.image?.fit === 'fill' || n.image?.fit === 'contain') &&
                sanitized.length <= 60000 &&
                sameAspect(sanitized, n.bounds) &&
                /\bviewBox=/.test(sanitized) &&
                !/<(?:style|filter|mask|image|pattern|use|text)\b/i.test(sanitized) &&
                (!box ||
                  (Math.abs(box.width - n.bounds.width) < 1 &&
                    Math.abs(box.height - n.bounds.height) < 1));
              if (vectorImage) {
                s.kind = 'svg';
                n.kind = 'svg';
                delete n.image;
                s.width = n.bounds.width;
                s.height = n.bounds.height;
              }
            }
            if (s.kind === 'image' && asset.mime === 'image/svg+xml') {
              try {
                const w = Math.max(1, Math.min(3840, Math.round(s.width || n.bounds.width))),
                  h = Math.max(1, Math.min(16000, Math.round(s.height || n.bounds.height)));
                // Vector artwork is drawn at three times its shown size so it stays sharp.
                const shown = Math.max(n.bounds.width, n.bounds.height, 1);
                const natural = Math.max(w, h);
                const scale = Math.max(1, Math.min(4, (shown * 3) / natural, 2048 / natural));
                const png = await sharp(asset.body, {
                  limitInputPixels: 16000000,
                  density: Math.round(72 * scale),
                })
                  .resize(Math.round(w * scale), Math.round(h * scale), { fit: 'inside' })
                  .png()
                  .toBuffer({ resolveWithObject: true });
                if (png.data.length > MAX_ASSET_BYTES) throw new Error('Image budget');
                asset = { mime: 'image/png', body: png.data };
                s.width = png.info.width;
                s.height = png.info.height;
              } catch {
                n.kind = 'frame';
                local.issues.push({
                  code: 'missing-asset',
                  severity: 'warning',
                  message: 'SVG image could not be safely rasterized within budget.',
                  screenId,
                  nodeId: n.id,
                });
                return;
              }
            }
            if (s.kind === 'image' && asset.mime !== 'image/svg+xml') {
              try {
                const normalized = await normalizeImage(asset.body);
                if (normalized.flattened)
                  local.issues.push({
                    code: 'static-image-frame',
                    severity: 'warning',
                    message: 'Animated image imported as its first frame.',
                    screenId,
                    nodeId: n.id,
                  });
                asset = { mime: normalized.mime, body: normalized.body };
                s.width = normalized.width;
                s.height = normalized.height;
              } catch {
                n.kind = 'frame';
                local.issues.push({
                  code: 'missing-asset',
                  severity: 'warning',
                  message: 'Image could not be decoded within the pixel and byte limits.',
                  screenId,
                  nodeId: n.id,
                });
                return;
              }
            }
            if (s.background && n.image) {
              const area = n.image.contentBox!;
              const size = backgroundSize(s.background.size, area, {
                width: s.width,
                height: s.height,
              });
              if (size === 'cover' || size === 'contain') n.image.fit = size;
              else if (size) n.image.intrinsicSize = size;
              const placement = size
                ? computeImagePlacement(n.bounds, { width: s.width, height: s.height }, n.image)
                : null;
              const repeat = s.background.repeat.split(' ');
              const repeatsX = repeat[0] === 'repeat' || repeat[0] === 'repeat-x';
              const repeatsY = repeat[0] === 'repeat-y' || (repeat[1] ?? repeat[0]) === 'repeat';
              const needsRepeat =
                placement &&
                ((repeatsX &&
                  (placement.x > area.x + 0.1 ||
                    placement.x + placement.width < area.x + area.width - 0.1)) ||
                  (repeatsY &&
                    (placement.y > area.y + 0.1 ||
                      placement.y + placement.height < area.y + area.height - 0.1)));
              if (!size || !placement || needsRepeat) {
                n.kind = 'frame';
                delete n.image;
                local.issues.push({
                  code: 'background-unsupported',
                  severity: 'warning',
                  message: 'Repeated tiles or unsupported CSS background sizing require review.',
                  screenId,
                  nodeId: n.id,
                });
                return;
              }
            }
            const id = s.kind + '-' + createHash('sha256').update(asset.body).digest('hex');
            n.assetId = id;
            if (!local.assets.some((a) => a.id === id))
              local.assets.push({
                id,
                kind: s.kind,
                mimeType: asset.mime,
                data: asset.body.toString('base64'),
                width: s.width,
                height: s.height,
                ...(s.url.startsWith('http') ? { sourceUrl: s.url } : {}),
              });
          };
          if (pendingBodies.size)
            await Promise.race([
              Promise.allSettled([...pendingBodies]),
              new Promise((resolve) => setTimeout(resolve, 10000)),
            ]);
          trace('collected');
          for (const s of data.sources) if (!s.mediaFrame) await processSource(s);
          const settledState = await fingerprint();
          if (settledState !== collectedState && attempt < 2) {
            local.assets.length = assetCount;
            local.issues.length = issueCount;
            // Motion the fingerprint missed (canvas, video, timers): freeze before retrying.
            await page.evaluate(freezePage);
            continue;
          }
          for (const s of data.sources) if (s.mediaFrame) await processSource(s);
          const fullHeight = await page.evaluate(() => document.documentElement.scrollHeight);
          const clip = o.selector
            ? data.root.bounds
            : { x: 0, y: 0, width, height: Math.min(16000, fullHeight) };
          clip.height = Math.min(clip.height, 16000);
          if (clip.y >= 16000 || clip.y + clip.height <= 0)
            throw new Error('Capture selector is outside covered region');
          clip.height = Math.min(clip.height, 16000 - Math.max(0, clip.y));
          // Clip the document frame, preserving image content boxes and original crop geometry.
          const background = await page.evaluate((selector) => {
            let el: Element | null = selector ? document.querySelector(selector) : document.body;
            let css = 'white';
            while (el) {
              const value = getComputedStyle(el).backgroundColor;
              if (value !== 'rgba(0, 0, 0, 0)' && value !== 'transparent') {
                css = value;
                break;
              }
              el = el.parentElement;
            }
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = 1;
            const ctx = canvas.getContext('2d')!;
            ctx.fillStyle = css;
            ctx.fillRect(0, 0, 1, 1);
            const c = ctx.getImageData(0, 0, 1, 1).data;
            return { r: c[0]! / 255, g: c[1]! / 255, b: c[2]! / 255, a: c[3]! / 255 };
          }, o.selector);
          const content = data.root;
          const padding: [number, number, number, number] = o.selector
            ? [0, 0, 0, 0]
            : [
                Math.max(0, content.bounds.y),
                Math.max(0, width - content.bounds.x - content.bounds.width),
                Math.max(0, clip.height - content.bounds.y - content.bounds.height),
                Math.max(0, content.bounds.x),
              ];
          const root: SceneNode = {
            id: 'capture-root',
            name: content.name,
            kind: 'frame',
            source: { tag: 'document', key: o.selector ? 'selection' : 'document' },
            bounds: { ...clip },
            style: { opacity: 1, background, clipContent: true },
            layout: {
              mode: 'vertical',
              gap: 0,
              padding,
              align: 'start',
              justify: 'start',
              wrap: false,
              widthSizing: 'fixed',
              heightSizing:
                fullHeight > 16000 || clip.y + data.root.bounds.height > 16000 ? 'fixed' : 'hug',
            },
            children: [content],
          };
          textLineBoxes(root);
          nameLayers(root);
          trace('sources processed');
          const shoot = () =>
            page.screenshot({ clip, fullPage: true, animations: 'allow', timeout: 10000 });
          let screenshot = await shoot();
          // The layers are measured, not drawn from this picture; only the reference
          // image is retaken when Chromium returns a repeated tile.
          for (let retry = 0; retry < 2 && (await isTiledScreenshot(screenshot)); retry++) {
            trace('screenshot came back tiled; retaking');
            await page.waitForTimeout(400);
            screenshot = await shoot();
          }
          if (await isTiledScreenshot(screenshot))
            local.issues.push({
              code: 'screenshot-unreliable',
              severity: 'warning',
              message:
                'The reference screenshot could not be drawn correctly; the layers are not affected.',
              screenId,
            });
          if ((await fingerprint()) !== settledState)
            // The scene is one synchronous snapshot; only the reference screenshot may differ.
            local.issues.push({
              code: 'screenshot-drift',
              severity: 'warning',
              message:
                'The page changed while the reference screenshot was taken; it may differ from the layers.',
              screenId,
            });
          trace('screenshot done');
          local.screens.push({
            id: screenId,
            viewport: { width, height, dpr: 1 },
            root,
            screenshot: screenshot.toString('base64'),
          });
          if (fullHeight > 16000)
            local.issues.push({
              code: 'height-truncated',
              severity: 'warning',
              message: 'Capture truncated at 16000 source pixels.',
              screenId,
            });
          local.issues.push({
            code: 'measurement-limitations',
            severity: 'info',
            message:
              'Animations frozen at capture; typography baselines, collapsed margins, intrinsic sizing and browser-specific shaping remain measured approximations. CSS font stacks do not identify every glyph fallback font.',
            screenId,
          });
          break;
        }
      } finally {
        await page.close().catch(() => {});
      }
      return local;
    };
    // Each width loads in its own page at the same time.
    const attempts = await Promise.allSettled(widths.map(captureWidth));
    const captured: Awaited<ReturnType<typeof captureWidth>>[] = [];
    for (const [index, attempt] of attempts.entries()) {
      if (attempt.status === 'fulfilled') captured.push(attempt.value);
      // Some sites stall one of several simultaneous loads. A width whose navigation
      // timed out is loaded again on its own, after the others have finished.
      else if (
        widths.length > 1 &&
        !stop &&
        /page.goto: Timeout/.test(String((attempt.reason as Error | undefined)?.message))
      )
        captured.push(await captureWidth(widths[index]!));
      else throw attempt.reason;
    }
    result.capture.title = captured.find((c) => c.title)?.title ?? '';
    const tokens = captured.find((c) => c.tokens.length)?.tokens;
    if (tokens) result.tokens = { colors: tokens };
    const assetIds = new Set<string>();
    for (const part of captured) {
      for (const asset of part.assets)
        if (!assetIds.has(asset.id)) {
          assetIds.add(asset.id);
          result.assets.push(asset);
        }
      result.issues.push(...part.issues);
      result.screens.push(...part.screens);
    }
    if (o.fontsDir && input.url) {
      const saved = await saveSiteFonts(
        o.fontsDir,
        new URL(target || input.url).hostname,
        [...fontDownloads].filter((entry): entry is [string, Uint8Array] => entry[1] !== undefined),
      ).catch(() => undefined);
      if (saved) {
        result.siteFonts = {
          folder: saved.folder,
          files: saved.files.map(({ family, style, file }) => ({ family, style, file })),
        };
        assignSiteFonts(
          result.screens.map((screen) => screen.root),
          [...styleSheets].flatMap(([url, css]) => parseFontFaces(css, url)),
          saved.byUrl,
        );
      }
    }
    if (requestLimited)
      result.issues.push({
        code: 'request-budget',
        severity: 'warning',
        message: `Requests beyond ${MAX_REQUESTS} were skipped; late-loading content may be missing.`,
      });
    if (bytesLimited)
      result.issues.push({
        code: 'image-budget',
        severity: 'warning',
        message:
          'Image downloads beyond the capture budget were skipped; some images may be missing.',
      });
    if (proxy?.limited)
      result.issues.push({
        code: 'network-budget',
        severity: 'warning',
        message: 'The page downloaded more than the capture budget; late resources were skipped.',
      });
    if (proxy?.blocked.length && !proxy.limited)
      result.issues.push({
        code: 'blocked-network',
        severity: 'warning',
        message: 'One or more network destinations were blocked by public-address policy.',
      });
    try {
      return validateScene(result);
    } catch (error) {
      if (process.env.CAPTURE_DEBUG_FILE)
        await import('node:fs/promises').then((fs) =>
          fs.writeFile(process.env.CAPTURE_DEBUG_FILE!, JSON.stringify(result)),
        );
      throw error;
    }
  };
  try {
    return await Promise.race([
      work(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          void close();
          reject(new Error('Capture timeout'));
        }, 180000);
        o.signal?.addEventListener('abort', () => reject(new Error('Capture aborted')), {
          once: true,
        });
      }),
    ]);
  } finally {
    clearTimeout(timer);
    o.signal?.removeEventListener('abort', abort);
    await close();
    await proxy?.close();
  }
}
