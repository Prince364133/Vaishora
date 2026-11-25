import { ActionForm } from "@/components/admin/ActionForm";
import { PhotoInput } from "./PhotoInput";
import { DesignMediaFields } from "./DesignMediaFields";
import type { ArtistDesign } from "@/server/artist-portal";
import type { ActionState } from "@/app/admin/actions";
import { formatDuration } from "@/lib/time";

const DURATIONS = [15, 30, 45, 60, 75, 90, 120, 150, 180, 210, 240, 300, 360, 420, 480, 540, 600];
const REGIONS = [
  ["palm", "Palm"],
  ["back", "Back of hand"],
  ["palm_back", "Palm and back"],
  ["feet", "Feet"],
] as const;
const COMPLEXITY = [
  ["simple", "Simple", "Quick, light patterns"],
  ["moderate", "Detailed", "Fuller coverage"],
  ["intricate", "Intricate", "Fine, dense work"],
  ["bridal", "Bridal", "Full bridal work"],
] as const;

export function DesignForm({
  action,
  categories,
  design,
}: {
  action: (s: ActionState, f: FormData) => Promise<ActionState>;
  categories: { slug: string; name: string }[];
  design?: ArtistDesign;
}) {
  const d = design;
  return (
    <ActionForm action={action} submitLabel={d ? "Submit changes for review" : "Submit for review"} pendingLabel={d ? "Saving…" : "Uploading…"} encType="multipart/form-data" resetOnSuccess={false} className="space-y-5">
      {d && <input type="hidden" name="id" value={d.id} />}
      <DesignMediaFields
        existingAssets={d?.assets ?? {}}
        region={d?.region ?? "palm"}
        videoUrl={d?.video_url}
        photos={
          <>
            <PhotoInput
              name="cover"
              label={d ? "Change cover image" : "Cover image"}
              required={!d}
              hint="Shown on your design card in the store and as the first photo. Use your best, clearest shot."
            />
            {d && d.photos.length > 0 && (
              <fieldset>
                <legend className="text-sm font-semibold text-plum-ink">Current photos</legend>
                <p className="field-hint">Choose “Cover” for the card image, or tick “Remove”.</p>
                <ul className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {d.photos.map((p, i) => (
                    <li key={p.id}>
                      <label className="relative block cursor-pointer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.url} alt={`Photo ${i + 1} of ${d.name}`} loading="lazy" className="aspect-square w-full rounded-[var(--radius-sm)] object-cover" />
                      </label>
                      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-2 text-xs font-semibold">
                        <label className="flex min-h-8 items-center gap-1">
                          <input type="radio" name="cover_photo" value={p.id} defaultChecked={i === 0} className="h-4 w-4 accent-[var(--color-plum)]" />
                          Cover
                        </label>
                        <label className="flex min-h-8 items-center gap-1 text-danger">
                          <input type="checkbox" name="remove_photo" value={p.id} className="h-4 w-4 accent-[var(--color-danger)]" />
                          Remove
                        </label>
                      </div>
                    </li>
                  ))}
                </ul>
              </fieldset>
            )}
            <PhotoInput
              name="photos"
              label={d ? "Add more photos" : "More photos (optional)"}
              multiple
              max={7}
              hint="Other angles and close-ups of the same design. Up to 8 photos in total, including the cover."
            />
          </>
        }
      />

      <section className="card space-y-4 p-4 sm:p-5">
        <h2 className="text-xl">Details</h2>
        <div className="field">
          <label htmlFor="name">Design name</label>
          <input id="name" name="name" className="input" required minLength={3} maxLength={80} defaultValue={d?.name} placeholder="e.g. Peacock bridal full hands" autoCapitalize="words" />
        </div>
        <div className="field">
          <label htmlFor="category_slug">Category</label>
          <select id="category_slug" name="category_slug" className="input" required defaultValue={d?.category_slug ?? ""}>
            <option value="" disabled>
              Choose a category
            </option>
            {categories.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <fieldset>
          <legend className="text-sm font-semibold text-plum-ink">Where it goes</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {REGIONS.map(([v, l]) => (
              <label key={v} className="chip cursor-pointer has-[:checked]:border-plum has-[:checked]:bg-plum has-[:checked]:text-ivory">
                <input type="radio" name="region" value={v} required defaultChecked={(d?.region ?? "palm") === v} className="sr-only" />
                {l}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="text-sm font-semibold text-plum-ink">Detail level</legend>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {COMPLEXITY.map(([v, l, hint]) => (
              <label key={v} className="cursor-pointer rounded-[var(--radius-sm)] border hairline bg-white p-3 has-[:checked]:border-plum has-[:checked]:ring-2 has-[:checked]:ring-rose/40">
                <input type="radio" name="complexity" value={v} required defaultChecked={(d?.complexity ?? "moderate") === v} className="sr-only" />
                <span className="block text-sm font-semibold text-plum-ink">{l}</span>
                <span className="block text-xs text-muted">{hint}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="field">
          <label htmlFor="description">Description</label>
          <textarea id="description" name="description" className="input min-h-28" required minLength={20} maxLength={1500} defaultValue={d?.description} placeholder="Motifs, style, how dark the stain gets, what makes it special…" />
        </div>
        <div className="field">
          <label htmlFor="includes">
            What the price covers <span className="font-normal text-muted">(optional)</span>
          </label>
          <input id="includes" name="includes" className="input" maxLength={300} defaultValue={d?.includes} placeholder="e.g. Both palms up to the wrist, natural henna cone" />
        </div>
      </section>

      <section className="card space-y-4 p-4 sm:p-5">
        <h2 className="text-xl">Price and time</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="field">
            <label htmlFor="price">Your price (₹)</label>
            <input id="price" name="price" type="number" inputMode="numeric" min={100} step={50} required className="input" defaultValue={d ? d.base_price_paise / 100 : undefined} placeholder="e.g. 2500" />
            <p className="field-hint">For one hand/one pair, as in the photos. Options like both hands are priced automatically.</p>
          </div>
          <div className="field">
            <label htmlFor="duration_minutes">Time it takes you</label>
            <select id="duration_minutes" name="duration_minutes" className="input" required defaultValue={String(d?.duration_minutes ?? 60)}>
              {DURATIONS.map((m) => (
                <option key={m} value={m}>
                  {formatDuration(m)}
                </option>
              ))}
            </select>
            <p className="field-hint">Customers are offered slots of this length within your working hours.</p>
          </div>
        </div>
      </section>
      <p className="text-sm text-muted">
        {d?.review_status === "approved"
          ? "Changes are reviewed by our team before they appear in the store. Your current version stays live meanwhile."
          : "Our team reviews every design (usually within a day). You’ll get an email when it’s live."}
      </p>
    </ActionForm>
  );
}
