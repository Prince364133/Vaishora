// Building blocks shared by the three AdaptiveSkeleton files (site, artist portal, admin).

export function Bone({ className = "", dark = false }: { className?: string; dark?: boolean }) {
  return <span aria-hidden className={`sk block ${dark ? "sk-on-dark" : ""} ${className}`} />;
}

/** Lines of text; the last one shorter, like a real paragraph. */
export function Lines({ n = 3, className = "" }: { n?: number; className?: string }) {
  return (
    <span aria-hidden className={`block space-y-2 ${className}`}>
      {Array.from({ length: n }, (_, i) => (
        <Bone key={i} className={`h-3.5 ${i === n - 1 ? "w-3/5" : "w-full"}`} />
      ))}
    </span>
  );
}

/** Wrapper: announces loading once to screen readers, fades in after a beat so fast loads don't flash. */
export function SkeletonFrame({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className={`sk-fade-in ${className}`}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}
