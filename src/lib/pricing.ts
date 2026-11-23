// Pure pricing engine. The server is the only place that calls `computeQuote` for
// money that is charged; the client receives quotes from /api/quote. All values in paise.

export type RuleGroup = "hands" | "side" | "coverage" | "addon" | "people";
export type Region = "palm" | "back" | "palm_back" | "feet";

export interface PricingRule {
  code: string;
  group_code: RuleGroup;
  label: string;
  description: string;
  price_multiplier: number;
  flat_paise: number;
  duration_multiplier: number;
  flat_minutes: number;
  is_default: boolean;
  sort: number;
  active: boolean;
}

export interface PricingSettings {
  gst_enabled: boolean;
  gst_rate_bp: number; // basis points, 1800 = 18%
  advance_percent: number; // 0..100
  platform_fee_paise: number;
}

export interface QuoteDesign {
  id: string;
  name: string;
  region: Region;
  base_price_paise: number;
  duration_minutes: number;
}

export interface QuoteOptions {
  hands?: string;
  side?: string;
  coverage?: string;
  addons?: string[];
  people?: number;
}

export interface QuoteCoupon {
  id: string;
  code: string;
  kind: "percent" | "flat";
  value: number;
  min_order_paise: number;
  max_discount_paise: number | null;
}

export interface QuoteLine {
  kind: "design" | "option" | "addon" | "people" | "discount" | "fee" | "tax";
  code: string;
  label: string;
  quantity: number;
  amount_paise: number;
}

export interface Quote {
  lines: QuoteLine[];
  per_person_paise: number;
  subtotal_paise: number;
  discount_paise: number;
  fee_paise: number;
  tax_paise: number;
  total_paise: number;
  advance_paise: number;
  balance_paise: number;
  duration_minutes: number;
  options: Required<QuoteOptions>;
  coupon: { code: string; applied: boolean; message: string } | null;
}

export class QuoteError extends Error {}

/** Which side options make sense for a design's artwork region. */
export function allowedSides(region: Region): string[] {
  switch (region) {
    case "palm":
      return ["side_front"];
    case "back":
      return ["side_back"];
    case "palm_back":
      return ["side_front", "side_back", "side_front_back"];
    case "feet":
      return [];
  }
}

function pick(rules: PricingRule[], group: RuleGroup, code: string | undefined, allowed?: string[]) {
  const inGroup = rules.filter((r) => r.active && r.group_code === group && (!allowed || allowed.includes(r.code)));
  if (!inGroup.length) return null;
  if (code) {
    const r = inGroup.find((x) => x.code === code);
    if (!r) throw new QuoteError(`Option "${code}" is not available for this design.`);
    return r;
  }
  return inGroup.find((r) => r.is_default) ?? inGroup.sort((a, b) => a.sort - b.sort)[0];
}

const roundRupee = (paise: number) => Math.round(paise / 100) * 100;

