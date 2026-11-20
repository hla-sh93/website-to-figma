import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequestKey } from '../src/plugin/request-key.js';

test('capture keys remain distinct and API-compatible without randomUUID', () => {
  const source = { getRandomValues: (bytes: Uint8Array<ArrayBuffer>) => bytes.fill(0) };
  const keys = Array.from({ length: 100 }, () => createRequestKey(source));
  assert.equal(new Set(keys).size, 100);
  assert.ok(keys.every((key) => /^[A-Za-z0-9_-]{1,80}$/.test(key)));
});

test('capture key generation continues when random byte APIs are missing or restricted', () => {
  const sources = [
    {},
    {
      getRandomValues: () => {
        throw new Error('Unavailable in this host');
      },
    },
  ];
  const keys = sources.flatMap((source) =>
    Array.from({ length: 20 }, () => createRequestKey(source)),
  );
  assert.equal(new Set(keys).size, 40);
  assert.ok(keys.every((key) => /^[A-Za-z0-9_-]{1,80}$/.test(key)));
});
