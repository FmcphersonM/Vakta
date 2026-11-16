import type { Company } from "../lib/db/schema";
import type { ToolDeps } from "./tools";
import { bookingService } from "../lib/booking/service";
import { geocodeAddress } from "../lib/booking/geocode";
import { sendSms } from "../lib/sms";
import { notifyOwner } from "../lib/notify";

/** Real dependencies for live calls. Test calls never send real SMS. */
export function productionDeps(company: Company, isTest: boolean): ToolDeps {
  return {
    booking: bookingService,
    geocode: (a) => geocodeAddress(a),
    sendSms: (i) => sendSms({ ...i, companyId: company.id, company, simulate: isTest }),
    notifyOwner: (kind, body, refs) => notifyOwner(company, kind, body, { ...refs, simulate: isTest }),
  };
}
