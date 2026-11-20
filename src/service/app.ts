import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { captureHtml, captureUrl } from '../capture/capture.js';
import { analyzeScene, flatten } from '../core/analysis.js';
import { comparePng, compareGeometry, type GeometryRecord } from '../quality/compare.js';
import {
  createJobManager,
  parseCaptureRequest,
  HttpError,
  type CaptureRunner,
  type Job,
} from './jobs.js';
import { dashboard } from './dashboard.js';
const { version } = JSON.parse(
  await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
) as { version: string };

const defaultRunner: CaptureRunner = async (request, signal, onProgress) => {
  const options = {
    widths: request.widths,
    height: request.height,
    theme: request.theme,
    language: request.language,
    signal,
    onProgress,
    selector: request.selector,
  };
  return request.demo
    ? captureHtml(
        await readFile(new URL('../../fixtures/reference.html', import.meta.url), 'utf8'),
        options,
      )
    : captureUrl(request.url!, options);
};
const summary = (job: Job) => ({
  id: job.id,
  state: job.state,
  stage: job.stage,
  createdAt: job.createdAt,
  error: job.error,
  ...(job.scene ? { analysis: analyzeScene(job.scene) } : {}),
});
async function body(req: http.IncomingMessage, max = 12 * 1024 * 1024): Promise<unknown> {
  let length = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > max) throw new HttpError(413, 'Request body exceeds limit.');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Invalid JSON request.');
  }
}

