import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initializeDraftOwner, scopedStorage } from '../src/accountStorage.ts';
function memory() { const data = new Map<string,string>(); return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string,v: string) => { data.set(k,v); }, removeItem: (k: string) => { data.delete(k); } }; }
test('restored drafts migrate without changing contents; switching accounts cannot read them', () => {
  const store = memory(); store.setItem('patientData', '{"existing":"원래 내용"}');
  initializeDraftOwner(store, 'alice');
  const alice = scopedStorage(store, 'alice'), bob = scopedStorage(store, 'bob');
  assert.equal(bob.getItem('patientData'), null);
  assert.equal(alice.getItem('patientData'), '{"existing":"원래 내용"}');
  assert.equal(store.getItem('patientData'), null);
  bob.setItem('patientData', 'bob draft'); assert.equal(alice.getItem('patientData'), '{"existing":"원래 내용"}');
  assert.equal(bob.getItem('patientData'), 'bob draft'); assert.equal(scopedStorage(store, null).getItem('patientData'), null);
  initializeDraftOwner(store, 'bob'); assert.equal(alice.getItem('patientData'), '{"existing":"원래 내용"}');
});
test('logged-out legacy data is retained and is never claimed by the next login', () => {
  const store = memory();store.setItem('patientData', 'legacy backup');initializeDraftOwner(store, null);initializeDraftOwner(store, 'next');
  assert.equal(scopedStorage(store, 'next').getItem('patientData'), null);assert.equal(store.getItem('patientData'), 'legacy backup');
});
