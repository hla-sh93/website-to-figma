import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createLocalService } from '../src/service/app.js';
import { parseCaptureRequest, createJobManager, HttpError } from '../src/service/jobs.js';
import { connectLocalService } from '../src/plugin/connection.js';
import type { ScenePackage } from '../src/core/scene.js';
const scene: ScenePackage = {
  version: 1,
  capture: {
    id: 'x',
    url: 'https://example.com',
    title: 'Test',
    capturedAt: '2026-10-29',
    engine: 'test',
  },
  screens: [
    {
      id: 'desktop',
      viewport: { width: 1440, height: 900, dpr: 1 },
      root: {
        id: 'root',
        kind: 'frame',
        name: 'Page',
        source: { tag: 'body' },
        bounds: { x: 0, y: 0, width: 1440, height: 100 },
        style: { opacity: 1 },
        children: [],
      },
    },
  ],
  assets: [],
  issues: [],
};

test('retained completed and cancelled jobs never exhaust the next sequential capture', async () => {
  const manager = createJobManager(async () => scene);
  const request = parseCaptureRequest({ url: 'https://example.com' });
  try {
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) {
      const job = manager.create(request, 'sequential-' + i);
      ids.push(job.id);
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(manager.get(job.id).state, 'ready');
      assert.equal(manager.create(request, 'sequential-' + i).id, job.id);
      if (i % 2) manager.cancel(job.id);
    }
    assert.throws(
      () => manager.get(ids[0]!),
      (e: unknown) => e instanceof HttpError && e.status === 404,
    );
    assert.ok(manager.get(ids.at(-1)!));
  } finally {
    manager.close();
  }
});

