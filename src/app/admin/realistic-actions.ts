"use server";

import { revalidatePath, updateTag } from "next/cache";
import { z } from "zod";
import { audit, requireRole } from "@/server/auth";
import { getDb } from "@/server/db";
import { setFeature } from "@/server/features";
import { storeImage } from "@/server/storage";

export type LabState = { ok?: string; error?: string } | null;

/** Admin: show or hide the Realistic 3D hand for customers (feature flag). */
export async function setRealisticLiveAction(_: LabState, form: FormData): Promise<LabState> {
  const user = await requireRole(["admin"]);
  try {
    const on = z.enum(["on", "off"]).parse(form.get("state")) === "on";
    if (on && form.get("confirm") !== "on") return { error: "Tick the box to confirm you checked the designs." };
    await setFeature(await getDb(), "realistic3d", on);
    await audit(user.id, "feature_flag", "feature", "realistic3d", { on });
    revalidatePath("/admin/designs/realistic");
    return { ok: on ? "Realistic 3D is now live for customers." : "Realistic 3D is hidden from customers again." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not change the setting." };
  }
}

/** Admin: store a 3D model texture built in the browser for a design that does not have one yet. */
export async function saveModelTextureAction(_: LabState, form: FormData): Promise<LabState> {
  const user = await requireRole(["admin"]);
  try {
    const designId = z.string().uuid().parse(form.get("design_id"));
    const side = z.enum(["palm", "back"]).parse(form.get("side"));
    const file = form.get("texture");
    if (!(file instanceof File) || !file.size) return { error: "Texture missing." };
    const url = await storeImage(file, "designs");
    const kind = side === "palm" ? "model_front" : "model_back";
    await (await getDb()).query(
      `INSERT INTO design_assets(design_id, kind, url, source) VALUES ($1,$2,$3,'upload')
       ON CONFLICT (design_id, kind) DO UPDATE SET url = EXCLUDED.url`,
      [designId, kind, url],
    );
    await audit(user.id, "model_texture_built", "design", designId, { side });
    updateTag("catalog");
    return { ok: "Built." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not save the texture." };
  }
}
