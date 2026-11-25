import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { requireCustomerPage } from "@/components/account/gate";
import { AccountShell } from "@/components/account/AccountShell";
import { ProfileEditor } from "@/components/account/ProfileEditor";
import { AdaptiveSkeleton } from "@/components/site/AdaptiveSkeleton";
import { SignOutButton } from "../SignOutButton";

export const metadata: Metadata = { title: "My profile", robots: { index: false } };

async function Profile() {
  await connection();
  const me = await requireCustomerPage();
  return (
    <AccountShell customer={me} tab="profile">
      <ProfileEditor customer={me} />
      <div className="mt-8 border-t hairline pt-4">
        <SignOutButton />
      </div>
    </AccountShell>
  );
}

export default function ProfilePage() {
  return (
    <Suspense fallback={<AdaptiveSkeleton variant="account" />}>
      <Profile />
    </Suspense>
  );
}
