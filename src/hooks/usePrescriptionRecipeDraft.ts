import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { clearRecipeDraft, emptyRecipeDraft, readRecipeDraft, writeRecipeDraft } from '../recipeDraftStorage';
import type { RecipeDraft, RecipeDraftStore } from '../recipeDraftStorage';

function browserStore(): RecipeDraftStore | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; }
  catch { return null; }
}

function restore(uid: string | null) {
  const saved = readRecipeDraft(browserStore(), uid);
  return { uid, draft: saved || emptyRecipeDraft(), restored: saved !== null, saveFailed: false };
}

export function usePrescriptionRecipeDraft(uid: string | null) {
  const [state, setState] = useState(() => restore(uid));
  const activeUid = useRef(uid);
  const mounted = useRef(true);
  activeUid.current = uid;

  // A different account must never briefly render, or persist, the previous account's patient.
  // Conditional state adjustment during render is confined to this hook's own component.
  let visibleState = state;
  if (state.uid !== uid) {
    visibleState = restore(uid);
    setState(visibleState);
  }
  const current = useRef(visibleState);
  current.current = visibleState;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const setDraft: Dispatch<SetStateAction<RecipeDraft>> = useCallback(update => {
    if (!mounted.current || activeUid.current !== uid || current.current.uid !== uid) return;
    const previous = current.current;
    const draft = typeof update === 'function' ? update(previous.draft) : update;
    if (draft === previous.draft) return;
    // Persist at the action boundary, not on a delayed effect that navigation could interrupt.
    const saved = writeRecipeDraft(browserStore(), uid, draft);
    const next = { ...previous, draft, saveFailed: !!uid && !saved };
    current.current = next;
    setState(next);
  }, [uid]);

  const resetDraft = useCallback(() => {
    if (!mounted.current || activeUid.current !== uid || current.current.uid !== uid) return;
    const removed = clearRecipeDraft(browserStore(), uid);
    const next = { uid, draft: emptyRecipeDraft(), restored: false, saveFailed: !!uid && !removed };
    current.current = next;
    setState(next);
  }, [uid]);

  const setRestored = useCallback((restored: boolean) => {
    if (!mounted.current || activeUid.current !== uid || current.current.uid !== uid) return;
    const next = { ...current.current, restored };
    current.current = next;
    setState(next);
  }, [uid]);

  return { draft: visibleState.draft, setDraft, resetDraft, restored: visibleState.restored, setRestored, saveFailed: visibleState.saveFailed };
}
