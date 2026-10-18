import { useEffect } from "react";
import type { SavedCopyQuery } from "@shared/ipc";
import { useAppDispatch } from "./hooks";
import { saveOfferCleared } from "./slices/savedFiles";

// how many screens show each report now, so a cleanup can tell a remount from leaving
const shown = new Map<string, number>();

function count(key: string, delta: number): number {
  const n = (shown.get(key) ?? 0) + delta;
  if (n > 0) shown.set(key, n);
  else shown.delete(key);
  return n;
}

/**
 * Leaving the screen of a sealed report drops the Save offer it did not take (D12): only its own
 * offer, and only when no screen shows that report any more. React's StrictMode (development)
 * unmounts and mounts again at once; that must not cost the operator the Save dialog after a
 * first seal (review, Stage 6).
 */
export function useDropSaveOfferOnLeave(ref: SavedCopyQuery): void {
  const dispatch = useAppDispatch();
  const { kind, id, version } = ref;
  useEffect(() => {
    const key = `${kind}:${id}:${version}`;
    count(key, +1);
    return () => {
      count(key, -1);
      // a remount runs before the microtask and counts itself again
      queueMicrotask(() => {
        if (!shown.has(key)) dispatch(saveOfferCleared({ kind, id, version }));
      });
    };
  }, [dispatch, kind, id, version]);
}