export function computeQuote(
  design: QuoteDesign,
  rules: PricingRule[],
  settings: PricingSettings,
  opts: QuoteOptions,
  coupon?: QuoteCoupon | null,
  couponCode?: string,
): Quote {
  const people = Math.floor(opts.people ?? 1);
  if (!Number.isFinite(people) || people < 1 || people > 20) throw new QuoteError("Number of people must be between 1 and 20.");

  const hands = pick(rules, "hands", opts.hands);
  const side = design.region === "feet" ? null : pick(rules, "side", opts.side, allowedSides(design.region));
  const coverage = design.region === "feet" ? null : pick(rules, "coverage", opts.coverage);
  const chosen = [hands, side, coverage].filter(Boolean) as PricingRule[];

  let perPerson = design.base_price_paise;
  let perPersonMinutes = design.duration_minutes;
  for (const r of chosen) {
    perPerson = perPerson * Number(r.price_multiplier) + r.flat_paise;
    perPersonMinutes = perPersonMinutes * Number(r.duration_multiplier) + r.flat_minutes;
  }
  perPerson = roundRupee(perPerson);
  perPersonMinutes = Math.ceil(perPersonMinutes / 5) * 5;

  const lines: QuoteLine[] = [
    {
      kind: "design",
      code: design.id,
      label: `${design.name} — ${chosen.map((r) => r.label).join(", ") || "as shown"}`,
      quantity: 1,
      amount_paise: perPerson,
    },
  ];

  let minutes = perPersonMinutes;
  const addonCodes = Array.from(new Set(opts.addons ?? []));
  const addons: string[] = [];
  for (const code of addonCodes) {
    const r = rules.find((x) => x.active && x.group_code === "addon" && x.code === code);
    if (!r) throw new QuoteError(`Add-on "${code}" is not available.`);
    if (design.region === "feet" && code === "addon_feet") continue; // already a feet design
    addons.push(code);
    lines.push({ kind: "addon", code, label: r.label, quantity: 1, amount_paise: r.flat_paise });
    minutes += r.flat_minutes;
  }

  if (people > 1) {
    const r = rules.find((x) => x.active && x.group_code === "people");
    const factor = r ? Number(r.price_multiplier) : 1;
    const durFactor = r ? Number(r.duration_multiplier) : 1;
    const each = roundRupee(perPerson * factor);
    lines.push({
      kind: "people",
      code: r?.code ?? "people_additional",
      label: `${r?.label ?? "Additional person"} × ${people - 1}`,
      quantity: people - 1,
      amount_paise: each * (people - 1),
    });
    minutes += Math.ceil((perPersonMinutes * durFactor * (people - 1)) / 5) * 5;
  }

  const subtotal = lines.reduce((s, l) => s + l.amount_paise, 0);

  let discount = 0;
  let couponResult: Quote["coupon"] = null;
  if (couponCode) {
    if (!coupon) couponResult = { code: couponCode, applied: false, message: "This code is not valid or has expired." };
    else if (subtotal < coupon.min_order_paise)
      couponResult = { code: coupon.code, applied: false, message: `Valid on orders of ₹${coupon.min_order_paise / 100} or more.` };
    else {
      discount = coupon.kind === "percent" ? Math.round((subtotal * coupon.value) / 100) : coupon.value;
      if (coupon.max_discount_paise != null) discount = Math.min(discount, coupon.max_discount_paise);
      discount = Math.min(roundRupee(discount), subtotal);
      couponResult = { code: coupon.code, applied: true, message: "Code applied." };
      lines.push({ kind: "discount", code: coupon.code, label: `Discount (${coupon.code})`, quantity: 1, amount_paise: -discount });
    }
  }

  const fee = settings.platform_fee_paise;
  if (fee > 0) lines.push({ kind: "fee", code: "platform_fee", label: "Booking fee", quantity: 1, amount_paise: fee });

  const taxable = subtotal - discount + fee;
  const tax = settings.gst_enabled ? Math.round((taxable * settings.gst_rate_bp) / 10_000) : 0;
  if (tax > 0) lines.push({ kind: "tax", code: "gst", label: `GST (${settings.gst_rate_bp / 100}%)`, quantity: 1, amount_paise: tax });

  const total = taxable + tax;
  const pct = Math.min(100, Math.max(0, settings.advance_percent));
  let advance = Math.ceil((total * pct) / 100 / 100) * 100;
  advance = Math.min(total, Math.max(advance, total > 0 ? 100 : 0));

  return {
    lines,
    per_person_paise: perPerson,
    subtotal_paise: subtotal,
    discount_paise: discount,
    fee_paise: fee,
    tax_paise: tax,
    total_paise: total,
    advance_paise: advance,
    balance_paise: total - advance,
    duration_minutes: minutes,
    options: {
      hands: hands?.code ?? "",
      side: side?.code ?? "",
      coverage: coverage?.code ?? "",
      addons,
      people,
    },
    coupon: couponResult,
  };
}
