import { Suspense } from "react";
import type { Metadata } from "next";
import { SimpleForm } from "@/components/site/SimpleForm";
import { cachedSettings } from "@/server/cached";

export const metadata: Metadata = { title: "Contact" };

async function Channels() {
  const s = await cachedSettings();
  const { phone, whatsapp, email, hours } = s.support;
  if (!phone && !whatsapp && !email) return <p className="text-sm text-muted">Send us a message using the form and we’ll get back to you during support hours ({hours}).</p>;
  return (
    <ul className="text-sm">
      {whatsapp && <li>WhatsApp: <a className="link tap-link" href={`https://wa.me/${whatsapp.replace(/\D/g, "")}`} target="_blank" rel="noopener">{whatsapp}</a></li>}
      {phone && <li>Phone: <a className="link tap-link" href={`tel:${phone}`}>{phone}</a></li>}
      {email && <li>Email: <a className="link tap-link break-all" href={`mailto:${email}`}>{email}</a></li>}
      <li className="mt-1 text-muted">Hours: {hours}</li>
    </ul>
  );
}

async function Form({ searchParams }: { searchParams: Promise<{ booking?: string }> }) {
  const sp = await searchParams;
  return (
    <SimpleForm
      endpoint="/api/support"
      submitLabel="Send message"
      successMessage="Thanks — your message has reached our team. We’ll reply on the number you gave."
      fields={[
        { name: "name", label: "Your name", required: true, autoComplete: "name", autoCapitalize: "words" },
        { name: "phone", label: "Mobile number", type: "tel", required: true, autoComplete: "tel" },
        { name: "bookingCode", label: "Booking ID", defaultValue: sp.booking ?? "", placeholder: "VSH-XXXXXX", autoComplete: "off", autoCapitalize: "characters", spellCheck: false },
        { name: "message", label: "How can we help?", type: "textarea", required: true },
      ]}
    />
  );
}

export default function ContactPage(props: { searchParams: Promise<{ booking?: string }> }) {
  return (
    <div className="container-v grid max-w-5xl gap-8 py-8 md:grid-cols-[1fr_1.2fr] md:gap-10 md:py-16">
      <div>
        <h1 className="text-[2.5rem] md:text-5xl">Contact us</h1>
        <p className="mt-3 text-muted">Questions about a booking, a custom bridal design, or an area we don’t list yet — we’re happy to help.</p>
        <div className="mt-6">
          <Suspense fallback={null}><Channels /></Suspense>
        </div>
      </div>
      <Suspense fallback={null}><Form {...props} /></Suspense>
    </div>
  );
}
