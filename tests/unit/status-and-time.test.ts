import { describe, expect, it } from "vitest";
import { assertTransition, canTransition, InvalidTransitionError, TRANSITIONS, BOOKING_STATUSES } from "@/lib/booking-status";
import { addDays, formatMinutes, istDateString, istMinutes, istToUtc, istWeekday } from "@/lib/time";

describe("booking state machine", () => {
  it("defines transitions for every status", () => {
    for (const s of BOOKING_STATUSES) expect(TRANSITIONS[s]).toBeDefined();
  });
  it("never lets a booking be confirmed before payment", () => {
    expect(canTransition("pending_payment", "confirmed")).toBe(false);
    expect(canTransition("pending_payment", "awaiting_artist_confirmation")).toBe(false);
    expect(() => assertTransition("pending_payment", "confirmed")).toThrow(InvalidTransitionError);
  });
  it("follows the paid → artist → confirmed → completed path", () => {
    expect(canTransition("pending_payment", "paid")).toBe(true);
    expect(canTransition("paid", "awaiting_artist_confirmation")).toBe(true);
    expect(canTransition("awaiting_artist_confirmation", "confirmed")).toBe(true);
    expect(canTransition("confirmed", "in_progress")).toBe(true);
    expect(canTransition("in_progress", "completed")).toBe(true);
  });
  it("treats completed and refunded as terminal", () => {
    expect(TRANSITIONS.completed).toEqual([]);
    expect(TRANSITIONS.refunded).toEqual([]);
  });
});

describe("IST time helpers", () => {
  it("converts IST wall time to UTC", () => {
    expect(istToUtc("2026-12-01", 9 * 60).toISOString()).toBe("2026-12-01T03:30:00.000Z");
    expect(istToUtc("2026-12-01", 0).toISOString()).toBe("2026-11-30T18:30:00.000Z");
  });
  it("finds the IST calendar day around midnight UTC", () => {
    expect(istDateString(new Date("2026-11-30T18:29:00Z"))).toBe("2026-11-30");
    expect(istDateString(new Date("2026-11-30T18:30:00Z"))).toBe("2026-12-01");
  });
  it("round-trips minutes and formats 12-hour times", () => {
    expect(istMinutes(istToUtc("2026-12-01", 13 * 60 + 15))).toBe(13 * 60 + 15);
    expect(formatMinutes(0)).toBe("12:00 AM");
    expect(formatMinutes(13 * 60 + 5)).toBe("1:05 PM");
  });
  it("computes weekdays and adds days across months", () => {
    expect(istWeekday("2026-11-23")).toBe(1); // Monday
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
  });
});
