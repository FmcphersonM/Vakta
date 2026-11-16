import type { AgentBrain, BetaMessage, BrainRequest } from "@/voice/brain";
import type { BookingService, Slot, ToolDeps } from "@/voice/tools";
import type { VoiceTransport } from "@/voice/session";

type Step = { text?: string; tools?: { name: string; input: Record<string, unknown> }[]; delayMs?: number; error?: Error; refusal?: boolean };

/** A deterministic stand-in for Claude: replies with the next scripted step. */
export class ScriptedBrain implements AgentBrain {
  requests: BrainRequest[] = [];
  active = 0;
  maxActive = 0;
  private n = 0;
  constructor(private steps: (Step | ((req: BrainRequest) => Step))[]) {}

  async respond(req: BrainRequest, turn: { onText: (d: string) => void; signal: AbortSignal }): Promise<BetaMessage> {
    this.requests.push(structuredClone(req));
    this.active++;
    this.maxActive = Math.max(this.maxActive, this.active);
    try {
      const raw = this.steps[this.n++];
      if (!raw) throw new Error(`ScriptedBrain ran out of steps (call ${this.n})`);
      const step = typeof raw === "function" ? raw(req) : raw;
      if (step.error) throw step.error;
      const words = (step.text ?? "").split(/(?<= )/);
      for (const w of words) {
        if (step.delayMs) await new Promise((r) => setTimeout(r, step.delayMs));
        if (turn.signal.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
        if (w) turn.onText(w);
      }
      const content: unknown[] = [];
      if (step.text) content.push({ type: "text", text: step.text, citations: null });
      for (const [i, t] of (step.tools ?? []).entries()) content.push({ type: "tool_use", id: `toolu_${this.n}_${i}`, name: t.name, input: t.input });
      return {
        id: `msg_${this.n}`,
        type: "message",
        role: "assistant",
        model: "scripted",
        content,
        stop_reason: step.refusal ? "refusal" : step.tools?.length ? "tool_use" : "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 80, cache_creation_input_tokens: 0 },
      } as unknown as BetaMessage;
    } finally {
      this.active--;
    }
  }
}

export class RecordingTransport implements VoiceTransport {
  tokens: string[] = [];
  utterances: string[] = [];
  private buf = "";
  languages: string[] = [];
  ended: { action: string; reason?: string } | null = null;
  sendText(token: string, last: boolean) {
    this.tokens.push(token);
    this.buf += token;
    if (last) {
      if (this.buf.trim()) this.utterances.push(this.buf.trim());
      this.buf = "";
    }
  }
  setLanguage(l: "nb" | "en") {
    this.languages.push(l);
  }
  end(h: { action: "transfer" | "end"; reason?: string }) {
    this.ended = h;
  }
}

export function fakeDeps(slots: Slot[]) {
  const sent: { to: string; body: string }[] = [];
  const notified: { kind: string; body: string }[] = [];
  const booked: { slot: Slot; details: Record<string, unknown> }[] = [];
  const booking: BookingService = {
    async findSlots() {
      return slots;
    },
    async book(_c, slot, details) {
      booked.push({ slot, details });
      return { id: crypto.randomUUID(), startsAt: slot.start, assigneeName: "Kari Nordmann" };
    },
    inServiceArea(_c, geo) {
      return geo ? geo.lat > 59 && geo.lat < 61 : null;
    },
  };
  const deps: ToolDeps = {
    booking,
    geocode: async (a) =>
      /kirkegata/i.test(a)
        ? { address: "Kirkegata 15, 0153 Oslo", lat: 59.91, lng: 10.744, postcode: "0153", city: "Oslo" }
        : /tromsø/i.test(a)
          ? { address: "Storgata 1, 9008 Tromsø", lat: 69.65, lng: 18.95, postcode: "9008", city: "Tromsø" }
          : null,
    sendSms: async (i) => {
      sent.push({ to: i.to, body: i.body });
    },
    notifyOwner: async (kind, body) => {
      notified.push({ kind, body });
    },
  };
  return { deps, sent, notified, booked };
}
