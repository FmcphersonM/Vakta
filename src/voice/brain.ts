import Anthropic from "@anthropic-ai/sdk";
import { env } from "../lib/env";

export type BetaMessageParam = Anthropic.Beta.Messages.BetaMessageParam;
export type BetaMessage = Anthropic.Beta.Messages.BetaMessage;
export type BetaTool = Anthropic.Beta.Messages.BetaTool;
export type BetaTextBlockParam = Anthropic.Beta.Messages.BetaTextBlockParam;

/** `noTools` forces a spoken reply (used on the last allowed step of a turn). */
export type BrainRequest = { system: BetaTextBlockParam[]; tools: BetaTool[]; messages: BetaMessageParam[]; noTools?: boolean };

/** Anything that can produce the agent's next message (Claude, or a scripted fake in tests). */
export interface AgentBrain {
  respond(req: BrainRequest, turn: { onText: (delta: string) => void; signal: AbortSignal }): Promise<BetaMessage>;
}

let client: Anthropic | undefined;
function getClient() {
  client ??= new Anthropic({ apiKey: env().ANTHROPIC_API_KEY, maxRetries: 1, timeout: 20_000 });
  return client;
}

/**
 * Claude, streamed: every text delta goes straight to text-to-speech so the
 * caller hears the first words while the rest is still being generated.
 * Low effort keeps thinking short for a snappy phone conversation.
 */
export class ClaudeBrain implements AgentBrain {
  constructor(
    private model = env().VOICE_MODEL,
    private effort = env().VOICE_EFFORT,
  ) {}

  async respond(req: BrainRequest, turn: { onText: (delta: string) => void; signal: AbortSignal }): Promise<BetaMessage> {
    const stream = getClient().beta.messages.stream(
      {
        model: this.model,
        max_tokens: 2048,
        system: req.system,
        tools: req.tools,
        messages: req.messages,
        ...(req.noTools ? { tool_choice: { type: "none" as const } } : {}),
        output_config: { effort: this.effort },
        // Cache the conversation so far; system + tools are cached via block breakpoints.
        cache_control: { type: "ephemeral" },
        // If a safety classifier declines, retry on a fallback model instead of going silent.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      },
      { signal: turn.signal },
    );
    stream.on("text", (delta) => turn.onText(delta));
    return stream.finalMessage();
  }
}
