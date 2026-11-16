// Filled in during step 3 (telephony).
import type { SmsResult, TelephonyProvider } from "./provider";
export class TwilioTelephony implements TelephonyProvider {
  readonly name = "twilio" as const;
  async sendSms(): Promise<SmsResult> { throw new Error("not implemented"); }
  async deleteRecording() { throw new Error("not implemented"); }
  async fetchRecording(): Promise<Response> { throw new Error("not implemented"); }
  async buyNumber(): Promise<{ e164: string; sid: string; smsCapable: boolean }> { throw new Error("not implemented"); }
  async releaseNumber() { throw new Error("not implemented"); }
}
