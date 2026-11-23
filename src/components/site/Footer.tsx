import Link from "next/link";
import { cacheLife } from "next/cache";

async function CopyrightYear() {
  "use cache";
  cacheLife("days");
  return <>{new Date().getFullYear()}</>;
}

const cols = [
  {
    title: "VAISHORA",
    links: [
      { href: "/about", label: "About VAISHORA" },
      { href: "/become-an-artist", label: "Become an artist" },
      { href: "/contact", label: "Contact" },
    ],
  },
  {
    title: "Explore",
    links: [
      { href: "/designs", label: "Browse designs" },
      { href: "/#services", label: "Services" },
      { href: "/artists", label: "Artists" },
      { href: "/booking/find", label: "Find my booking" },
    ],
  },
  {
    title: "Policies",
    links: [
      { href: "/terms", label: "Terms and conditions" },
      { href: "/privacy", label: "Privacy policy" },
      { href: "/cancellation-refund", label: "Cancellation and refund policy" },
    ],
  },
];

export function Footer() {
  const instagram = process.env.NEXT_PUBLIC_INSTAGRAM_URL;
  const whatsapp = process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP;
  return (
    <footer className="mt-auto bg-plum text-blush">
      <div className="container-v grid grid-cols-2 gap-x-6 gap-y-8 py-12 md:grid-cols-[1.3fr_repeat(3,1fr)] md:gap-y-10 md:py-14">
        <div className="col-span-2 max-w-xs md:col-span-1">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/emblem.png" alt="" width={44} height={42} className="h-11 w-auto" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/wordmark.png" alt="VAISHORA" width={160} height={18} className="h-[18px] w-auto" />
          </div>
          <p className="mt-4 font-display text-xl italic text-rose">Beauty, made personal.</p>
          <p className="mt-3 text-sm text-blush/75">Mehndi artists for weddings, festivals and celebrations across Hyderabad.</p>
          <div className="mt-3 flex gap-5">
            {instagram && (
              <a href={instagram} className="tap-link text-sm underline decoration-rose underline-offset-4" rel="noopener" target="_blank">
                Instagram
              </a>
            )}
            {whatsapp && (
              <a href={`https://wa.me/${whatsapp.replace(/\D/g, "")}`} className="tap-link text-sm underline decoration-rose underline-offset-4" rel="noopener" target="_blank">
                WhatsApp
              </a>
            )}
          </div>
        </div>
        {cols.map((c) => (
          <div key={c.title} className={c.title === "Policies" ? "col-span-2 md:col-span-1" : undefined}>
            <h2 className="font-sans text-sm font-semibold text-gold">{c.title}</h2>
            <ul className={`mt-2 md:mt-3 md:space-y-1 ${c.title === "Policies" ? "grid grid-cols-2 gap-x-6 md:block" : ""}`}>
              {c.links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="tap-link py-1 text-sm leading-snug text-blush/85 hover:text-ivory pointer-fine:md:min-h-0">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-white/10">
        <div className="container-v flex flex-col gap-1 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-xs text-blush/60 sm:flex-row sm:justify-between">
          <p>
            © <CopyrightYear /> VAISHORA. All rights reserved.
          </p>
          <p>Prices in INR. Service area: Hyderabad.</p>
        </div>
      </div>
    </footer>
  );
}
