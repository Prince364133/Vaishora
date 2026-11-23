import { z } from "zod";
import { verify180Payment, verifyCheckout } from "@/server/payments/service";
import { handleError, limit, ok, readJson } from "@/server/http";
import { verifyPaymentSchema } from "@/lib/schemas";

export async function POST(req: Request) {
  const limited = limit(req, "pay-verify", 30, 10 * 60_000);
  if (limited) return limited;
  try {
    const raw = (await readJson(req)) as Record<string, unknown>;
    if (raw?.provider === "180pay") {
      const b = z
        .object({ bookingToken: z.string().min(20).max(100), orderId: z.string().regex(/^vsh_[A-Za-z0-9_]+$/), sessionId: z.string().min(6).max(140) })
        .parse(raw);
      const r = await verify180Payment(b);
      return ok({ outcome: r.outcome });
    }
    const body = verifyPaymentSchema.parse(raw);
    const result = await verifyCheckout(body);
    return ok({ outcome: result.outcome });
  } catch (e) {
    return handleError(e);
  }
}
