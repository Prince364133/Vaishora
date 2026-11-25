"use client";

import { startTransition, useActionState, useEffect, useRef } from "react";
import type { ActionState } from "@/app/admin/actions";

type Action = (state: ActionState, form: FormData) => Promise<ActionState>;

/**
 * Form bound to a server action with inline success/error messages. What was typed is kept when the
 * action returns an error; the form resets only after a success (unless `resetOnSuccess` is false,
 * for edit forms whose fields already show the saved values).
 */
export function ActionForm({
  action,
  children,
  submitLabel,
  className = "",
  pendingLabel = "Saving…",
  danger = false,
  encType,
  resetOnSuccess = true,
  confirm,
}: {
  action: Action;
  children: React.ReactNode;
  submitLabel: string;
  className?: string;
  pendingLabel?: string;
  danger?: boolean;
  encType?: "multipart/form-data";
  resetOnSuccess?: boolean;
  /** Asks for a second tap before submitting (for destructive actions). */
  confirm?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const form = useRef<HTMLFormElement>(null);
  const armed = useRef(false);

  useEffect(() => {
    if (state?.ok && resetOnSuccess) form.current?.reset();
  }, [state, resetOnSuccess]);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (confirm && !armed.current) {
      armed.current = true;
      const btn = e.currentTarget.querySelector<HTMLButtonElement>("button[type=submit]");
      if (btn) {
        btn.textContent = confirm;
        setTimeout(() => {
          armed.current = false;
          btn.textContent = submitLabel;
        }, 4000);
      }
      return;
    }
    armed.current = false;
    const data = new FormData(e.currentTarget);
    startTransition(() => formAction(data));
  }

  return (
    <form ref={form} onSubmit={onSubmit} className={className} encType={encType}>
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
