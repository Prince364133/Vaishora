import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center bg-ivory px-4 text-center">
      <div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/emblem.png" alt="" className="mx-auto h-12 w-auto" />
        <h1 className="mt-4 text-[2.6rem] sm:text-5xl">Page not found</h1>
        <p className="mt-2 text-muted">The page you’re looking for doesn’t exist or has moved.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link href="/" className="btn btn-primary">Go home</Link>
          <Link href="/designs" className="btn btn-secondary">Browse designs</Link>
        </div>
      </div>
    </main>
  );
}
