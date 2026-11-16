import { eq } from "drizzle-orm";
import { withTenant } from "../lib/db/client";
import { calls, type Company, type JobType, type TranscriptEntry } from "../lib/db/schema";
import type { AgentBrain, BetaMessage, BetaMessageParam, BetaTextBlockParam } from "./brain";
import { buildSystemPrompt, callContext } from "./prompt";
import { CallTools, TOOL_DEFS, type TerminalAction, type ToolDeps } from "./tools";
import { speechMillis } from "./speech";

/** How the session talks to the outside world (Twilio WebSocket, browser simulator, tests). */
export interface VoiceTransport {
  /** Stream text to text-to-speech. `last` marks the end of an utterance. */
  sendText(token: string, last: boolean): void;
  setLanguage(lang: "nb" | "en"): void;
  /** End the AI part of the call; handoff tells the telephony layer what to do next. */
  end(handoff: { action: "transfer" | "end"; reason?: string }): void;
}

export type SessionOptions = {
  company: Company;
  jobTypes: JobType[];
  callId: string;
  callerNumber: string | null;
  isTest: boolean;
  greeting: string;
  brain: AgentBrain;
  transport: VoiceTransport;
  deps: ToolDeps;
  now?: () => Date;
  silenceMs?: number;
  maxDurationMs?: number;
  /** Estimated time to speak a text aloud (tests use 0). */
  speechTime?: (text: string) => number;
  onClosed?: (callId: string) => void;
};

const LINES = {
  nb: {
    still: "Er du der fortsatt?",
    gone: "Jeg hører deg dessverre ikke. Ring oss gjerne igjen. Ha det bra!",
    glitch: "Beklager, jeg fikk et lite teknisk problem. Kan du si det en gang til?",
    broken: "Beklager, jeg har tekniske problemer akkurat nå. Jeg har notert at du ringte, og noen fra firmaet ringer deg tilbake. Ha det bra!",
    refusal: "Det kan jeg dessverre ikke hjelpe med. Er det noe annet jeg kan hjelpe deg med angående en jobb?",
    tooLong: "Jeg må dessverre avslutte nå, men jeg har notert alt, og firmaet tar kontakt. Ha det bra!",
  },
  en: {
    still: "Are you still there?",
    gone: "I'm afraid I can't hear you. Please call us again. Goodbye!",
    glitch: "Sorry, I had a small technical problem. Could you say that again?",
    broken: "Sorry, I'm having technical problems right now. I've noted your call and someone will call you back. Goodbye!",
    refusal: "I'm afraid I can't help with that. Is there anything else I can help you with regarding a job?",
    tooLong: "I need to wrap up now, but I've noted everything and the company will get in touch. Goodbye!",
  },
};

/**
 * One phone conversation with the AI receptionist. Transport-agnostic: the
 * same class runs real calls, the browser test simulator and the test suite.
 */
export class CallSession {
  readonly tools: CallTools;
  readonly transcript: TranscriptEntry[] = [];
  private messages: BetaMessageParam[] = [];
  private system: BetaTextBlockParam[];
  private pending: string[] = [];
  private notes: string[] = [];
  private current: { abort: AbortController; done: Promise<void> } | null = null;
  private loop: Promise<void> | null = null;
  private firstTurn = true;
  private lang: "nb" | "en";
  private ended = false;
  private closed = false;
  private errors = 0;
  private silenceTimer: NodeJS.Timeout | null = null;
  private silenceStrikes = 0;
  private maxTimer: NodeJS.Timeout | null = null;
  private usage = { input: 0, output: 0, cache_read: 0, cache_write: 0, turns: 0 };
  private now: () => Date;
  private speech: (text: string) => number;

  constructor(private o: SessionOptions) {
    this.now = o.now ?? (() => new Date());
    this.speech = o.speechTime ?? speechMillis;
    this.lang = o.company.locale === "en" ? "en" : "nb";
    this.system = buildSystemPrompt(o.company, o.jobTypes);
    this.tools = new CallTools(o.company, o.jobTypes, o.callId, o.callerNumber, o.deps, this.now, o.isTest);
  }

