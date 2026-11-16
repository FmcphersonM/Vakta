import { eq } from "drizzle-orm";
import { withTenant } from "../lib/db/client";
import { calls, companies, jobTypes } from "../lib/db/schema";
import { fullGreeting } from "../lib/greeting";
import { postCall } from "../lib/calls/post-call";
import { randomToken } from "../lib/crypto";
import { CallSession, type VoiceTransport } from "./session";
import { ClaudeBrain, type AgentBrain } from "./brain";
import { productionDeps } from "./deps";

export type SimEvent =
  | { type: "text"; token: string }
  | { type: "utterance_end" }
  | { type: "language"; lang: "nb" | "en" }
  | { type: "end"; action: "transfer" | "end"; reason?: string };

class SimTransport implements VoiceTransport {
  listener: ((e: SimEvent) => void) | null = null;
  ended: { action: "transfer" | "end"; reason?: string } | null = null;
  sendText(token: string, last: boolean) {
    if (token) this.listener?.({ type: "text", token });
    if (last) this.listener?.({ type: "utterance_end" });
  }
  setLanguage(lang: "nb" | "en") {
    this.listener?.({ type: "language", lang });
  }
  end(h: { action: "transfer" | "end"; reason?: string }) {
    this.ended = h;
    this.listener?.({ type: "end", ...h });
  }
}

type Sim = { session: CallSession; transport: SimTransport; companyId: string; userId: string; callId: string; lastActive: number };
const g = globalThis as unknown as { __vaktaSims?: Map<string, Sim>; __vaktaSimSweep?: NodeJS.Timeout };
const sims = (g.__vaktaSims ??= new Map());

let brainFactory: () => AgentBrain = () => new ClaudeBrain();
export function setSimulatorBrain(f: (() => AgentBrain) | null) {
  brainFactory = f ?? (() => new ClaudeBrain());
}

g.__vaktaSimSweep ??= setInterval(() => {
  const cutoff = Date.now() - 15 * 60_000;
  for (const [id, s] of sims) if (s.lastActive < cutoff) void endSimulation(id, s.userId);
}, 60_000);
g.__vaktaSimSweep.unref?.();

/** Starts a browser test call: a real call record (marked as test) and a real agent session. */
export async function startSimulation(companyId: string, userId: string, callerNumber: string | null) {
  const { company, jt, call } = await withTenant(companyId, async (tx) => {
    const [company] = await tx.select().from(companies).where(eq(companies.id, companyId));
    const jt = await tx.select().from(jobTypes);
    const [call] = await tx
      .insert(calls)
      .values({ companyId, provider: "simulator", isTest: true, fromNumber: callerNumber, language: company.locale === "en" ? "en" : "nb" })
      .returning();
    return { company, jt, call };
  });
  const transport = new SimTransport();
  const greeting = fullGreeting(company);
  const session = new CallSession({
    company,
    jobTypes: jt,
    callId: call.id,
    callerNumber,
    isTest: true,
    greeting,
    brain: brainFactory(),
    transport,
    deps: productionDeps(company, true),
    speechTime: () => 0,
    silenceMs: 24 * 3600_000, // no "are you still there?" in the browser
  });
  session.start();
  const id = randomToken(18);
  sims.set(id, { session, transport, companyId, userId, callId: call.id, lastActive: Date.now() });
  return { id, callId: call.id, greeting };
}

/** Sends the caller's words and streams the agent's reply events. */
export async function simulateUtterance(id: string, userId: string, text: string, onEvent: (e: SimEvent) => void) {
  const sim = sims.get(id);
  if (!sim || sim.userId !== userId) throw new Error("not_found");
  sim.lastActive = Date.now();
  sim.transport.listener = onEvent;
  try {
    await sim.session.onCallerText(text);
    await new Promise((r) => setTimeout(r, 10)); // let a pending end() fire
  } finally {
    if (sim.transport.listener === onEvent) sim.transport.listener = null;
  }
  return { ended: sim.transport.ended };
}

export async function endSimulation(id: string, userId: string) {
  const sim = sims.get(id);
  if (!sim || sim.userId !== userId) return null;
  sims.delete(id);
  await sim.session.close();
  await postCall(sim.callId, sim.companyId);
  return sim.callId;
}
