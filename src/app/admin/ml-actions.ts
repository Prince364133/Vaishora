"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit, requireRole } from "@/server/auth";
import { promote } from "@/server/ml";

export type MlActionState = { ok?: string; error?: string } | null;

/** Admin: make a model version live (promote a candidate, or roll back to an older version). */
export async function makeModelLiveAction(_: MlActionState, form: FormData): Promise<MlActionState> {
  const user = await requireRole(["admin"]);
  try {
    const version = z.coerce.number().int().min(0).parse(form.get("version"));
    await promote(version, user.id, "Made live by an admin.");
    await audit(user.id, "ml_model_promoted", "ml_model", String(version), { manual: true });
    revalidatePath("/admin/designs/models");
    return { ok: `Version ${version} is now live.` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not change the live model." };
  }
}
