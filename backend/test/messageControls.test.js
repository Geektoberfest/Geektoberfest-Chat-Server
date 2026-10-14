import test from 'node:test';
import assert from 'node:assert/strict';
import { canDeleteMessage, canEditMessage, cleanEditText } from '../utils/messageControls.js';

const mine = { senderId: 'u1', deleted: false };

test('the author can edit and delete their own live message', () => {
  assert.equal(canEditMessage(mine, 'u1'), true);
  assert.equal(canDeleteMessage(mine, 'u1'), true);
});

test('nobody else can edit or delete someone else\'s message', () => {
  assert.equal(canEditMessage(mine, 'u2'), false);
  assert.equal(canDeleteMessage(mine, 'u2'), false);
  assert.equal(canEditMessage(mine, ''), false);
});

test('a deleted message cannot be edited or deleted again', () => {
  const gone = { senderId: 'u1', deleted: true };
  assert.equal(canEditMessage(gone, 'u1'), false);
  assert.equal(canDeleteMessage(gone, 'u1'), false);
});

test('an unknown message is not editable', () => {
  assert.equal(canEditMessage(null, 'u1'), false);
});

test('cleanEditText trims, accepts normal text and enforces the limit', () => {
  assert.deepEqual(cleanEditText('  fixed typo  '), { value: 'fixed typo' });
  assert.ok(cleanEditText('   ').error);
  assert.ok(cleanEditText(42).error);
  assert.ok(cleanEditText('x'.repeat(1001)).error);
  assert.ok(cleanEditText('bad\u0007text').error);
});
