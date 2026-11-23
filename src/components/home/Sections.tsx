import Link from "next/link";
import { HandIllustration } from "@/components/hand/HandIllustration";
import { DesignCard } from "@/components/studio/DesignCard";
import type { StudioDesign } from "@/components/studio/types";
import type { PublicArtist } from "@/server/catalog";
import { ArtistCard } from "@/components/artists/ArtistCard";

export function PopularDesigns({ designs }: { designs: StudioDesign[] }) {
  const list = designs.filter((d) => d.featured).slice(0, 6);
  if (!list.length) return null;
  return (
    <section className="container-v py-14 md:py-24" aria-labelledby="popular-title">
      <div className="flex items-end justify-between gap-6">
        <div>
          <h2 id="popular-title" className="text-4xl md:text-5xl">Popular mehndi designs</h2>
          <p className="mt-2 max-w-xl text-muted">Every design is original to VAISHORA and can be previewed on the 3D hand before you book.</p>
        </div>
        <Link href="/designs" className="link hidden whitespace-nowrap sm:inline">
          Browse all designs
        </Link>
      </div>
      <div className="mt-8 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        {list.map((d) => (
          <DesignCard key={d.slug} design={d} />
        ))}
      </div>
      <Link href="/designs" className="btn btn-secondary mt-8 w-full sm:hidden">
        Browse all designs
      </Link>
    </section>
  );
}

const SERVICES: { title: string; text: string; category: string; side: "palm" | "back" | "feet" }[] = [
  { title: "Bridal mehndi", text: "Full, intricate coverage for the wedding day, by bridal specialists.", category: "bridal", side: "palm" },
  { title: "Engagement mehndi", text: "Refined designs that frame the ring finger.", category: "engagement", side: "palm" },
  { title: "Party mehndi", text: "Quick, elegant designs for sangeet, Eid, Teej and Karva Chauth.", category: "floral", side: "palm" },
  { title: "Arabic mehndi", text: "Flowing trails with bold florals and open skin.", category: "arabic", side: "back" },
  { title: "Minimal mehndi", text: "Light designs that take twenty to thirty minutes.", category: "minimal", side: "palm" },
  { title: "Full hand mehndi", text: "Fingertips to wrist, front and back.", category: "full-hand", side: "palm" },
  { title: "Feet mehndi", text: "Matching designs for feet, for brides and festivals.", category: "feet", side: "feet" },
];

export function Services({ designs }: { designs: StudioDesign[] }) {
  return (
    <section id="services" className="bg-blush/55 py-14 md:py-24" aria-labelledby="services-title">
      <div className="container-v">
        <h2 id="services-title" className="text-4xl md:text-5xl">Services</h2>
        <p className="mt-2 max-w-xl text-muted">At home, at the venue, or wherever the celebration is — anywhere in our Hyderabad service area.</p>
        <ul className="mt-8 grid grid-cols-1 gap-px overflow-hidden rounded-[var(--radius-md)] border hairline bg-[var(--color-line)] sm:grid-cols-2 lg:grid-cols-4">
          {SERVICES.map((s) => {
            const d = designs.find((x) => x.category_slug === s.category);
            const art = d ? (s.side === "feet" ? d.assets.feet : s.side === "back" ? d.assets.back ?? d.assets.palm : d.assets.palm ?? d.assets.back) : null;
            return (
              <li key={s.title} className="bg-ivory">
                <Link href={`/designs?category=${s.category}`} className="flex h-full items-center gap-4 p-4 hover:bg-white">
                  <div className="w-20 flex-none rounded-[6px] bg-blush/70">
                    <HandIllustration side={s.side} art={art ?? null} />
                  </div>
                  <div>
                    <h3 className="text-[1.4rem]">{s.title}</h3>
                    <p className="text-sm text-muted">{s.text}</p>
                  </div>
                </Link>
              </li>
            );
          })}
          <li className="bg-plum">
            <Link href="/designs" className="flex h-full min-h-28 flex-col justify-center p-5 text-ivory">
              <span className="font-display text-[1.6rem] leading-tight">See every design and price</span>
              <span className="mt-1 text-sm text-blush/80">Prices shown before you book</span>
            </Link>
          </li>
        </ul>
      </div>
    </section>
  );
}

