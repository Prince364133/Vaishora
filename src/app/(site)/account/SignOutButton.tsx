"use client";

import { useRouter } from "next/navigation";

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="btn btn-ghost px-0 text-sm underline decoration-rose underline-offset-4"
      onClick={async () => {
        await fetch("/api/account", { method: "DELETE" });
        router.refresh();
      }}
    >
      Sign out on this device
    </button>
  );
}
