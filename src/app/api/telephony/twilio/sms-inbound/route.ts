import { and, eq } from "drizzle-orm";
import { readTwilioRequest, xml } from "@/lib/telephony/webhook";
import { withSystem } from "@/lib/db/client";
import { companies, phoneNumbers } from "@/lib/db/schema";
import { normalizePhone, fmt } from "@/lib/format";
import { notifyOwner } from "@/lib/notify";

/** Someone texted the Vakta number: pass the message on to the business. */
export async function POST(req: Request) {
  const r = await readTwilioRequest(req);
  if (!r.ok) return r.response;
  const to = normalizePhone(r.params.To) ?? r.params.To;
  const [row] = await withSystem((tx) =>
    tx
      .select({ company: companies })
      .from(phoneNumbers)
      .innerJoin(companies, eq(companies.id, phoneNumbers.companyId))
      .where(and(eq(phoneNumbers.e164, to), eq(phoneNumbers.status, "assigned"))),
  );
  if (row) {
    const from = fmt.phone(normalizePhone(r.params.From) ?? r.params.From);
    await notifyOwner({ ...row.company, notifyOn: ["lead"] }, "lead", `SMS fra ${from}: ${(r.params.Body ?? "").slice(0, 500)}`);
  }
  return xml(`<?xml version="1.0" encoding="UTF-8"?><Response/>`);
}
