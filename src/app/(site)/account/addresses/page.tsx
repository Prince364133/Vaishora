import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { getDb } from "@/server/db";
import { listAddresses } from "@/server/customer-addresses";
import { requireCustomerPage } from "@/components/account/gate";
import { AccountShell } from "@/components/account/AccountShell";
import { AddressManager } from "@/components/account/AddressManager";
import { AdaptiveSkeleton } from "@/components/site/AdaptiveSkeleton";

export const metadata: Metadata = { title: "My addresses", robots: { index: false } };

async function Addresses() {
  await connection();
  const me = await requireCustomerPage();
  const list = await listAddresses(await getDb(), me.id);
  return (
    <AccountShell customer={me} tab="addresses">
      <p className="mb-4 text-sm text-muted">Save the places where you’d like the artist to come — home, work, a friend’s place for the party. Choose any of them when you book.</p>
      <AddressManager initial={list} />
    </AccountShell>
  );
}

export default function AddressesPage() {
  return (
    <Suspense fallback={<AdaptiveSkeleton variant="account" />}>
      <Addresses />
    </Suspense>
  );
}
