export interface StudioDesign {
  id: string;
  slug: string;
  name: string;
  category_slug: string;
  category_name: string;
  description: string;
  region: "palm" | "back" | "palm_back" | "feet";
  complexity: string;
  duration_minutes: number;
  base_price_paise: number;
  status: "active" | "draft" | "unavailable";
  featured: boolean;
  assets: { palm?: string; back?: string; feet?: string };
}

export interface StudioCategory {
  slug: string;
  name: string;
}

export const COMPLEXITY_LABEL: Record<string, string> = {
  simple: "Simple",
  moderate: "Detailed",
  intricate: "Intricate",
  bridal: "Bridal",
};

export function previewSide(d: StudioDesign): "palm" | "back" | "feet" {
  if (d.region === "feet") return "feet";
  if (d.region === "back") return "back";
  return "palm";
}

export function previewArt(d: StudioDesign): string | null {
  if (d.region === "feet") return d.assets.feet ?? null;
  if (d.region === "back") return d.assets.back ?? null;
  return d.assets.palm ?? d.assets.back ?? null;
}
