import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import twilio from "twilio";
import { closeDb, withSystem, withTenant } from "@/lib/db/client";
import { calls, companies, leads, phoneNumbers, smsMessages } from "@/lib/db/schema";
import { handleInboundCall } from "@/lib/telephony/inbound";
import { assignNumber } from "@/lib/telephony/numbers";
import { postCall } from "@/lib/calls/post-call";
import { verifyToken } from "@/lib/crypto";
import { resetEnvCache } from "@/lib/env";
import { makeCompany } from "./helpers";
import { POST as voiceRoute } from "@/app/api/telephony/twilio/voice/route";
import { POST as connectAction } from "@/app/api/telephony/twilio/connect-action/route";

afterAll(closeDb);
beforeEach(() => {
  delete process.env.TWILIO_AUTH_TOKEN;
  resetEnvCache();
});

async function companyWithNumber(changes: Partial<typeof companies.$inferInsert> = {}) {
  const c = await makeCompany();
  await withSystem((tx) => tx.update(companies).set({ onboardingStep: "done", forwardNumber: "+4791234567", ...changes }).where(eq(companies.id, c.companyId)));
  const num = await assignNumber(c.companyId, c.userId);
  return { ...c, number: num.e164 };
}

const sid = () => `CA${crypto.randomUUID().replace(/-/g, "")}`;

describe("inbound call routing", () => {
  it("rejects calls to unknown numbers", async () => {
    const r = await handleInboundCall({ callSid: sid(), from: "+4740000000", to: "+4799999999" });
    expect(r.twiml).toContain("<Reject");
    expect(r.callId).toBeUndefined();
  });

  it("hands a normal call to the AI with a signed WebSocket URL, and is idempotent on retries", async () => {
    const c = await companyWithNumber();
    const callSid = sid();
    const r = await handleInboundCall({ callSid, from: "+4740011111", to: c.number });
    expect(r.twiml).toContain("<ConversationRelay");
    const url = r.twiml.match(/url="(wss:[^"]+)"/)![1].replace(/&amp;/g, "&");
    const token = new URL(url).searchParams.get("t");
    expect(verifyToken<{ callId: string; companyId: string }>(token)).toMatchObject({ callId: r.callId, companyId: c.companyId });
    const again = await handleInboundCall({ callSid, from: "+4740011111", to: c.number });
    expect(again.callId).toBe(r.callId);
    const rows = await withTenant(c.companyId, (tx) => tx.select().from(calls));
    expect(rows).toHaveLength(1);
  });

  it("blocks blocked numbers and guards against forwarding loops", async () => {
    const c = await companyWithNumber({ blockedNumbers: ["+4740022222"] });
    const blocked = await handleInboundCall({ callSid: sid(), from: "+4740022222", to: c.number });
    expect(blocked.twiml).toContain("<Reject");
    const [row] = await withTenant(c.companyId, (tx) => tx.select().from(calls).where(eq(calls.id, blocked.callId!)));
    expect(row.outcome).toBe("blocked");
    const other = await companyWithNumber();
    const loop = await handleInboundCall({ callSid: sid(), from: other.number, to: c.number });
    expect(loop.twiml).toContain('<Reject reason="busy"/>');
  });

  it("does not answer with AI when the subscription is inactive, and alerts the owner", async () => {
    const c = await companyWithNumber({ trialEndsAt: new Date(Date.now() - 86400_000), subscriptionStatus: "trialing" });
    const r = await handleInboundCall({ callSid: sid(), from: "+4740033333", to: c.number });
    expect(r.twiml).toContain("<Say");
    expect(r.twiml).toContain("<Hangup/>");
    await new Promise((res) => setTimeout(res, 200));
    const sms = await withTenant(c.companyId, (tx) => tx.select().from(smsMessages));
    expect(sms[0]?.purpose).toBe("owner_notification");
    expect(sms[0]?.toNumber).toBe("+4791234567");
  });

  it("puts VIP callers straight through to the owner", async () => {
    const c = await companyWithNumber({ vipNumbers: ["+4740044444"], forwardHours: "always" });
    const r = await handleInboundCall({ callSid: sid(), from: "+4740044444", to: c.number });
    expect(r.twiml).toContain("<Dial");
    expect(r.twiml).toContain("+4791234567");
    expect(r.twiml).toContain("vip-fallback");
  });
});

