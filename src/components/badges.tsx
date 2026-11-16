import { AlertTriangle, Flame } from "lucide-react";
import { Badge, type Tone } from "@/components/ui";
import type { Dict } from "@/lib/i18n";
import type { CallOutcome, LeadStatus, Urgency } from "@/lib/db/schema";

const statusTone: Record<LeadStatus, Tone> = { new: "blue", booked: "brand", quoted: "violet", won: "green", lost: "neutral" };
export function LeadStatusBadge({ status, t }: { status: LeadStatus; t: Dict }) {
  return <Badge tone={statusTone[status]}>{t.leadStatus[status]}</Badge>;
}

export function UrgencyBadge({ urgency, t, hideNormal = true }: { urgency: Urgency; t: Dict; hideNormal?: boolean }) {
  if (hideNormal && (urgency === "normal" || urgency === "low")) return null;
  return urgency === "emergency" ? (
    <Badge tone="red">
      <Flame className="h-3 w-3" aria-hidden /> {t.urgency.emergency}
    </Badge>
  ) : urgency === "high" ? (
    <Badge tone="amber">
      <AlertTriangle className="h-3 w-3" aria-hidden /> {t.urgency.high}
    </Badge>
  ) : (
    <Badge>{t.urgency[urgency]}</Badge>
  );
}

const outcomeTone: Record<CallOutcome, Tone> = {
  booked: "brand",
  lead_captured: "blue",
  transferred: "violet",
  emergency: "red",
  spam: "neutral",
  sales: "neutral",
  hangup: "amber",
  info: "neutral",
  failed: "red",
  service_inactive: "amber",
  blocked: "neutral",
};
export function OutcomeBadge({ outcome, t }: { outcome: CallOutcome | null; t: Dict }) {
  if (!outcome) return <Badge tone="green">{t.outcome.in_progress}</Badge>;
  return <Badge tone={outcomeTone[outcome]}>{t.outcome[outcome]}</Badge>;
}
