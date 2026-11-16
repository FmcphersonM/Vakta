import twilio from "twilio";
import { env } from "../env";
import type { SmsResult, TelephonyProvider } from "./provider";

type Client = ReturnType<typeof twilio>;

/**
 * Twilio in the EU (region IE1 / edge Dublin): calls, recordings and SMS data
 * stay in Ireland. Uses an API key when present, else the auth token.
 */
export class TwilioTelephony implements TelephonyProvider {
  readonly name = "twilio" as const;
  private client: Client;

  constructor() {
    const e = env();
    const opts = { accountSid: e.TWILIO_ACCOUNT_SID, region: e.TWILIO_REGION || undefined, edge: e.TWILIO_EDGE || undefined };
    this.client =
      e.TWILIO_API_KEY_SID && e.TWILIO_API_KEY_SECRET
        ? twilio(e.TWILIO_API_KEY_SID, e.TWILIO_API_KEY_SECRET, opts)
        : twilio(e.TWILIO_ACCOUNT_SID!, e.TWILIO_AUTH_TOKEN!, opts);
  }

  private apiHost() {
    const e = env();
    return e.TWILIO_REGION ? `api.${e.TWILIO_EDGE || "dublin"}.${e.TWILIO_REGION}.twilio.com` : "api.twilio.com";
  }

  private basicAuth() {
    const e = env();
    const user = e.TWILIO_API_KEY_SID ?? e.TWILIO_ACCOUNT_SID!;
    const pass = e.TWILIO_API_KEY_SECRET ?? e.TWILIO_AUTH_TOKEN!;
    return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
  }

  async sendSms(input: { to: string; from: string; body: string; statusCallback?: string }): Promise<SmsResult> {
    try {
      const m = await this.client.messages.create({
        to: input.to,
        from: input.from,
        body: input.body,
        statusCallback: input.statusCallback,
      });
      return { sid: m.sid, status: "queued" };
    } catch (e) {
      return { sid: null, status: "failed", error: e instanceof Error ? e.message : String(e) };
    }
  }

  async deleteRecording(sid: string) {
    try {
      await this.client.recordings(sid).remove();
    } catch (e) {
      // Already gone is fine (idempotent deletion).
      if ((e as { status?: number }).status !== 404) throw e;
    }
  }

  async fetchRecording(sid: string): Promise<Response> {
    if (!/^RE[0-9a-f]{32}$/.test(sid)) return new Response("bad sid", { status: 400 });
    const url = `https://${this.apiHost()}/2010-04-01/Accounts/${env().TWILIO_ACCOUNT_SID}/Recordings/${sid}.mp3`;
    return fetch(url, { headers: { Authorization: this.basicAuth() } });
  }

  async buyNumber(): Promise<{ e164: string; sid: string; smsCapable: boolean }> {
    const e = env();
    const base = e.APP_URL;
    const list = this.client.availablePhoneNumbers("NO");
    const candidates =
      e.TWILIO_NUMBER_TYPE === "local"
        ? await list.local.list({ voiceEnabled: true, limit: 5 })
        : await list.mobile.list({ voiceEnabled: true, smsEnabled: true, limit: 5 });
    const pick = candidates[0];
    if (!pick) throw new Error("No Norwegian numbers available from Twilio right now");
    const n = await this.client.incomingPhoneNumbers.create({
      phoneNumber: pick.phoneNumber,
      bundleSid: e.TWILIO_NO_BUNDLE_SID,
      addressSid: e.TWILIO_NO_ADDRESS_SID,
      voiceUrl: `${base}/api/telephony/twilio/voice`,
      voiceMethod: "POST",
      statusCallback: `${base}/api/telephony/twilio/status`,
      statusCallbackMethod: "POST",
      smsUrl: `${base}/api/telephony/twilio/sms-inbound`,
      smsMethod: "POST",
      friendlyName: `${e.NEXT_PUBLIC_APP_NAME} pool`,
    });
    return { e164: n.phoneNumber, sid: n.sid, smsCapable: Boolean(n.capabilities?.sms) };
  }

  /** Points an existing number's webhooks at this server (used by the setup script). */
  async configureNumber(sid: string) {
    const base = env().APP_URL;
    await this.client.incomingPhoneNumbers(sid).update({
      voiceUrl: `${base}/api/telephony/twilio/voice`,
      voiceMethod: "POST",
      statusCallback: `${base}/api/telephony/twilio/status`,
      statusCallbackMethod: "POST",
      smsUrl: `${base}/api/telephony/twilio/sms-inbound`,
      smsMethod: "POST",
    });
  }

  async listOwnedNumbers() {
    const rows = await this.client.incomingPhoneNumbers.list({ limit: 200 });
    return rows.map((r) => ({ sid: r.sid, e164: r.phoneNumber, smsCapable: Boolean(r.capabilities?.sms) }));
  }

  async releaseNumber(sid: string) {
    await this.client.incomingPhoneNumbers(sid).remove();
  }
}
