"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Bone, Lines, SkeletonFrame } from "@/components/skeleton/Bone";

// Artist portal: one skeleton that adapts to the screen being loaded (route, and the tab in the URL for
// Orders), sized for phones first and widening on tablets/desktops like the real pages.

export type ArtistSkeletonVariant = "dashboard" | "orders" | "designs" | "design-form" | "profile" | "schedule" | "payouts" | "support" | "ticket";

function variantFor(path: string): ArtistSkeletonVariant {
  if (path === "/artist-portal") return "dashboard";
  if (path.startsWith("/artist-portal/orders")) return "orders";
  if (path === "/artist-portal/designs") return "designs";
  if (path.startsWith("/artist-portal/designs/")) return "design-form";
  if (path.startsWith("/artist-portal/profile")) return "profile";
  if (path.startsWith("/artist-portal/schedule")) return "schedule";
  if (path.startsWith("/artist-portal/payouts")) return "payouts";
  if (path.startsWith("/artist-portal/support/")) return "ticket";
  if (path.startsWith("/artist-portal/support")) return "support";
  return "dashboard";
}

const Title = ({ w = "w-48" }: { w?: string }) => (
  <div className="mb-5 space-y-2">
    <Bone className={`h-10 ${w}`} />
    <Bone className="h-3.5 w-2/3 max-w-sm" />
  </div>
);

function Stats({ n = 6 }: { n?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className={`space-y-2 rounded-[var(--radius-md)] p-4 ${i === 0 ? "bg-plum" : "card"}`}>
          <Bone dark={i === 0} className="h-3 w-24" />
          <Bone dark={i === 0} className="h-7 w-20" />
          <Bone dark={i === 0} className="h-3 w-28" />
        </div>
      ))}
    </div>
  );
}

function Cards({ n = 3, tall = false }: { n?: number; tall?: boolean }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="card space-y-3 p-4">
          <div className="flex justify-between gap-3">
            <Bone className="h-6 w-1/2" />
            <Bone className="h-5 w-20 rounded-full" />
          </div>
          <Lines n={tall ? 4 : 2} />
          {tall && <Bone className="h-9 w-32" />}
        </div>
      ))}
    </div>
  );
}

