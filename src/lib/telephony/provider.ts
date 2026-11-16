import { features } from "../env";

export type SmsResult = { sid: string | null; status: "queued" | "sent" | "simulated" | "failed"; error?: string };

export interface TelephonyProvider {
  readonly name: "twilio" | "mock";
  sendSms(input: { to: string; from: string; body: string; statusCallback?: string }): Promise<SmsResult>;
  deleteRecording(sid: string): Promise<void>;
  /** Streams the audio of a recording (mp3). */
  fetchRecording(sid: string): Promise<Response>;
  /** Buys a new Norwegian number for the pool. */
  buyNumber(): Promise<{ e164: string; sid: string; smsCapable: boolean }>;
  /** Releases a number back to the provider. */
  releaseNumber(sid: string): Promise<void>;
}

class MockTelephony implements TelephonyProvider {
  readonly name = "mock" as const;
  async sendSms(input: { to: string; from: string; body: string }): Promise<SmsResult> {
    console.log(`[sms:simulated] ${input.from} → ${input.to}: ${input.body}`);
    return { sid: null, status: "simulated" };
  }
  async deleteRecording() {}
  async fetchRecording(): Promise<Response> {
    return new Response("Recording not available in test mode", { status: 404 });
  }
  async buyNumber(): Promise<{ e164: string; sid: string; smsCapable: boolean }> {
    throw new Error("Cannot buy numbers in test mode");
  }
  async releaseNumber() {}
}

let instance: TelephonyProvider | undefined;
let override: TelephonyProvider | undefined;

export async function getTelephony(): Promise<TelephonyProvider> {
  if (override) return override;
  if (!instance) {
    if (features.twilio()) {
      const { TwilioTelephony } = await import("./twilio");
      instance = new TwilioTelephony();
    } else {
      instance = new MockTelephony();
    }
  }
  return instance;
}

/** Tests can swap in a fake provider. */
export function setTelephonyForTests(p: TelephonyProvider | undefined) {
  override = p;
}
