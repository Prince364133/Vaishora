import { handleRazorpayWebhook } from "@/server/payments/service";
import { fail, handleError, ok } from "@/server/http";

// Razorpay Dashboard -> Webhooks: URL /api/webhooks/razorpay, secret = RAZORPAY_WEBHOOK_SECRET,
// events: payment.captured, payment.failed, order.paid, refund.processed, refund.failed.
export async function POST(req: Request) {
  const raw = await req.text(); // verify against the exact raw body, before parsing
  if (raw.length > 1_000_000) return fail("Payload too large", 413);
  try {
    const r = await handleRazorpayWebhook(raw, req.headers.get("x-razorpay-signature") ?? "", req.headers.get("x-razorpay-event-id"));
    return ok({ received: true, duplicate: r.duplicate });
  } catch (e) {
    return handleError(e);
  }
}
