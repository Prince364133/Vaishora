"use client";

import { usePathname } from "next/navigation";
import { Suspense } from "react";
import { Bone, Lines, SkeletonFrame } from "@/components/skeleton/Bone";

// Website: one skeleton that adapts to the screen being loaded. The variant follows the route (or is
// passed explicitly), and every layout reflows with the viewport exactly like the real page.

export type SiteSkeletonVariant = "home" | "catalog" | "detail" | "profile" | "artists" | "booking" | "form" | "account" | "text";

function variantFor(path: string): SiteSkeletonVariant {
  if (path === "/") return "home";
  if (path === "/designs") return "catalog";
  if (path.startsWith("/designs/")) return "detail";
  if (path === "/artists") return "artists";
  if (path.startsWith("/artists/")) return "profile";
  if (path.startsWith("/book/")) return "booking";
  if (path.startsWith("/account") || path.startsWith("/booking")) return "account";
  if (path === "/become-an-artist" || path === "/contact") return "form";
  return "text";
}

function CardGrid({ n = 8, photo = true }: { n?: number; photo?: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="card overflow-hidden">
          {photo && <Bone className="aspect-[4/5] w-full rounded-none" />}
          <div className="space-y-2 p-3 sm:p-4">
            <Bone className="h-3 w-1/3" />
            <Bone className="h-5 w-4/5" />
            <Bone className="h-3 w-1/2" />
            <Bone className="mt-3 h-5 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Pure layout for a variant (no hooks). */
function Body({ v }: { v: SiteSkeletonVariant }) {

  switch (v) {
    case "home":
      return (
        <SkeletonFrame label="Loading VAISHORA">
          <div className="container-v grid gap-8 py-8 md:grid-cols-2 md:items-center md:py-16">
            <div className="space-y-4">
              <Bone className="h-4 w-32" />
              <Bone className="h-12 w-full md:h-16" />
              <Bone className="h-12 w-4/5 md:h-16" />
              <Lines n={3} className="max-w-md" />
              <div className="flex gap-3 pt-2">
                <Bone className="h-12 w-40" />
                <Bone className="h-12 w-32" />
              </div>
            </div>
            <Bone className="arch h-[52svh] max-h-[560px] w-full" />
          </div>
          <div className="container-v pb-12">
            <Bone className="mb-5 h-9 w-64" />
            <CardGrid n={4} />
          </div>
        </SkeletonFrame>
      );
    case "catalog":
      return (
        <SkeletonFrame label="Loading designs">
          <div className="container-v py-8 md:py-12">
            <Bone className="h-11 w-2/3 max-w-md" />
            <Lines n={2} className="mt-3 max-w-xl" />
            <div className="mt-6 flex gap-2 overflow-hidden">
              {Array.from({ length: 7 }, (_, i) => (
                <Bone key={i} className="h-11 w-28 flex-none rounded-full" />
              ))}
            </div>
            <div className="mt-6">
              <CardGrid n={8} />
            </div>
          </div>
        </SkeletonFrame>
      );
    case "detail":
      return (
        <SkeletonFrame label="Loading design">
          <div className="container-v grid gap-6 pt-3 pb-10 md:gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
            <Bone className="arch h-[clamp(260px,52svh,600px)] w-full lg:h-[72svh] lg:max-h-[640px]" />
            <div className="space-y-4 lg:pt-4">
              <Bone className="h-4 w-28" />
              <Bone className="h-12 w-4/5" />
              <Lines n={4} />
              <div className="grid grid-cols-2 gap-4 border-y hairline py-5">
                {Array.from({ length: 4 }, (_, i) => (
                  <div key={i} className="space-y-2">
                    <Bone className="h-3 w-24" />
                    <Bone className="h-7 w-28" />
                  </div>
                ))}
              </div>
              <Bone className="h-12 w-48" />
            </div>
          </div>
        </SkeletonFrame>
      );
    case "profile":
      return (
        <SkeletonFrame label="Loading artist profile">
          <div className="container-v max-w-4xl py-6 md:py-12">
            <div className="flex items-center gap-4">
              <Bone className="h-16 w-16 flex-none rounded-full sm:h-20 sm:w-20" />
              <div className="flex-1 space-y-2">
                <Bone className="h-10 w-2/3 max-w-sm" />
                <Bone className="h-4 w-40" />
              </div>
            </div>
            <Lines n={3} className="mt-6 max-w-2xl" />
            <div className="mt-10 grid grid-cols-2 border-b hairline pb-3">
              <Bone className="mx-auto h-7 w-40" />
              <Bone className="mx-auto h-7 w-32" />
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3">
              {Array.from({ length: 6 }, (_, i) => (
                <Bone key={i} className="aspect-[4/5] w-full rounded-[var(--radius-md)]" />
              ))}
            </div>
          </div>
        </SkeletonFrame>
      );
    case "artists":
      return (
        <SkeletonFrame label="Loading artists">
          <div className="container-v py-8 md:py-12">
            <Bone className="h-11 w-2/3 max-w-md" />
            <Lines n={2} className="mt-3 max-w-xl" />
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="card space-y-3 p-5">
                  <div className="flex items-center gap-3">
                    <Bone className="h-14 w-14 rounded-full" />
                    <div className="flex-1 space-y-2">
                      <Bone className="h-5 w-2/3" />
                      <Bone className="h-3 w-1/3" />
                    </div>
                  </div>
                  <Lines n={2} />
                  <Bone className="h-9 w-28" />
                </div>
              ))}
            </div>
          </div>
        </SkeletonFrame>
      );
    case "booking":
      return (
        <SkeletonFrame label="Loading booking">
          <div className="container-v py-6 md:py-10">
            <div className="flex gap-2">
              {Array.from({ length: 5 }, (_, i) => (
                <Bone key={i} className="h-2 flex-1 rounded-full" />
              ))}
            </div>
            <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
              <div className="space-y-4">
                <Bone className="h-9 w-48" />
                <Bone className="arch h-[52svh] max-h-[520px] w-full" />
                <Lines n={2} />
              </div>
              <div className="card hidden space-y-3 p-5 lg:block">
                <div className="flex gap-3">
                  <Bone className="h-16 w-16" />
                  <div className="flex-1 space-y-2">
                    <Bone className="h-3 w-1/3" />
                    <Bone className="h-6 w-3/4" />
                  </div>
                </div>
                <Lines n={4} />
                <Bone className="h-12 w-full" />
              </div>
            </div>
          </div>
        </SkeletonFrame>
      );
    case "account":
      return (
        <SkeletonFrame label="Loading your account">
          <div className="container-v max-w-2xl py-8 md:py-12">
            <Bone className="h-11 w-48" />
            <div className="card mt-6 space-y-4 p-6 sm:p-8">
              <div className="flex items-center gap-3">
                <Bone className="h-11 w-11 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Bone className="h-6 w-2/3" />
                  <Bone className="h-3 w-1/2" />
                </div>
              </div>
              <Bone className="h-11 w-48" />
            </div>
          </div>
        </SkeletonFrame>
      );
    case "form":
      return (
        <SkeletonFrame label="Loading form">
          <div className="container-v grid max-w-5xl gap-8 py-8 md:grid-cols-[1fr_1.2fr] md:py-16">
            <div className="space-y-4">
              <Bone className="h-12 w-full" />
              <Bone className="h-12 w-3/4" />
              <Lines n={5} />
            </div>
            <div className="card space-y-5 p-5 sm:p-6">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="space-y-2">
                  <Bone className="h-3.5 w-32" />
                  <Bone className="h-12 w-full" />
                </div>
              ))}
              <Bone className="h-12 w-48" />
            </div>
          </div>
        </SkeletonFrame>
      );
    default:
      return (
        <SkeletonFrame label="Loading page">
          <div className="container-v max-w-3xl space-y-4 py-8 md:py-14">
            <Bone className="h-12 w-3/4" />
            <Lines n={4} />
            <Bone className="mt-6 h-7 w-1/2" />
            <Lines n={5} />
          </div>
        </SkeletonFrame>
      );
  }
}

function Routed({ variant }: { variant?: SiteSkeletonVariant }) {
  const path = usePathname() ?? "";
  return <Body v={variant ?? variantFor(path)} />;
}

/**
 * Adaptive skeleton for this app. With an explicit `variant` it renders immediately; otherwise it reads the
 * route (inside its own Suspense boundary, so it never blocks prerendering of dynamic routes).
 */
export function AdaptiveSkeleton({ variant }: { variant?: SiteSkeletonVariant }) {
  if (variant) return <Body v={variant} />;
  return (
    <Suspense fallback={<Body v="text" />}>
      <Routed />
    </Suspense>
  );
}
