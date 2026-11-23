import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { getDb } from "@/server/db";
import { currentUser } from "@/server/auth";

export const metadata = { title: "Artists" };

async function List() {
  await connection();
  const db = await getDb();
  const user = await currentUser();
  const rows = await db.query<{ id: string; name: string; phone: string; status: string; skill_level: string; verified: boolean; is_demo: boolean; areas: number; upcoming: number }>(
    `SELECT a.id, a.name, a.phone, a.status, a.skill_level, (a.verified_at IS NOT NULL) AS verified, a.is_demo,
            (SELECT count(*)::int FROM artist_service_areas s WHERE s.artist_id = a.id) AS areas,
            (SELECT count(*)::int FROM bookings b WHERE b.artist_id = a.id AND b.starts_at > now() AND b.status IN ('awaiting_artist_confirmation','confirmed')) AS upcoming
     FROM artists a ORDER BY a.status, a.name`,
  );
  const admin = user?.role === "admin";
  return (
    <>
    <ul className="mt-4 space-y-2 md:hidden">
      {rows.map((a) => (
        <li key={a.id} className="card relative p-4 text-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {admin ? (
                <Link href={`/admin/artists/${a.id}`} className="link stretched-link font-semibold">
                  {a.name}
                </Link>
              ) : (
                <span className="font-semibold">{a.name}</span>
              )}
              {a.is_demo && <span className="sample-badge ml-2">Demo</span>}
              <span className="block text-xs text-muted">{a.phone}</span>
            </div>
            <span className={`text-xs font-semibold capitalize ${a.status === "active" ? "text-success" : a.status === "suspended" ? "text-danger" : "text-muted"}`}>{a.status}</span>
          </div>
          <p className="mt-2 text-muted">
            <span className="capitalize">{a.skill_level.replace("_", " ")}</span> · {a.verified ? "Verified" : "Not verified"} · {a.areas} {a.areas === 1 ? "area" : "areas"} · {a.upcoming} upcoming
          </p>
        </li>
      ))}
      {!rows.length && <li className="card p-6 text-center text-muted">No artists yet. Add one, or review applications under Customers &amp; inbox.</li>}
    </ul>
    <div className="mt-4 hidden overflow-x-auto card md:block">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="text-left text-xs text-muted">
          <tr className="border-b hairline"><th className="p-3">Artist</th><th className="p-3">Level</th><th className="p-3">Status</th><th className="p-3">Verified</th><th className="p-3">Areas</th><th className="p-3">Upcoming</th></tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id} className="border-b hairline last:border-0">
              <td className="p-3">
                {user?.role === "admin" ? <Link href={`/admin/artists/${a.id}`} className="link font-semibold">{a.name}</Link> : <span className="font-semibold">{a.name}</span>}
                {a.is_demo && <span className="sample-badge ml-2">Demo</span>}
                <span className="block text-xs text-muted">{a.phone}</span>
              </td>
              <td className="p-3">{a.skill_level.replace("_", " ")}</td>
              <td className={`p-3 font-semibold ${a.status === "active" ? "text-success" : a.status === "suspended" ? "text-danger" : ""}`}>{a.status}</td>
              <td className="p-3">{a.verified ? "Yes" : "No"}</td>
              <td className="p-3">{a.areas}</td>
              <td className="p-3">{a.upcoming}</td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={6} className="p-8 text-center text-muted">No artists yet. Add one, or review applications under Customers &amp; inbox.</td></tr>}
        </tbody>
      </table>
    </div>
    </>
  );
}

export default function AdminArtists() {
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[2.25rem] sm:text-4xl">Artists</h1>
        <Link href="/admin/artists/new" className="btn btn-primary btn-sm">Add artist</Link>
      </div>
      <Suspense fallback={<p className="mt-4 text-muted">Loading…</p>}>
        <List />
      </Suspense>
    </>
  );
}
