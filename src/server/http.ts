import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { BookingError } from "./bookings";
import { PaymentProviderError } from "./payments/provider";
import { InvalidTransitionError } from "@/lib/booking-status";
import { ipFrom, rateLimit } from "./rate-limit";

export function ok(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, { ...init, headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) } });
}

export function fail(message: string, status = 400, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: message, ...extra }, { status, headers: { "Cache-Control": "no-store" } });
}

export function handleError(e: unknown) {
  if (e instanceof ZodError) {
    const first = e.issues[0];
    return fail(first?.message ?? "Invalid request", 422, { field: first?.path.join(".") });
  }
  if (e instanceof BookingError) return fail(e.message, e.status, { code: e.code });
  if (e instanceof PaymentProviderError) return fail(e.message, e.status);
  if (e instanceof InvalidTransitionError) return fail(e.message, 409);
  console.error("[api]", e);
  return fail("Something went wrong on our side. Please try again.", 500);
}

/** Returns a 429 response when the caller exceeded the limit, otherwise null. */
export function limit(req: Request, name: string, max: number, windowMs: number) {
  const r = rateLimit(`${name}:${ipFrom(req)}`, max, windowMs);
  return r.ok ? null : fail("Too many requests. Please wait a moment and try again.", 429, { retryAfter: r.retryAfter });
}

export async function readJson(req: Request, maxBytes = 20_000): Promise<unknown> {
  const text = await req.text();
  if (text.length > maxBytes) throw new BookingError("Request too large", "invalid", 413);
  try {
    return JSON.parse(text);
  } catch {
    throw new BookingError("Invalid JSON", "invalid", 400);
  }
}
