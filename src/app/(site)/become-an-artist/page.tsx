import type { Metadata } from "next";
import Link from "next/link";
import { ApplicationForm } from "@/components/artist/ApplicationForm";

export const metadata: Metadata = { title: "Become a VAISHORA artist" };

export default function BecomeArtistPage() {
  return (
    <div className="container-v grid max-w-5xl gap-8 py-8 md:grid-cols-[1fr_1.2fr] md:gap-10 md:py-16">
      <div>
        <h1 className="text-[2.3rem] md:text-5xl">Grow your mehndi work with VAISHORA</h1>
        <p className="mt-3 text-muted">Bookings with the advance already paid, your own working hours, your own designs and prices, and payouts straight to your bank.</p>
        <h2 className="mt-8 text-2xl">How joining works</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-muted">
          <li>Create your artist account with this form.</li>
          <li>Sign in to your artist portal with the same email — you’ll see your verification status there.</li>
          <li>Our team reviews your work and details (usually 2–3 working days) and emails you when you’re approved.</li>
          <li>Set your service areas, working days and hours, add your bank account and upload your designs with your price and time.</li>
          <li>Customers book you in your free slots. Accept, complete, and request payouts from your portal.</li>
        </ol>
        <p className="mt-6 text-sm">
          Already applied?{" "}
          <Link href="/account?artist=1" className="link">
            Sign in to the artist portal
          </Link>
        </p>
      </div>
      <ApplicationForm />
    </div>
  );
}
