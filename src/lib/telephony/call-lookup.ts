import { eq } from "drizzle-orm";
import { withSystem } from "../db/client";
import { calls, companies } from "../db/schema";

/** Find a call + its company from a webhook (system context, by our id or Twilio's SID). */
export async function findCall(by: { id?: string | null; sid?: string | null }) {
  if (!by.id && !by.sid) return null;
  return withSystem(async (tx) => {
    const where = by.id && /^[0-9a-f-]{36}$/.test(by.id) ? eq(calls.id, by.id) : by.sid ? eq(calls.providerCallSid, by.sid) : undefined;
    if (!where) return null;
    const [row] = await tx.select({ call: calls, company: companies }).from(calls).innerJoin(companies, eq(companies.id, calls.companyId)).where(where).limit(1);
    return row ?? null;
  });
}
