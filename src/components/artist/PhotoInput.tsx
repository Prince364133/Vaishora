"use client";

import { useEffect, useRef, useState } from "react";

const MAX_EDGE = 1800;
const QUALITY = 0.85;

/** Downscales a phone photo to ≤1800px JPEG in the browser so uploads stay small and fast. */
async function compress(file: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type) && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)) return file;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
    const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 900_000 && file.type !== "image/heic") return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", QUALITY));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file; // the server validates and reports unsupported files
  }
}

/**
 * File input for photos: compresses in the browser, shows previews, and keeps working inside a
 * normal <form> (server actions receive the compressed files).
 */
export function PhotoInput({ name, label, multiple = false, max = 8, hint, required = false }: { name: string; label: string; multiple?: boolean; max?: number; hint?: string; required?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [previews, setPreviews] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  // The form resets after a successful server action; clear the previews with it.
  useEffect(() => {
    const form = input.current?.form;
    if (!form) return;
    const onReset = () => setPreviews([]);
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, []);

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    setError("");
    const chosen = [...(e.target.files ?? [])];
    if (chosen.length > max) setError(`You can add up to ${max} photo${max > 1 ? "s" : ""} at a time; the first ${max} were kept.`);
    setBusy(true);
    const out = await Promise.all(chosen.slice(0, max).map(compress));
    setBusy(false);
    try {
      const dt = new DataTransfer();
      out.forEach((f) => dt.items.add(f));
      e.target.files = dt.files;
    } catch {
      /* very old browsers: keep the original files */
    }
    setPreviews(out.map((f) => URL.createObjectURL(f)));
  }

  return (
    <div className="field">
      <label htmlFor={`photo-${name}`}>{label}</label>
      <label
        htmlFor={`photo-${name}`}
        className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-[var(--radius-md)] border border-dashed border-rose-deep/40 bg-blush/40 px-4 py-4 text-center text-sm text-plum hover:bg-blush"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="3" y="5" width="18" height="15" rx="2" />
          <circle cx="12" cy="12.5" r="3.5" />
          <path d="M8 5l1.5-2h5L16 5" />
        </svg>
        <span className="font-semibold">{busy ? "Preparing photos…" : multiple ? "Take or choose photos" : "Take or choose a photo"}</span>
        <span className="text-xs text-muted">JPEG, PNG or WebP. Large photos are resized automatically.</span>
      </label>
      <input
        ref={input}
        id={`photo-${name}`}
        name={name}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        multiple={multiple}
        required={required}
        onChange={onChange}
        className="sr-only"
      />
      {hint && <p className="field-hint">{hint}</p>}
      {error && <p className="field-error">{error}</p>}
      {previews.length > 0 && (
        <ul className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {previews.map((u) => (
            <li key={u}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={u} alt="Selected photo preview" className="aspect-square w-full rounded-[var(--radius-sm)] object-cover" />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
