"use client";

import { usePathname } from "next/navigation";
import { Suspense } from "react";
import { Bone, Lines, SkeletonFrame } from "@/components/skeleton/Bone";

// Admin panel: one skeleton that adapts to the screen being loaded (dashboard tiles, data tables,
// review queues, detail/edit forms, conversations), reflowing for phone, tablet and desktop.

export type AdminSkeletonVariant = "dashboard" | "table" | "queue" | "detail" | "payouts" | "thread";

function variantFor(path: string): AdminSkeletonVariant {
  if (path === "/admin") return "dashboard";
  if (path.startsWith("/admin/verification")) return "queue";
  if (path.startsWith("/admin/payouts")) return "payouts";
  if (/^\/admin\/support\/[^/]+/.test(path)) return "thread";
  if (/^\/admin\/(bookings|designs|artists)\/[^/]+/.test(path) || path.startsWith("/admin/pricing")) return "detail";
  return "table";
}

function Tiles({ n = 8 }: { n?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="card space-y-2 p-4">
          <Bone className="h-3 w-24" />
          <Bone className="h-7 w-20" />
          <Bone className="h-3 w-32" />
        </div>
      ))}
    </div>
  );
}

function Table({ rows = 8, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <>
      {/* phones: cards */}
      <div className="space-y-2 md:hidden">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="card space-y-2 p-4">
            <div className="flex justify-between">
              <Bone className="h-5 w-1/2" />
              <Bone className="h-5 w-16 rounded-full" />
            </div>
            <Lines n={2} />
          </div>
        ))}
      </div>
      {/* tablets and up: table */}
      <div className="card hidden overflow-hidden md:block">
        <div className="grid gap-4 border-b hairline p-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {Array.from({ length: cols }, (_, i) => (
            <Bone key={i} className="h-3 w-2/3" />
          ))}
        </div>
        {Array.from({ length: rows }, (_, r) => (
          <div key={r} className="grid gap-4 border-b hairline p-3 last:border-0" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
            {Array.from({ length: cols }, (_, i) => (
              <Bone key={i} className={`h-4 ${i === 0 ? "w-4/5" : "w-1/2"}`} />
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

/** Pure layout for a variant (no hooks). */
function Body({ v }: { v: AdminSkeletonVariant }) {
  const heading = <Bone className="mb-5 h-10 w-56" />;
  switch (v) {
    case "dashboard":
      return (
        <SkeletonFrame label="Loading dashboard">
          {heading}
          <Tiles />
          <Bone className="mt-8 mb-3 h-7 w-32" />
          <Table rows={6} cols={6} />
        </SkeletonFrame>
      );
    case "queue":
      return (
        <SkeletonFrame label="Loading verification queue">
          {heading}
          <Bone className="mb-5 h-12 w-80 max-w-full" />
          <div className="space-y-4">
            {[0, 1].map((i) => (
              <div key={i} className="card space-y-4 p-5">
                <div className="flex justify-between">
                  <div className="space-y-2">
                    <Bone className="h-7 w-48" />
                    <Bone className="h-3.5 w-64" />
                  </div>
                  <Bone className="h-3.5 w-20" />
                </div>
                <div className="flex gap-2 overflow-hidden">
                  {[0, 1, 2].map((k) => (
                    <Bone key={k} className="h-40 w-40 flex-none" />
                  ))}
                </div>
                <Lines n={2} />
                <Bone className="h-9 w-44" />
              </div>
            ))}
          </div>
        </SkeletonFrame>
      );
    case "payouts":
      return (
        <SkeletonFrame label="Loading payouts">
          {heading}
          <Tiles n={4} />
          <Bone className="mt-8 mb-3 h-7 w-44" />
          <div className="card max-w-xl space-y-3 p-5">
            <div className="grid grid-cols-2 gap-4">
              <Bone className="h-12" />
              <Bone className="h-12" />
            </div>
            <Bone className="h-9 w-20" />
          </div>
          <Bone className="mt-8 mb-3 h-7 w-48" />
          <Table rows={4} cols={5} />
        </SkeletonFrame>
      );
    case "thread":
      return (
        <SkeletonFrame label="Loading ticket">
          <div className="max-w-3xl">
            {heading}
            {[0, 1, 2].map((i) => (
              <div key={i} className={`mb-3 flex ${i % 2 ? "justify-end" : ""}`}>
                <Bone className="h-20 w-4/5 rounded-[var(--radius-md)]" />
              </div>
            ))}
            <Bone className="mt-6 h-40 w-full rounded-[var(--radius-md)]" />
          </div>
        </SkeletonFrame>
      );
    case "detail":
      return (
        <SkeletonFrame label="Loading details">
          <Bone className="mb-2 h-3.5 w-24" />
          {heading}
          <div className="card space-y-4 p-5">
            <div className="grid gap-4 md:grid-cols-2">
              {Array.from({ length: 8 }, (_, i) => (
                <div key={i} className="space-y-2">
                  <Bone className="h-3.5 w-28" />
                  <Bone className="h-12 w-full" />
                </div>
              ))}
            </div>
            <Bone className="h-9 w-32" />
          </div>
          <div className="mt-6 grid gap-6 md:grid-cols-2">
            {[0, 1].map((i) => (
              <div key={i} className="card space-y-3 p-5">
                <Bone className="h-5 w-40" />
                <Lines n={3} />
              </div>
            ))}
          </div>
        </SkeletonFrame>
      );
    default:
      return (
        <SkeletonFrame label="Loading">
          <div className="mb-5 flex items-center justify-between gap-3">
            <Bone className="h-10 w-48" />
            <Bone className="h-9 w-28" />
          </div>
          <div className="mb-4 flex gap-2 overflow-hidden">
            {Array.from({ length: 5 }, (_, i) => (
              <Bone key={i} className="h-11 w-24 flex-none rounded-full" />
            ))}
          </div>
          <Table />
        </SkeletonFrame>
      );
  }
}

function Routed({ variant }: { variant?: AdminSkeletonVariant }) {
  const path = usePathname() ?? "";
  return <Body v={variant ?? variantFor(path)} />;
}

/**
 * Adaptive skeleton for this app. With an explicit `variant` it renders immediately; otherwise it reads the
 * route (inside its own Suspense boundary, so it never blocks prerendering of dynamic routes).
 */
export function AdaptiveSkeleton({ variant }: { variant?: AdminSkeletonVariant }) {
  if (variant) return <Body v={variant} />;
  return (
    <Suspense fallback={<Body v="table" />}>
      <Routed />
    </Suspense>
  );
}
