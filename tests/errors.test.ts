import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errorMessage } from '../src/plugin/errors.js';
test('native string and cross-realm failures retain their useful message', () => {
  assert.equal(errorMessage('Invalid native value'), 'Invalid native value');
  assert.equal(errorMessage({ message: 'Unsupported font' }), 'Unsupported font');
  assert.equal(errorMessage(new Error('Native API failure')), 'Native API failure');
  assert.equal(errorMessage(null), 'Operation failed.');
});
