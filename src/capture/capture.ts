import { chromium, type Browser, type BrowserContext } from 'playwright';
import { existsSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { validateScene, type ScenePackage, type SceneNode } from '../core/scene.js';
import { assertPublicUrl } from '../service/network-policy.js';
import { startEgressProxy } from '../service/egress-proxy.js';
import sharp from 'sharp';
import { collect } from './collector.js';
import { inspectFonts } from './fonts.js';
import { captureGate, pageFingerprint } from './page-state.js';
import { parseObjectPosition, backgroundSize, computeImagePlacement } from '../core/image.js';
export type CaptureOptions = {
  widths?: number[];
  height?: number;
  theme?: 'light' | 'dark';
  language?: 'ar' | 'en';
  signal?: AbortSignal;
  onProgress?: (stage: string) => void;
  selector?: string;
};
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
  const close = async () => {
    stop = true;
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
      proxy = await startEgressProxy({ maxBytes: 24 * 1024 * 1024 });
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
    await context.route('**/*', (route) => {
      const url = route.request().url();
      return (input.html !== undefined && !url.startsWith('data:')) || !/^(https?:|data:)/.test(url)
        ? route.abort()
        : route.continue();
    });
    await context.routeWebSocket('**/*', (socket) => socket.close());
    context.on('page', (p) => {
      if (context!.pages().length > 1) void p.close();
    });
    // tsx preserves function names with a helper when serializing the collector.
    await context.addInitScript('globalThis.__name = (value) => value');
    const page = await context.newPage();
    page.setDefaultTimeout(7000);
    page.on('download', (d) => void d.cancel());
    const bodies = new Map<string, { mime: string; body: Buffer }>();
    let bytes = 0,
      requests = 0;
    page.on('response', async (response) => {
      if (!response.headers()['content-type']?.startsWith('image/')) return;
      try {
        const body = await response.body();
        bytes += body.length;
        if (bytes > 12 * 1024 * 1024) {
          void close();
          return;
        }
        bodies.set(response.url(), {
          mime: response.headers()['content-type']!.split(';')[0]!,
          body,
        });
      } catch {}
    });
    page.on('request', () => {
      if (++requests > 1000) void close();
    });
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
    for (const width of widths) {
      o.onProgress?.(`capture-${width}`);
      await page.setViewportSize({ width, height });
      if (input.html !== undefined)
        await page.setContent(input.html, { waitUntil: 'domcontentloaded', timeout: 12000 });
      else {
        const response = await page.goto(input.url!, {
          waitUntil: 'domcontentloaded',
          timeout: 20000,
        });
        if (response && response.status() >= 400)
          throw new Error(
            `[HTTP_STATUS] Website returned HTTP ${response.status()}; the requested page was not captured.`,
          );
      }
      await page.addStyleTag({
        content:
          '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}',
      });
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
      const assetCount = result.assets.length,
        issueCount = result.issues.length;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (await page.evaluate(captureGate))
          throw new Error(
            '[PAGE_BLOCKED] الموقع عرض صفحة تحقق أو حاجز وصول بدلاً من الصفحة المطلوبة. يلزم التقاط الصفحة من المتصفح بعد فتحها.',
          );
        await page.evaluate(async () => {
          await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 3000))]);
          for (let y = 0; y < Math.min(document.documentElement.scrollHeight, 16000); y += 800) {
            scrollTo(0, y);
            await new Promise((r) => setTimeout(r, 100));
          }
          scrollTo(0, 0);
          await Promise.race([
            Promise.all([...document.images].map((i) => i.decode().catch(() => {}))),
            new Promise((r) => setTimeout(r, 2000)),
          ]);
          for (const video of document.querySelectorAll('video')) video.pause();
        });
        // Dismiss only recognized cookie-rejection controls, never general page actions.
        for (const selector of ['#sp-cc-rejectall-link', '#onetrust-reject-all-handler']) {
          const reject = page.locator(selector);
          if (await reject.isVisible().catch(() => false))
            await reject.click({ timeout: 4000 }).catch(() => {
              result.issues.push({
                code: 'consent-dismissal-failed',
                severity: 'warning',
                message: 'The cookie banner could not be dismissed within the bounded wait.',
              });
            });
        }
        let stable = false,
          previous = '',
          unchanged = 0;
        const fingerprint = () => page.evaluate(pageFingerprint);
        for (let i = 0; i < 40; i++) {
          const geometry = await fingerprint();
          if (geometry === previous) {
            if (++unchanged >= 6) {
              stable = true;
              break;
            }
          } else unchanged = 0;
          previous = geometry;
          await page.waitForTimeout(150);
        }
        if (!stable) throw new Error('لم يستقر تصميم الموقع أثناء الالتقاط. حاولي مجدداً.');
        const collectedState = await fingerprint();
        await page.evaluate('globalThis.__name = (value) => value');
        result.capture.title = await page.title();
        const data = await page.evaluate(collect, o.selector);
        const screenId = `viewport-${width}`;
        const nodes = new Map<string, SceneNode>();
        const visit = (n: SceneNode) => {
          nodes.set(n.id, n);
          n.children.forEach(visit);
        };
        visit(data.root);
        await inspectFonts(page, data.textSources, nodes, data.issues);
        for (const issue of data.issues) result.issues.push({ ...issue, screenId });
        for (const s of data.sources) {
          const n = nodes.get(s.nodeId)!;
          if (n.image && s.objectPosition) {
            const position = parseObjectPosition(s.objectPosition);
            if (position) {
              n.image.position = position.position;
              n.image.positionOffset = position.offset;
            } else
              result.issues.push({
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
                    animations: 'disabled',
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
                body: m[2] ? Buffer.from(m[3]!, 'base64') : Buffer.from(decodeURIComponent(m[3]!)),
              };
          }
          if (!asset || asset.body.length > 4 * 1024 * 1024) {
            n.kind = 'frame';
            result.issues.push({
              code: 'missing-asset',
              severity: 'warning',
              message: 'Source image unavailable or exceeds asset budget.',
              screenId,
              nodeId: n.id,
            });
            continue;
          }
          // SVG response images are sanitized using the browser DOM before packaging.
          if (asset.mime === 'image/svg+xml') {
            const sanitized = await page.evaluate((svg) => {
              const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
              doc
                .querySelectorAll('script,foreignObject,style,animate,set,animateTransform')
                .forEach((e) => e.remove());
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
          }
          if (s.kind === 'image' && asset.mime === 'image/svg+xml') {
            try {
              const w = Math.max(1, Math.min(3840, Math.round(s.width || n.bounds.width))),
                h = Math.max(1, Math.min(16000, Math.round(s.height || n.bounds.height)));
              const png = await sharp(asset.body, { limitInputPixels: 16000000 })
                .resize(w, h, { fit: 'inside', withoutEnlargement: true })
                .png()
                .toBuffer({ resolveWithObject: true });
              if (png.data.length > 4 * 1024 * 1024) throw new Error('Image budget');
              asset = { mime: 'image/png', body: png.data };
              s.width = png.info.width;
              s.height = png.info.height;
            } catch {
              n.kind = 'frame';
              result.issues.push({
                code: 'missing-asset',
                severity: 'warning',
                message: 'SVG image could not be safely rasterized within budget.',
                screenId,
                nodeId: n.id,
              });
              continue;
            }
          }
          if (s.kind === 'image' && asset.mime !== 'image/svg+xml') {
            try {
              const decoded = sharp(asset.body, { limitInputPixels: 16000000, pages: 1 });
              const metadata = await decoded.metadata();
              if (!metadata.width || !metadata.height) throw new Error('Missing image dimensions');
              if ((metadata.pages ?? 1) > 1)
                result.issues.push({
                  code: 'static-image-frame',
                  severity: 'warning',
                  message: 'Animated image imported as its first frame.',
                  screenId,
                  nodeId: n.id,
                });
              const normalized = await decoded.rotate().png().toBuffer({ resolveWithObject: true });
              if (normalized.data.length > 4 * 1024 * 1024) throw new Error('Decoded image budget');
              asset = { mime: 'image/png', body: normalized.data };
              s.width = normalized.info.width;
              s.height = normalized.info.height;
            } catch {
              n.kind = 'frame';
              result.issues.push({
                code: 'missing-asset',
                severity: 'warning',
                message: 'Image could not be decoded within the pixel and byte limits.',
                screenId,
                nodeId: n.id,
              });
              continue;
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
              result.issues.push({
                code: 'background-unsupported',
                severity: 'warning',
                message: 'Repeated tiles or unsupported CSS background sizing require review.',
                screenId,
                nodeId: n.id,
              });
              continue;
            }
          }
          const id = s.kind + '-' + createHash('sha256').update(asset.body).digest('hex');
          n.assetId = id;
          if (!result.assets.some((a) => a.id === id))
            result.assets.push({
              id,
              kind: s.kind,
              mimeType: asset.mime,
              data: asset.body.toString('base64'),
              width: s.width,
              height: s.height,
              ...(s.url.startsWith('http') ? { sourceUrl: s.url } : {}),
            });
        }
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
        const screenshot = await page.screenshot({
          clip,
          fullPage: true,
          animations: 'disabled',
          timeout: 10000,
        });
        if ((await fingerprint()) !== collectedState) {
          result.assets.length = assetCount;
          result.issues.length = issueCount;
          if (attempt < 2) continue;
          throw new Error(
            'تغيّر محتوى الموقع أثناء الالتقاط. حاولي مجدداً بعد اكتمال تحميل الصفحة.',
          );
        }
        result.screens.push({
          id: screenId,
          viewport: { width, height, dpr: 1 },
          root,
          screenshot: screenshot.toString('base64'),
        });
        if (fullHeight > 16000)
          result.issues.push({
            code: 'height-truncated',
            severity: 'warning',
            message: 'Capture truncated at 16000 source pixels.',
            screenId,
          });
        result.issues.push({
          code: 'measurement-limitations',
          severity: 'info',
          message:
            'Animations frozen at capture; typography baselines, collapsed margins, intrinsic sizing and browser-specific shaping remain measured approximations. CSS font stacks do not identify every glyph fallback font.',
          screenId,
        });
        break;
      }
    }
    if (proxy?.blocked.length)
      result.issues.push({
        code: 'blocked-network',
        severity: 'warning',
        message: 'One or more network destinations were blocked by public-address policy.',
      });
    return validateScene(result);
  };
  try {
    return await Promise.race([
      work(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          void close();
          reject(new Error('Capture timeout'));
        }, 85000);
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
