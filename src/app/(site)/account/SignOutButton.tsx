"use client";

import { useRouter } from "next/navigation";
import { refreshSiteAccount } from "@/components/site/site-account";

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="btn btn-ghost px-0 text-sm underline decoration-rose underline-offset-4"
      onClick={async () => {
        await fetch("/api/account", { method: "DELETE" });
        await refreshSiteAccount();
        router.push("/account");
        router.refresh();
      }}
    >
      Sign out on this device
    </button>
  );
}
