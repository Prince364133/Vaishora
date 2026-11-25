import { youTubeId } from "@/lib/youtube";
import { describeChanges, type DesignSnapshot } from "@/server/design-revisions";
import { describe, expect, it } from "vitest";
import { earningFor } from "@/server/ledger";
import { decryptField, encryptField } from "@/server/vault";
import { formatPhone, percentFromBp } from "@/lib/format";

describe("artist earnings", () => {
  it("credits the advance minus the platform margin; the artist keeps the cash balance", () => {
    // ₹2,000 booking, 30% advance online, 20% margin
    const e = earningFor(200_000, 60_000, 2000);
    expect(e.margin_paise).toBe(40_000);
    expect(e.cash_paise).toBe(140_000);
    expect(e.payable_paise).toBe(20_000);
    expect(e.net_paise).toBe(160_000); // cash + payable = total − margin
    expect(e.cash_paise + e.payable_paise).toBe(e.net_paise);
  });

  it("goes negative when the margin is larger than the advance", () => {
    const e = earningFor(100_000, 10_000, 2500);
    expect(e.payable_paise).toBe(-15_000);
    expect(e.net_paise).toBe(75_000);
  });

  it("never treats more than the total as advance", () => {
    expect(earningFor(50_000, 80_000, 0).advance_paise).toBe(50_000);
  });
});

describe("vault", () => {
  it("round-trips and does not store the plain value", () => {
    const enc = encryptField("123456789012");
    expect(enc).not.toContain("123456789012");
    expect(decryptField(enc)).toBe("123456789012");
    expect(encryptField("123456789012")).not.toBe(enc); // random IV
  });

  it("rejects tampered ciphertext", () => {
    const enc = encryptField("987654321");
    const parts = enc.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptField(parts.join("."))).toThrow();
  });
});

describe("format helpers", () => {
  it("formats Indian mobiles and margins", () => {
    expect(formatPhone("+916205170591")).toBe("+91 62051 70591");
    expect(percentFromBp(2000)).toBe("20%");
    expect(percentFromBp(1250)).toBe("12.5%");
  });
});


describe("YouTube links", () => {
  it("accepts every common link shape and rejects others", () => {
    for (const u of [
      "https://www.youtube.com/watch?v=z96hSI23fGg",
      "https://youtu.be/z96hSI23fGg?si=abc",
      "https://youtube.com/shorts/z96hSI23fGg",
      "https://m.youtube.com/watch?v=z96hSI23fGg&t=10",
      "https://www.youtube.com/embed/z96hSI23fGg",
      "z96hSI23fGg",
    ])
      expect(youTubeId(u)).toBe("z96hSI23fGg");
    expect(youTubeId("https://vimeo.com/123")).toBeNull();
    expect(youTubeId("https://youtube.com/watch?v=short")).toBeNull();
    expect(youTubeId("")).toBeNull();
  });
});

describe("design edit summary", () => {
  const base: DesignSnapshot = { name: "A", category_slug: "bridal", description: "d", includes: "", region: "palm", complexity: "simple", duration_minutes: 60, base_price_paise: 100000, video_url: null, photos: ["/1.jpg"], assets: {} };
  it("lists exactly what changed", () => {
    expect(describeChanges(base, base)).toEqual([]);
    const c = describeChanges(base, { ...base, base_price_paise: 150000, photos: ["/1.jpg", "/2.jpg"], video_url: "https://youtu.be/z96hSI23fGg" });
    expect(c).toContain("Price: ₹1,000 → ₹1,500");
    expect(c.some((x) => x.startsWith("Photos: 1 → 2"))).toBe(true);
    expect(c.some((x) => x.startsWith("Video:"))).toBe(true);
  });
});
