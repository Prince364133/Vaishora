import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { listCategories, listDesigns } from "@/server/catalog";
import { currentUser } from "@/server/auth";
import { HandIllustration } from "@/components/hand/HandIllustration";
import { ActionForm } from "@/components/admin/ActionForm";
import { saveCategoryAction } from "../../actions";
import { formatPaise } from "@/lib/money";
import { formatDuration } from "@/lib/time";

export const metadata = { title: "Designs" };

async function Content({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  await connection();
  const [designs, categories, user, sp] = await Promise.all([listDesigns({ includeInactive: true }), listCategories({ includeInactive: true }), currentUser(), searchParams]);
  const isAdmin = user?.role === "admin";
  return (
    <>
      {sp.saved && <p className="mt-3 rounded-[var(--radius-sm)] bg-success/10 px-4 py-2 text-sm text-success">Saved “{sp.saved}”.</p>}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {designs.map((d) => {
          const art = d.region === "feet" ? d.assets.feet : d.assets.palm ?? d.assets.back;
          return (
            <Link key={d.id} href={isAdmin ? `/admin/designs/${d.id}` : `/designs/${d.slug}`} className="card overflow-hidden hover:border-rose">
              <div className="bg-blush/60">
                <HandIllustration side={d.region === "feet" ? "feet" : d.assets.palm ? "palm" : "back"} art={art ?? null} />
              </div>
              <div className="p-3 text-sm">
                <p className="font-semibold">{d.name}</p>
                <p className="text-muted">{d.category_name} · {formatPaise(d.base_price_paise)} · {formatDuration(d.duration_minutes)}</p>
                <p className={`mt-1 text-xs font-semibold ${d.status === "active" ? "text-success" : "text-danger"}`}>{d.status}{d.featured ? " · featured" : ""}</p>
              </div>
            </Link>
          );
        })}
      </div>

      <section className="mt-10">
        <h2 className="text-2xl">Categories</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {categories.map((c) => (
            <div key={c.slug} className="card p-4">
              {isAdmin ? (
                <ActionForm action={saveCategoryAction} submitLabel="Save" className="grid gap-2 sm:grid-cols-2">
                  <input type="hidden" name="slug" value={c.slug} />
                  <input name="name" defaultValue={c.name} className="input" aria-label="Name" />
                  <input name="sort" type="number" defaultValue={c.sort} className="input" aria-label="Sort order" />
                  <input name="description" defaultValue={c.description} className="input sm:col-span-2" aria-label="Description" />
                  <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={c.active} /> Active</label>
                </ActionForm>
              ) : (
                <p>{c.name}</p>
              )}
            </div>
          ))}
          {isAdmin && (
            <div className="card border-dashed p-4">
              <p className="mb-2 text-sm font-semibold">New category</p>
              <ActionForm action={saveCategoryAction} submitLabel="Add category" className="grid gap-2 sm:grid-cols-2">
                <input name="slug" placeholder="slug (e.g. festive)" aria-label="Slug" autoCapitalize="none" spellCheck={false} className="input" required />
                <input name="name" placeholder="Name" aria-label="Name" className="input" required />
                <input name="description" placeholder="Description" aria-label="Description" className="input sm:col-span-2" />
                <input name="sort" type="number" inputMode="numeric" placeholder="Sort" aria-label="Sort order" className="input" />
                <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked /> Active</label>
              </ActionForm>
            </div>
          )}
        </div>
      </section>
    </>
  );
}

export default function AdminDesigns(props: { searchParams: Promise<{ saved?: string }> }) {
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[2.25rem] sm:text-4xl">Designs</h1>
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/designs/from-photo" className="btn btn-secondary btn-sm">Add from photo</Link>
          <Link href="/admin/designs/reproject" className="btn btn-ghost btn-sm">Rebuild photo designs</Link>
          <Link href="/admin/designs/new" className="btn btn-primary btn-sm">New design</Link>
        </div>
      </div>
      <Suspense fallback={<p className="mt-4 text-muted">Loading…</p>}>
        <Content {...props} />
      </Suspense>
    </>
  );
}
