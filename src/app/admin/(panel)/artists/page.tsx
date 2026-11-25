import Link from "next/link";
import { connection } from "next/server";
import { getDb } from "@/server/db";
import { currentUser } from "@/server/auth";
import { AdaptiveSkeleton } from "@/components/admin/AdaptiveSkeleton";
import { KeyedSuspense } from "@/components/skeleton/KeyedSuspense";

export const metadata = { title: "Artists" };

const FILTERS = [
  ["all", "All"],
  ["active", "Active"],
  ["pending", "Pending"],
  ["suspended", "Suspended"],
  ["rejected", "Rejected"],
] as const;

async function List({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await connection();
  const db = await getDb();
  const user = await currentUser();
  const { status: raw } = await searchParams;
  const filter = FILTERS.some(([k]) => k === raw) ? raw! : "all";
  const rows = await db.query<{ id: string; name: string; phone: string; status: string; skill_level: string; verified: boolean; is_demo: boolean; areas: number; upcoming: number }>(
    `SELECT a.id, a.name, a.phone, a.status, a.skill_level, (a.verified_at IS NOT NULL) AS verified, a.is_demo,
            (SELECT count(*)::int FROM artist_service_areas s WHERE s.artist_id = a.id) AS areas,
            (SELECT count(*)::int FROM bookings b WHERE b.artist_id = a.id AND b.starts_at > now() AND b.status IN ('awaiting_artist_confirmation','confirmed')) AS upcoming
     FROM artists a ${filter === "all" ? "" : "WHERE a.status = $1"} ORDER BY a.status, a.name`,
    filter === "all" ? [] : [filter],
  );
  const admin = user?.role === "admin";
  return (
    <>
    <nav className="scroller mt-4 gap-2" aria-label="Filter by status">
      {FILTERS.map(([k, l]) => (
        <Link key={k} href={k === "all" ? "/admin/artists" : `/admin/artists?status=${k}`} aria-current={filter === k ? "page" : undefined} className="chip aria-[current=page]:border-plum aria-[current=page]:bg-plum aria-[current=page]:text-ivory">
          {l}
        </Link>
      ))}
    </nav>
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
            <span className={`text-xs font-semibold capitalize ${a.status === "active" ? "text-success" : (a.status === "suspended" || a.status === "rejected") ? "text-danger" : "text-muted"}`}>{a.status}</span>
          </div>
          <p className="mt-2 text-muted">
            <span className="capitalize">{a.skill_level.replace("_", " ")}</span> · {a.verified ? "Verified" : "Not verified"} · {a.areas} {a.areas === 1 ? "area" : "areas"} · {a.upcoming} upcoming
          </p>
        </li>
      ))}
      {!rows.length && <li className="card p-6 text-center text-muted">No artists here. New applications appear under Verification.</li>}
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
              <td className={`p-3 font-semibold ${a.status === "active" ? "text-success" : (a.status === "suspended" || a.status === "rejected") ? "text-danger" : ""}`}>{a.status}</td>
              <td className="p-3">{a.verified ? "Yes" : "No"}</td>
              <td className="p-3">{a.areas}</td>
              <td className="p-3">{a.upcoming}</td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={6} className="p-8 text-center text-muted">No artists here. New applications appear under Verification.</td></tr>}
        </tbody>
      </table>
    </div>
    </>
  );
}

export default function AdminArtists({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[2.25rem] sm:text-4xl">Artists</h1>
        <Link href="/admin/artists/new" className="btn btn-primary btn-sm">Add artist</Link>
      </div>
      <KeyedSuspense fallback={<AdaptiveSkeleton />}>
        <List searchParams={searchParams} />
      </KeyedSuspense>
    </>
  );
}
