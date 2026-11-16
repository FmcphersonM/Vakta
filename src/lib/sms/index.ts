import { eq } from "drizzle-orm";
import { withTenant } from "../db/client";
import { smsMessages, type SmsPurpose } from "../db/schema";
import { getTelephony } from "../telephony/provider";
import { env } from "../env";

/** Alphanumeric sender (max 11 chars, Norway supports these without registration). */
export function senderFor(company: { smsSenderName: string | null }) {
  return company.smsSenderName || env().SMS_DEFAULT_SENDER;
}

/**
 * Sends one SMS and records it. Never throws: a failed SMS must not break a
 * booking or a call; the failure is stored and shown in the dashboard.
 */
export async function sendSms(input: {
  companyId: string;
  company: { smsSenderName: string | null };
  to: string;
  body: string;
  purpose: SmsPurpose;
  callId?: string | null;
  appointmentId?: string | null;
  leadId?: string | null;
  simulate?: boolean;
}) {
  const sender = senderFor(input.company);
  const tel = await getTelephony();
  const [row] = await withTenant(input.companyId, (tx) =>
    tx
      .insert(smsMessages)
      .values({
        companyId: input.companyId,
        toNumber: input.to,
        sender,
        body: input.body,
        purpose: input.purpose,
        provider: input.simulate ? "mock" : tel.name,
        status: "queued",
        callId: input.callId ?? null,
        appointmentId: input.appointmentId ?? null,
        leadId: input.leadId ?? null,
      })
      .returning({ id: smsMessages.id }),
  );
  let status: string = "simulated";
  let providerSid: string | null = null;
  let error: string | null = null;
  if (!input.simulate) {
    try {
      const r = await tel.sendSms({
        to: input.to,
        from: sender,
        body: input.body,
        statusCallback: `${env().APP_URL}/api/telephony/twilio/sms-status`,
      });
      status = r.status;
      providerSid = r.sid;
      error = r.error ?? null;
    } catch (e) {
      status = "failed";
      error = e instanceof Error ? e.message : String(e);
      console.error("[sms] send failed", error);
    }
  }
  await withTenant(input.companyId, (tx) =>
    tx.update(smsMessages).set({ status, providerSid, error }).where(eq(smsMessages.id, row.id)),
  );
  return { id: row.id, status };
}