test('six pending captures retain backpressure and are never evicted', async () => {
  const manager = createJobManager(
    async (_request, signal) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(new Error('aborted'))),
      ),
  );
  try {
    const request = parseCaptureRequest({ url: 'https://example.com' });
    const jobs = Array.from({ length: 6 }, () => manager.create(request));
    assert.throws(
      () => manager.create(request),
      (e: unknown) => e instanceof HttpError && e.status === 429,
    );
    assert.ok(jobs.every((job) => manager.get(job.id).state === 'queued'));
  } finally {
    manager.close();
  }
});
test('local API authenticates, rejects foreign origins and validates input before work', async () => {
  const app = await createLocalService({ port: 0, runner: async () => scene });
  try {
    assert.equal((await fetch(app.url + '/health')).status, 401);
    assert.equal(
      (
        await fetch(app.url + '/health', {
          headers: { Authorization: `Bearer ${app.token}`, Origin: 'https://evil.example' },
        })
      ).status,
      403,
    );
    assert.equal((await fetch(app.url + '/', { headers: { Origin: 'null' } })).status, 403);
    const r = await fetch(app.url + '/jobs', {
      method: 'POST',
      headers: { Authorization: `Bearer ${app.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'http://127.0.0.1' }),
    });
    assert.equal(r.status, 400);
    const page = await (await fetch(app.url)).text();
    assert.match(page, /By Hla\.Sh/);
  } finally {
    await app.close();
  }
});
test('Figma localhost endpoint supports authenticated requests without accepting foreign hosts or origins', async () => {
  const app = await createLocalService({ port: 0, runner: async () => scene });
  const localUrl = app.url.replace('127.0.0.1', 'localhost');
  const headers = { Authorization: `Bearer ${app.token}` };
  try {
    assert.equal((await fetch(localUrl + '/health', { headers })).status, 200);
    assert.equal((await fetch(localUrl + '/health')).status, 401);
    assert.equal((await fetch(localUrl + '/', { headers: { Origin: localUrl } })).status, 200);
    assert.equal((await fetch(localUrl + '/', { headers: { Origin: 'null' } })).status, 403);
    assert.equal(
      (
        await fetch(localUrl + '/health', {
          headers: { ...headers, Origin: 'https://evil.example' },
        })
      ).status,
      403,
    );
    const preflight = await fetch(localUrl + '/health', {
      method: 'OPTIONS',
      headers: {
        Origin: 'null',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'Authorization, Content-Type',
      },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), 'null');
    const foreignHost = await new Promise<number | undefined>((resolve, reject) => {
      const req = http.request(
        app.url + '/health',
        { headers: { ...headers, Host: 'localhost.attacker.test:' + new URL(app.url).port } },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.on('error', reject);
      req.end();
    });
    assert.equal(foreignHost, 403);
  } finally {
    await app.close();
  }
});

test('automatic plugin connection requires a private installation credential even for opaque origins', async () => {
  const app = await createLocalService({ port: 0 });
  try {
    const response = await fetch(app.url + '/plugin-session', {
      headers: { 'X-Plugin-Pairing': app.pairingKey },
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).token, app.token);
    assert.equal(await connectLocalService(fetch, app.url, app.pairingKey), app.token);
    assert.equal(
      (
        await fetch(app.url + '/plugin-session', {
          headers: { Origin: 'null', 'X-Plugin-Pairing': app.pairingKey },
        })
      ).status,
      200,
    );
    assert.equal((await fetch(app.url + '/plugin-session')).status, 401);
    for (const origin of ['null', 'https://www.figma.com', 'https://evil.example', app.url]) {
      const response = await fetch(app.url + '/plugin-session', { headers: { Origin: origin } });
      assert.ok([401, 403].includes(response.status));
      assert.ok(!(await response.text()).includes(app.token));
    }
  } finally {
    await app.close();
  }
});

test('website language accepts only source locale choices', () => {
  for (const language of ['ar', 'en'])
    assert.equal(parseCaptureRequest({ url: 'https://example.com', language }).language, language);
  for (const language of ['fr', 'ar-SA', true, null])
    assert.throws(() => parseCaptureRequest({ url: 'https://example.com', language }));
  assert.equal(parseCaptureRequest({ url: 'https://example.com' }).language, undefined);
});
test('local verification evidence requires the private installation credential', async () => {
  const app = await createLocalService({ port: 0 });
  try {
    assert.equal((await fetch(app.url + '/plugin-verification')).status, 401);
    const headers = {
      'X-Plugin-Pairing': app.pairingKey,
      'Content-Type': 'application/json',
      Origin: 'null',
    };
    assert.equal(
      (
        await fetch(app.url + '/plugin-verification', {
          method: 'POST',
          headers,
          body: JSON.stringify({ stage: 'native-import-complete', data: { screens: 3 } }),
        })
      ).status,
      200,
    );
    const response = await fetch(app.url + '/plugin-verification', { headers });
    const evidence = await response.json();
    assert.equal(evidence.events.length, 1);
    assert.deepEqual(evidence.events[0].data, { screens: 3 });
    assert.ok(!JSON.stringify(evidence).includes(app.pairingKey));
    assert.equal(
      (
        await fetch(app.url + '/plugin-verification', {
          method: 'POST',
          headers,
          body: JSON.stringify({ stage: '<invalid>' }),
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await fetch(app.url + '/plugin-verification', {
          headers: { ...headers, Origin: 'https://evil.example' },
        })
      ).status,
      403,
    );
  } finally {
    await app.close();
  }
});

test('job retry is idempotent, returns validated scene, and detects key conflicts', async () => {
  let runs = 0;
  const app = await createLocalService({
    port: 0,
    runner: async () => {
      runs++;
      return structuredClone(scene);
    },
  });
  const headers = {
    Authorization: `Bearer ${app.token}`,
    'Content-Type': 'application/json',
    'Idempotency-Key': 'same-key',
  };
  try {
    const create = () =>
      fetch(app.url + '/jobs', {
        method: 'POST',
        headers,
        body: JSON.stringify({ url: 'https://example.com', widths: [1440] }),
      });
    const first = (await (await create()).json()) as { id: string };
    const second = (await (await create()).json()) as { id: string };
    assert.equal(first.id, second.id);
    for (let i = 0; i < 20; i++) {
      const status = (await (await fetch(app.url + '/jobs/' + first.id, { headers })).json()) as {
        state: string;
      };
      if (status.state === 'ready') break;
      await new Promise((r) => setTimeout(r, 10));
    }
    const result = await fetch(app.url + '/jobs/' + first.id + '/scene', { headers });
    assert.equal(result.status, 200);
    assert.equal(runs, 1);
    assert.equal(
      (
        await fetch(app.url + '/jobs', {
          method: 'POST',
          headers,
          body: JSON.stringify({ url: 'https://example.org' }),
        })
      ).status,
      409,
    );
  } finally {
    await app.close();
  }
});
test('cancellation propagates to a running capture and never publishes its late result', async () => {
  let cancel: () => void = () => {};
  const aborted = new Promise<void>((r) => (cancel = r));
  const app = await createLocalService({
    port: 0,
    runner: async (_request, signal) => {
      await new Promise<void>((resolve) =>
        signal.addEventListener(
          'abort',
          () => {
            cancel();
            resolve();
          },
          { once: true },
        ),
      );
      return scene;
    },
  });
  const headers = { Authorization: `Bearer ${app.token}`, 'Content-Type': 'application/json' };
  try {
    const job = (await (
      await fetch(app.url + '/jobs', {
        method: 'POST',
        headers,
        body: JSON.stringify({ demo: true }),
      })
    ).json()) as { id: string };
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(
      (await fetch(app.url + '/jobs/' + job.id, { method: 'DELETE', headers })).status,
      200,
    );
    await aborted;
    const result = (await (await fetch(app.url + '/jobs/' + job.id, { headers })).json()) as {
      state: string;
    };
    assert.equal(result.state, 'cancelled');
    assert.equal((await fetch(app.url + '/jobs/' + job.id + '/scene', { headers })).status, 409);
  } finally {
    await app.close();
  }
});
