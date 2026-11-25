"use client";

import { useEffect, useRef, useState } from "react";

export interface PickedAddress {
  /** Set when the address is saved in the customer's account. */
  id?: string;
  label: string;
  house: string;
  building: string;
  formatted_address: string;
  place_id: string | null;
  lat: number;
  lng: number;
  locality_id: number;
  locality: string;
  landmark: string;
  instructions: string;
  is_default?: boolean;
  /** Any active artist covers this locality. */
  served?: boolean;
}

export const addressText = (a: Pick<PickedAddress, "house" | "building" | "formatted_address">) => [a.house, a.building, a.formatted_address].filter(Boolean).join(", ");

type Suggestion = { placeId: string; main: string; secondary: string };
type Resolved = { placeId: string | null; formatted: string; lat: number; lng: number; locality: { id: number; name: string }; served: boolean; mapUrl: string | null };

const newSession = () => (crypto.randomUUID?.() ?? `${Date.now()}${Math.random()}`).replace(/[^A-Za-z0-9]/g, "").slice(0, 32);
const LABELS = ["Home", "Work", "Other"];

/**
 * Full-screen location page: search Google Maps (Hyderabad only) or use the current location, check the
 * pin on the map, add flat / building / landmark, then save. Signed-in customers save to their account;
 * guests get the address back to use for this booking (it is saved when they book).
 */
