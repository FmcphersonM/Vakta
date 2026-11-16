import twilio from "twilio";
import { env } from "../env";

/**
 * Reads a Twilio webhook and verifies its X-Twilio-Signature against our
 * public URL. Without an auth token (local development) the check is skipped,
 * but never in production.
 */
export async function readTwilioRequest(
  req: Request,
): Promise<{ ok: true; params: Record<string, string>; search: URLSearchParams } | { ok: false; response: Response }> {
  const u = new URL(req.url);
  const publicUrl = `${env().APP_URL}${u.pathname}${u.search}`;
  const form = await req.formData();
  const params: Record<string, string> = {};
  form.forEach((v, k) => {
    if (typeof v === "string") params[k] = v;
  });
  const token = env().TWILIO_AUTH_TOKEN;
  if (token) {
    const sig = req.headers.get("x-twilio-signature") ?? "";
    if (!twilio.validateRequest(token, sig, publicUrl, params)) {
      console.warn("[twilio] invalid signature", u.pathname);
      return { ok: false, response: new Response("Invalid signature", { status: 403 }) };
    }
  } else if (env().NODE_ENV === "production") {
    return { ok: false, response: new Response("Twilio not configured", { status: 503 }) };
  }
  return { ok: true, params, search: u.searchParams };
}

export function xml(body: string, status = 200) {
  return new Response(body, { status, headers: { "Content-Type": "text/xml; charset=utf-8" } });
}
