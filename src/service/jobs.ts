import { createHash, randomUUID } from 'node:crypto';
import { setInterval, clearInterval } from 'node:timers';
import { validateScene, type ScenePackage } from '../core/scene.js';
import { validateTarget } from './network-policy.js';
export type CaptureRequest = {
  url?: string;
  demo?: boolean;
  widths: number[];
  height: number;
  theme: 'light' | 'dark';
  language?: 'ar' | 'en';
  selector?: string;
};
export type CaptureRunner = (
  request: CaptureRequest,
  signal: AbortSignal,
  progress: (stage: string) => void,
) => Promise<ScenePackage>;
export type Job = {
  id: string;
  state: 'queued' | 'capturing' | 'ready' | 'failed' | 'cancelled';
  stage: string;
  createdAt: number;
  request: CaptureRequest;
  controller: AbortController;
  scene?: ScenePackage;
  error?: string;
  fingerprint: string;
};
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function parseCaptureRequest(input: unknown): CaptureRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new HttpError(400, 'Capture settings must be an object.');
  const data = input as Record<string, unknown>;
  if (
    Object.keys(data).some(
      (k) => !['url', 'demo', 'widths', 'height', 'theme', 'selector', 'language'].includes(k),
    )
  )
    throw new HttpError(400, 'Unknown capture setting.');
  if (data.demo !== undefined && data.demo !== true)
    throw new HttpError(400, 'Demo must be true when provided.');
  if ((data.demo === true) === 'url' in data)
    throw new HttpError(400, 'Choose one website URL or the owned demo.');
  if ('url' in data) {
    if (typeof data.url !== 'string') throw new HttpError(400, 'URL must be text.');
    try {
      validateTarget(data.url);
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
  }
  const widths = data.widths ?? [1440, 390],
    height = data.height ?? 900,
    theme = data.theme ?? 'light';
  if (
    !Array.isArray(widths) ||
    widths.length < 1 ||
    widths.length > 5 ||
    new Set(widths).size !== widths.length ||
    widths.some((w) => !Number.isInteger(w) || w < 320 || w > 3840)
  )
    throw new HttpError(400, 'Choose 1–5 unique widths between 320 and 3840.');
  if (typeof height !== 'number' || !Number.isInteger(height) || height < 200 || height > 2160)
    throw new HttpError(400, 'Height must be between 200 and 2160.');
  if (theme !== 'light' && theme !== 'dark')
    throw new HttpError(400, 'Theme must be light or dark.');
  if (data.language !== undefined && data.language !== 'ar' && data.language !== 'en')
    throw new HttpError(400, 'Choose Arabic or English website language.');
  if (
    data.selector !== undefined &&
    (typeof data.selector !== 'string' || !data.selector.trim() || data.selector.length > 500)
  )
    throw new HttpError(400, 'Section selector must be 1–500 characters.');
  return {
    ...(typeof data.url === 'string' ? { url: data.url } : { demo: true }),
    widths,
    height,
    theme,
    ...(data.language ? { language: data.language as 'ar' | 'en' } : {}),
    ...(typeof data.selector === 'string' ? { selector: data.selector } : {}),
  };
}
export function createJobManager(runner: CaptureRunner) {
  const jobs = new Map<string, Job>();
  const keys = new Map<string, string>();
  let active = false,
    closed = false;
  const pump = async () => {
    if (active || closed) return;
    const job = [...jobs.values()].find((j) => j.state === 'queued');
    if (!job) return;
    active = true;
    job.state = 'capturing';
    job.stage = 'Loading page';
    try {
      const scene = await runner(job.request, job.controller.signal, (stage) => {
        if (job.state === 'capturing') job.stage = stage;
      });
      if (!job.controller.signal.aborted) {
        job.scene = validateScene(scene);
        job.state = 'ready';
        job.stage = 'Ready to import';
      }
    } catch (error) {
      if (!job.controller.signal.aborted) {
        job.state = 'failed';
        job.error = error instanceof Error ? error.message.slice(0, 800) : 'Capture failed.';
        job.stage = 'Capture failed';
      }
    } finally {
      active = false;
      queueMicrotask(() => void pump());
    }
  };
  const cancel = (job: Job) => {
    job.state = 'cancelled';
    job.stage = 'Cancelled';
    delete job.scene;
    job.controller.abort();
  };
  const forget = (id: string) => {
    jobs.delete(id);
    for (const [key, value] of keys) if (value === id) keys.delete(key);
  };
  const expire = () => {
    const cutoff = Date.now() - 30 * 60 * 1000;
    for (const [id, job] of jobs)
      if (job.createdAt < cutoff) {
        cancel(job);
        forget(id);
      }
  };
  const timer = setInterval(expire, 60000);
  return {
    create(request: CaptureRequest, key?: string) {
      expire();
      if (closed) throw new HttpError(503, 'Capture service is closing.');
      const fingerprint = createHash('sha256').update(JSON.stringify(request)).digest('hex');
      if (key) {
        if (!/^[a-zA-Z0-9_-]{1,80}$/.test(key)) throw new HttpError(400, 'Invalid retry key.');
        const id = keys.get(key);
        if (id) {
          const job = jobs.get(id)!;
          if (job.fingerprint !== fingerprint)
            throw new HttpError(409, 'Retry key already belongs to different capture settings.');
          return job;
        }
      }
      if (jobs.size >= 6) {
        const oldestFinished = [...jobs.values()].find(
          (job) => job.state !== 'queued' && job.state !== 'capturing',
        );
        if (oldestFinished) forget(oldestFinished.id);
      }
      if (jobs.size >= 6)
        throw new HttpError(
          429,
          'Six captures are pending. Cancel a capture or wait for one to finish.',
        );
      const job: Job = {
        id: randomUUID(),
        state: 'queued',
        stage: 'Queued',
        createdAt: Date.now(),
        request,
        controller: new AbortController(),
        fingerprint,
      };
      jobs.set(job.id, job);
      if (key) keys.set(key, job.id);
      queueMicrotask(() => void pump());
      return job;
    },
    get(id: string) {
      expire();
      const job = jobs.get(id);
      if (!job) throw new HttpError(404, 'Capture not found or expired.');
      return job;
    },
    cancel(id: string) {
      const job = this.get(id);
      cancel(job);
      return job;
    },
    remove(id: string) {
      const job = this.get(id);
      cancel(job);
      forget(id);
    },
    close() {
      closed = true;
      clearInterval(timer);
      for (const job of jobs.values()) cancel(job);
      jobs.clear();
      keys.clear();
    },
  };
}