export function HowItWorks() {
  const steps = [
    { title: "Explore", text: "Choose your favourite design from the library." },
    { title: "Customise", text: "Preview it on the interactive hand and pick hands, sides and add-ons." },
    { title: "Book", text: "Select your date, time and location, and pay a small advance online." },
  ];
  return (
    <section id="how-it-works" className="container-v py-14 md:py-24" aria-labelledby="how-title">
      <h2 id="how-title" className="text-4xl md:text-5xl">How it works</h2>
      <ol className="mt-8 grid gap-6 md:mt-10 md:grid-cols-3 md:gap-8">
        {steps.map((s, i) => (
          <li key={s.title} className="relative grid grid-cols-[2.75rem_minmax(0,1fr)] border-t border-plum/25 pt-4 md:block md:pt-5">
            <span className="row-span-2 font-display text-[2.6rem] leading-none text-rose md:text-5xl" aria-hidden>
              {i + 1}
            </span>
            <h3 className="text-[1.75rem] md:mt-3 md:text-3xl">{s.title}</h3>
            <p className="mt-1 text-muted">{s.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function WhyVaishora() {
  const items = [
    { title: "Reviewed artist profiles", text: "Artists are reviewed by our team before they can take bookings. Verified badges appear only after verification." },
    { title: "Transparent pricing", text: "Every option is priced before you pay, with an itemised summary and the advance clearly shown." },
    { title: "Curated designs", text: "An original design library you can inspect on a 3D hand, palm and back." },
    { title: "Live availability", text: "Only times when an artist is genuinely free in your area are offered, with travel time built in." },
    { title: "Booking confirmation", text: "A booking reference and a private booking page that tracks your artist’s confirmation." },
    { title: "Customer support", text: "Reach our team about any booking through the contact page or WhatsApp." },
  ];
  return (
    <section className="bg-plum text-blush py-14 md:py-24" aria-labelledby="why-title">
      <div className="container-v">
        <h2 id="why-title" className="text-4xl md:text-5xl text-ivory">Why VAISHORA</h2>
        <div className="mt-10 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((it) => (
            <div key={it.title} className="border-l border-gold/50 pl-5">
              <h3 className="text-2xl text-ivory">{it.title}</h3>
              <p className="mt-1.5 text-[0.95rem] text-blush/80">{it.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function ArtistShowcase({ artists }: { artists: PublicArtist[] }) {
  return (
    <section className="container-v py-14 md:py-24" aria-labelledby="artists-title">
      <div className="flex items-end justify-between gap-6">
        <div>
          <h2 id="artists-title" className="text-4xl md:text-5xl">Featured artists</h2>
          <p className="mt-2 max-w-xl text-muted">Independent mehndi professionals across Hyderabad.</p>
        </div>
        <Link href="/artists" className="link hidden whitespace-nowrap sm:inline">
          All artists
        </Link>
      </div>
      {artists.length ? (
        <div className="scroller scroller-bleed mt-8 pb-1 sm:grid sm:grid-cols-2 sm:overflow-visible lg:grid-cols-3">
          {artists.slice(0, 6).map((a) => (
            <ArtistCard key={a.id} artist={a} className="w-[min(82%,320px)] sm:w-auto" />
          ))}
        </div>
      ) : (
        <div className="mt-8 card p-8 text-center">
          <p className="font-display text-2xl text-plum">Artist profiles are coming soon</p>
          <p className="mt-2 text-muted">We are onboarding artists now. You can still book a design and our team will assign an artist.</p>
          <Link href="/become-an-artist" className="link mt-4 inline-block">
            Are you a mehndi artist? Join VAISHORA
          </Link>
        </div>
      )}
    </section>
  );
}

export interface TestimonialItem {
  quote: string;
  name: string;
  context: string;
  sample: boolean;
}

export function Testimonials({ items }: { items: TestimonialItem[] }) {
  if (!items.length) return null;
  const sample = items.every((i) => i.sample);
  return (
    <section className="bg-blush/55 py-14 md:py-24" aria-labelledby="testimonials-title">
      <div className="container-v">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="testimonials-title" className="text-4xl md:text-5xl">What customers say</h2>
          {sample && <span className="sample-badge">Sample content — shown in development only</span>}
        </div>
        <div className="scroller scroller-bleed mt-8 pb-1 sm:grid sm:grid-cols-3 sm:overflow-visible">
          {items.map((t, i) => (
            <figure key={i} className="card w-[min(85%,340px)] p-5 sm:w-auto sm:p-6">
              <blockquote className="font-display text-[1.45rem] leading-snug text-plum">“{t.quote}”</blockquote>
              <figcaption className="mt-4 text-sm">
                <span className="font-semibold">{t.name}</span>
                <span className="text-muted"> — {t.context}</span>
                {t.sample && <span className="sample-badge ml-2">Sample</span>}
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}

export function FinalCta() {
  return (
    <section className="container-v py-20 md:py-28 text-center" aria-labelledby="final-title">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/emblem.png" alt="" className="mx-auto h-12 w-auto opacity-90" />
      <h2 id="final-title" className="mx-auto mt-4 max-w-2xl text-4xl md:text-6xl">Make your special moments more beautiful.</h2>
      <Link href="/designs" className="btn btn-primary mt-8">
        Find your mehndi artist
      </Link>
    </section>
  );
}
