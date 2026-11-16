import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { eq } from "drizzle-orm";
import { verifyToken } from "../lib/crypto";
import { withTenant } from "../lib/db/client";
import { calls, companies, jobTypes } from "../lib/db/schema";
import { fullGreeting } from "../lib/greeting";
import { postCall } from "../lib/calls/post-call";
import { CallSession, type VoiceTransport } from "./session";
import { ClaudeBrain, type AgentBrain } from "./brain";
import { productionDeps } from "./deps";
import { env } from "../lib/env";

const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });

let brainFactory: () => AgentBrain = () => new ClaudeBrain();
/** Tests replace Claude with a scripted brain. */
export function setBrainFactory(f: (() => AgentBrain) | null) {
  brainFactory = f ?? (() => new ClaudeBrain());
}

/** Messages Twilio ConversationRelay sends us. */
type RelayIn =
  | { type: "setup"; callSid: string; from?: string; to?: string; customParameters?: Record<string, string> }
  | { type: "prompt"; voicePrompt: string; lang?: string; last?: boolean }
  | { type: "interrupt"; utteranceUntilInterrupt?: string; durationUntilInterruptMs?: number }
  | { type: "dtmf"; digit: string }
  | { type: "error"; description?: string }
  | { type: string; [k: string]: unknown };

class RelayTransport implements VoiceTransport {
  constructor(private ws: WebSocket) {}
  private send(obj: unknown) {
    if (this.ws.readyState === this.ws.OPEN) this.ws.send(JSON.stringify(obj));
  }
  sendText(token: string, last: boolean) {
    this.send({ type: "text", token, last });
  }
  setLanguage(lang: "nb" | "en") {
    const code = lang === "en" ? "en-US" : "nb-NO";
    this.send({ type: "language", ttsLanguage: code, transcriptionLanguage: code });
  }
  end(handoff: { action: "transfer" | "end"; reason?: string }) {
    this.send({ type: "end", handoffData: JSON.stringify(handoff) });
  }
}

/** Accepts Twilio's WebSocket only with a valid, unexpired token we signed for this call. */
export function handleRelayUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
  const url = new URL(req.url ?? "/", "http://localhost");
  const claims = verifyToken<{ callId: string; companyId: string }>(url.searchParams.get("t"));
  if (!claims) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => void onConnection(ws, claims));
}

async function onConnection(ws: WebSocket, claims: { callId: string; companyId: string }) {
  // Twilio sends "setup" right away; listen immediately and buffer until the
  // session is loaded, so no early message is lost.
  const early: RelayIn[] = [];
  let handle: ((m: RelayIn) => void) | null = null;
  let closedEarly = false;
  ws.on("message", (raw) => {
    let msg: RelayIn;
    try {
      msg = JSON.parse(raw.toString()) as RelayIn;
    } catch {
      return;
    }
    if (handle) handle(msg);
    else early.push(msg);
  });
  ws.on("error", (e) => console.error("[voice] socket error", e));
  ws.once("close", () => {
    closedEarly = true;
  });

  const data = await withTenant(claims.companyId, async (tx) => {
    const [company] = await tx.select().from(companies).where(eq(companies.id, claims.companyId));
    const [call] = await tx.select().from(calls).where(eq(calls.id, claims.callId));
    const jt = await tx.select().from(jobTypes);
    return { company, call, jt };
  });
  if (!data.company || !data.call) {
    ws.close(1008, "unknown call");
    return;
  }
  const { company, call } = data;
  const session = new CallSession({
    company,
    jobTypes: data.jt,
    callId: call.id,
    callerNumber: call.fromNumber,
    isTest: call.isTest,
    greeting: fullGreeting(company),
    brain: brainFactory(),
    transport: new RelayTransport(ws),
    deps: productionDeps(company, call.isTest),
  });

  handle = (msg) => {
    switch (msg.type) {
      case "setup":
        session.start();
        break;
      case "prompt": {
        const m = msg as Extract<RelayIn, { type: "prompt" }>;
        if (m.last !== false) void session.onCallerText(m.voicePrompt);
        break;
      }
      case "interrupt":
        session.onInterrupt(String((msg as { utteranceUntilInterrupt?: string }).utteranceUntilInterrupt ?? ""));
        break;
      case "dtmf":
        session.onDtmf(String((msg as { digit?: string }).digit ?? ""));
        break;
      case "error":
        console.error("[voice] relay error", (msg as { description?: string }).description);
        break;
    }
  };
  for (const m of early.splice(0)) handle(m);

  const finish = () => {
    void session
      .close()
      .then(() => postCall(call.id, company.id))
      .catch((e) => console.error("[voice] close failed", e));
  };
  if (closedEarly) finish();
  else ws.on("close", finish);
  if (env().NODE_ENV !== "production") console.log(`[voice] call ${call.id} connected`);
}
