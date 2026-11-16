"use client";

import { useFormStatus } from "react-dom";
import clsx from "clsx";
import { CheckCircle2, AlertCircle } from "lucide-react";
import { buttonClass } from "./index";
import type { ReactNode } from "react";

export type ActionState = { ok?: boolean; message?: string; error?: string; fieldErrors?: Record<string, string> } | null;

export function SubmitButton({
  children,
  pendingText,
  variant = "primary",
  size = "md",
  className,
  name,
  value,
}: {
  children: ReactNode;
  pendingText?: string;
  variant?: "primary" | "secondary" | "danger" | "ghost" | "success";
  size?: "sm" | "md" | "lg";
  className?: string;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending}
      aria-busy={pending}
      className={buttonClass(variant, size, className)}
    >
      {pending && pendingText ? pendingText : children}
    </button>
  );
}

export function FormMessage({ state }: { state: ActionState }) {
  if (!state || (!state.message && !state.error)) return null;
  const ok = !state.error;
  return (
    <p
      role={ok ? "status" : "alert"}
      className={clsx(
        "flex items-start gap-2 rounded-xl px-3 py-2 text-sm",
        ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800",
      )}
    >
      {ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
      <span>{state.error ?? state.message}</span>
    </p>
  );
}
