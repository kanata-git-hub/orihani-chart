import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getRecipeDoseBand } from '../src/recipeDoseBands.ts';

test('each upper boundary is inclusive and the next displayed microgram moves to the next band', () => {
  const boundaries = [
    [15, '15g 이하', '15g 초과 · 30g 이하'],
    [30, '15g 초과 · 30g 이하', '30g 초과 · 45g 이하'],
    [45, '30g 초과 · 45g 이하', '45g 초과 · 60g 이하'],
    [60, '45g 초과 · 60g 이하', '60g 초과 · 75g 이하'],
    [75, '60g 초과 · 75g 이하', '75g 초과 · 90g 이하'],
    [90, '75g 초과 · 90g 이하', '90g 초과 · 120g 이하'],
    [120, '90g 초과 · 120g 이하', '120g 초과 · 150g 이하'],
    [150, '120g 초과 · 150g 이하', '150g 초과'],
  ] as const;
  for (const [amount, inclusiveLabel, nextLabel] of boundaries) {
    assert.equal(getRecipeDoseBand(amount - 0.000001).label, inclusiveLabel);
    assert.equal(getRecipeDoseBand(amount).label, inclusiveLabel);
    assert.equal(getRecipeDoseBand(amount + 0.0000005).label, nextLabel);
    assert.equal(getRecipeDoseBand(amount + 0.000001).label, nextLabel);
  }
  assert.equal(getRecipeDoseBand(0.000001).label, '15g 이하');
  assert.equal(getRecipeDoseBand(1000).label, '150g 초과');
});

test('floating noise and sub-display precision cannot change the visible dose band', () => {
  assert.equal(getRecipeDoseBand(15 + Number.EPSILON * 15).label, '15g 이하');
  assert.equal(getRecipeDoseBand(30.0000004).label, '15g 초과 · 30g 이하');
  assert.equal(getRecipeDoseBand(30.0000006).label, '30g 초과 · 45g 이하');
  assert.equal(getRecipeDoseBand(150.00000001).label, '120g 초과 · 150g 이하');
});

test('course quantities use their actual day-scaled grams rather than the daily dose band', () => {
  const dailyGrams = 5;
  assert.deepEqual([1, 7, 15, 30].map(days => getRecipeDoseBand(dailyGrams * days).label), [
    '15g 이하',
    '30g 초과 · 45g 이하',
    '60g 초과 · 75g 이하',
    '120g 초과 · 150g 이하',
  ]);
});
