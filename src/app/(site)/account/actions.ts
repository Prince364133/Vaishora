"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/server/db";
import { currentCustomer } from "@/server/customer-auth";
import { createTicket, replyToTicket } from "@/server/support";
import { notifyTeam } from "@/server/email";
import type { ActionState } from "@/app/admin/actions";

const s = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim() : "");
const CUSTOMER_CATEGORIES = ["booking", "payment", "account", "other"] as const;

function fail(e: unknown): ActionState {
  if (e instanceof z.ZodError) return { error: e.issues[0]?.message ?? "Please check the form." };
  console.error("[account]", e);
  return { error: "Something went wrong. Please try again." };
}

export async function createCustomerTicketAction(_: ActionState, form: FormData): Promise<ActionState> {
  let id = "";
  try {
    const me = await currentCustomer();
    if (!me) return { error: "Please sign in again." };
    const t = z
      .object({
        subject: z.string().min(5, "Add a short subject").max(120),
        category: z.enum(CUSTOMER_CATEGORIES),
        booking_code: z.string().max(20),
        body: z.string().min(10, "Tell us a little more").max(3000),
      })
      .parse(Object.fromEntries(["subject", "category", "booking_code", "body"].map((k) => [k, s(form.get(k))])));
    const db = await getDb();
    // Only the customer's own booking can be referenced.
    const code = t.booking_code.toUpperCase();
    if (code && !(await db.query(`SELECT 1 FROM bookings WHERE code = $1 AND customer_id = $2`, [code, me.id])).length) return { error: "That booking reference isn’t one of your bookings." };
    const urgent = code ? (await db.query(`SELECT 1 FROM bookings WHERE code = $1 AND starts_at < now() + interval '24 hours' AND starts_at > now() - interval '6 hours'`, [code])).length > 0 : false;
    const r = await db.tx((q) =>
      createTicket(q, {
        customerId: me.id,
        requesterName: me.name || "Customer",
        requesterContact: [me.phone, me.email].filter(Boolean).join(" · "),
        subject: t.subject,
        category: t.category,
        priority: urgent ? "high" : "normal",
        bookingCode: code,
        body: t.body,
        authorId: me.id,
      }),
    );
    id = r.id;
    notifyTeam({
      template: "ticket_new_customer",
      subject: `[${r.code}] ${urgent ? "HIGH — " : ""}${t.subject}`,
      heading: "New support ticket from a customer",
      paragraphs: [`From ${me.name || "a customer"}${code ? ` about booking ${code}` : ""}:`, t.body.slice(0, 1200)],
      path: `/admin/support/${r.id}`,
    });
    revalidatePath("/account/support");
    revalidatePath("/admin/support");
  } catch (e) {
    return fail(e);
  }
  redirect(`/account/support/${id}?created=1`);
}

export async function replyCustomerTicketAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const me = await currentCustomer();
    if (!me) return { error: "Please sign in again." };
    const id = z.string().uuid().parse(s(form.get("ticketId")));
    const close = s(form.get("close")) === "1";
    const body = close ? s(form.get("body")) || "Closed by customer — issue solved." : z.string().min(2, "Write a message").max(3000).parse(s(form.get("body")));
    const db = await getDb();
    if (!(await db.query(`SELECT 1 FROM support_tickets WHERE id = $1 AND customer_id = $2`, [id, me.id])).length) return { error: "Ticket not found." };
    await db.tx((q) => replyToTicket(q, id, { authorType: "customer", authorId: me.id, authorName: me.name || "Customer", body, status: close ? "closed" : undefined }));
    if (!close) notifyTeam({ template: "ticket_reply_customer", subject: "Customer replied on a ticket", heading: `${me.name || "A customer"} replied`, paragraphs: [body.slice(0, 1200)], path: `/admin/support/${id}` });
    revalidatePath(`/account/support/${id}`);
    revalidatePath("/admin/support");
    return { ok: close ? "Ticket closed." : "Reply sent." };
  } catch (e) {
    return fail(e);
  }
}
