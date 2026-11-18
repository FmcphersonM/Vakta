import { z } from "zod";

/**
 * All configuration comes from environment variables (see .env.example).
 * Optional integrations simply stay "not configured" until their keys exist.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  // On Render the public address is provided automatically (RENDER_EXTERNAL_URL).
  APP_URL: z.string().url().default(process.env.RENDER_EXTERNAL_URL ?? "http://localhost:3000"),
  NEXT_PUBLIC_APP_NAME: z.string().default("Vakta"),
  PORT: z.coerce.number().default(3000),
  SESSION_SECRET: z.string().min(32),
  ENCRYPTION_KEY: z.string().min(32),
  CRON_SECRET: z.string().min(16).optional(),

  ANTHROPIC_API_KEY: z.string().optional(),
  VOICE_MODEL: z.string().default("claude-opus-5-5"),
  VOICE_EFFORT: z.enum(["low", "medium", "high"]).default("low"),
  SUMMARY_MODEL: z.string().default("claude-opus-5-5"),

  TELEPHONY_PROVIDER: z.enum(["twilio", "mock"]).optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_API_KEY_SID: z.string().optional(),
  TWILIO_API_KEY_SECRET: z.string().optional(),
  TWILIO_REGION: z.string().default("ie1"),
  TWILIO_EDGE: z.string().default("dublin"),
  TTS_PROVIDER: z.enum(["Google", "Amazon", "ElevenLabs"]).default("Google"),
  TTS_VOICE_NB: z.string().default("nb-NO-Chirp3-HD-Aoede"),
  TTS_VOICE_EN: z.string().default("en-GB-Chirp3-HD-Aoede"),
  STT_PROVIDER: z.enum(["Google", "Deepgram"]).default("Deepgram"),
  STT_MODEL_NB: z.string().optional(),
  SMS_DEFAULT_SENDER: z.string().default("Vakta"),
  // Norwegian numbers need a regulatory bundle + address registered in Twilio.
  TWILIO_NO_BUNDLE_SID: z.string().optional(),
  TWILIO_NO_ADDRESS_SID: z.string().optional(),
  TWILIO_NUMBER_TYPE: z.enum(["mobile", "local"]).default("mobile"),
  NUMBER_POOL_SIZE: z.coerce.number().int().min(0).max(50).default(2),

  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_ID: z.string().optional(),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_CLIENT_ID: z.string().optional(),
  MICROSOFT_CLIENT_SECRET: z.string().optional(),
  GOOGLE_MAPS_API_KEY: z.string().optional(),

  SMTP_URL: z.string().optional(),
  EMAIL_FROM: z.string().default("Vakta <no-reply@vakta.no>"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
      throw new Error(`Invalid or missing environment variables:\n${issues}\nSee .env.example`);
    }
    cached = parsed.data;
  }
  return cached;
}

/** For tests that change process.env. */
export function resetEnvCache() {
  cached = undefined;
}

export const features = {
  ai: () => Boolean(env().ANTHROPIC_API_KEY) || (process.env.VAKTA_FAKE_AI === "1" && env().NODE_ENV !== "production"),
  twilio: () =>
    env().TELEPHONY_PROVIDER !== "mock" &&
    Boolean(env().TWILIO_ACCOUNT_SID && env().TWILIO_AUTH_TOKEN),
  stripe: () => Boolean(env().STRIPE_SECRET_KEY && env().STRIPE_PRICE_ID),
  google: () => Boolean(env().GOOGLE_CLIENT_ID && env().GOOGLE_CLIENT_SECRET),
  microsoft: () => Boolean(env().MICROSOFT_CLIENT_ID && env().MICROSOFT_CLIENT_SECRET),
  email: () => Boolean(env().SMTP_URL),
};
