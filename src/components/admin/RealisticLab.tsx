"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { LazyHandViewer3D } from "@/components/hand/LazyHandViewer3D";
import { saveModelTextureAction, setRealisticLiveAction, type LabState } from "@/app/admin/realistic-actions";

type Assets = { palm?: string; back?: string; palm_photo?: string; back_photo?: string; model_front?: string; model_back?: string };
export interface LabDesign {
  id: string;
  slug: string;
  name: string;
  region: "palm" | "back" | "palm_back" | "feet";
  status: string;
  review_status: string | null;
  artist_name: string | null;
  updated_at: string;
  assets: Assets;
  capture_status: "pending" | "approved" | "rejected" | null;
  capture_method: string | null;
}

/** Sides that have uploaded henna + fitted photo but no 3D model texture yet. */
function missingSides(d: LabDesign): ("palm" | "back")[] {
  const out: ("palm" | "back")[] = [];
  if (d.assets.palm && d.assets.palm_photo && !d.assets.model_front) out.push("palm");
  if (d.assets.back && d.assets.back_photo && !d.assets.model_back) out.push("back");
  return out;
}

function LiveSwitch({ live }: { live: boolean }) {
  const [state, action, pending] = useActionState<LabState, FormData>(setRealisticLiveAction, null);
  return (
    <form action={action} className="card space-y-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted">Realistic 3D for customers</p>
          <p className={`text-2xl font-semibold ${live ? "text-success" : "text-plum"}`}>{live ? "Live" : "Hidden (admin only)"}</p>
        </div>
        {live ? (
          <button name="state" value="off" className="btn btn-secondary" disabled={pending}>
            Hide from customers
          </button>
        ) : (
          <button name="state" value="on" className="btn btn-primary" disabled={pending}>
            Make live
          </button>
        )}
      </div>
      {!live && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="confirm" className="mt-1" /> I checked the designs below on Realistic 3D and they look right.
        </label>
      )}
      <p className="text-xs text-muted">
        {live
          ? "Customers can switch between the 3D model and Realistic 3D on every design page and in the hero."
          : "Customers see only the 3D model, with no switch. Turning this on adds a “3D model / Realistic 3D” switch everywhere."}
      </p>
      {state?.error && <p className="text-sm text-danger" role="alert">{state.error}</p>}
      {state?.ok && <p className="text-sm text-success" role="status">{state.ok}</p>}
    </form>
  );
}

export function RealisticLab({ designs, live, pendingReview, detector }: { designs: LabDesign[]; live: boolean; pendingReview: number; detector: string | null }) {
  const [selected, setSelected] = useState<string | null>(designs[0]?.id ?? null);
  const [build, setBuild] = useState<Record<string, string>>({});
  const d = designs.find((x) => x.id === selected) ?? null;
  const withModel = designs.filter((x) => x.assets.model_front || x.assets.model_back).length;
  const missing = designs.filter((x) => missingSides(x).length > 0);
  const [busy, setBusy] = useState(false);

  async function buildMissing() {
    setBusy(true);
    const { imageData, loadImageUrl } = await import("@/lib/photo-import/browser");
    const { buildModelTexture } = await import("@/lib/photo-import/model-texture");
    for (const x of missing) {
      for (const side of missingSides(x)) {
        const key = `${x.id}:${side}`;
        setBuild((b) => ({ ...b, [key]: "Building…" }));
        try {
          const [m, p] = await Promise.all([loadImageUrl(x.assets[side]!), loadImageUrl(x.assets[`${side}_photo`]!)]);
          const W = p.naturalWidth;
          const mask = imageData(m, W, W);
          const photo = imageData(p, W, W);
          const tex = await buildModelTexture(mask, photo, side);
          const fd = new FormData();
          fd.set("design_id", x.id);
          fd.set("side", side);
          fd.set("texture", new File([tex], `model-${side}.jpg`, { type: "image/jpeg" }));
          const res = await saveModelTextureAction(null, fd);
          setBuild((b) => ({ ...b, [key]: res?.error ?? "Done" }));
        } catch (e) {
          setBuild((b) => ({ ...b, [key]: e instanceof Error ? e.message : "Failed" }));
        }
      }
    }
    setBusy(false);
  }

  return (
    <div className="space-y-6">
      <LiveSwitch live={live} />

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          ["Uploaded designs with 3D artwork", designs.length],
          ["Showing on the 3D model", `${withModel} / ${designs.length}`],
          ["Photos waiting for review", pendingReview],
          ["Henna detector", detector ?? "classic rules"],
        ].map(([label, value]) => (
          <div key={String(label)} className="card p-4">
            <p className="text-xs text-muted">{label}</p>
            <p className="mt-1 text-xl font-semibold">{value}</p>
          </div>
        ))}
      </div>
      <p className="text-sm">
        <Link href="/admin/designs/captures" className="link">Photo review queue</Link> ·{" "}
        <Link href="/admin/designs/models" className="link">Detector versions</Link> ·{" "}
        <Link href="/admin/designs/from-photo" className="link">Add a design from a photo</Link>
      </p>

      {missing.length > 0 && (
        <div className="card flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
          <span>
            {missing.length} design{missing.length === 1 ? " was" : "s were"} uploaded before the 3D model could show them.
          </span>
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={buildMissing}>
            {busy ? "Building…" : "Build their 3D model view"}
          </button>
        </div>
      )}

      {designs.length === 0 ? (
        <div className="card p-5 text-sm text-muted">No uploaded designs with 3D artwork yet. They appear here when artists add a 3D preview to a design.</div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          <ul className="card max-h-[70svh] divide-y hairline overflow-y-auto">
            {designs.map((x) => {
              const miss = missingSides(x);
              return (
                <li key={x.id}>
                  <button type="button" onClick={() => setSelected(x.id)} className={`w-full px-4 py-3 text-left text-sm ${selected === x.id ? "bg-blush" : "hover:bg-blush/50"}`} aria-pressed={selected === x.id}>
                    <span className="block font-semibold">{x.name}</span>
                    <span className="block text-xs text-muted">
                      {x.artist_name ? `by ${x.artist_name}` : "Admin import"} · {x.review_status ?? x.status}
                      {x.capture_status ? ` · photo ${x.capture_status === "pending" ? "not reviewed" : x.capture_status}` : ""}
                      {x.capture_method ? ` · ${x.capture_method.startsWith("unet") ? "AI detector" : "classic rules"}` : ""}
                    </span>
                    <span className={`block text-xs ${miss.length ? "text-danger" : "text-success"}`}>
                      {miss.length ? "Not on the 3D model yet" : "On the 3D model"}
                      {miss.map((s) => (build[`${x.id}:${s}`] ? ` · ${s}: ${build[`${x.id}:${s}`]}` : "")).join("")}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {d && (
            <div className="space-y-2">
              <p className="text-sm">
                <strong>{d.name}</strong> — switch between the two viewers at the top of the preview.{" "}
                <Link href={`/designs/${d.slug}`} className="link">Open design page</Link>
              </p>
              <div className="arch relative h-[min(70svh,640px)] overflow-hidden bg-plum">
                <LazyHandViewer3D
                  key={d.id}
                  palmArt={d.assets.palm ?? null}
                  backArt={d.assets.back ?? null}
                  region={d.region}
                  designName={d.name}
                  designSlug={d.slug}
                  palmPhoto={d.assets.palm_photo ?? null}
                  backPhoto={d.assets.back_photo ?? null}
                  modelFront={d.assets.model_front ?? null}
                  modelBack={d.assets.model_back ?? null}
                  customOnly
                  forceRealistic
                  className="absolute inset-0 pt-6"
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
