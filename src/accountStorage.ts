type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const OWNER_KEY = 'orihani:legacy-draft-owner';

// Run once at restored-auth initialization, before rendering any patient data.
// Unattributed logged-out drafts are retained, never handed to the next person who signs in.
export function initializeDraftOwner(store: Store, restoredUid: string | null) {
  if (store.getItem(OWNER_KEY) === null) store.setItem(OWNER_KEY, restoredUid || 'unclaimed');
}
export function scopedStorage(store: Store, uid: string | null) {
  const keyFor = (key: string) => `orihani:user:${uid}:${key}`;
  return {
    getItem(key: string): string | null {
      if (!uid) return null;
      const value = store.getItem(keyFor(key));
      if (value !== null) return value;
      if (store.getItem(OWNER_KEY) !== uid) return null;
      const legacy = store.getItem(key);
      if (legacy !== null) { store.setItem(keyFor(key), legacy); store.removeItem(key); }
      return legacy;
    },
    setItem(key: string, value: string) { if (uid) store.setItem(keyFor(key), value); },
    removeItem(key: string) { if (uid) store.removeItem(keyFor(key)); },
  };
}

type BrowserStore = Store & Pick<Storage, 'length' | 'key'>;
const SHEET_TOKEN = 'googleAccessToken';

function clearSavedTokens(storage: BrowserStore, keep: string | null = null) {
  for (let i = storage.length - 1; i >= 0; i--) {
    const key = storage.key(i);
    if (key && key !== keep && (key === SHEET_TOKEN || /^orihani:user:.*:googleAccessToken$/.test(key))) {
      storage.removeItem(key);
    }
  }
}

// Older builds stored this credential alongside patient drafts. Only carry an attributed
// token into its owner's current tab; leave patient drafts and Firebase sign-in untouched.
export function restoreSheetToken(disk: BrowserStore, tab: BrowserStore, uid: string | null): string | null {
  const key = uid ? `orihani:user:${uid}:${SHEET_TOKEN}` : null;
  try {
    clearSavedTokens(tab, key);
    if (!key) return null;
    const token = tab.getItem(key) ?? disk.getItem(key) ??
      (disk.getItem(OWNER_KEY) === uid ? disk.getItem(SHEET_TOKEN) : null);
    if (token) tab.setItem(key, token);
    return token;
  } finally {
    clearSavedTokens(disk);
  }
}
