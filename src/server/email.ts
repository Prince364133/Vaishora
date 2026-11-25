import "server-only";
import { after } from "next/server";
import { getDb, Queryable } from "./db";
import { siteUrl } from "./env";

// Transactional email over SMTP (any provider: Gmail/Workspace, Zoho, Amazon SES, Brevo…).
// Every message is recorded in `notifications`; delivery problems are logged there and never
// break the request that triggered the email.
//
//   SMTP_HOST, SMTP_PORT (587 STARTTLS / 465 TLS), SMTP_SECURE (optional), SMTP_USER, SMTP_PASS,
//   SMTP_FROM or EMAIL_FROM ("VAISHORA <no-reply@…>" or a bare address)

/** Sender: SMTP_FROM / EMAIL_FROM; a bare address gets the brand name. */
export function emailFrom() {
  const raw = (process.env.SMTP_FROM || process.env.EMAIL_FROM || process.env.SMTP_USER || "").trim();
  if (!raw) return "";
  return raw.includes("<") ? raw : `"VAISHORA" <${raw}>`;
}

export function smtpConfigured() {
  return !!(process.env.SMTP_HOST && emailFrom());
}

type Transport = { sendMail: (m: Record<string, unknown>) => Promise<unknown> };
const g = globalThis as unknown as { __vaishoraMailer?: Promise<Transport> };

async function transport(): Promise<Transport> {
  if (!g.__vaishoraMailer) {
    g.__vaishoraMailer = (async () => {
      const nodemailer = await import("nodemailer");
      const port = Number(process.env.SMTP_PORT ?? 587);
      const secure = process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : port === 465;
      return nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port,
        secure,
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? "" } : undefined,
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 15_000,
      }) as unknown as Transport;
    })().catch((e) => {
      g.__vaishoraMailer = undefined;
      throw e;
    });
  }
  return g.__vaishoraMailer;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Branded, minimal HTML layout. `paragraphs` are plain text (escaped here). */
function layout(heading: string, paragraphs: string[], cta?: { label: string; href: string }) {
  const body = paragraphs.map((p) => `<p style="margin:0 0 14px;line-height:1.55">${esc(p)}</p>`).join("");
  const button = cta
    ? `<p style="margin:22px 0 6px"><a href="${esc(cta.href)}" style="display:inline-block;background:#5b1f3d;color:#fff8f1;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">${esc(cta.label)}</a></p>`
    : "";
  return `<!doctype html><html><body style="margin:0;background:#fbf5f3;font-family:Arial,Helvetica,sans-serif;color:#2d1622">
<div style="max-width:560px;margin:0 auto;padding:28px 20px">
<p style="font-family:Georgia,serif;font-size:22px;letter-spacing:2px;color:#5b1f3d;margin:0 0 18px">VAISHORA</p>
<div style="background:#ffffff;border:1px solid #efdfe0;border-radius:12px;padding:24px">
<h1 style="font-family:Georgia,serif;font-weight:normal;font-size:24px;margin:0 0 14px;color:#5b1f3d">${esc(heading)}</h1>${body}${button}
</div>
<p style="font-size:12px;color:#8a7380;margin:16px 4px 0">You received this because you have a VAISHORA artist account. Need help? Reply in the Support section of your artist portal.</p>
</div></body></html>`;
}

export interface EmailMessage {
  to: string;
  subject: string;
  heading: string;
  paragraphs: string[];
  cta?: { label: string; path: string };
  template: string;
  artistId?: string | null;
  bookingId?: string | null;
}

/**
 * Records and sends an email. Never throws: the result says what happened. Pass `q` to record the
 * notification inside the caller's transaction (the SMTP send itself always happens after).
 */
export async function sendEmail(m: EmailMessage, q?: Queryable): Promise<"sent" | "failed" | "skipped"> {
  let id: string | null = null;
  try {
    const db = q ?? (await getDb());
    const r = await db.query<{ id: string }>(
      `INSERT INTO notifications(booking_id, artist_id, channel, template, recipient, subject, status, payload)
       VALUES ($1, $2, 'email', $3, $4, $5, 'queued', $6::jsonb) RETURNING id`,
      [m.bookingId ?? null, m.artistId ?? null, m.template, m.to, m.subject, JSON.stringify({ heading: m.heading, paragraphs: m.paragraphs, cta: m.cta ?? null })],
    );
    id = r[0].id;
  } catch (e) {
    console.error("[email] could not record notification", e);
  }
  const mark = async (status: "sent" | "failed" | "skipped", error?: string) => {
    if (!id) return;
    try {
      await (await getDb()).query(
        `UPDATE notifications SET status = $2, attempts = attempts + 1, last_error = $3, sent_at = CASE WHEN $2 = 'sent' THEN now() END WHERE id = $1`,
        [id, status, error ?? null],
      );
    } catch (e) {
      console.error("[email] could not update notification", e);
    }
  };
  if (!smtpConfigured()) {
    console.info(`[email] SMTP not configured; skipped "${m.subject}" to ${m.to}`);
    await mark("skipped", "SMTP not configured");
    return "skipped";
  }
  try {
    const cta = m.cta ? { label: m.cta.label, href: `${siteUrl()}${m.cta.path}` } : undefined;
    const text = [m.heading, "", ...m.paragraphs, ...(cta ? ["", `${cta.label}: ${cta.href}`] : [])].join("\n");
    await (await transport()).sendMail({ from: emailFrom(), to: m.to, subject: m.subject, text, html: layout(m.heading, m.paragraphs, cta) });
    await mark("sent");
    return "sent";
  } catch (e) {
    console.error("[email] send failed", e);
    await mark("failed", (e as Error).message?.slice(0, 500));
    return "failed";
  }
}

/** Sends after the response is finished (Next `after`), so email never delays or fails the action. */
export function queueEmail(m: EmailMessage) {
  try {
    after(() => sendEmail(m).then(() => undefined));
  } catch {
    void sendEmail(m).catch(() => {}); // outside a request scope (scripts, tests)
  }
}

/** Checks the SMTP connection and login without sending anything (used by the admin settings page). */
export async function verifySmtp(): Promise<{ ok: boolean; message: string }> {
  if (!smtpConfigured()) return { ok: false, message: "SMTP is not configured." };
  try {
    await ((await transport()) as unknown as { verify: () => Promise<unknown> }).verify();
    return { ok: true, message: `Connected to ${process.env.SMTP_HOST} as ${process.env.SMTP_USER ?? "(no login)"}.` };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/**
 * Alert for the VAISHORA team (new application, design to review, payout request, support ticket).
 * Goes to ADMIN_NOTIFY_EMAIL, else the support email in settings, else the SMTP account itself.
 */
export function notifyTeam(m: { subject: string; heading: string; paragraphs: string[]; path: string; template: string; artistId?: string | null }) {
  try {
    after(async () => {
      const { getSettings } = await import("./settings");
      const to = process.env.ADMIN_NOTIFY_EMAIL || (await getSettings()).support.email || process.env.SMTP_USER || "";
      if (!to) return;
      await sendEmail({ to, subject: `[VAISHORA admin] ${m.subject}`, heading: m.heading, paragraphs: m.paragraphs, cta: { label: "Open in admin", path: m.path }, template: `team_${m.template}`, artistId: m.artistId });
    });
  } catch {
    /* outside a request scope (scripts, tests): skip team alerts */
  }
}
