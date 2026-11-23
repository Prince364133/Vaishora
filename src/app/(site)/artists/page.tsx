import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { cachedArtists } from "@/server/cached";
import { ArtistCard } from "@/components/artists/ArtistCard";

export const metadata: Metadata = { title: "Mehndi artists in Hyderabad" };

async function List() {
  const artists = await cachedArtists();
  if (!artists.length)
    return (
      <div className="mt-8 card p-8 text-center">
        <p className="font-display text-2xl text-plum">Artist profiles are coming soon</p>
        <p className="mt-2 text-muted">You can still book any design — we assign an available artist in your area.</p>
      </div>
    );
  return (
    <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {artists.map((a) => <ArtistCard key={a.id} artist={a} />)}
    </div>
  );
}

export default function ArtistsPage() {
  return (
    <div className="container-v py-6 md:py-12">
      <h1 className="text-[2.5rem] md:text-6xl">Artists</h1>
      <p className="mt-2 max-w-2xl text-muted">Independent mehndi professionals reviewed by our team. Ratings appear only from completed VAISHORA bookings.</p>
      <Suspense fallback={<div className="mt-8 h-96 rounded bg-blush/50" />}>
        <List />
      </Suspense>
      <p className="mt-10 text-sm">
        Are you a mehndi artist? <Link href="/become-an-artist" className="link">Apply to join VAISHORA</Link>
      </p>
    </div>
  );
}
