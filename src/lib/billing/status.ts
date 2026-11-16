import type { Company } from "../db/schema";

export type ServiceState = {
  /** May the AI answer calls for this company right now? */
  active: boolean;
  trialDaysLeft: number | null;
  status: Company["subscriptionStatus"];
};

const PAST_DUE_GRACE_DAYS = 7;

export function serviceState(c: Pick<Company, "subscriptionStatus" | "trialEndsAt" | "currentPeriodEnd">, now = new Date()): ServiceState {
  const status = c.subscriptionStatus;
  if (status === "active") return { active: true, trialDaysLeft: null, status };
  if (status === "past_due") {
    const graceEnd = (c.currentPeriodEnd?.getTime() ?? now.getTime()) + PAST_DUE_GRACE_DAYS * 86400_000;
    return { active: now.getTime() < graceEnd, trialDaysLeft: null, status };
  }
  if (status === "trialing") {
    const ms = c.trialEndsAt.getTime() - now.getTime();
    const days = Math.max(0, Math.ceil(ms / 86400_000));
    return { active: ms > 0, trialDaysLeft: days, status };
  }
  return { active: false, trialDaysLeft: null, status };
}
