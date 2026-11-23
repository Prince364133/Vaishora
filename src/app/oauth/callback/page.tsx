// Redirect target registered with 180 Identity. The bottom sheet normally completes in-page;
// if a full-page redirect happens, send the customer back to continue browsing.
import Link from "next/link";

export const metadata = { title: "Signing in", robots: { index: false } };

export default function OAuthCallback() {
  return (
    <main className="grid min-h-dvh place-items-center bg-ivory px-4 text-center">
      <div>
        <h1 className="text-4xl">You’re signed in</h1>
        <p className="mt-2 text-muted">Return to your booking to finish checkout.</p>
        <Link href="/designs" className="btn btn-primary mt-6">Continue</Link>
      </div>
    </main>
  );
}
