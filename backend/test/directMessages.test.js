import test from 'node:test';
import assert from 'node:assert/strict';
import { canAccessThread, cleanDmText, threadKey } from '../utils/directMessages.js';

test('a thread key is the same whichever way round the two users are given', () => {
  assert.equal(threadKey('abc', 'xyz'), threadKey('xyz', 'abc'));
  assert.notEqual(threadKey('abc', 'xyz'), threadKey('abc', 'qqq'));
});

test('only the two participants can access a thread', () => {
  const thread = { participants: ['u1', 'u2'] };
  assert.equal(canAccessThread(thread, 'u1'), true);
  assert.equal(canAccessThread(thread, 'u2'), true);
  assert.equal(canAccessThread(thread, 'u3'), false);
  assert.equal(canAccessThread(thread, ''), false);
  assert.equal(canAccessThread(null, 'u1'), false);
});

test('cleanDmText trims and accepts a normal message', () => {
  assert.deepEqual(cleanDmText('  hi there  '), { value: 'hi there' });
});

test('cleanDmText rejects empty, non-text, too long and control-character messages', () => {
  assert.ok(cleanDmText('   ').error);
  assert.ok(cleanDmText(42).error);
  assert.ok(cleanDmText('x'.repeat(1001)).error);
  assert.ok(cleanDmText('bad\u0007text').error);
  assert.deepEqual(cleanDmText('x'.repeat(1000)), { value: 'x'.repeat(1000) });
});
