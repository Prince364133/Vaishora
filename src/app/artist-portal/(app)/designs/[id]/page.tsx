import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { requireArtist } from "@/server/artist-auth";
import { getDb } from "@/server/db";
import { getArtistDesign } from "@/server/artist-portal";
import { cachedCategories } from "@/server/cached";
import { DesignForm } from "@/components/artist/DesignForm";
import { ActionForm } from "@/components/admin/ActionForm";
import { PageHeader, reviewBadge } from "@/components/artist/ui";
import { deleteDesignAction, discardPendingEditAction, saveArtistDesignAction, setDesignAvailabilityAction } from "../../../actions";
import { AdaptiveSkeleton } from "@/components/artist/AdaptiveSkeleton";

export const metadata: Metadata = { title: "Edit design" };

type SP = { submitted?: string; review?: string; saved?: string };

async function EditDesign({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  await connection();
  const a = await requireArtist({ active: true });
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [d, categories] = await Promise.all([getArtistDesign(await getDb(), a.id, id), cachedCategories()]);
  if (!d) notFound();
  const message = sp.submitted
    ? "Design submitted! Our team will review it shortly — you’ll get an email when it’s live."
    : sp.review
      ? d.has_pending
        ? "Changes sent for review. Your current version stays live until they’re approved."
        : "Saved and sent for review."
      : sp.saved
        ? "Changes saved."
        : null;
  return (
    <>
      <PageHeader title={d.name} back={{ href: "/artist-portal/designs", label: "Designs" }} action={reviewBadge(d)} />
      {message && (
        <p className="mb-4 rounded-[var(--radius-md)] bg-[#eef6f1] px-4 py-3 text-sm text-success" role="status">
          {message}
        </p>
      )}
      {d.has_pending && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] border border-gold bg-gold/15 p-4 text-sm">
          <p>
            <span className="font-semibold">Your changes are waiting for review.</span> The form below shows them; customers still see the approved version.
          </p>
          <ActionForm action={discardPendingEditAction} submitLabel="Withdraw changes" className="[&>div]:mt-0" confirm="Tap again to withdraw">
            <input type="hidden" name="id" value={d.id} />
          </ActionForm>
        </div>
      )}
      {!d.has_pending && d.review_status === "approved" && d.review_note && (
        <div className="mb-4 rounded-[var(--radius-md)] border border-danger/30 bg-[#fbeeee] p-4 text-sm">
          <p className="font-semibold text-danger">Your last changes were not approved</p>
          <p className="mt-1">{d.review_note}</p>
        </div>
      )}
      {d.review_status === "rejected" && d.review_note && (
        <div className="mb-4 rounded-[var(--radius-md)] border border-danger/30 bg-[#fbeeee] p-4 text-sm">
          <p className="font-semibold text-danger">Our team asked for changes</p>
          <p className="mt-1">{d.review_note}</p>
          <p className="mt-2 text-muted">Update the design below and save — it goes back for review automatically.</p>
        </div>
      )}
      {d.review_status === "approved" && d.status !== "draft" && (
        <div className="card mb-4 flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p className="font-semibold text-plum-ink">{d.status === "active" ? "Live in the store" : "Hidden from the store"}</p>
            <p className="text-sm text-muted">{d.status === "active" ? "Customers can see and book this design in your free slots." : "Customers can’t see it. Make it live again any time."}</p>
          </div>
          <div className="flex items-center gap-3">
            {d.status === "active" && (
              <Link href={`/designs/${d.slug}`} className="link tap-link text-sm" target="_blank">
                View live
              </Link>
            )}
            <ActionForm action={setDesignAvailabilityAction} submitLabel={d.status === "active" ? "Hide (unlive)" : "Make live"} className="[&>div]:mt-0">
              <input type="hidden" name="id" value={d.id} />
              <input type="hidden" name="status" value={d.status === "active" ? "unavailable" : "active"} />
            </ActionForm>
          </div>
        </div>
      )}
      <DesignForm action={saveArtistDesignAction} categories={categories} design={d} />
      <section className="mt-8 border-t hairline pt-5">
        <h2 className="text-xl">Remove design</h2>
        <p className="mt-1 text-sm text-muted">{d.bookings ? "This design has bookings, so it will be archived (hidden) instead of deleted." : "This permanently deletes the design and its photos."}</p>
        <ActionForm action={deleteDesignAction} submitLabel={d.bookings ? "Archive design" : "Delete design"} confirm="Tap again to confirm" danger>
          <input type="hidden" name="id" value={d.id} />
        </ActionForm>
      </section>
    </>
  );
}

export default function EditDesignPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  return (
    <Suspense fallback={<AdaptiveSkeleton />}>
      <EditDesign params={params} searchParams={searchParams} />
    </Suspense>
  );
}
