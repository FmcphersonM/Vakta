import type { Company } from "./db/schema";
import { sendSms } from "./sms";

export type NotifyKind = "booked" | "lead" | "emergency" | "missed";

/** SMS the business owner (or the configured alert numbers) about an event. */
export async function notifyOwner(
  company: Pick<Company, "id" | "notifyOn" | "notifyNumbers" | "forwardNumber" | "smsSenderName">,
  kind: NotifyKind,
  body: string,
  refs: { callId?: string | null; appointmentId?: string | null; leadId?: string | null; simulate?: boolean } = {},
) {
  if (!company.notifyOn.includes(kind)) return 0;
  const to = company.notifyNumbers.length ? company.notifyNumbers : company.forwardNumber ? [company.forwardNumber] : [];
  for (const number of to) {
    await sendSms({
      companyId: company.id,
      company,
      to: number,
      body,
      purpose: "owner_notification",
      callId: refs.callId,
      appointmentId: refs.appointmentId,
      leadId: refs.leadId,
      simulate: refs.simulate,
    });
  }
  return to.length;
}
