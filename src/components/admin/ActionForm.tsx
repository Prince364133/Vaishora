"use client";

import { useActionState } from "react";
import type { ActionState } from "@/app/admin/actions";

type Action = (state: ActionState, form: FormData) => Promise<ActionState>;

export function ActionForm({
  action,
  children,
  submitLabel,
  className = "",
  pendingLabel = "Saving…",
  danger = false,
  encType,
}: {
  action: Action;
  children: React.ReactNode;
  submitLabel: string;
  className?: string;
  pendingLabel?: string;
  danger?: boolean;
  encType?: "multipart/form-data";
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className={className} encType={encType}>
      {children}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="submit" className={`btn btn-sm ${danger ? "btn-primary bg-danger hover:bg-danger/90" : "btn-primary"}`} disabled={pending}>
          {pending ? pendingLabel : submitLabel}
        </button>
        {state?.ok && (
          <p className="text-sm text-success" role="status">
            {state.ok}
          </p>
        )}
        {state?.error && (
          <p className="text-sm text-danger" role="alert">
            {state.error}
          </p>
        )}
      </div>
    </form>
  );
}
