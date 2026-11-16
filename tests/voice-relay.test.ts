import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import WebSocket from "ws";
import { eq } from "drizzle-orm";
import { closeDb, withSystem, withTenant } from "@/lib/db/client";
import { calls, companies } from "@/lib/db/schema";
import { handleRelayUpgrade, setBrainFactory } from "@/voice/relay";
import { handleInboundCall } from "@/lib/telephony/inbound";
import { assignNumber } from "@/lib/telephony/numbers";
import { makeCompany } from "./helpers";
import { ScriptedBrain } from "./fakes";

let server: Server;
let port: number;

beforeAll(async () => {
  server = createServer((_req, res) => res.end());
  server.on("upgrade", (req, socket, head) => handleRelayUpgrade(req, socket, head));
  await new Promise<void>((r) => server.listen(0, r));
  port = (server.address() as AddressInfo).port;
});
afterAll(async () => {
  setBrainFactory(null);
  server.close();
  await closeDb();
});

function connect(token: string | null) {
  return new WebSocket(`ws://localhost:${port}/api/voice/relay${token ? `?t=${encodeURIComponent(token)}` : ""}`);
}

describe("Twilio ConversationRelay WebSocket", () => {
  it("refuses connections without a valid signed token", async () => {
    const ws = connect("forged.token");
    const err = await new Promise<Error>((r) => ws.on("error", r));
    expect(String(err)).toContain("401");
  });

  it("streams the AI reply as text tokens and hands control back with end", async () => {
    const c = await makeCompany();
    await withSystem((tx) => tx.update(companies).set({ onboardingStep: "done" }).where(eq(companies.id, c.companyId)));
    const num = await assignNumber(c.companyId, c.userId);
    const inbound = await handleInboundCall({ callSid: `CA${crypto.randomUUID().replace(/-/g, "")}`, from: "+4740012345", to: num.e164 });
    const token = new URL(inbound.twiml.match(/url="([^"]+)"/)![1].replace(/&amp;/g, "&")).searchParams.get("t");

    setBrainFactory(() => new ScriptedBrain([
      { text: "Hei! Hva gjelder det?" },
      { tools: [{ name: "end_call", input: { reason: "wrong_number", goodbye_message: "Ingen fare. Ha det bra!" } }] },
    ]));

    const ws = connect(token);
    const received: Record<string, unknown>[] = [];
    ws.on("message", (m) => received.push(JSON.parse(m.toString())));
    await new Promise((r) => ws.on("open", r));
    ws.send(JSON.stringify({ type: "setup", callSid: "CA1", from: "+4740012345", to: num.e164 }));
    ws.send(JSON.stringify({ type: "prompt", voicePrompt: "Hallo", lang: "nb-NO", last: true }));
    await new Promise((r) => setTimeout(r, 200));
    const text = received.filter((m) => m.type === "text").map((m) => m.token).join("");
    expect(text).toBe("Hei! Hva gjelder det?");
    expect(received.find((m) => m.type === "text" && m.last === true)).toBeTruthy();

    ws.send(JSON.stringify({ type: "prompt", voicePrompt: "Å, feil nummer, beklager", last: true }));
    await new Promise((r) => setTimeout(r, 2500));
    const end = received.find((m) => m.type === "end");
    expect(end).toBeTruthy();
    expect(JSON.parse(String(end!.handoffData))).toEqual({ action: "end", reason: "wrong_number" });

    ws.close();
    await new Promise((r) => setTimeout(r, 300));
    const [call] = await withTenant(c.companyId, (tx) => tx.select().from(calls).where(eq(calls.id, inbound.callId!)));
    expect(call.transcript.map((e) => e.role)).toEqual(["agent", "caller", "agent", "caller", "agent"]);
    expect(call.postProcessedAt).not.toBeNull();
  });
});
