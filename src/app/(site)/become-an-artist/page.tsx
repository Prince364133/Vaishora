import type { Metadata } from "next";
import { SimpleForm } from "@/components/site/SimpleForm";

export const metadata: Metadata = { title: "Become a VAISHORA artist" };

export default function BecomeArtistPage() {
  return (
    <div className="container-v grid max-w-5xl gap-8 py-8 md:grid-cols-[1fr_1.2fr] md:gap-10 md:py-16">
      <div>
        <h1 className="text-[2.3rem] md:text-5xl">Grow your mehndi work with VAISHORA</h1>
        <p className="mt-3 text-muted">We bring you bookings with the advance already paid, a clear schedule in your areas, and a profile that shows your portfolio.</p>
        <h2 className="mt-8 text-2xl">How joining works</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-muted">
          <li>Send your details and portfolio link.</li>
          <li>Our team calls you, reviews your work and checks your ID.</li>
          <li>Once approved, you set your service areas and working hours, and start receiving booking requests.</li>
        </ol>
        <p className="mt-6 text-xs text-muted">Commission and payout terms are shared during onboarding.</p>
      </div>
      <SimpleForm
        endpoint="/api/artist-applications"
        submitLabel="Send application"
        successMessage="Thank you! We’ve received your application and will call you within a few working days."
        fields={[
          { name: "name", label: "Full name", required: true, autoComplete: "name", autoCapitalize: "words" },
          { name: "phone", label: "Mobile number", type: "tel", required: true, autoComplete: "tel" },
          { name: "email", label: "Email", type: "email", autoComplete: "email" },
          { name: "localities", label: "Areas you can travel to", placeholder: "e.g. Kondapur, Gachibowli, Madhapur", autoCapitalize: "words" },
          { name: "experience", label: "Experience", placeholder: "Years, bridal work, styles" },
          { name: "instagram", label: "Instagram or portfolio link", inputMode: "url", autoCapitalize: "none", spellCheck: false, autoComplete: "url" },
          { name: "message", label: "Anything else", type: "textarea" },
        ]}
      />
    </div>
  );
}
