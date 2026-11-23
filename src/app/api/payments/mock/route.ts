import { z } from "zod";
import { getDb } from "@/server/db";
import { mockCompletePayment } from "@/server/payments/provider";
import { paymentProviderName } from "@/server/env";
import { fail, handleError, ok, readJson } from "@/server/http";

// Development-only stand-in for the hosted gateway checkout. Returns 404 unless the mock
// provider is active, which is impossible in production builds.
export async function POST(req: Request) {
  if (paymentProviderName() !== "mock") return fail("Not found", 404);
  try {
    const { orderId, outcome } = z
      .object({ orderId: z.string().startsWith("order_mock_"), outcome: z.enum(["success", "failure"]) })
      .parse(await readJson(req));
    const db = await getDb();
    const rows = await db.query<{ amount_paise: number }>(`SELECT amount_paise FROM payments WHERE provider = 'mock' AND provider_order_id = $1`, [orderId]);
    if (!rows[0]) return fail("Unknown order", 404);
    return ok(mockCompletePayment(orderId, rows[0].amount_paise, outcome));
  } catch (e) {
    return handleError(e);
  }
}
