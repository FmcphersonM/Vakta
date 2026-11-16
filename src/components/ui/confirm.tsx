"use client";

import { useFormStatus } from "react-dom";
import { buttonClass } from "./index";
import type { ReactNode } from "react";

/** Submit button that asks for confirmation first (for destructive actions). */
export function ConfirmSubmit({
  message,
  children,
  variant = "danger",
  size = "md",
  className,
}: {
  message: string;
  children: ReactNode;
  variant?: "danger" | "secondary" | "primary";
  size?: "sm" | "md";
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={buttonClass(variant, size, className)}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
