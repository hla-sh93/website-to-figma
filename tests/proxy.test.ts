import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startEgressProxy } from '../src/service/egress-proxy.js';

async function requestStatus(
  proxy: { url: string; username: string; password: string },
  target: string,
  auth = true,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      proxy.url,
      {
        method: 'GET',
        path: target,
        headers: auth
          ? {
              'Proxy-Authorization': `Basic ${Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64')}`,
            }
          : {},
      },
      (res) => {
        res.resume();
        resolve(res.statusCode!);
      },
    );
    req.on('error', reject);
    req.end();
  });
}

test('proxy requires per-capture authentication and denies literal private targets', async () => {
  const proxy = await startEgressProxy();
  try {
    assert.equal(await requestStatus(proxy, 'http://example.com', false), 407);
    assert.equal(await requestStatus(proxy, 'http://127.0.0.1'), 403);
    assert.ok(proxy.blocked.length > 0);
  } finally {
    await proxy.close();
  }
});

test('proxy blocks DNS-rebound destinations before opening a socket', async () => {
  const proxy = await startEgressProxy({
    resolver: async () => [{ address: '127.0.0.1', family: 4 }],
  });
  try {
    assert.equal(await requestStatus(proxy, 'http://rebound.example'), 403);
  } finally {
    await proxy.close();
  }
});

test('proxy denies HTTPS tunnel to metadata address', async () => {
  const proxy = await startEgressProxy();
  try {
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(proxy.url, {
        method: 'CONNECT',
        path: '169.254.169.254:443',
        headers: {
          'Proxy-Authorization': `Basic ${Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64')}`,
        },
      });
      req.on('connect', (res, socket) => {
        socket.destroy();
        resolve(res.statusCode!);
      });
      req.on('error', reject);
      req.end();
    });
    assert.equal(status, 403);
  } finally {
    await proxy.close();
  }
});
