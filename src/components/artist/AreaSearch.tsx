"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { addServiceAreaAction } from "@/app/artist-portal/actions";

type Suggestion = { placeId: string; main: string; secondary: string };

/** Search Google Maps for any Hyderabad area and add it to the artist's service areas. */
export function AreaSearch() {
  const router = useRouter();
  const [session] = useState(() => (crypto.randomUUID?.() ?? String(Date.now())).replace(/[^A-Za-z0-9]/g, "").slice(0, 32));
  const [q, setQ] = useState("");
  const [list, setList] = useState<Suggestion[]>([]);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (q.trim().length < 2) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch("/api/places/autocomplete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input: q, session, kind: "region" }), signal: ctrl.signal })
        .then((r) => r.json())
        .then((j) => setList(j.suggestions ?? []))
        .catch(() => {});
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, session]);

  async function add(s: Suggestion) {
    setBusy(true);
    setMsg({});
    const r = await addServiceAreaAction(s.placeId, session);
    setBusy(false);
    setMsg(r ?? {});
    if (r?.ok) {
      setQ("");
      setList([]);
      router.refresh();
    }
  }

  const shown = q.trim().length < 2 ? [] : list;
  return (
    <div className="rounded-[var(--radius-md)] border border-dashed border-rose-deep/40 bg-blush/30 p-3">
      <label htmlFor="area-search" className="text-sm font-semibold text-plum-ink">
        Don’t see your area? Search Google Maps
      </label>
      <input id="area-search" type="search" autoComplete="off" className="input mt-1" placeholder="e.g. Kokapet, Tellapur, Nizampet" value={q} onChange={(e) => setQ(e.target.value)} />
      {shown.length > 0 && (
        <ul className="mt-2 divide-y hairline rounded-[var(--radius-sm)] bg-white">
          {shown.map((s) => (
            <li key={s.placeId}>
              <button type="button" disabled={busy} onClick={() => add(s)} className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm hover:bg-blush/50">
                <span className="min-w-0">
                  <span className="block font-semibold text-plum-ink">{s.main}</span>
                  <span className="block truncate text-xs text-muted">{s.secondary}</span>
                </span>
                <span className="flex-none text-xs font-semibold text-rose-deep">+ Add</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {msg.ok && (
        <p className="mt-2 text-sm text-success" role="status">
          {msg.ok}
        </p>
      )}
      {msg.error && (
        <p className="mt-2 text-sm text-danger" role="alert">
          {msg.error}
        </p>
      )}
    </div>
  );
}
