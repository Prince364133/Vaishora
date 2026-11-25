import { z } from "zod";
import { getDb } from "@/server/db";
import { currentCustomer } from "@/server/customer-auth";
import { addressInputSchema, deleteAddress, updateAddress } from "@/server/customer-addresses";
import { fail, handleError, ok, readJson } from "@/server/http";

const patchSchema = addressInputSchema.pick({ label: true, house: true, building: true, landmark: true, instructions: true, is_default: true }).partial();

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const me = await currentCustomer();
    if (!me) return fail("Please sign in again.", 401);
    const id = z.string().uuid().parse((await ctx.params).id);
    const patch = patchSchema.parse(await readJson(req, 4000));
    const db = await getDb();
    return ok({ address: await db.tx((q) => updateAddress(q, me.id, id, patch)) });
  } catch (e) {
    if (e instanceof Error && e.message === "Address not found.") return fail(e.message, 404);
    return handleError(e);
  }
}

export async function DELETE(_: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const me = await currentCustomer();
    if (!me) return fail("Please sign in again.", 401);
    const id = z.string().uuid().parse((await ctx.params).id);
    const db = await getDb();
    await db.tx((q) => deleteAddress(q, me.id, id));
    return ok({ deleted: true });
  } catch (e) {
    return handleError(e);
  }
}