export async function createLocalService(
  options: { port?: number; runner?: CaptureRunner; pairingKey?: string } = {},
) {
  const token = randomBytes(24).toString('hex');
  const pairingKey = options.pairingKey ?? randomBytes(24).toString('hex');
  const jobs = createJobManager(options.runner ?? defaultRunner);
  const verification: { at: string; stage: string; data: unknown }[] = [];
  let origin = '';
  const server = http.createServer(async (req, res) => {
    const send = (status: number, data: unknown) => {
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify(data));
    };
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    try {
      // Figma's manifest validator accepts localhost for development access.
      // Keep both exact loopback authorities; arbitrary Host values stay denied.
      const serviceOrigins = [origin, origin.replace('127.0.0.1', 'localhost')];
      const requestServiceOrigin = serviceOrigins.find(
        (value) => new URL(value).host === req.headers.host,
      );
      if (!requestServiceOrigin) throw new HttpError(403, 'Invalid local service host.');
      const requestOrigin = req.headers.origin;
      if (
        requestOrigin &&
        !['null', 'https://www.figma.com', 'https://figma.com', ...serviceOrigins].includes(
          requestOrigin,
        )
      )
        throw new HttpError(403, 'Origin is not allowed.');
      if (requestOrigin) {
        res.setHeader('Access-Control-Allow-Origin', requestOrigin);
        res.setHeader('Vary', 'Origin');
      }
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
        res.setHeader(
          'Access-Control-Allow-Headers',
          'Authorization, Content-Type, Idempotency-Key, X-Plugin-Pairing',
        );
        res.writeHead(204);
        res.end();
        return;
      }
      const url = new URL(req.url ?? '/', origin);
      // Native Figma fetch may carry an opaque origin. Only the personalized
      // installation can obtain a session; an origin alone is not a credential.
      if (url.pathname === '/plugin-session' || url.pathname === '/plugin-verification') {
        const supplied = Buffer.from(String(req.headers['x-plugin-pairing'] ?? '')),
          expected = Buffer.from(pairingKey);
        if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
          throw new HttpError(401, 'Plugin connection is not paired.');
        if (url.pathname === '/plugin-verification') {
          if (req.method === 'GET') {
            send(200, { events: verification });
            return;
          }
          if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed.');
          const event = (await body(req, 8 * 1024 * 1024)) as { stage?: unknown; data?: unknown };
          if (!event || typeof event.stage !== 'string' || !/^[a-z-]{1,60}$/.test(event.stage))
            throw new HttpError(400, 'Invalid verification event.');
          verification.push({
            at: new Date().toISOString(),
            stage: event.stage,
            data: event.data ?? null,
          });
          while (
            verification.length > 100 ||
            JSON.stringify(verification).length > 16 * 1024 * 1024
          )
            verification.shift();
          send(200, { recorded: true });
          return;
        }
        if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed.');
        send(200, { token });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/') {
        if (requestOrigin && requestOrigin !== requestServiceOrigin)
          throw new HttpError(403, 'Open the local dashboard directly to view the session code.');
        res.setHeader(
          'Content-Security-Policy',
          "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        );
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        res.end(dashboard(token));
        return;
      }
      const authorization = Buffer.from(req.headers.authorization ?? '');
      const expected = Buffer.from(`Bearer ${token}`);
      if (authorization.length !== expected.length || !timingSafeEqual(authorization, expected))
        throw new HttpError(401, 'Enter the current session code from the local service.');
      if (url.pathname === '/health' && req.method === 'GET') {
        send(200, { status: 'ready', version, author: 'Hla.Sh' });
        return;
      }
      if (url.pathname === '/jobs' && req.method === 'POST') {
        const request = parseCaptureRequest(await body(req, 8192));
        const key = req.headers['idempotency-key'];
        if (Array.isArray(key)) throw new HttpError(400, 'Invalid retry key.');
        send(202, summary(jobs.create(request, key)));
        return;
      }
      const match = url.pathname.match(/^\/jobs\/([a-f0-9-]{36})(?:\/(scene|compare|remove))?$/);
      if (!match) throw new HttpError(404, 'Endpoint not found.');
      const job = jobs.get(match[1]!);
      if (req.method === 'DELETE') {
        if (match[2] === 'remove') {
          jobs.remove(job.id);
          send(200, { removed: true });
        } else send(200, summary(jobs.cancel(job.id)));
        return;
      }
      if (req.method === 'GET' && !match[2]) {
        send(200, summary(job));
        return;
      }
      if (!job.scene || job.state !== 'ready') throw new HttpError(409, 'Capture is not ready.');
      if (req.method === 'GET' && match[2] === 'scene') {
        send(200, job.scene);
        return;
      }
      if (req.method === 'POST' && match[2] === 'compare') {
        const data = (await body(req)) as { screenId?: unknown; png?: unknown; geometry?: unknown };
        if (
          !data ||
          typeof data.screenId !== 'string' ||
          typeof data.png !== 'string' ||
          data.png.length > 10 * 1024 * 1024 ||
          !/^[A-Za-z0-9+/]+={0,2}$/.test(data.png) ||
          data.png.length % 4
        )
          throw new HttpError(400, 'Choose a screen and a valid PNG export.');
        const screen = job.scene.screens.find((s) => s.id === data.screenId);
        if (!screen?.screenshot) throw new HttpError(404, 'Source screen was not found.');
        const comparison = await comparePng(
          Buffer.from(screen.screenshot, 'base64'),
          Buffer.from(data.png, 'base64'),
        );
        let geometry;
        if (data.geometry !== undefined) {
          if (!Array.isArray(data.geometry) || data.geometry.length > 12000)
            throw new HttpError(400, 'Invalid geometry report.');
          for (const n of data.geometry) {
            if (
              !n ||
              typeof n.sourceId !== 'string' ||
              !n.bounds ||
              !['x', 'y', 'width', 'height'].every((k) => Number.isFinite(n.bounds[k])) ||
              (n.text !== undefined && typeof n.text !== 'string')
            )
              throw new HttpError(400, 'Invalid geometry entry.');
          }
          geometry = compareGeometry(
            flatten(screen.root).map((n) => ({
              sourceId: n.id,
              bounds: n.bounds,
              ...(n.text ? { text: n.text.characters } : {}),
            })),
            data.geometry as GeometryRecord[],
          );
        }
        send(200, {
          visual: {
            ...comparison,
            diff: comparison.diff.toString('base64'),
            overlay: comparison.overlay.toString('base64'),
          },
          geometry,
        });
        return;
      }
      throw new HttpError(404, 'Endpoint not found.');
    } catch (error) {
      if (!res.headersSent)
        send(error instanceof HttpError ? error.status : 500, {
          error: error instanceof Error ? error.message.slice(0, 800) : 'Request failed.',
        });
      else res.end();
    }
  });
  server.requestTimeout = 100000;
  server.headersTimeout = 10000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 4017, '127.0.0.1', resolve);
  });
  const address = server.address() as { port: number };
  origin = `http://127.0.0.1:${address.port}`;
  return {
    url: origin,
    token,
    pairingKey,
    close: async () => {
      jobs.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
