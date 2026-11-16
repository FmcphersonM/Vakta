import { Phone } from "lucide-react";
import clsx from "clsx";
import { buttonClass } from "@/components/ui";

/** One-tap call button. Big enough for gloves. */
export function CallLink({ phone, label, compact, className }: { phone: string | null | undefined; label: string; compact?: boolean; className?: string }) {
  if (!phone) return null;
  return (
    <a
      href={`tel:${phone}`}
      className={clsx(buttonClass(compact ? "secondary" : "primary", compact ? "sm" : "md"), compact && "!px-2.5", className)}
      aria-label={`${label} ${phone}`}
    >
      <Phone className="h-4 w-4" aria-hidden />
      {!compact && <span>{label}</span>}
    </a>
  );
}
