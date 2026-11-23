import { describe, expect, it } from "vitest";
import { computeQuote, PricingRule, PricingSettings, QuoteError } from "@/lib/pricing";

const rule = (code: string, group_code: PricingRule["group_code"], p: Partial<PricingRule> = {}): PricingRule => ({
  code, group_code, label: code, description: "", price_multiplier: 1, flat_paise: 0, duration_multiplier: 1, flat_minutes: 0, is_default: false, sort: 0, active: true, ...p,
});

const rules: PricingRule[] = [
  rule("hands_one", "hands", { is_default: true }),
  rule("hands_both", "hands", { price_multiplier: 1.8, duration_multiplier: 1.8 }),
  rule("side_front", "side", { is_default: true }),
  rule("side_back", "side"),
  rule("side_front_back", "side", { price_multiplier: 1.7, duration_multiplier: 1.7 }),
  rule("coverage_full", "coverage", { is_default: true }),
  rule("coverage_half", "coverage", { price_multiplier: 0.65, duration_multiplier: 0.65 }),
  rule("addon_feet", "addon", { flat_paise: 69900, flat_minutes: 45 }),
  rule("addon_bridal_custom", "addon", { flat_paise: 149900, flat_minutes: 60 }),
  rule("people_additional", "people", { price_multiplier: 0.85, duration_multiplier: 0.9 }),
];
const settings: PricingSettings = { gst_enabled: false, gst_rate_bp: 1800, advance_percent: 30, platform_fee_paise: 0 };
const mandala = { id: "d1", name: "Classic Mandala", region: "palm" as const, base_price_paise: 99900, duration_minutes: 60 };
const both = { ...mandala, region: "palm_back" as const };

describe("computeQuote", () => {
  it("defaults to one hand, front, full — the starting price", () => {
    const q = computeQuote(mandala, rules, settings, {});
    expect(q.total_paise).toBe(99900);
    expect(q.duration_minutes).toBe(60);
    expect(q.advance_paise).toBe(30000); // 30% rounded up to the rupee
    expect(q.balance_paise).toBe(69900);
  });

  it("applies multipliers, add-ons and extra people (matches the E2E-verified ₹4,025)", () => {
    const q = computeQuote(mandala, rules, settings, { hands: "hands_both", addons: ["addon_feet"], people: 2 });
    expect(q.per_person_paise).toBe(179800);
    expect(q.lines.find((l) => l.kind === "people")!.amount_paise).toBe(152800);
    expect(q.total_paise).toBe(179800 + 69900 + 152800);
    expect(q.duration_minutes).toBe(110 + 45 + 100);
  });

  it("rejects a side option the design artwork does not support", () => {
    expect(() => computeQuote(mandala, rules, settings, { side: "side_back" })).toThrow(QuoteError);
    expect(computeQuote(both, rules, settings, { side: "side_front_back" }).total_paise).toBe(169800);
  });

  it("rejects unknown add-ons and invalid people counts", () => {
    expect(() => computeQuote(mandala, rules, settings, { addons: ["free_money"] })).toThrow(QuoteError);
    expect(() => computeQuote(mandala, rules, settings, { people: 0 })).toThrow(QuoteError);
    expect(() => computeQuote(mandala, rules, settings, { people: 21 })).toThrow(QuoteError);
  });

  it("ignores inactive rules", () => {
    const off = rules.map((r) => (r.code === "hands_both" ? { ...r, active: false } : r));
    expect(() => computeQuote(mandala, off, settings, { hands: "hands_both" })).toThrow(QuoteError);
  });

  it("applies percent coupons with a cap, and reports minimum-order failures", () => {
    const coupon = { id: "c", code: "WED10", kind: "percent" as const, value: 10, min_order_paise: 50000, max_discount_paise: 5000 };
    const q = computeQuote(mandala, rules, settings, { hands: "hands_both" }, coupon, "WED10");
    expect(q.discount_paise).toBe(5000);
    expect(q.coupon?.applied).toBe(true);
    const small = computeQuote({ ...mandala, base_price_paise: 30000 }, rules, settings, {}, coupon, "WED10");
    expect(small.coupon?.applied).toBe(false);
    expect(small.discount_paise).toBe(0);
    const unknown = computeQuote(mandala, rules, settings, {}, null, "NOPE");
    expect(unknown.coupon?.applied).toBe(false);
  });

  it("adds GST and fees only when configured", () => {
    const q = computeQuote(mandala, rules, { ...settings, gst_enabled: true, platform_fee_paise: 4900 }, {});
    expect(q.fee_paise).toBe(4900);
    expect(q.tax_paise).toBe(Math.round((99900 + 4900) * 0.18));
    expect(q.total_paise).toBe(99900 + 4900 + q.tax_paise);
  });

  it("feet designs ignore side/coverage and the feet add-on", () => {
    const feet = { ...mandala, region: "feet" as const };
    const q = computeQuote(feet, rules, settings, { addons: ["addon_feet"] });
    expect(q.total_paise).toBe(99900);
    expect(q.options.side).toBe("");
  });
});
