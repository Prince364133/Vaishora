"use client";

import { useState } from "react";

/**
 * Two tabs on an artist's public profile. Both panels are in the HTML (search engines index both);
 * only the visible one is shown. Keyboard: arrow keys switch tabs.
 */
export function ProfileTabs({ designs, portfolio, designCount, portfolioCount }: { designs: React.ReactNode; portfolio: React.ReactNode; designCount: number; portfolioCount: number }) {
  const [tab, setTab] = useState<"designs" | "portfolio">(designCount || !portfolioCount ? "designs" : "portfolio");
  const tabs = [
    ["designs", `Mehndi designs (${designCount})`],
    ["portfolio", `Portfolio (${portfolioCount})`],
  ] as const;
  return (
    <section className="mt-10">
      <div
        role="tablist"
        aria-label="Artist work"
        className="grid grid-cols-2 border-b hairline"
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "ArrowLeft") setTab((t) => (t === "designs" ? "portfolio" : "designs"));
        }}
      >
        {tabs.map(([k, l]) => (
          <button
            key={k}
            id={`tab-${k}`}
            type="button"
            role="tab"
            aria-selected={tab === k}
            aria-controls={`panel-${k}`}
            tabIndex={tab === k ? 0 : -1}
            onClick={() => setTab(k)}
            className={`-mb-px min-h-12 border-b-2 px-2 font-display text-xl transition-colors sm:text-2xl ${tab === k ? "border-plum bg-blush/50 text-plum" : "border-transparent text-muted hover:text-plum"}`}
          >
            {l}
          </button>
        ))}
      </div>
      <div id="panel-designs" role="tabpanel" aria-labelledby="tab-designs" hidden={tab !== "designs"} className="pt-5">
        {designs}
      </div>
      <div id="panel-portfolio" role="tabpanel" aria-labelledby="tab-portfolio" hidden={tab !== "portfolio"} className="pt-5">
        {portfolio}
      </div>
    </section>
  );
}
