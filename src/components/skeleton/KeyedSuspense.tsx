"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

/**
 * A Suspense boundary that resets whenever the URL query changes, so switching a tab or filter on the
 * same page (?tab=…) shows the skeleton again instead of the previous tab's content.
 */
function Keyed({ fallback, children }: { fallback: React.ReactNode; children: React.ReactNode }) {
  const key = useSearchParams()?.toString() ?? "";
  return (
    <Suspense key={key} fallback={fallback}>
      {children}
    </Suspense>
  );
}

export function KeyedSuspense({ fallback, children }: { fallback: React.ReactNode; children: React.ReactNode }) {
  return (
    <Suspense fallback={fallback}>
      <Keyed fallback={fallback}>{children}</Keyed>
    </Suspense>
  );
}
