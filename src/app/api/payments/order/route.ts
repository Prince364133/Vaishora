import { z } from "zod";
import { createPaymentOrder } from "@/server/payments/service";
import { handleError, limit, ok, readJson } from "@/server/http";

export async function POST(req: Request) {
  const limited = limit(req, "pay-order", 20, 10 * 60_000);
  if (limited) return limited;
  try {
    const { bookingToken } = z.object({ bookingToken: z.string().min(20).max(100) }).parse(await readJson(req));
    return ok(await createPaymentOrder(bookingToken));
  } catch (e) {
    return handleError(e);
  }
}
