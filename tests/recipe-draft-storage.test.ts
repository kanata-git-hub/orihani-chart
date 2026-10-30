import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearRecipeDraft, emptyRecipeDraft, readRecipeDraft, writeRecipeDraft, RECIPE_DRAFT_KEY } from '../src/recipeDraftStorage.ts';
import type { PrescriptionPatient, RecipeDraft } from '../src/recipeDraftStorage.ts';

function memory() {
  const data = new Map<string, string>();
  return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
}

const patient: PrescriptionPatient = {
  id: 'chart:example', name: '테스트환자', chartNumber: 'example', age: '40', gender: '여', symptoms: '테스트 증상',
  date: '2026-10-30', dateLabel: '결제일', rowNumber: 2, prescription: '테스트처방', formulas: ['테스트처방'], additions: '', removals: '', recordCount: 1,
};
function selectedDraft(): RecipeDraft {
  const draftPatient = structuredClone(patient);
  return { name: '테스트환자', gender: '여', symptoms: '', patients: [draftPatient], hasSearched: true, selectedId: draftPatient.id,
    recipe: { patient: draftPatient, herbs: [{ name: '테스트약재', dailyGrams: 2.5 }], warnings: [], fetchedAt: '2026-10-30T12:00:00.000Z' }, openDays: [15, 30] };
}

test('query, selected recipe and expanded periods survive a fresh storage read without expiry', () => {
  const store = memory(); const draft = selectedDraft();
  assert.equal(writeRecipeDraft(store, 'account-a', draft), true);
  assert.deepEqual(readRecipeDraft(store, 'account-a'), draft);
  // A reload restores the saved lookup; it does not silently recalculate or alter its timestamp.
  assert.equal(readRecipeDraft(store, 'account-a')?.recipe?.fetchedAt, draft.recipe!.fetchedAt);
});

test('accounts and logged-out reads remain isolated', () => {
  const store = memory(); writeRecipeDraft(store, 'account-a', selectedDraft());
  assert.equal(readRecipeDraft(store, 'account-b'), null);
  assert.equal(readRecipeDraft(store, null), null);
  assert.equal(writeRecipeDraft(store, null, selectedDraft()), false);
  writeRecipeDraft(store, 'account-b', { ...emptyRecipeDraft(), name: '다른 검색' });
  assert.equal(readRecipeDraft(store, 'account-a')?.name, '테스트환자');
  assert.equal(readRecipeDraft(store, 'account-b')?.name, '다른 검색');
});

test('clear removes only this account cache and it stays absent until a new user action saves', () => {
  const store = memory(); writeRecipeDraft(store, 'account-a', selectedDraft()); writeRecipeDraft(store, 'account-b', selectedDraft());
  assert.equal(clearRecipeDraft(store, 'account-a'), true);
  assert.equal(readRecipeDraft(store, 'account-a'), null);
  assert.equal(readRecipeDraft(store, 'account-a'), null);
  assert.notEqual(readRecipeDraft(store, 'account-b'), null);
});

test('corrupt, mismatched and incompatible snapshots are ignored rather than rendered', () => {
  const store = memory(); const key = `orihani:user:account-a:${RECIPE_DRAFT_KEY}`;
  for (const raw of ['{', JSON.stringify({ version: 2, draft: selectedDraft() }), JSON.stringify({ version: 1, draft: { ...selectedDraft(), selectedId: 'another-patient' } }), JSON.stringify({ version: 1, draft: { ...selectedDraft(), patients: [{}] } }), JSON.stringify({ version: 1, draft: { ...selectedDraft(), openDays: [999] } }), JSON.stringify({ version: 1, draft: { ...selectedDraft(), recipe: { ...selectedDraft().recipe, herbs: [{ name: '약재', dailyGrams: '2' }] } } })]) {
    store.setItem(key, raw); assert.equal(readRecipeDraft(store, 'account-a'), null);
  }
});

test('only the approved state fields are serialized; credentials and transient errors are excluded', () => {
  const store = memory();
  const draft = Object.assign(selectedDraft(), { accessToken: 'secret-token', busy: 'recipe', error: 'transient-error' });
  Object.assign(draft.patients[0], { accessToken: 'patient-extra-secret' });
  assert.equal(writeRecipeDraft(store, 'account-a', draft), true);
  const raw = [...store.data.values()].join('');
  assert.doesNotMatch(raw, /secret|accessToken|transient-error|busy/);
});

test('blocked or full browser storage fails softly and does not mutate the supplied draft', () => {
  const broken = { getItem: () => { throw Error('blocked'); }, setItem: () => { throw Error('quota'); }, removeItem: () => { throw Error('blocked'); } };
  const draft = selectedDraft(); const before = structuredClone(draft);
  assert.equal(readRecipeDraft(broken, 'account-a'), null);
  assert.equal(writeRecipeDraft(broken, 'account-a', draft), false);
  assert.equal(clearRecipeDraft(broken, 'account-a'), false);
  assert.deepEqual(draft, before);
  assert.equal(readRecipeDraft(null, 'account-a'), null);
});