  get isEnded() {
    return this.ended;
  }

  /** The greeting is spoken by the telephony layer; we only record it and start listening. */
  start() {
    this.record("agent", this.o.greeting);
    this.armSilence(this.speech(this.o.greeting));
    this.maxTimer = setTimeout(() => void this.finish({ kind: "end", message: LINES[this.lang].tooLong, reason: "max_duration" }), this.o.maxDurationMs ?? 12 * 60_000);
    this.maxTimer.unref?.();
  }

  /** The caller said something (final transcript of an utterance). */
  onCallerText(text: string): Promise<void> {
    const clean = text.trim();
    if (this.ended || !clean) return this.loop ?? Promise.resolve();
    this.clearSilence();
    this.silenceStrikes = 0;
    this.pending.push(clean);
    // Stop whatever we were saying or thinking: the caller has the floor.
    this.current?.abort.abort();
    if (!this.loop) {
      this.loop = this.process().finally(() => {
        this.loop = null;
      });
    }
    return this.loop;
  }

  /** The caller talked over us; remember how far they got to hear. */
  onInterrupt(heardSoFar: string) {
    this.current?.abort.abort();
    const heard = heardSoFar.trim();
    if (heard) this.notes.push(this.lang === "en" ? `The caller interrupted you after hearing: "${heard}"` : `Innringeren avbrøt deg etter å ha hørt: «${heard}»`);
  }

  onDtmf(digit: string) {
    void this.onCallerText(this.lang === "en" ? `[pressed ${digit} on the keypad]` : `[tastet ${digit} på tastaturet]`);
  }

  private async process() {
    while (this.pending.length && !this.ended) {
      if (this.current) await this.current.done;
      const texts = this.pending.splice(0);
      for (const t of texts) this.record("caller", t);
      let content = texts.join(" ");
      if (this.firstTurn) {
        content = `${callContext(this.o.company, { callerNumber: this.o.callerNumber, greeting: this.o.greeting, now: this.now() })}\n\n${content}`;
        this.firstTurn = false;
      }
      if (this.notes.length) content = `(${this.notes.splice(0).join(" ")})\n${content}`;
      this.messages.push({ role: "user", content });
      const abort = new AbortController();
      const done = this.runTurn(abort.signal).catch((e) => this.onError(e));
      this.current = { abort, done };
      await done;
      this.current = null;
    }
  }

  private async runTurn(signal: AbortSignal) {
    let lastSpoken = "";
    const MAX_STEPS = 6;
    for (let step = 0; step < MAX_STEPS; step++) {
      let spoken = "";
      let msg: BetaMessage;
      try {
        msg = await this.o.brain.respond(
          { system: this.system, tools: TOOL_DEFS, messages: this.messages, noTools: step === MAX_STEPS - 1 },
          {
            signal,
            onText: (d) => {
              spoken += d;
              this.o.transport.sendText(d, false);
            },
          },
        );
      } catch (e) {
        if (signal.aborted) {
          // Close the half-spoken utterance so the next reply starts fresh.
          if (spoken) this.o.transport.sendText("", true);
          if (spoken.trim()) {
            this.messages.push({ role: "assistant", content: spoken.trim() });
            this.record("agent", `${spoken.trim()} …`);
          }
          return;
        }
        throw e;
      }
      if (spoken) this.o.transport.sendText("", true);
      this.errors = 0;
      this.trackUsage(msg);

      if (msg.stop_reason === "refusal") {
        this.say(LINES[this.lang].refusal);
        this.messages.push({ role: "assistant", content: LINES[this.lang].refusal });
        break;
      }
      this.messages.push({ role: "assistant", content: msg.content });
      if (spoken.trim()) {
        this.record("agent", spoken.trim());
        lastSpoken = spoken;
      }
      const toolUses = msg.content.filter((b): b is Extract<typeof b, { type: "tool_use" }> => b.type === "tool_use");
      if (msg.stop_reason !== "tool_use" || toolUses.length === 0) break;

      const results: { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean }[] = [];
      let terminal: TerminalAction | undefined;
      for (const tu of toolUses) {
        const r = await this.tools.run(tu.name, tu.input);
        if (r.language && r.language !== this.lang) {
          this.lang = r.language;
          this.o.transport.setLanguage(r.language);
        }
        if (r.terminal) terminal = r.terminal;
        if (tu.name === "book_befaring" && !r.isError) this.record("system", r.content);
        results.push({ type: "tool_result", tool_use_id: tu.id, content: r.content, ...(r.isError ? { is_error: true } : {}) });
      }
      this.messages.push({ role: "user", content: results });
      if (terminal) {
        await this.finish(terminal);
        return;
      }
      if (signal.aborted) return; // the caller spoke while we worked; their words come next
    }
    await this.persist();
    this.armSilence(this.speech(lastSpoken));
  }

