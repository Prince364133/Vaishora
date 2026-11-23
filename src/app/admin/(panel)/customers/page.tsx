import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { getDb } from "@/server/db";
import { ActionForm } from "@/components/admin/ActionForm";
import { updateInboxAction } from "../../actions";
import { formatPaise } from "@/lib/money";
import { formatIstDate } from "@/lib/time";

export const metadata = { title: "Customers & inbox" };

async function Content({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await connection();
  const sp = await searchParams;
  const db = await getDb();
  const q = sp.q?.trim();
  const [customers, support, apps] = await Promise.all([
    db.query<{ id: string; name: string; phone: string; email: string | null; bookings: number; spent: number; last: string | null; last_id: string | null }>(
      `SELECT c.id, c.name, c.phone, c.email,
              (SELECT count(*)::int FROM bookings b WHERE b.customer_id = c.id AND b.status NOT IN ('expired')) AS bookings,
              COALESCE((SELECT sum(p.amount_paise) FROM payments p JOIN bookings b ON b.id = p.booking_id WHERE b.customer_id = c.id AND p.status IN ('captured','partially_refunded')),0)::int AS spent,
              (SELECT max(b.starts_at) FROM bookings b WHERE b.customer_id = c.id) AS last,
              (SELECT b.id FROM bookings b WHERE b.customer_id = c.id ORDER BY b.created_at DESC LIMIT 1) AS last_id
       FROM customers c ${q ? "WHERE c.name ILIKE $1 OR c.phone ILIKE $1" : ""} ORDER BY c.created_at DESC LIMIT 200`,
      q ? [`%${q}%`] : [],
    ),
    db.query<{ id: string; name: string; phone: string; booking_code: string | null; message: string; status: string; created_at: string }>(`SELECT * FROM support_requests ORDER BY status, created_at DESC LIMIT 50`),
    db.query<{ id: string; name: string; phone: string; email: string | null; localities: string; experience: string; instagram: string | null; message: string; status: string; created_at: string }>(
      `SELECT * FROM artist_applications ORDER BY status, created_at DESC LIMIT 50`,
    ),
  ]);
  return (
    <div className="space-y-10">
      <section>
        <form className="mt-4 flex gap-2" role="search">
          <input name="q" type="search" enterKeyHint="search" autoComplete="off" aria-label="Search customers" defaultValue={q} className="input min-w-0 flex-1 sm:max-w-xs sm:flex-none" placeholder="Name or phone" />
          <button className="btn btn-secondary flex-none">Search</button>
        </form>
        <ul className="mt-3 space-y-2 md:hidden">
          {customers.map((c) => (
            <li key={c.id} className="card p-4 text-sm">
              <p className="font-semibold">{c.name}</p>
              <p className="text-xs text-muted [overflow-wrap:anywhere]">
                {c.phone}
                {c.email && ` · ${c.email}`}
              </p>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 border-t hairline pt-1">
                <Link className="link tap-link" href={`/admin/bookings?q=${encodeURIComponent(c.phone)}`}>
                  {c.bookings} {c.bookings === 1 ? "booking" : "bookings"}
                </Link>
                <span className="text-muted">
                  {formatPaise(c.spent)} paid{c.last && ` · last ${formatIstDate(c.last)}`}
                </span>
              </div>
            </li>
          ))}
          {!customers.length && <li className="card p-6 text-center text-muted">No customers yet.</li>}
        </ul>
        <div className="mt-3 hidden overflow-x-auto card md:block">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-xs text-muted">
              <tr className="border-b hairline"><th className="p-3">Customer</th><th className="p-3">Bookings</th><th className="p-3">Paid online</th><th className="p-3">Latest service</th></tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id} className="border-b hairline last:border-0">
                  <td className="p-3"><span className="font-semibold">{c.name}</span><span className="block text-xs text-muted">{c.phone}{c.email && ` · ${c.email}`}</span></td>
                  <td className="p-3"><Link className="link" href={`/admin/bookings?q=${encodeURIComponent(c.phone)}`}>{c.bookings}</Link></td>
                  <td className="p-3">{formatPaise(c.spent)}</td>
                  <td className="p-3">{c.last ? formatIstDate(c.last) : "—"}</td>
                </tr>
              ))}
              {!customers.length && <tr><td colSpan={4} className="p-8 text-center text-muted">No customers yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-2xl">Support requests</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {support.map((r) => (
            <div key={r.id} className="card p-4 text-sm">
              <p className="font-semibold [overflow-wrap:anywhere]">{r.name} · {r.phone}{r.booking_code && ` · ${r.booking_code}`}</p>
              <p className="text-xs text-muted">{formatIstDate(r.created_at)} · {r.status}</p>
              <p className="mt-2 whitespace-pre-wrap [overflow-wrap:anywhere]">{r.message}</p>
              <ActionForm action={updateInboxAction} submitLabel={r.status === "open" ? "Mark resolved" : "Reopen"} className="mt-1">
                <input type="hidden" name="table" value="support_requests" />
                <input type="hidden" name="id" value={r.id} />
                <input type="hidden" name="status" value={r.status === "open" ? "resolved" : "open"} />
              </ActionForm>
            </div>
          ))}
          {!support.length && <p className="text-muted">No support requests.</p>}
        </div>
      </section>

      <section>
        <h2 className="text-2xl">Artist applications</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {apps.map((r) => (
            <div key={r.id} className="card p-4 text-sm">
              <p className="font-semibold [overflow-wrap:anywhere]">{r.name} · {r.phone}{r.email && ` · ${r.email}`}</p>
              <p className="text-xs text-muted [overflow-wrap:anywhere]">{formatIstDate(r.created_at)} · {r.status}{r.instagram && ` · ${r.instagram}`}</p>
              {r.localities && <p className="mt-2"><span className="text-muted">Areas:</span> {r.localities}</p>}
              {r.experience && <p><span className="text-muted">Experience:</span> {r.experience}</p>}
              {r.message && <p className="mt-1 whitespace-pre-wrap">{r.message}</p>}
              <ActionForm action={updateInboxAction} submitLabel="Update" className="mt-1 flex items-end gap-2 [&>div]:mt-0">
                <input type="hidden" name="table" value="artist_applications" />
                <input type="hidden" name="id" value={r.id} />
                <select name="status" aria-label="Application status" defaultValue={r.status} className="input min-h-11 min-w-0 flex-1 py-1"><option value="new">New</option><option value="contacted">Contacted</option><option value="onboarded">Onboarded</option><option value="declined">Declined</option></select>
              </ActionForm>
            </div>
          ))}
          {!apps.length && <p className="text-muted">No applications yet.</p>}
        </div>
      </section>
    </div>
  );
}

export default function CustomersPage(props: { searchParams: Promise<{ q?: string }> }) {
  return (
    <>
      <h1 className="text-[2.25rem] sm:text-4xl">Customers &amp; inbox</h1>
      <Suspense fallback={<p className="mt-4 text-muted">Loading…</p>}>
        <Content {...props} />
      </Suspense>
    </>
  );
}