describe("Twilio webhooks", () => {
  function signedRequest(path: string, params: Record<string, string>, token: string, tamper = false) {
    const url = `https://vakta.test${path}`;
    const sig = twilio.getExpectedTwilioSignature(token, url, params);
    return new Request(`http://localhost:3000${path}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": tamper ? `${sig}x` : sig },
      body: new URLSearchParams(params),
    });
  }

  it("accepts a correctly signed voice webhook and rejects a forged one", async () => {
    process.env.TWILIO_AUTH_TOKEN = "test-auth-token-123";
    resetEnvCache();
    const c = await companyWithNumber();
    const params = { CallSid: sid(), From: "+4740055555", To: c.number };
    const ok = await voiceRoute(signedRequest("/api/telephony/twilio/voice", params, "test-auth-token-123"));
    expect(ok.status).toBe(200);
    expect(await ok.text()).toContain("<ConversationRelay");
    const bad = await voiceRoute(signedRequest("/api/telephony/twilio/voice", params, "test-auth-token-123", true));
    expect(bad.status).toBe(403);
  });

  it("connect-action transfers to the owner when the agent asks for it", async () => {
    const c = await companyWithNumber({ forwardHours: "always" });
    const r = await handleInboundCall({ callSid: sid(), from: "+4740066666", to: c.number });
    const req = new Request(`http://localhost/api/telephony/twilio/connect-action?callId=${r.callId}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ CallSid: "x", SessionStatus: "ended", HandoffData: JSON.stringify({ action: "transfer", reason: "emergency" }) }),
    });
    const res = await connectAction(req);
    const body = await res.text();
    expect(body).toContain("<Dial");
    expect(body).toContain("<Number>+4791234567</Number>");
  });
});

describe("post-call processing", () => {
  it("flags a dropped call and texts the owner, exactly once", async () => {
    const c = await companyWithNumber();
    const r = await handleInboundCall({ callSid: sid(), from: "+4740077777", to: c.number });
    await Promise.all([postCall(r.callId!, c.companyId), postCall(r.callId!, c.companyId)]);
    const [call] = await withTenant(c.companyId, (tx) => tx.select().from(calls).where(eq(calls.id, r.callId!)));
    expect(call.outcome).toBe("hangup");
    expect(call.flagged).toBe(true);
    const sms = await withTenant(c.companyId, (tx) => tx.select().from(smsMessages));
    expect(sms).toHaveLength(1);
    expect(sms[0].body).toContain("400 77 777");
  });

  it("marks a call with a lead as captured and sends a lead alert", async () => {
    const c = await companyWithNumber();
    const r = await handleInboundCall({ callSid: sid(), from: "+4740088888", to: c.number });
    await withTenant(c.companyId, async (tx) => {
      const [lead] = await tx.insert(leads).values({ companyId: c.companyId, name: "Per Test", phone: "+4740088888" }).returning();
      await tx
        .update(calls)
        .set({ leadId: lead.id, transcript: [{ role: "caller", text: "Jeg har en lekkasje", at: new Date().toISOString() }] })
        .where(eq(calls.id, r.callId!));
    });
    await postCall(r.callId!, c.companyId);
    const [call] = await withTenant(c.companyId, (tx) => tx.select().from(calls).where(eq(calls.id, r.callId!)));
    expect(call.outcome).toBe("lead_captured");
    expect(call.summary).toContain("lekkasje");
    const sms = await withTenant(c.companyId, (tx) => tx.select().from(smsMessages));
    expect(sms.map((s) => s.body).join()).toContain("Per Test");
  });
});

describe("phone numbers", () => {
  it("gives each company its own number, instantly, from the pool", async () => {
    const a = await companyWithNumber();
    const b = await companyWithNumber();
    expect(a.number).not.toBe(b.number);
    const again = await assignNumber(a.companyId, a.userId);
    expect(again.e164).toBe(a.number);
    const visibleToA = await withTenant(a.companyId, (tx) => tx.select().from(phoneNumbers));
    expect(visibleToA.map((n) => n.e164)).toEqual([a.number]);
  });
});
