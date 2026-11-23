import { Suspense } from "react";
import { connection } from "next/server";
import { requireRole } from "@/server/auth";
import { getDb } from "@/server/db";
import { listPricingRules } from "@/server/catalog";
import { getSettings } from "@/server/settings";
import { ActionForm } from "@/components/admin/ActionForm";
import { saveCouponAction, saveRuleAction, saveSettingsAction } from "../../actions";
import { formatPaise } from "@/lib/money";

export const metadata = { title: "Pricing & settings" };

const GROUP_LABEL: Record<string, string> = { hands: "Hands", side: "Side", coverage: "Coverage", addon: "Add-ons", people: "Additional people" };

async function Content() {
  await connection();
  await requireRole(["admin"]);
  const db = await getDb();
  const [rules, s, coupons] = await Promise.all([
    listPricingRules({ includeInactive: true }),
    getSettings(),
    db.query<{ code: string; kind: string; value: number; min_order_paise: number; max_discount_paise: number | null; ends_at: string | null; usage_limit: number | null; used_count: number; active: boolean }>(`SELECT * FROM coupons ORDER BY created_at DESC`),
  ]);
  return (
    <div className="mt-6 space-y-10">
      <section>
        <h2 className="text-2xl">Package options</h2>
        <p className="text-sm text-muted">
          Price per person = design starting price × (hands × side × coverage multipliers) + flat amounts. Add-ons add a flat amount and minutes. Each additional person is charged the per-person price × the multiplier below.
        </p>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          {rules.map((r) => (
            <div key={r.code} className="card p-4">
              <p className="text-xs font-semibold text-rose-deep">{GROUP_LABEL[r.group_code]} · {r.code}</p>
              <ActionForm action={saveRuleAction} submitLabel="Save" className="mt-2 grid gap-2 sm:grid-cols-2">
                <input type="hidden" name="code" value={r.code} />
                <label className="field"><span className="label">Label</span><input name="label" defaultValue={r.label} className="input" /></label>
                <label className="field"><span className="label">Description</span><input name="description" defaultValue={r.description} className="input" /></label>
                <label className="field"><span className="label">Price multiplier</span><input name="price_multiplier" type="number" inputMode="decimal" step="0.01" min={0} defaultValue={r.price_multiplier} className="input" /></label>
                <label className="field"><span className="label">Flat amount (₹)</span><input name="flat" type="number" inputMode="numeric" min={0} step={1} defaultValue={r.flat_paise / 100} className="input" /></label>
                <label className="field"><span className="label">Duration multiplier</span><input name="duration_multiplier" type="number" inputMode="decimal" step="0.01" min={0} defaultValue={r.duration_multiplier} className="input" /></label>
                <label className="field"><span className="label">Extra minutes</span><input name="flat_minutes" type="number" inputMode="numeric" min={0} defaultValue={r.flat_minutes} className="input" /></label>
                <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={r.active} /> Offered</label>
              </ActionForm>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-2xl">Business settings</h2>
        <ActionForm action={saveSettingsAction} submitLabel="Save settings" className="mt-3 card p-4 sm:p-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="flex min-h-11 items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="gst_enabled" defaultChecked={s.gst_enabled} /> Charge GST (enable only after confirming registration and rate with your CA)</label>
            <label className="field"><span className="label">GST rate (%)</span><input name="gst_rate" type="number" inputMode="decimal" step="0.01" min={0} max={28} defaultValue={s.gst_rate_bp / 100} className="input" /></label>
            <label className="field"><span className="label">Booking fee (₹)</span><input name="platform_fee" type="number" inputMode="numeric" min={0} defaultValue={s.platform_fee_paise / 100} className="input" /></label>
            <label className="field"><span className="label">Advance (% of total)</span><input name="advance_percent" type="number" inputMode="numeric" min={1} max={100} defaultValue={s.advance_percent} className="input" /></label>
            <label className="field"><span className="label">Travel/prep buffer (min)</span><input name="buffer_minutes" type="number" inputMode="numeric" min={0} max={240} defaultValue={s.buffer_minutes} className="input" /></label>
            <label className="field"><span className="label">Minimum notice (hours)</span><input name="lead_time_hours" type="number" inputMode="numeric" min={0} max={168} defaultValue={s.lead_time_hours} className="input" /></label>
            <label className="field"><span className="label">Slot interval (min)</span><input name="slot_interval_minutes" type="number" inputMode="numeric" min={15} max={120} defaultValue={s.slot_interval_minutes} className="input" /></label>
            <label className="field"><span className="label">Unpaid hold (min)</span><input name="hold_minutes" type="number" inputMode="numeric" min={5} max={60} defaultValue={s.hold_minutes} className="input" /></label>
            <label className="field"><span className="label">Booking window (days)</span><input name="booking_window_days" type="number" inputMode="numeric" min={1} max={365} defaultValue={s.booking_window_days} className="input" /></label>
            <label className="field"><span className="label">First start hour (IST)</span><input name="service_start_hour" type="number" inputMode="numeric" min={0} max={23} defaultValue={s.service_start_minute / 60} className="input" /></label>
            <label className="field"><span className="label">Last end hour (IST)</span><input name="service_end_hour" type="number" inputMode="numeric" min={1} max={24} defaultValue={s.service_end_minute / 60} className="input" /></label>
            <label className="field"><span className="label">Full refund if cancelled ≥ (hours)</span><input name="full_refund_hours" type="number" inputMode="numeric" min={0} defaultValue={s.cancellation.full_refund_hours} className="input" /></label>
            <label className="field"><span className="label">Partial refund if cancelled ≥ (hours)</span><input name="partial_refund_hours" type="number" inputMode="numeric" min={0} defaultValue={s.cancellation.partial_refund_hours} className="input" /></label>
            <label className="field"><span className="label">Partial refund (%)</span><input name="partial_refund_percent" type="number" inputMode="numeric" min={0} max={100} defaultValue={s.cancellation.partial_refund_percent} className="input" /></label>
            <label className="field"><span className="label">Support phone</span><input name="support_phone" type="tel" inputMode="tel" defaultValue={s.support.phone} className="input" /></label>
            <label className="field"><span className="label">Support WhatsApp (digits)</span><input name="support_whatsapp" inputMode="tel" defaultValue={s.support.whatsapp} className="input" /></label>
            <label className="field"><span className="label">Support email</span><input name="support_email" inputMode="email" autoCapitalize="none" defaultValue={s.support.email} className="input" /></label>
            <label className="field"><span className="label">Support hours</span><input name="support_hours" defaultValue={s.support.hours} className="input" /></label>
            <label className="flex min-h-11 items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="allow_demo_artists" defaultChecked={s.allow_demo_artists} /> Show demo artists to customers (development only — keep off in production)</label>
          </div>
        </ActionForm>
      </section>

      <section>
        <h2 className="text-2xl">Discount codes</h2>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          {coupons.map((c) => (
            <div key={c.code} className="card p-4 text-sm">
              <p className="font-semibold">{c.code} — {c.kind === "percent" ? `${c.value}%` : formatPaise(c.value)} {c.active ? "" : "(inactive)"}</p>
              <p className="text-muted">Used {c.used_count}{c.usage_limit ? ` of ${c.usage_limit}` : ""} · min order {formatPaise(c.min_order_paise)}{c.max_discount_paise ? ` · max ${formatPaise(c.max_discount_paise)}` : ""}</p>
            </div>
          ))}
          <div className="card border-dashed p-4">
            <p className="text-sm font-semibold">Create or update a code</p>
            <ActionForm action={saveCouponAction} submitLabel="Save code" className="mt-2 grid gap-2 sm:grid-cols-2">
              <input name="code" placeholder="CODE" aria-label="Code" autoCapitalize="characters" autoComplete="off" spellCheck={false} required className="input uppercase" />
              <select name="kind" aria-label="Discount type" className="input"><option value="percent">Percent off</option><option value="flat">Flat ₹ off</option></select>
              <input name="value" type="number" inputMode="numeric" min={1} placeholder="Value (% or ₹)" aria-label="Value" required className="input" />
              <input name="min_order" type="number" inputMode="numeric" min={0} placeholder="Minimum order ₹" aria-label="Minimum order" className="input" />
              <input name="max_discount" type="number" inputMode="numeric" min={0} placeholder="Max discount ₹ (optional)" aria-label="Maximum discount" className="input" />
              <input name="usage_limit" type="number" inputMode="numeric" min={1} placeholder="Usage limit (optional)" aria-label="Usage limit" className="input" />
              <label className="field"><span className="label">Valid until (optional)</span><input name="ends_at" type="date" className="input" /></label>
              <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked /> Active</label>
            </ActionForm>
          </div>
        </div>
      </section>
    </div>
  );
}

export default function PricingPage() {
  return (
    <>
      <h1 className="text-[2.25rem] sm:text-4xl">Pricing &amp; settings</h1>
      <Suspense fallback={<p className="mt-4 text-muted">Loading…</p>}>
        <Content />
      </Suspense>
    </>
  );
}
