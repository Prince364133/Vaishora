"use client";

import { useSyncExternalStore } from "react";

// Browser side of the feature flags (src/server/features.ts). Fetched once per page load; everything is OFF
// until the answer arrives, so a hidden feature never flashes on screen.
export interface Features {
  realistic3d: boolean;
}
const OFF: Features = { realistic3d: false };
let current: Features = OFF;
let started = false;
const subs = new Set<() => void>();

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  fetch("/api/features")
    .then((r) => (r.ok ? r.json() : OFF))
    .then((f: Partial<Features>) => {
      current = { ...OFF, ...f };
      subs.forEach((cb) => cb());
    })
    .catch(() => {});
}

export function useFeature(name: keyof Features): boolean {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      start();
      return () => subs.delete(cb);
    },
    () => current[name],
    () => false,
  );
}
