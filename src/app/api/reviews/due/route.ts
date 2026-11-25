import { getDb } from "@/server/db";
import { currentCustomer } from "@/server/customer-auth";
import { bookingAccessToken } from "@/server/bookings";
import { findDueReview } from "@/server/reviews";
import { ok } from "@/server/http";

// The signed-in customer's booking that is ready to be rated (drives the in-app "rate or skip" prompt).
export async function GET() {
  const me = await currentCustomer();
  if (!me) return ok({ due: null });
  const due = await findDueReview(await getDb(), me.id);
  return ok({ due: due ? { ...due, token: bookingAccessToken(due.id), id: undefined } : null });
}
