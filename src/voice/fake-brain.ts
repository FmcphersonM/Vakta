/**
 * DEVELOPMENT/TEST ONLY — a scripted stand-in for Claude so the full call flow
 * (simulator UI, tools, booking, SMS) can be exercised without an API key.
 * Enabled with VAKTA_FAKE_AI=1 and refused in production.
 */
import type { AgentBrain, BetaMessage, BrainRequest } from "./brain";

export function fakeAiEnabled() {
  return process.env.VAKTA_FAKE_AI === "1" && process.env.NODE_ENV !== "production";
}

type Block = { type: "text"; text: string; citations: null } | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };

export class ScriptedDemoBrain implements AgentBrain {
  async respond(req: BrainRequest, turn: { onText: (d: string) => void; signal: AbortSignal }): Promise<BetaMessage> {
    const last = req.messages.at(-1)!;
    const callerTurns = req.messages.filter((m) => m.role === "user" && typeof m.content === "string");
    const toolResult = Array.isArray(last.content) ? (last.content.find((b) => b.type === "tool_result") as { content?: string } | undefined) : undefined;
    const prevTool = [...req.messages].reverse().find((m) => m.role === "assistant" && Array.isArray(m.content) && m.content.some((b) => b.type === "tool_use"));
    const prevToolName = prevTool && Array.isArray(prevTool.content) ? (prevTool.content.find((b) => b.type === "tool_use") as { name: string }).name : null;
    const blocks: Block[] = [];
    const say = (t: string) => blocks.push({ type: "text", text: t, citations: null });
    const use = (name: string, input: Record<string, unknown>) => blocks.push({ type: "tool_use", id: `toolu_${Math.random().toString(36).slice(2)}`, name, input });

    if (toolResult && prevToolName === "save_caller_details") {
      say("Takk! Et øyeblikk, jeg sjekker kalenderen. ");
      use("find_befaring_slots", {});
    } else if (toolResult && prevToolName === "find_befaring_slots") {
      const slots = String(toolResult.content ?? "").match(/S\d+: [^\n]+/g) ?? [];
      say(slots.length ? `Jeg har ledig ${slots.slice(0, 2).map((s) => s.replace(/^S\d+: /, "")).join(", eller ")}. Hva passer best?` : "Jeg fant dessverre ingen ledige tider. Noen fra firmaet ringer deg tilbake.");
    } else if (toolResult && prevToolName === "book_befaring") {
      say(`${String(toolResult.content).split(".")[0]}. Du får en bekreftelse på SMS. Var det noe mer?`);
    } else if (callerTurns.length === 1) {
      say("Det kan vi hjelpe med! Hva heter du, og hvilken adresse gjelder det?");
    } else if (callerTurns.length === 2) {
      const text = String(callerTurns[1].content).split("\n").at(-1)!;
      const [name, ...rest] = text.split(",");
      use("save_caller_details", { name: name.trim(), address: rest.join(",").trim(), description: String(callerTurns[0].content).split("\n").at(-1) });
    } else if (callerTurns.length === 3) {
      use("book_befaring", { slot_id: "S1" });
    } else {
      use("end_call", { reason: "done", goodbye_message: "Takk for at du ringte. Ha en fin dag!" });
    }
    for (const b of blocks) if (b.type === "text") for (const w of b.text.split(/(?<= )/)) {
      if (turn.signal.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
      turn.onText(w);
    }
    return {
      id: "msg_fake",
      type: "message",
      role: "assistant",
      model: "scripted-demo",
      content: blocks,
      stop_reason: blocks.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    } as unknown as BetaMessage;
  }
}
