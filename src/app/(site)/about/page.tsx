import Link from "next/link";

export const metadata = { title: "About VAISHORA" };

export default function AboutPage() {
  return (
    <div className="container-v max-w-3xl py-8 md:py-16">
      <p className="eyebrow">Beauty, made personal.</p>
      <h1 className="mt-2 text-[2.5rem] md:text-6xl">About VAISHORA</h1>
      <div className="mt-5 space-y-4 text-base text-muted md:mt-6 md:text-[1.05rem]">
        <p>VAISHORA connects people in Hyderabad with independent mehndi artists for weddings, engagements, festivals and everyday celebrations.</p>
        <p>We built VAISHORA so that choosing mehndi feels as considered as choosing an outfit: you can turn a design on a 3D hand, see exactly what it costs for your hands and family, and book a time when an artist near you is genuinely free.</p>
        <p>For artists, we handle discovery, scheduling and advance payments so they can focus on their craft.</p>
      </div>
      <div className="mt-8 grid gap-3 sm:flex sm:flex-wrap">
        <Link href="/designs" className="btn btn-primary">Explore designs</Link>
        <Link href="/become-an-artist" className="btn btn-secondary">Join as an artist</Link>
      </div>
    </div>
  );
}