export function AddressPicker({ onClose, onSaved, saveToAccount }: { onClose: () => void; onSaved: (a: PickedAddress) => void; saveToAccount: boolean }) {
  const [session] = useState(newSession);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState("");
  const [place, setPlace] = useState<Resolved | null>(null);
  const [f, setF] = useState({ house: "", building: "", landmark: "", instructions: "", label: "Home", is_default: false });
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  // Lock page scroll while the page is open; Escape closes.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    input.current?.focus();
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Debounced suggestions.
  useEffect(() => {
    if (place || query.trim().length < 2) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch("/api/places/autocomplete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input: query, session }), signal: ctrl.signal });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error ?? "Search failed");
        setSuggestions(j.suggestions ?? []);
        setError("");
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError((e as Error).message);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query, session, place]);

  const shown = place || query.trim().length < 2 ? [] : suggestions;

  async function resolve(body: object) {
    setResolving(true);
    setError("");
    try {
      const res = await fetch("/api/places/resolve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "We couldn’t use that location.");
      setPlace(j);
      setSuggestions([]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setResolving(false);
    }
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) return setError("Your browser can’t share its location. Please search instead.");
    setResolving(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {
        setResolving(false);
        setError("Location permission was denied. Please search for your address.");
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!place) return;
    if (!f.house.trim()) return setError("Enter your flat / house number.");
    const a: PickedAddress = {
      label: f.label.trim() || "Home",
      house: f.house.trim(),
      building: f.building.trim(),
      formatted_address: place.formatted,
      place_id: place.placeId,
      lat: place.lat,
      lng: place.lng,
      locality_id: place.locality.id,
      locality: place.locality.name,
      landmark: f.landmark.trim(),
      instructions: f.instructions.trim(),
      is_default: f.is_default,
      served: place.served,
    };
    if (!saveToAccount) return onSaved(a);
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/account/addresses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(a) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Could not save the address.");
      onSaved({ ...j.address, served: place.served });
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Add an address" className="fixed inset-0 z-[70] flex justify-center bg-plum-ink/40 sm:items-center sm:p-6">
      <div className="flex h-full w-full flex-col overflow-hidden bg-ivory sm:h-auto sm:max-h-[min(860px,100%)] sm:max-w-lg sm:rounded-[var(--radius-lg)] sm:shadow-2xl">
        <header className="flex items-center gap-2 border-b hairline px-2 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2">
          <button type="button" onClick={place ? () => setPlace(null) : onClose} className="btn btn-ghost h-11 w-11 flex-none px-0" aria-label={place ? "Back to search" : "Close"}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              {place ? <path d="M15 18l-6-6 6-6" /> : <path d="M18 6 6 18M6 6l12 12" />}
            </svg>
          </button>
          <h2 className="font-sans text-lg font-semibold text-plum-ink">{place ? "Address details" : "Search your location"}</h2>
        </header>

        <div className="flex-1 overflow-y-auto overscroll-contain px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {!place ? (
            <>
              <label htmlFor="addr-search" className="sr-only">
                Search for your area, street or building
              </label>
              <div className="relative">
                <svg className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>
                <input
                  ref={input}
                  id="addr-search"
                  type="search"
                  enterKeyHint="search"
                  autoComplete="off"
                  className="input pl-10"
                  placeholder="Area, street, building or landmark"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <button type="button" onClick={useCurrentLocation} disabled={resolving} className="mt-3 flex min-h-12 w-full items-center gap-3 rounded-[var(--radius-sm)] px-2 text-left text-sm font-semibold text-rose-deep hover:bg-blush/60">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <circle cx="12" cy="12" r="3" />
                  <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
                  <circle cx="12" cy="12" r="8" />
                </svg>
                {resolving ? "Finding your location…" : "Use my current location"}
              </button>
              {error && (
                <p className="mt-2 text-sm text-danger" role="alert">
                  {error}
                </p>
              )}
              <ul className="mt-2 divide-y hairline" aria-label="Suggestions" aria-busy={searching}>
                {shown.map((s) => (
                  <li key={s.placeId}>
                    <button type="button" onClick={() => resolve({ placeId: s.placeId, session })} className="flex w-full items-start gap-3 px-2 py-3 text-left hover:bg-blush/50" disabled={resolving}>
                      <svg className="mt-0.5 flex-none text-muted" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                        <path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12Z" />
                        <circle cx="12" cy="10" r="2.5" />
                      </svg>
                      <span className="min-w-0">
                        <span className="block font-semibold text-plum-ink">{s.main}</span>
                        <span className="block truncate text-sm text-muted">{s.secondary}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {searching && <p className="mt-2 px-2 text-sm text-muted">Searching…</p>}
              {!searching && query.trim().length >= 2 && !shown.length && !error && <p className="mt-2 px-2 text-sm text-muted">No matching places in Hyderabad. Try the area name.</p>}
              <p className="mt-6 px-2 text-xs text-muted">We serve Hyderabad. Results from Google Maps.</p>
            </>
          ) : (
            <form onSubmit={save} className="space-y-4" noValidate>
              {place.mapUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={place.mapUrl} alt={`Map of ${place.formatted}`} className="h-44 w-full rounded-[var(--radius-md)] bg-blush object-cover" />
              )}
              <div className="rounded-[var(--radius-md)] border hairline bg-white p-3">
                <p className="text-sm text-plum-ink">{place.formatted}</p>
                <p className={`mt-1 text-xs font-semibold ${place.served ? "text-success" : "text-henna"}`}>
                  {place.locality.name} · {place.served ? "artists available in this area" : "no artist covers this area yet — you can still save it"}
                </p>
                <button type="button" className="link tap-link mt-1 text-xs" onClick={() => setPlace(null)}>
                  Change location
                </button>
              </div>
              <div className="field">
                <label htmlFor="addr-house">Flat / house number, floor</label>
                <input id="addr-house" className="input" required maxLength={80} value={f.house} onChange={(e) => setF({ ...f, house: e.target.value })} placeholder="e.g. Flat 402, 4th floor" autoComplete="address-line1" />
              </div>
              <div className="field">
                <label htmlFor="addr-building">
                  Building / apartment / street <span className="font-normal text-muted">(optional)</span>
                </label>
                <input id="addr-building" className="input" maxLength={120} value={f.building} onChange={(e) => setF({ ...f, building: e.target.value })} placeholder="e.g. Lake View Towers, Block B" autoComplete="address-line2" />
              </div>
              <div className="field">
                <label htmlFor="addr-landmark">
                  Landmark <span className="font-normal text-muted">(optional)</span>
                </label>
                <input id="addr-landmark" className="input" maxLength={120} value={f.landmark} onChange={(e) => setF({ ...f, landmark: e.target.value })} placeholder="e.g. Opposite the community hall" />
              </div>
              <div className="field">
                <label htmlFor="addr-notes">
                  Directions for the artist <span className="font-normal text-muted">(optional)</span>
                </label>
                <input id="addr-notes" className="input" maxLength={300} value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} placeholder="Gate number, parking, lift" />
              </div>
              <fieldset>
                <legend className="text-sm font-semibold text-plum-ink">Save as</legend>
                <div className="mt-2 flex flex-wrap gap-2" role="radiogroup">
                  {LABELS.map((l) => (
                    <button key={l} type="button" role="radio" aria-checked={f.label === l} className="chip" onClick={() => setF({ ...f, label: l })}>
                      {l}
                    </button>
                  ))}
                </div>
              </fieldset>
              {saveToAccount && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={f.is_default} onChange={(e) => setF({ ...f, is_default: e.target.checked })} className="h-5 w-5 accent-[var(--color-plum)]" />
                  Make this my default address
                </label>
              )}
              {error && (
                <p className="text-sm text-danger" role="alert">
                  {error}
                </p>
              )}
              <button className="btn btn-primary w-full" disabled={saving}>
                {saving ? "Saving…" : saveToAccount ? "Save address" : "Use this address"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
