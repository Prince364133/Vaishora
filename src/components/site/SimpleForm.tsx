"use client";

import { useState } from "react";

export interface FieldDef {
  name: string;
  label: string;
  type?: "text" | "tel" | "email" | "url" | "textarea";
  required?: boolean;
  placeholder?: string;
  defaultValue?: string;
  autoComplete?: string;
  /** Mobile keyboard hints. Sensible defaults are derived from `type`. */
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  spellCheck?: boolean;
}

const DEFAULTS: Record<string, Pick<FieldDef, "inputMode" | "autoCapitalize" | "spellCheck">> = {
  tel: { inputMode: "tel", autoCapitalize: "none", spellCheck: false },
  email: { inputMode: "email", autoCapitalize: "none", spellCheck: false },
  url: { inputMode: "url", autoCapitalize: "none", spellCheck: false },
  text: { autoCapitalize: "sentences" },
};

/** Small JSON form used for contact and artist applications (with honeypot + server validation). */
export function SimpleForm({ endpoint, fields, submitLabel, successMessage }: { endpoint: string; fields: FieldDef[]; submitLabel: string; successMessage: string }) {
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState("sending");
    setError("");
    const data = Object.fromEntries(new FormData(e.currentTarget).entries());
    const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setState("idle");
      setError(json.error ?? "Could not send. Please try again.");
      return;
    }
    setState("done");
  }

  if (state === "done")
    return (
      <p className="card p-5 text-success" role="status">
        {successMessage}
      </p>
    );

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate={false}>
      {fields.map((f, i) => {
        const d = DEFAULTS[f.type ?? "text"] ?? {};
        const last = i === fields.length - 1;
        return (
          <div key={f.name} className="field">
            <label htmlFor={f.name}>
              {f.label}
              {!f.required && <span className="font-normal text-muted"> (optional)</span>}
            </label>
            {f.type === "textarea" ? (
              <textarea id={f.name} name={f.name} required={f.required} placeholder={f.placeholder} defaultValue={f.defaultValue} className="input min-h-32" maxLength={1000} />
            ) : (
              <input
                id={f.name}
                name={f.name}
                type={f.type ?? "text"}
                required={f.required}
                placeholder={f.placeholder}
                defaultValue={f.defaultValue}
                autoComplete={f.autoComplete}
                inputMode={f.inputMode ?? d.inputMode}
                autoCapitalize={f.autoCapitalize ?? d.autoCapitalize}
                spellCheck={f.spellCheck ?? d.spellCheck}
                enterKeyHint={last ? "send" : "next"}
                className="input"
              />
            )}
          </div>
        );
      })}
      <div className="hidden" aria-hidden>
        <input name="website" tabIndex={-1} autoComplete="off" />
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
      <button className="btn btn-primary w-full sm:w-auto" disabled={state === "sending"}>
        {state === "sending" ? "Sending…" : submitLabel}
      </button>
    </form>
  );
}
