"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { Address } from "viem";
import {
  REVEAL_CHANGED_EVENT,
  revealStorageKey,
  type RevealSecret,
} from "@/lib/commitReveal";

/**
 * Read a locally-stored reveal secret reactively via useSyncExternalStore.
 *
 * localStorage is an external store, so this is the React-blessed way to read
 * it without synchronously calling setState inside an effect. We return the raw
 * JSON string from getSnapshot (a stable primitive) and parse it with useMemo,
 * which avoids the infinite-loop trap of returning a fresh object each render.
 */
export function useRevealSecret(
  bountyId: bigint,
  account?: Address,
): RevealSecret | null {
  const subscribe = useCallback((onChange: () => void) => {
    if (typeof window === "undefined") return () => {};
    window.addEventListener("storage", onChange);
    window.addEventListener(REVEAL_CHANGED_EVENT, onChange);
    return () => {
      window.removeEventListener("storage", onChange);
      window.removeEventListener(REVEAL_CHANGED_EVENT, onChange);
    };
  }, []);

  const getSnapshot = useCallback(() => {
    if (typeof window === "undefined" || !account) return null;
    return window.localStorage.getItem(revealStorageKey(bountyId, account));
  }, [bountyId, account]);

  const raw = useSyncExternalStore(subscribe, getSnapshot, () => null);

  return useMemo(() => {
    if (!raw) return null;
    try {
      return JSON.parse(raw) as RevealSecret;
    } catch {
      return null;
    }
  }, [raw]);
}
