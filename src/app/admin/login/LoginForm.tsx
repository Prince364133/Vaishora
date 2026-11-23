"use client";

import { useActionState } from "react";
import { loginAction } from "../actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, null);
  return (
    <form action={action} className="mt-5 space-y-4">
      <div className="field">
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" inputMode="email" autoCapitalize="none" spellCheck={false} autoComplete="username" required className="input" defaultValue={state?.email} key={state?.email ?? "email"} />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required className="input" />
      </div>
      {state?.error && (
        <p className="field-error" role="alert">
          {state.error}
        </p>
      )}
      <button className="btn btn-primary w-full" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
