"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { DesignCard } from "./DesignCard";
import type { StudioCategory, StudioDesign } from "./types";

type Sort = "featured" | "price-asc" | "price-desc" | "time";

export function Catalogue({ designs, categories }: { designs: StudioDesign[]; categories: StudioCategory[] }) {
  const params = useSearchParams();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("featured");
  const category = params.get("category") ?? "all";

  const setCategory = (c: string) => {
    const sp = new URLSearchParams(params);
    if (c === "all") sp.delete("category");
    else sp.set("category", c);
    router.replace(`/designs${sp.size ? `?${sp}` : ""}`, { scroll: false });
  };

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out = designs.filter(
      (d) =>
        (category === "all" || d.category_slug === category) &&
        (!needle || `${d.name} ${d.category_name} ${d.description}`.toLowerCase().includes(needle)),
    );
    const sorters: Record<Sort, (a: StudioDesign, b: StudioDesign) => number> = {
      featured: () => 0,
      "price-asc": (a, b) => a.base_price_paise - b.base_price_paise,
      "price-desc": (a, b) => b.base_price_paise - a.base_price_paise,
      time: (a, b) => a.duration_minutes - b.duration_minutes,
    };
    return [...out].sort(sorters[sort]);
  }, [designs, category, q, sort]);

  const used = categories.filter((c) => designs.some((d) => d.category_slug === c.slug));

  return (
    <>
      <div className="field mt-5 sm:mt-6 sm:max-w-md">
        <label htmlFor="q" className="sr-only">
          Search designs
        </label>
        <input
          id="q"
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          className="input"
          placeholder="Search mandala, floral, bridal…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <div className="scroller scroller-bleed mt-3 sm:flex-wrap" role="radiogroup" aria-label="Category">
        <button type="button" role="radio" aria-checked={category === "all"} className="chip" onClick={() => setCategory("all")}>
          All
        </button>
        {used.map((c) => (
          <button key={c.slug} type="button" role="radio" aria-checked={category === c.slug} className="chip" onClick={() => setCategory(c.slug)}>
            {c.name}
          </button>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-sm text-muted" aria-live="polite">
          {list.length} {list.length === 1 ? "design" : "designs"}
        </p>
        <div className="flex items-center gap-2">
          <label htmlFor="sort" className="text-sm text-muted">
            Sort
          </label>
          <select id="sort" className="input min-h-11 w-auto py-2 pl-3 pr-8" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="featured">Recommended</option>
            <option value="price-asc">Price: low to high</option>
            <option value="price-desc">Price: high to low</option>
            <option value="time">Quickest first</option>
          </select>
        </div>
      </div>
      {list.length ? (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
          {list.map((d) => (
            <DesignCard key={d.slug} design={d} />
          ))}
        </div>
      ) : (
        <div className="mt-6 card p-8 text-center">
          <p className="font-display text-2xl text-plum">No designs match</p>
          <button type="button" className="btn btn-secondary mt-4" onClick={() => { setQ(""); setCategory("all"); }}>
            Clear filters
          </button>
        </div>
      )}
    </>
  );
}
