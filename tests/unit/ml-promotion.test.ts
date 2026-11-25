import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => ({ getDb: vi.fn() }));
vi.mock("@/server/auth", () => ({ currentUser: vi.fn() }));

const { promotionDecision, MIN_GAIN } = await import("@/server/ml");

const s = (f1: number, n?: number) => ({ f1, n });

describe("henna model promotion rule", () => {
  it("promotes a candidate that is better on the primary set with no regressions", () => {
    const d = promotionDecision({
      candidate: { synthetic: s(0.84), real_holdout: s(0.8) },
      live: { synthetic: s(0.83), real_holdout: s(0.78) },
    });
    expect(d.promote).toBe(true);
  });

  it("rejects a candidate that regresses on any test set", () => {
    const d = promotionDecision({
      candidate: { synthetic: s(0.7), real_holdout: s(0.9) },
      live: { synthetic: s(0.83), real_holdout: s(0.78) },
    });
    expect(d.promote).toBe(false);
    expect(d.reason).toMatch(/synthetic/);
  });

  it("rejects a candidate that is only marginally better", () => {
    const d = promotionDecision({
      candidate: { real_holdout: s(0.78 + MIN_GAIN / 2) },
      live: { real_holdout: s(0.78) },
    });
    expect(d.promote).toBe(false);
  });

  it("uses the approved gold photos as the primary set once there are enough", () => {
    const better = { candidate: { real_holdout: s(0.78), real_gold: s(0.9, 6) }, live: { real_holdout: s(0.78), real_gold: s(0.8, 6) } };
    expect(promotionDecision(better).promote).toBe(true);
    const tooFew = { candidate: { real_holdout: s(0.78), real_gold: s(0.9, 2) }, live: { real_holdout: s(0.78), real_gold: s(0.8, 2) } };
    expect(promotionDecision(tooFew).promote).toBe(false); // primary falls back to real_holdout, which did not improve
  });

  it("never promotes without comparable results", () => {
    expect(promotionDecision({ candidate: {}, live: {} }).promote).toBe(false);
  });
});
