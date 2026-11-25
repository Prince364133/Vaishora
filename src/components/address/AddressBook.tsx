"use client";

import { useEffect, useState } from "react";
import { AddressPicker, addressText, type PickedAddress } from "./AddressPicker";

/**
 * Choose where the artist should come: saved addresses (signed in), plus "Add new address" which opens the
 * location search page. Guests' new addresses are kept for this booking and saved when they book.
 */
export function AddressBook({
  signedIn,
  selected,
  onSelect,
  invalid,
}: {
  signedIn: boolean;
  selected: PickedAddress | null;
  onSelect: (a: PickedAddress | null) => void;
  invalid?: boolean;
}) {
  const [saved, setSaved] = useState<PickedAddress[] | null>(null);
  const [drafts, setDrafts] = useState<PickedAddress[]>([]);
  const [picking, setPicking] = useState(false);

  // Load saved addresses (signed in); preselect the default the first time.
  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    fetch("/api/account/addresses")
      .then((r) => r.json())
      .then((j: { addresses?: PickedAddress[] }) => {
        if (!live) return;
        const list = j.addresses ?? [];
        setSaved(list);
        if (list.length && !selected) onSelect(list.find((a) => a.is_default) ?? list[0]);
      })
      .catch(() => live && setSaved([]));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the sign-in state changes only
  }, [signedIn]);

  const isSel = (a: PickedAddress) => !!selected && (a.id ? a.id === selected.id : !selected.id && a.lat === selected.lat && a.house === selected.house);
  // A new (unsaved) address chosen earlier stays visible when the step is reopened.
  const savedList = signedIn ? saved : [];
  const all = [...(savedList ?? []), ...drafts, ...(selected && !selected.id && !drafts.some(isSel) ? [selected] : [])];

  return (
    <div>
      <fieldset aria-invalid={invalid} data-error={invalid} tabIndex={invalid ? -1 : undefined}>
        <legend className="text-sm font-semibold text-plum-ink">Where should the artist come?</legend>
        {savedList === null ? (
          <div className="mt-2 space-y-2" aria-busy="true">
            <span className="sk block h-20 rounded-[var(--radius-md)]" />
          </div>
        ) : (
          <ul className="mt-2 space-y-2" role="radiogroup" aria-label="Saved addresses">
            {all.map((a, i) => (
              <li key={a.id ?? `draft-${i}`}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={isSel(a)}
                  onClick={() => onSelect(a)}
                  className={`flex w-full items-start gap-3 rounded-[var(--radius-md)] border p-3 text-left transition-colors ${isSel(a) ? "border-plum bg-blush/50 ring-2 ring-rose/30" : "hairline bg-white hover:border-rose"}`}
                >
                  <span className={`mt-1 grid h-5 w-5 flex-none place-items-center rounded-full border-2 ${isSel(a) ? "border-plum" : "border-[rgb(75_29_63/0.3)]"}`} aria-hidden>
                    {isSel(a) && <span className="h-2.5 w-2.5 rounded-full bg-plum" />}
                  </span>
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-plum-ink">{a.label}</span>
                      {a.is_default && <span className="rounded-full bg-blush px-2 text-[0.7rem] font-semibold text-plum">Default</span>}
                      {!a.id && <span className="rounded-full bg-gold/25 px-2 text-[0.7rem] font-semibold text-henna">New — saved when you book</span>}
                    </span>
                    <span className="mt-0.5 block text-sm text-muted">{addressText(a)}</span>
                    <span className="block text-xs text-muted">{a.locality}</span>
                  </span>
                </button>
              </li>
            ))}
            <li>
              <button type="button" onClick={() => setPicking(true)} className="flex min-h-14 w-full items-center gap-3 rounded-[var(--radius-md)] border border-dashed border-rose-deep/50 px-3 text-left font-semibold text-rose-deep hover:bg-blush/40">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-blush text-lg leading-none" aria-hidden>
                  +
                </span>
                {all.length ? "Add a new address" : "Add your address"}
              </button>
            </li>
          </ul>
        )}
      </fieldset>
      {picking && (
        <AddressPicker
          saveToAccount={signedIn}
          onClose={() => setPicking(false)}
          onSaved={(a) => {
            setPicking(false);
            if (a.id) setSaved((s) => [...(s ?? []).map((x) => (a.is_default ? { ...x, is_default: false } : x)), a]);
            else setDrafts((d) => [...d, a]);
            onSelect(a);
          }}
        />
      )}
    </div>
  );
}
