import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertPublicUrl, isPublicAddress, validateTarget } from '../src/service/network-policy.js';

test('blocks private, mapped, reserved, and metadata addresses', () => {
  for (const ip of [
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '192.168.2.1',
    '169.254.169.254',
    '0.0.0.0',
    '100.64.0.1',
    '192.0.2.1',
    '224.1.1.1',
    '::1',
    '::',
    'fc00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '2001:db8::1',
  ]) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
  assert.equal(isPublicAddress('1.1.1.1'), true);
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
});

test('rejects unsafe schemes, embedded credentials, and non-web ports', async () => {
  for (const value of [
    'file:///etc/passwd',
    'javascript:alert(1)',
    'http://user:password@example.com',
    'http://localhost',
    'http://2130706433',
    'https://example.com:22',
  ]) {
    assert.throws(() => validateTarget(value), Error, value);
  }
});

test('rejects hostname if any DNS result is private', async () => {
  await assert.rejects(
    assertPublicUrl('https://example.com', async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]),
    /public|private/i,
  );
});

test('accepts public HTTPS with all public DNS results', async () => {
  const result = await assertPublicUrl('https://example.com/a', async () => [
    { address: '93.184.216.34', family: 4 },
  ]);
  assert.equal(result.hostname, 'example.com');
});

test('revalidates each request and rejects unresolved names', async () => {
  await assert.rejects(
    assertPublicUrl('https://example.com', async () => []),
    /resolve|address/i,
  );
  assert.throws(() => validateTarget('https://foo.local/'), /local|public/i);
});
