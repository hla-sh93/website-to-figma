import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('the shipped plugin contains no verification hooks or site-specific cases', async () => {
  for (const file of ['dist/code.js', 'dist/ui.html']) {
    const text = await readFile(file, 'utf8');
    for (const marker of ['verifyNativeResult', 'VERIFY_PREVIEW', 'plugin-verification', 'amazon'])
      assert.ok(!text.toLowerCase().includes(marker.toLowerCase()), `${file} contains ${marker}`);
  }
  const diagnostic = await readFile('dist/diagnostic/code.js', 'utf8');
  assert.ok(diagnostic.includes('VERIFY_PREVIEW'));
});

test('the main bundle does not embed a second copy of the UI', async () => {
  const code = await readFile('dist/code.js', 'utf8');
  assert.ok(!code.includes('<!doctype html') && !code.includes('<html'));
});
