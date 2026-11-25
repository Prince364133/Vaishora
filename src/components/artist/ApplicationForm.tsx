"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** "Become an artist" application. On success the applicant goes to the artist portal sign-in. */
export function ApplicationForm() {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "sending">("idle");
  const [error, setError] = useState<{ message: string; field?: string; redirect?: string } | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState("sending");
    setError(null);
    const fd = new FormData(e.currentTarget);
    const data = { ...Object.fromEntries(fd.entries()), consent: fd.get("consent") === "on" };
    try {
      const res = await fetch("/api/artist-applications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError({ message: json.error ?? "Could not send. Please try again.", field: json.field, redirect: json.redirect });
        setState("idle");
        if (json.field) document.getElementById(`app-${json.field}`)?.focus();
        return;
      }
      router.push(json.redirect ?? "/account?artist=1&applied=1");
    } catch {
      setError({ message: "Network problem. Check your connection and try again." });
      setState("idle");
    }
  }

  const invalid = (f: string) => (error?.field === f ? true : undefined);
  const field = (name: string, label: string, props: React.InputHTMLAttributes<HTMLInputElement> & { hint?: string; optional?: boolean } = {}) => {
    const { hint, optional, ...rest } = props;
    return (
      <div className="field">
        <label htmlFor={`app-${name}`}>
          {label}
          {optional && <span className="font-normal text-muted"> (optional)</span>}
        </label>
        <input id={`app-${name}`} name={name} className="input" aria-invalid={invalid(name)} required={!optional} {...rest} />
        {hint && <p className="field-hint">{hint}</p>}
      </div>
    );
  };

  return (
    <form onSubmit={onSubmit} className="card space-y-4 p-5 sm:p-6" noValidate={false}>
      {field("name", "Full name", { autoComplete: "name", autoCapitalize: "words", minLength: 2, maxLength: 80, enterKeyHint: "next" })}
      {field("email", "Email", { type: "email", autoComplete: "email", inputMode: "email", autoCapitalize: "none", spellCheck: false, maxLength: 120, hint: "You will sign in to your artist portal with this email." })}
      {field("phone", "Mobile number", { type: "tel", autoComplete: "tel", inputMode: "tel", placeholder: "98765 43210" })}
      <div className="grid gap-4 sm:grid-cols-2">
        {field("experience_years", "Years of experience", { type: "number", inputMode: "numeric", min: 0, max: 60, placeholder: "e.g. 5" })}
        {field("languages", "Languages you speak", { optional: true, maxLength: 120, placeholder: "Telugu, Hindi, English" })}
      </div>
      {field("localities", "Areas you can travel to", { autoCapitalize: "words", maxLength: 300, placeholder: "e.g. Kondapur, Gachibowli, Madhapur" })}
      {field("instagram", "Instagram or portfolio link", { optional: true, autoCapitalize: "none", spellCheck: false, maxLength: 200, placeholder: "@yourhandle or https://…" })}
      <div className="field">
        <label htmlFor="app-experience">
          Your work <span className="font-normal text-muted">(optional)</span>
        </label>
        <textarea id="app-experience" name="experience" className="input min-h-24" maxLength={500} placeholder="Styles you specialise in, bridal work, where you have worked" />
      </div>
      <div className="field">
        <label htmlFor="app-message">
          Anything else <span className="font-normal text-muted">(optional)</span>
        </label>
        <textarea id="app-message" name="message" className="input min-h-20" maxLength={1000} />
      </div>
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" name="consent" required className="mt-1 h-5 w-5 flex-none accent-[var(--color-plum)]" />
        <span>
          These details are mine and accurate, and I agree to be contacted by VAISHORA about my application. See our{" "}
          <Link href="/terms" className="link">
            terms
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="link">
            privacy policy
          </Link>
          .
        </span>
      </label>
      <div className="hidden" aria-hidden>
        <input name="website" tabIndex={-1} autoComplete="off" />
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error.message}{" "}
          {error.redirect && (
            <Link href={error.redirect} className="link font-semibold">
              Sign in
            </Link>
          )}
        </p>
      )}
      <button className="btn btn-primary w-full sm:w-auto" disabled={state === "sending"}>
        {state === "sending" ? "Sending…" : "Create my artist account"}
      </button>
      <p className="text-xs text-muted">
        Already applied?{" "}
        <Link href="/account?artist=1" className="link">
          Sign in to the artist portal
        </Link>
      </p>
    </form>
  );
}
