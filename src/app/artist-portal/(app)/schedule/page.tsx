import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { requireArtist } from "@/server/artist-auth";
import { getDb } from "@/server/db";
import { getSchedule } from "@/server/artist-portal";
import { ScheduleEditor } from "@/components/artist/ScheduleEditor";
import { ActionForm } from "@/components/admin/ActionForm";
import { PageHeader } from "@/components/artist/ui";
import { addTimeOffAction, removeTimeOffAction, saveScheduleAction } from "../../actions";
import { addDays, formatIstDate, istDateString } from "@/lib/time";
import { AdaptiveSkeleton } from "@/components/artist/AdaptiveSkeleton";

export const metadata: Metadata = { title: "Working hours" };

async function Schedule() {
  await connection();
  const a = await requireArtist();
  const { days, timeOff } = await getSchedule(await getDb(), a.id);
  const today = istDateString();
  return (
    <>
      <PageHeader
        title="Working hours"
        back={{ href: "/artist-portal/profile", label: "Profile" }}
        subtitle="Customers are offered slots only inside these hours, sized to each design’s duration, with travel time kept free between bookings."
      />
      <ScheduleEditor initial={days} action={saveScheduleAction} />

      <section className="mt-10" id="time-off">
        <h2 className="text-2xl">Days off and holidays</h2>
        <p className="mt-1 text-sm text-muted">Block dates when you are away. Existing bookings are not affected.</p>
        <ActionForm action={addTimeOffAction} submitLabel="Block these days" className="card mt-3 p-4 sm:p-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="field">
              <label htmlFor="from">From</label>
              <input id="from" name="from" type="date" required min={today} max={addDays(today, 365)} className="input" />
            </div>
            <div className="field">
              <label htmlFor="to">To (inclusive)</label>
              <input id="to" name="to" type="date" min={today} max={addDays(today, 365)} className="input" />
            </div>
            <div className="field">
              <label htmlFor="reason">
                Note <span className="font-normal text-muted">(optional)</span>
              </label>
              <input id="reason" name="reason" maxLength={120} className="input" placeholder="e.g. Family wedding" />
            </div>
          </div>
        </ActionForm>
        <ul className="mt-3 space-y-2">
          {timeOff.map((t) => {
            const last = new Date(new Date(t.hi).getTime() - 1);
            const same = formatIstDate(t.lo) === formatIstDate(last);
            return (
              <li key={t.id} className="card flex items-center justify-between gap-3 p-3 pl-4">
                <div>
                  <p className="font-semibold text-plum-ink">{same ? formatIstDate(t.lo) : `${formatIstDate(t.lo)} – ${formatIstDate(last)}`}</p>
                  {t.reason && <p className="text-sm text-muted">{t.reason}</p>}
                </div>
                <ActionForm action={removeTimeOffAction} submitLabel="Remove" className="[&>div]:mt-0">
                  <input type="hidden" name="id" value={t.id} />
                </ActionForm>
              </li>
            );
          })}
          {!timeOff.length && <li className="text-sm text-muted">No days blocked.</li>}
        </ul>
      </section>
    </>
  );
}

export default function SchedulePage() {
  return (
    <Suspense fallback={<AdaptiveSkeleton />}>
      <Schedule />
    </Suspense>
  );
}
