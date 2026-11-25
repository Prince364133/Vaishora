"use client";

import dynamic from "next/dynamic";

/**
 * The 3D hand viewer (three.js, ~600 KB) loaded on demand: never on the server, and only once the
 * component is rendered. Shows a plum shimmer the size of the stage meanwhile.
 */
export const LazyHandViewer3D = dynamic(() => import("./HandViewer3D").then((m) => m.HandViewer3D), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 grid place-items-center bg-plum" role="status" aria-label="Loading 3D hand">
      <div className="h-2/3 w-1/2 animate-pulse rounded-[45%_45%_30%_30%] bg-white/10" />
    </div>
  ),
});
