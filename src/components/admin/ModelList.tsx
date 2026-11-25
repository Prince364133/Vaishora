"use client";

import { useActionState } from "react";
import { makeModelLiveAction, type MlActionState } from "@/app/admin/ml-actions";

type Scores = { f1?: number; n?: number };
export interface ModelRow {
  version: number;
  method: string;
  metrics: { candidate?: Record<string, Scores>; live?: Record<string, Scores>; rule_based?: Record<string, Scores> };
  trained_on: { real_labels?: number; gold_labels?: number; steps?: number; base_version?: number | null };
  status: "candidate" | "live" | "retired" | "rejected";
  decision: string | null;
  created_at: string;
  promoted_at: string | null;
  auto: boolean;
}

const SET_LABEL: Record<string, string> = { synthetic: "Synthetic test", real_holdout: "Studio photo test", real_gold: "Your approved test photos" };
const STATUS = { live: "Live", candidate: "Waiting", retired: "Previous", rejected: "Not better" } as const;

function pct(v?: number) {
  return typeof v === "number" ? `${Math.round(v * 1000) / 10}%` : "—";
}

function MakeLive({ version }: { version: number }) {
  const [state, action, pending] = useActionState<MlActionState, FormData>(makeModelLiveAction, null);
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="version" value={version} />
      <button className="btn btn-secondary btn-sm" disabled={pending}>{pending ? "Switching…" : "Make live"}</button>
      {state?.error && <span className="text-xs text-danger" role="alert">{state.error}</span>}
    </form>
  );
}

export function ModelList({ rows, auto, approvedPhotos }: { rows: ModelRow[]; auto: boolean; approvedPhotos: number }) {
  return (
    <div className="space-y-4">
      <div className="card p-4 text-sm">
        <p>
          Automatic switching to better versions is <strong>{auto ? "on" : "off"}</strong>
          {auto ? "." : " (ML_AUTO_PROMOTE=off): better versions wait here for you to make them live."} Approved photos available for learning:{" "}
          <strong>{approvedPhotos}</strong>.
        </p>
        <p className="mt-1 text-xs text-muted">
          Accuracy below is the F1 score: how closely the detected henna matches the real henna (100% = perfect). The training worker retrains after enough new
          approved photos arrive (scripts/ml/autolearn.py).
        </p>
      </div>
      <ul className="space-y-3">
        {rows.map((r) => {
          const cand = r.metrics.candidate ?? {};
          const live = r.metrics.live ?? r.metrics.rule_based ?? {};
          const sets = Object.keys(cand);
          return (
            <li key={r.version} className="card p-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">
                  Version {r.version} <span className="font-normal text-muted">({r.method})</span>
                </p>
                <span className={r.status === "live" ? "text-success font-semibold" : r.status === "rejected" ? "text-muted" : ""}>
                  {STATUS[r.status]}
                  {r.status === "live" && r.auto ? " · switched automatically" : ""}
                </span>
              </div>
              {sets.length > 0 && (
                <table className="mt-2 w-full text-left text-xs">
                  <thead className="text-muted">
                    <tr>
                      <th className="py-1 font-normal">Test</th>
                      <th className="py-1 font-normal">This version</th>
                      <th className="py-1 font-normal">{r.metrics.live ? `Live at the time (v${(r.trained_on.base_version ?? r.version - 1)})` : "Classic rules"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sets.map((k) => (
                      <tr key={k}>
                        <td className="py-0.5">{SET_LABEL[k] ?? k}{cand[k]?.n ? ` (${cand[k].n})` : ""}</td>
                        <td className="py-0.5 font-semibold">{pct(cand[k]?.f1)}</td>
                        <td className="py-0.5">{pct(live[k]?.f1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="mt-2 text-xs text-muted">
                Learned from {r.trained_on.real_labels ?? 0} approved photo{r.trained_on.real_labels === 1 ? "" : "s"} · {r.created_at.slice(0, 16)}
                {r.decision ? ` · ${r.decision}` : ""}
              </p>
              {r.status !== "live" && (
                <div className="mt-2">
                  <MakeLive version={r.version} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
