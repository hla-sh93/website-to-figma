import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arabicError, technicalDetail } from '../src/plugin/messages.js';
import { alternateAddress } from '../src/capture/capture.js';

const arabicOnly = (text: string) =>
  /[\u0600-\u06FF]/.test(text) && !/[A-Za-z]{3,}/.test(text.replace(/www|https?|Figma/g, ''));

test('technical failures are shown as Arabic sentences', () => {
  const raw =
    'page.goto: net::ERR_EMPTY_RESPONSE at https://example.com/ Call log: \u001b[2m - navigating to "https://example.com/", waiting until "domcontentloaded"\u001b[22m';
  assert.match(arabicError(raw), /لا يستجيب/);
  for (const message of [
    raw,
    'page.goto: net::ERR_NAME_NOT_RESOLVED at https://nope.example/',
    'page.goto: Timeout 35000ms exceeded.',
    'net::ERR_CERT_DATE_INVALID',
    'The website did not reveal visible content before capture.',
    'Website resolved to a private or non-public address.',
    'Enter a complete HTTP or HTTPS website URL.',
    'Unable to establish connection to Figma after 10 seconds. Please check your internet connection.',
    'Layer import: __variable_1 (capture-root): in createVariable: duplicate variable name',
    'Failed to fetch',
  ])
    assert.ok(arabicOnly(arabicError(message)), `${message} -> ${arabicError(message)}`);
});

test('messages already in Arabic pass through; unknown ones keep a short technical detail', () => {
  assert.equal(
    arabicError('انتهت جلسة الالتقاط. حاولي مجدداً.'),
    'انتهت جلسة الالتقاط. حاولي مجدداً.',
  );
  const unknown = arabicError('Something \u001b[2modd\u001b[22m happened Call log: - a\n - b');
  assert.match(unknown, /^تعذر إكمال النسخ\. \(التفاصيل التقنية: Something odd happened\)$/);
  assert.equal(technicalDetail('a\n  b \u001b[22m'), 'a b');
});

test('the other form of an address: with and without www', () => {
  assert.equal(alternateAddress('https://example.com/ar?x=1'), 'https://www.example.com/ar?x=1');
  assert.equal(alternateAddress('https://www.example.com/'), 'https://example.com/');
  assert.equal(alternateAddress('https://shop.example.co.uk/'), undefined);
  assert.equal(alternateAddress('http://203.0.113.5/'), undefined);
});
