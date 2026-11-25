"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { QuickProfile, type CustomerLite } from "@/components/booking/CheckoutAccount";

/** Contact details (name, mobile, email, gender) shared with the artist for confirmed bookings. */
export function ProfileEditor({ customer }: { customer: CustomerLite }) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  return (
    <div>
      {saved && (
        <p className="mb-3 rounded-[var(--radius-sm)] bg-[#eef6f1] px-4 py-2 text-sm text-success" role="status">
          Profile saved.
        </p>
      )}
      <QuickProfile
        customer={customer}
        title="Your details"
        subtitle="Shared with your artist only for confirmed bookings."
        submitLabel="Save profile"
        onSaved={() => {
          setSaved(true);
          router.refresh();
        }}
      />
    </div>
  );
}
