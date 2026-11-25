import "server-only";
import crypto from "node:crypto";
import { Queryable } from "./db";

// Support tickets: a thread of messages between a requester (artist today; customers can be added)
// and the VAISHORA team.

export const TICKET_CATEGORIES = ["booking", "payment", "payout", "account", "design", "technical", "other"] as const;
export const TICKET_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export const TICKET_STATUSES = ["open", "in_progress", "awaiting_reply", "resolved", "closed"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  awaiting_reply: "Waiting for your reply",
  resolved: "Resolved",
  closed: "Closed",
};

export const TICKET_CATEGORY_LABEL: Record<(typeof TICKET_CATEGORIES)[number], string> = {
  booking: "Booking",
  payment: "Customer payment",
  payout: "Payout",
  account: "Account & verification",
  design: "Designs",
  technical: "App problem",
  other: "Something else",
};

export interface Ticket {
  id: string;
  code: string;
  artist_id: string | null;
  customer_id: string | null;
  requester_name: string;
  requester_contact: string;
  subject: string;
  category: (typeof TICKET_CATEGORIES)[number];
  priority: (typeof TICKET_PRIORITIES)[number];
  status: TicketStatus;
  booking_code: string | null;
  last_actor: string;
  created_at: string;
  updated_at: string;
  message_count: number;
}

export interface TicketMessage {
  id: string;
  author_type: "artist" | "admin" | "customer" | "system";
  author_name: string;
  body: string;
  created_at: string;
}

const SELECT = `SELECT t.id, t.code, t.artist_id, t.customer_id, t.requester_name, t.requester_contact, t.subject, t.category, t.priority, t.status,
  t.booking_code, t.last_actor, t.created_at, t.updated_at, (SELECT count(*)::int FROM ticket_messages m WHERE m.ticket_id = t.id) AS message_count
  FROM support_tickets t`;

function ticketCode() {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  return `TKT-${[...crypto.randomBytes(6)].map((b) => alphabet[b % alphabet.length]).join("")}`;
}

/** A ticket from an artist (`artistId`) or a customer (`customerId`). */
export async function createTicket(
  q: Queryable,
  t: { artistId?: string; customerId?: string; requesterName: string; requesterContact: string; subject: string; category: string; priority: string; bookingCode?: string; body: string; authorId: string },
) {
  const actor = t.customerId ? "customer" : "artist";
  const r = await q.query<{ id: string; code: string }>(
    `INSERT INTO support_tickets(code, artist_id, customer_id, requester_name, requester_contact, subject, category, priority, booking_code, last_actor)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, code`,
    [ticketCode(), t.artistId ?? null, t.customerId ?? null, t.requesterName, t.requesterContact, t.subject, t.category, t.priority, t.bookingCode || null, actor],
  );
  await q.query(`INSERT INTO ticket_messages(ticket_id, author_type, author_id, author_name, body) VALUES ($1,$2,$3,$4,$5)`, [r[0].id, actor, t.authorId, t.requesterName, t.body]);
  return r[0];
}

export async function listTickets(q: Queryable, opts: { artistId?: string; customerId?: string; status?: "active" | "done" | "all" } = {}) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.artistId) {
    params.push(opts.artistId);
    where.push(`t.artist_id = $${params.length}`);
  }
  if (opts.customerId) {
    params.push(opts.customerId);
    where.push(`t.customer_id = $${params.length}`);
  }
  if (opts.status === "active") where.push(`t.status IN ('open','in_progress','awaiting_reply')`);
  if (opts.status === "done") where.push(`t.status IN ('resolved','closed')`);
  return q.query<Ticket>(
    `${SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, t.updated_at DESC LIMIT 200`,
    params,
  );
}

/** `scope` limits to the owner's own tickets: an artist id, or `{ customerId }`. */
export async function getTicket(q: Queryable, id: string, scope?: string | { customerId: string }) {
  const params: unknown[] = [id];
  let extra = "";
  if (typeof scope === "string") {
    params.push(scope);
    extra = " AND t.artist_id = $2";
  } else if (scope) {
    params.push(scope.customerId);
    extra = " AND t.customer_id = $2";
  }
  const t = (await q.query<Ticket>(`${SELECT} WHERE t.id = $1${extra}`, params))[0];
  if (!t) return null;
  const messages = await q.query<TicketMessage>(
    `SELECT id::text, author_type, author_name, body, created_at FROM ticket_messages WHERE ticket_id = $1 ORDER BY created_at, id`,
    [id],
  );
  return { ticket: t, messages };
}

/** Adds a reply and moves the ticket to the status that follows from who replied. */
export async function replyToTicket(
  q: Queryable,
  ticketId: string,
  m: { authorType: "artist" | "customer" | "admin"; authorId: string; authorName: string; body: string; status?: TicketStatus },
) {
  await q.query(`INSERT INTO ticket_messages(ticket_id, author_type, author_id, author_name, body) VALUES ($1,$2,$3,$4,$5)`, [ticketId, m.authorType, m.authorId, m.authorName, m.body]);
  // An artist reply reopens a resolved ticket; an admin reply waits for the artist unless a status is chosen.
  const next = m.status ?? (m.authorType === "admin" ? "awaiting_reply" : "open");
  await q.query(
    `UPDATE support_tickets SET status = $2, last_actor = $3, updated_at = now(),
       resolved_at = CASE WHEN $2 IN ('resolved','closed') THEN now() ELSE NULL END WHERE id = $1`,
    [ticketId, next, m.authorType],
  );
}
