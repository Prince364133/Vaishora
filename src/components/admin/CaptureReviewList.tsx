"use client";

import Link from "next/link";
import { useActionState } from "react";
import { reviewCaptureAction, type ActionState } from "@/app/admin/actions";

export interface CaptureRow {
  run_id: string;
  design_id: string | null;
  name: string | null;
  side: "palm" | "back";
  photo_url: string;
  mask_url: string | null;
  method: string;
  uncertainty: number | null;
  review_status: "pending" | "approved" | "rejected";
  landmarks_edited: boolean;
  brushed: boolean;
  consent_training: boolean;
  created_at: string;
}

const STATUS_LABEL = { pending: "Not reviewed", approved: "Approved", rejected: "Rejected" } as const;

function Decision({ row }: { row: CaptureRow }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(reviewCaptureAction, null);
  const btn = (status: "approved" | "rejected" | "pending", label: string, cls: string) => (
    <button name="status" value={status} className={`btn btn-sm ${cls}`} disabled={pending || row.review_status === status}>
      {label}
    </button>
  );
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="run_id" value={row.run_id} />
      {btn("approved", "Approve", "btn-primary")}
      {btn("rejected", "Reject", "btn-secondary")}
      {row.review_status !== "pending" && btn("pending", "Undo", "btn-ghost")}
      {state?.error && <span className="text-xs text-danger" role="alert">{state.error}</span>}
    </form>
  );
}

export function CaptureReviewList({ rows, counts }: { rows: CaptureRow[]; counts: { pending: number; approved: number; trainable: number } }) {
  if (!rows.length) {
    return (
      <div className="card p-5 text-sm">
        No photo designs yet. <Link href="/admin/designs/from-photo" className="link">Add one from a photo</Link>.
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <p className="text-sm">
        <strong>{counts.pending}</strong> to review · <strong>{counts.approved}</strong> approved · <strong>{counts.trainable}</strong> usable for training (approved
        and the owner agreed)
      </p>
      <ul className="grid gap-4 md:grid-cols-2">
        {rows.map((r) => (
          <li key={r.run_id} className="card overflow-hidden">
            <div className="grid grid-cols-2 gap-px bg-[var(--color-line)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={r.photo_url} alt={`Original photo for ${r.name ?? "a deleted design"}`} className="aspect-square w-full bg-blush object-cover" loading="lazy" />
              <div className="relative aspect-square w-full" style={{ background: "#f2d3c4" }}>
                {r.mask_url && (
                  // the henna mask is white-on-transparent: tint it via CSS mask so it reads as henna
                  <div
                    className="absolute inset-0"
                    style={{ background: "#5b1f0f", WebkitMaskImage: `url(${r.mask_url})`, maskImage: `url(${r.mask_url})`, WebkitMaskSize: "contain", maskSize: "contain" }}
                    role="img"
                    aria-label="Extracted henna"
                  />
                )}
              </div>
            </div>
            <div className="space-y-2 p-4 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                {r.design_id ? (
                  <Link href={`/admin/designs/${r.design_id}`} className="font-semibold link">{r.name}</Link>
                ) : (
                  <span className="font-semibold text-muted">Design deleted</span>
                )}
                <span className={r.review_status === "approved" ? "text-success" : r.review_status === "rejected" ? "text-danger" : "text-muted"}>{STATUS_LABEL[r.review_status]}</span>
              </div>
              <p className="text-xs text-muted">
                {r.side === "palm" ? "Palm" : "Back"} · {r.method.startsWith("unet") ? `AI model (${r.method})` : "classic rules"}
                {r.uncertainty != null && ` · unsure on ${r.uncertainty}%`}
                {r.landmarks_edited && " · points fixed by hand"}
                {r.brushed && " · brush corrections"}
                {r.consent_training ? " · owner agreed to training" : " · no training consent"}
              </p>
              <Decision row={r} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