function FormSections({ n = 3 }: { n?: number }) {
  return (
    <div className="space-y-5">
      {Array.from({ length: n }, (_, s) => (
        <div key={s} className="card space-y-4 p-4 sm:p-5">
          <Bone className="h-6 w-40" />
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="space-y-2">
              <Bone className="h-3.5 w-28" />
              <Bone className="h-12 w-full" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Pure layout for a variant (no hooks). */
function Body({ v, tab }: { v: ArtistSkeletonVariant; tab: string | null }) {
  switch (v) {
    case "dashboard":
      return (
        <SkeletonFrame label="Loading your dashboard">
          <Bone className="h-3.5 w-40" />
          <Bone className="mt-2 mb-5 h-10 w-52" />
          <Stats />
          <Bone className="mt-7 mb-3 h-7 w-40" />
          <Cards n={2} />
        </SkeletonFrame>
      );
    case "orders":
      return (
        <SkeletonFrame label={`Loading ${tab ?? ""} orders`}>
          <Title w="w-36" />
          <div className="mb-4 grid grid-cols-3 gap-1 rounded-[var(--radius-md)] bg-blush p-1">
            {[0, 1, 2].map((i) => (
              <Bone key={i} className={`h-11 ${tab === ["requests", "upcoming", "past"][i] ? "bg-white" : ""}`} />
            ))}
          </div>
          <Cards n={3} tall />
        </SkeletonFrame>
      );
    case "designs":
      return (
        <SkeletonFrame label="Loading designs">
          <Title w="w-40" />
          <div className="grid gap-3 sm:grid-cols-2">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="card flex gap-3 p-3">
                <Bone className="h-24 w-24 flex-none" />
                <div className="flex-1 space-y-2">
                  <Bone className="h-5 w-4/5" />
                  <Bone className="h-3.5 w-1/2" />
                  <Bone className="h-5 w-16 rounded-full" />
                </div>
              </div>
            ))}
          </div>
        </SkeletonFrame>
      );
    case "design-form":
      return (
        <SkeletonFrame label="Loading design">
          <Bone className="mb-2 h-3.5 w-20" />
          <Title w="w-64" />
          <div className="card mb-5 space-y-4 p-4 sm:p-5">
            <div className="flex justify-between">
              <Bone className="h-6 w-40" />
              <Bone className="h-10 w-48 rounded-full" />
            </div>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {Array.from({ length: 4 }, (_, i) => (
                <Bone key={i} className="aspect-square w-full" />
              ))}
            </div>
          </div>
          <FormSections n={2} />
        </SkeletonFrame>
      );
    case "profile":
      return (
        <SkeletonFrame label="Loading profile">
          <Title w="w-36" />
          <div className="card flex items-center gap-4 p-4">
            <Bone className="h-16 w-16 flex-none rounded-full" />
            <div className="flex-1 space-y-2">
              <Bone className="h-6 w-1/2" />
              <Bone className="h-5 w-32 rounded-full" />
            </div>
          </div>
          <div className="mt-4 mb-6 grid grid-cols-3 gap-2">
            {[0, 1, 2].map((i) => (
              <Bone key={i} className="h-14" />
            ))}
          </div>
          <FormSections n={2} />
        </SkeletonFrame>
      );
    case "schedule":
      return (
        <SkeletonFrame label="Loading working hours">
          <Title w="w-52" />
          <div className="space-y-3">
            {Array.from({ length: 7 }, (_, i) => (
              <div key={i} className="card flex items-center justify-between p-4">
                <Bone className="h-5 w-28" />
                <Bone className="h-8 w-14 rounded-full" />
              </div>
            ))}
          </div>
        </SkeletonFrame>
      );
    case "payouts":
      return (
        <SkeletonFrame label="Loading payouts">
          <Title w="w-36" />
          <Stats n={4} />
          <Bone className="mt-6 mb-3 h-7 w-32" />
          <div className="card space-y-3 p-5">
            <Bone className="h-3.5 w-24" />
            <Bone className="h-12 w-56" />
            <Bone className="h-9 w-36" />
          </div>
          <Bone className="mt-6 mb-3 h-7 w-44" />
          <Cards n={2} />
        </SkeletonFrame>
      );
    case "support":
      return (
        <SkeletonFrame label="Loading support">
          <Title w="w-36" />
          <Bone className="mb-5 h-16 w-full" />
          <Cards n={2} />
          <Bone className="mt-8 mb-3 h-7 w-40" />
          <FormSections n={1} />
        </SkeletonFrame>
      );
    case "ticket":
      return (
        <SkeletonFrame label="Loading ticket">
          <Title w="w-64" />
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className={`flex ${i % 2 ? "justify-end" : ""}`}>
                <Bone className={`h-20 w-4/5 rounded-[var(--radius-md)] ${i % 2 ? "bg-plum/20" : ""}`} />
              </div>
            ))}
          </div>
          <Bone className="mt-6 h-32 w-full rounded-[var(--radius-md)]" />
        </SkeletonFrame>
      );
  }
}

function WithTab({ variant }: { variant?: ArtistSkeletonVariant }) {
  const path = usePathname() ?? "/artist-portal";
  const tab = useSearchParams()?.get("tab") ?? null;
  return <Body v={variant ?? variantFor(path)} tab={tab} />;
}

/**
 * Adaptive skeleton for the artist portal. Reads the route and the Orders tab inside its own Suspense
 * boundary (never blocks prerendering); the instant fallback is the dashboard layout.
 */
export function AdaptiveSkeleton({ variant }: { variant?: ArtistSkeletonVariant }) {
  return (
    <Suspense fallback={<Body v={variant ?? "dashboard"} tab={null} />}>
      <WithTab variant={variant} />
    </Suspense>
  );
}
