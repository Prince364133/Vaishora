export function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <article className="container-v max-w-3xl py-8 md:py-16">
      <h1 className="text-[2.4rem] md:text-5xl">{title}</h1>
      <p className="mt-4 rounded-[var(--radius-sm)] border border-gold bg-gold/15 px-4 py-3 text-sm">
        Draft for review. This text is a starting point written for the product and has not been reviewed by a lawyer. It must be checked against current Indian
        consumer protection, IT and data protection (DPDP Act, 2023) requirements before launch.
      </p>
      <div className="mt-8 space-y-4 text-base leading-7 [&_h2]:mt-8 [&_h2]:text-[1.6rem] md:[&_h2]:text-2xl [&_li]:ml-5 [&_li]:list-disc [&_p]:text-plum-ink/90">{children}</div>
    </article>
  );
}