  private say(text: string) {
    this.o.transport.sendText(text, true);
    this.record("agent", text);
  }

  private async finish(action: TerminalAction) {
    if (this.ended) return;
    this.ended = true;
    this.clearSilence();
    if (this.maxTimer) clearTimeout(this.maxTimer);
    this.say(action.message);
    if (action.kind === "transfer") this.record("system", this.lang === "en" ? "Transferred to the on-call phone." : "Satt over til vakttelefon.");
    await this.persist();
    const handoff = action.kind === "transfer" ? { action: "transfer" as const } : { action: "end" as const, reason: action.reason };
    const t = setTimeout(() => this.o.transport.end(handoff), this.speech(action.message));
    t.unref?.();
  }

  private async onError(e: unknown) {
    console.error("[voice] turn failed", e);
    this.errors++;
    if (this.errors >= 2) {
      await withTenant(this.o.company.id, (tx) =>
        tx.update(calls).set({ flagged: true, flagReason: "Teknisk feil under samtalen – ring kunden tilbake." }).where(eq(calls.id, this.o.callId)),
      ).catch(() => {});
      await this.finish({ kind: "end", message: LINES[this.lang].broken, reason: "error" });
    } else {
      this.say(LINES[this.lang].glitch);
      this.armSilence(this.speech(LINES[this.lang].glitch));
    }
  }

  private armSilence(afterSpeechMs: number) {
    this.clearSilence();
    if (this.ended) return;
    this.silenceTimer = setTimeout(() => {
      if (this.ended || this.current) return;
      this.silenceStrikes++;
      if (this.silenceStrikes >= 2) {
        void this.finish({ kind: "end", message: LINES[this.lang].gone, reason: "silence" });
        return;
      }
      this.say(LINES[this.lang].still);
      this.notes.push(this.lang === "en" ? 'It was quiet, so you asked "Are you still there?"' : "Det var stille, så du spurte «Er du der fortsatt?»");
      this.armSilence(this.speech(LINES[this.lang].still));
    }, afterSpeechMs + (this.o.silenceMs ?? 9000));
    this.silenceTimer.unref?.();
  }

  private clearSilence() {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = null;
  }

  private record(role: TranscriptEntry["role"], text: string) {
    this.transcript.push({ role, text, at: this.now().toISOString() });
  }

  private trackUsage(m: BetaMessage) {
    const u = m.usage;
    this.usage.input += u.input_tokens ?? 0;
    this.usage.output += u.output_tokens ?? 0;
    this.usage.cache_read += u.cache_read_input_tokens ?? 0;
    this.usage.cache_write += u.cache_creation_input_tokens ?? 0;
    this.usage.turns++;
  }

  async persist() {
    await withTenant(this.o.company.id, (tx) =>
      tx.update(calls).set({ transcript: this.transcript, aiUsage: this.usage, language: this.lang }).where(eq(calls.id, this.o.callId)),
    );
  }

  /** The phone line closed (caller hung up, transfer started, or session ended). */
  async close() {
    if (this.closed) return;
    this.closed = true;
    this.ended = true;
    this.clearSilence();
    if (this.maxTimer) clearTimeout(this.maxTimer);
    this.current?.abort.abort();
    await this.current?.done.catch(() => {});
    await this.persist().catch((e) => console.error("[voice] persist failed", e));
    this.o.onClosed?.(this.o.callId);
  }
}
