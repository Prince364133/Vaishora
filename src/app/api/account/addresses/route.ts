import { getDb } from "@/server/db";
import { currentCustomer } from "@/server/customer-auth";
import { addressInputSchema, createAddress, listAddresses } from "@/server/customer-addresses";
import { fail, handleError, limit, ok, readJson } from "@/server/http";

// The signed-in customer's saved addresses.
export async function GET() {
  const me = await currentCustomer();
  if (!me) return ok({ addresses: [] });
  return ok({ addresses: await listAddresses(await getDb(), me.id) });
}

export async function POST(req: Request) {
  const limited = limit(req, "address-save", 30, 10 * 60_000);
  if (limited) return limited;
  try {
    const me = await currentCustomer();
    if (!me) return fail("Please sign in to save addresses.", 401);
    const input = addressInputSchema.parse(await readJson(req, 4000));
    const db = await getDb();
    const address = await db.tx((q) => createAddress(q, me.id, input));
    return ok({ address }, { status: 201 });
  } catch (e) {
    if (e instanceof Error && /locality|20 addresses/.test(e.message)) return fail(e.message, 422);
    return handleError(e);
  }
}
