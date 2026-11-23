import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getDesignById, listCategories } from "@/server/catalog";
import { requireRole } from "@/server/auth";
import { ActionForm } from "@/components/admin/ActionForm";
import { HandIllustration } from "@/components/hand/HandIllustration";
import { saveDesignAction } from "../../../actions";

async function Editor({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  await requireRole(["admin"]);
  const { id } = await params;
  const isNew = id === "new";
  if (!isNew && !/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [d, categories] = await Promise.all([isNew ? null : getDesignById(id), listCategories({ includeInactive: true })]);
  if (!isNew && !d) notFound();
  return (
    <>
      <Link href="/admin/designs" className="link tap-link text-sm">All designs</Link>
      <h1 className="mt-1 text-[2.25rem] sm:text-4xl">{isNew ? "New design" : d!.name}</h1>
      <ActionForm action={saveDesignAction} submitLabel={isNew ? "Create design" : "Save design"} encType="multipart/form-data" className="mt-5 card p-4 sm:p-5">
        <input type="hidden" name="id" value={d?.id ?? ""} />
        <div className="grid gap-4 md:grid-cols-2">
          <label className="field"><span className="label">Name</span><input name="name" required defaultValue={d?.name} className="input" /></label>
          <label className="field"><span className="label">Slug (URL)</span><input name="slug" required pattern="[a-z0-9-]{3,60}" autoCapitalize="none" spellCheck={false} defaultValue={d?.slug} className="input" /></label>
          <label className="field"><span className="label">Category</span>
            <select name="category_slug" required defaultValue={d?.category_slug ?? ""} className="input">
              <option value="" disabled>Choose</option>
              {categories.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
            </select>
          </label>
          <label className="field"><span className="label">Artwork covers</span>
            <select name="region" defaultValue={d?.region ?? "palm"} className="input">
              <option value="palm">Palm</option><option value="back">Back of hand</option><option value="palm_back">Palm and back</option><option value="feet">Feet</option>
            </select>
          </label>
          <label className="field md:col-span-2"><span className="label">Description</span><textarea name="description" maxLength={600} defaultValue={d?.description} className="input min-h-24" /></label>
          <label className="field"><span className="label">Starting price (₹, one hand as shown)</span><input name="price" type="number" inputMode="numeric" min={0} step={1} required defaultValue={d ? d.base_price_paise / 100 : ""} className="input" /></label>
          <label className="field"><span className="label">Application time (minutes, one hand)</span><input name="duration_minutes" type="number" inputMode="numeric" min={10} max={600} required defaultValue={d?.duration_minutes ?? 30} className="input" /></label>
          <label className="field"><span className="label">Complexity</span>
            <select name="complexity" defaultValue={d?.complexity ?? "moderate"} className="input">
              <option value="simple">Simple</option><option value="moderate">Detailed</option><option value="intricate">Intricate</option><option value="bridal">Bridal</option>
            </select>
          </label>
          <label className="field"><span className="label">Artist eligibility</span>
            <select name="artist_eligibility" defaultValue={d?.artist_eligibility ?? "standard"} className="input">
              <option value="standard">Any active artist</option><option value="senior">Senior artists and above</option><option value="bridal_specialist">Bridal specialists only</option>
            </select>
          </label>
          <label className="field"><span className="label">Availability</span>
            <select name="status" defaultValue={d?.status ?? "draft"} className="input">
              <option value="active">Active (bookable)</option><option value="unavailable">Visible, not bookable</option><option value="draft">Draft (hidden)</option>
            </select>
          </label>
          <label className="field"><span className="label">Sort order</span><input name="sort" type="number" inputMode="numeric" min={0} defaultValue={d?.sort ?? 0} className="input" /></label>
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="featured" defaultChecked={d?.featured} /> Featured on the homepage</label>
        </div>

        <h2 className="mt-8 font-sans text-base font-semibold">Artwork</h2>
        <p className="text-sm text-muted">
          Upload a square transparent PNG or WebP (2048×2048 recommended, up to 3 MB) with the mehndi in any solid colour on a transparent background, aligned to the
          hand template: fingertips at the top, wrist at the bottom, as seen looking at the palm (or back). Download the <a className="link" href="/hand/palm.webp" target="_blank">palm</a> and{" "}
          <a className="link" href="/hand/back.webp" target="_blank">back</a> templates to trace over.
        </p>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          {(["palm", "back", "feet"] as const).map((k) => (
            <div key={k} className="rounded-[var(--radius-sm)] border hairline p-3">
              <p className="text-sm font-semibold capitalize">{k}</p>
              <div className="mt-2 w-full rounded bg-blush/60">
                <HandIllustration side={k} art={d?.assets[k] ?? null} />
              </div>
              <input type="file" name={`art_${k}`} accept="image/png,image/webp" aria-label={`${k} artwork`} className="mt-2 w-full text-sm" />
            </div>
          ))}
        </div>
      </ActionForm>
    </>
  );
}

export default function DesignEditor(props: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<p className="text-muted">Loading…</p>}>
      <Editor {...props} />
    </Suspense>
  );
}
