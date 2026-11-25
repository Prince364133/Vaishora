"use client";

import { useState } from "react";
import { reprojectDesignAction } from "@/app/admin/actions";
import { FRAME_VERSION, Pt, Side } from "@/lib/photo-import/warp";
import { dataBlob, imageData, loadImageUrl, warpSource } from "@/lib/photo-import/browser";
import { buildModelTexture } from "@/lib/photo-import/model-texture";

export interface ReprojectItem {
  run_id: string;
  name: string;
  slug: string;
  side: Side;
  photo_url: string;
  edits_url: string | null;
  landmarks: Pt[];
  params: { sensitivity?: number; method?: string };
  frame_version: number;
}

type RowState = "idle" | "working" | "done" | string;

/** Re-warps each photo design from its stored original for the current hand frame (runs in the browser). */
export function ReprojectTool({ items }: { items: ReprojectItem[] }) {
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [busy, setBusy] = useState(false);
  const [all, setAll] = useState(false);
  const stale = items.filter((i) => i.frame_version < FRAME_VERSION);
  const list = all ? items : stale;

  async function rebuild(item: ReprojectItem) {
    setRows((r) => ({ ...r, [item.run_id]: "working" }));
    try {
      const img = await loadImageUrl(item.photo_url);
      const src = imageData(img, img.naturalWidth, img.naturalHeight);
      let edits: ImageData | null = null;
      if (item.edits_url) {
        const e = await loadImageUrl(item.edits_url);
        edits = imageData(e, src.width, src.height);
      }
      // same kind of detector as the original import (the current version of the model, if it was the model)
      const r = await warpSource(src, item.landmarks, item.side, item.params.sensitivity ?? 0.5, edits, item.params.method?.startsWith("unet") ? "model" : "rules");
      const fd = new FormData();
      fd.set("run_id", item.run_id);
      fd.set("frame_version", String(FRAME_VERSION));
      fd.set("method", r.method);
      if (r.uncertainty != null) fd.set("uncertainty", String(r.uncertainty));
      fd.set("mask", new File([await dataBlob(r.mask)], "mask.webp", { type: "image/webp" }));
      fd.set("photo", new File([await dataBlob(r.photo)], "photo.webp", { type: "image/webp" }));
      fd.set("model", new File([await buildModelTexture(r.mask, r.photo, item.side)], "model.jpg", { type: "image/jpeg" }));
      const res = await reprojectDesignAction(null, fd);
      setRows((s) => ({ ...s, [item.run_id]: res?.error ? res.error : "done" }));
    } catch (e) {
      setRows((s) => ({ ...s, [item.run_id]: e instanceof Error ? e.message : "Failed" }));
    }
  }

  async function rebuildAll() {
    setBusy(true);
    for (const item of list) await rebuild(item);
    setBusy(false);
  }

  return (
    <div className="card p-5">
      <p className="text-sm">
        Current hand frame: <strong>v{FRAME_VERSION}</strong>. {stale.length} of {items.length} photo design{items.length === 1 ? "" : "s"} need rebuilding.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-primary btn-sm" disabled={busy || !list.length} onClick={rebuildAll}>
          {busy ? "Rebuilding…" : `Rebuild ${list.length}`}
        </button>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Include designs that are already up to date
        </label>
      </div>
      {list.length > 0 && (
        <ul className="mt-4 divide-y hairline text-sm">
          {list.map((i) => {
            const st = rows[i.run_id] ?? "idle";
            return (
              <li key={i.run_id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  {i.name} <span className="text-muted">({i.side}, built for v{i.frame_version})</span>
                </span>
                <span className={st === "done" ? "text-success" : st === "idle" || st === "working" ? "text-muted" : "text-danger"} role="status">
                  {st === "idle" ? "Waiting" : st === "working" ? "Rebuilding…" : st === "done" ? "Rebuilt" : st}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
