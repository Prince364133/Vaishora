"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AddressPicker, addressText, type PickedAddress } from "@/components/address/AddressPicker";

/** Saved addresses: add (location search page), set default, edit details, delete. */
export function AddressManager({ initial }: { initial: PickedAddress[] }) {
  const router = useRouter();
  const [list, setList] = useState(initial);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function call(id: string, method: "PATCH" | "DELETE", body?: object) {
    setBusy(id);
    setError("");
    try {
      const res = await fetch(`/api/account/addresses/${id}`, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Could not update the address.");
      const fresh = await (await fetch("/api/account/addresses")).json();
      setList(fresh.addresses ?? []);
      setEditing(null);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      {error && (
        <p className="mb-3 text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      <ul className="space-y-3">
        {list.map((a) => (
          <li key={a.id} className="card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-plum-ink">{a.label}</span>
                  {a.is_default && <span className="rounded-full bg-blush px-2 text-[0.7rem] font-semibold text-plum">Default</span>}
                </p>
                <p className="mt-0.5 text-sm text-muted">{addressText(a)}</p>
                <p className="text-xs text-muted">
                  {a.locality}
                  {a.landmark ? ` · near ${a.landmark}` : ""}
                </p>
              </div>
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${a.lat},${a.lng}`}
                target="_blank"
                rel="noreferrer"
                className="link tap-link flex-none text-xs"
              >
                Map
              </a>
            </div>
            {editing === a.id ? (
              <form
                className="mt-3 grid gap-3 sm:grid-cols-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void call(a.id!, "PATCH", Object.fromEntries(["label", "house", "building", "landmark", "instructions"].map((k) => [k, String(f.get(k) ?? "")])));
                }}
              >
                {(
                  [
                    ["label", "Label", a.label],
                    ["house", "Flat / house number", a.house],
                    ["building", "Building / street", a.building],
                    ["landmark", "Landmark", a.landmark],
                    ["instructions", "Directions for the artist", a.instructions],
                  ] as const
                ).map(([k, l, v]) => (
                  <label key={k} className={`field ${k === "instructions" ? "sm:col-span-2" : ""}`}>
                    <span className="label">{l}</span>
                    <input name={k} defaultValue={v} required={k === "house" || k === "label"} maxLength={k === "instructions" ? 300 : 120} className="input" />
                  </label>
                ))}
                <div className="flex gap-2 sm:col-span-2">
                  <button className="btn btn-primary btn-sm" disabled={busy === a.id}>
                    {busy === a.id ? "Saving…" : "Save"}
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                <button type="button" className="link tap-link" onClick={() => setEditing(a.id!)}>
                  Edit
                </button>
                {!a.is_default && (
                  <button type="button" className="link tap-link" disabled={busy === a.id} onClick={() => call(a.id!, "PATCH", { is_default: true })}>
                    Make default
                  </button>
                )}
                <button
                  type="button"
                  className="link tap-link text-danger"
                  disabled={busy === a.id}
                  onClick={() => {
                    if (window.confirm(`Delete “${a.label}” address?`)) void call(a.id!, "DELETE");
                  }}
                >
                  Delete
                </button>
              </div>
            )}
          </li>
        ))}
        {!list.length && <li className="card p-6 text-center text-muted">No saved addresses yet.</li>}
      </ul>
      <button type="button" onClick={() => setAdding(true)} className="mt-4 flex min-h-14 w-full items-center justify-center gap-2 rounded-[var(--radius-md)] border border-dashed border-rose-deep/50 font-semibold text-rose-deep hover:bg-blush/40">
        + Add a new address
      </button>
      {adding && (
        <AddressPicker
          saveToAccount
          onClose={() => setAdding(false)}
          onSaved={async () => {
            setAdding(false);
            const fresh = await (await fetch("/api/account/addresses")).json();
            setList(fresh.addresses ?? []);
          }}
        />
      )}
    </div>
  );
}
