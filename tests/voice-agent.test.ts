import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, withSystem, withTenant } from "@/lib/db/client";
import { calls, companies, jobTypes, leads } from "@/lib/db/schema";
import { CallSession } from "@/voice/session";
import { buildSystemPrompt, callContext } from "@/voice/prompt";
import { spokenSlot, spokenTimeNb } from "@/voice/speech";
import { fullGreeting } from "@/lib/greeting";
import { makeCompany } from "./helpers";
import { fakeDeps, RecordingTransport, ScriptedBrain } from "./fakes";
import type { BrainRequest } from "@/voice/brain";

afterAll(closeDb);

const NOW = new Date("2026-11-16T09:00:00Z"); // Monday 10:00 in Oslo
const tomorrow9 = new Date("2026-11-17T08:00:00Z"); // Tue 09:00 Oslo
const thu1330 = new Date("2026-11-19T12:30:00Z"); // Thu 13:30 Oslo

async function setup(changes: Partial<typeof companies.$inferInsert> = {}) {
  const c = await makeCompany({ name: "Fjordbyen Rør AS" });
  await withSystem((tx) =>
    tx.update(companies).set({ onboardingStep: "done", forwardNumber: "+4791234567", forwardHours: "always", ...changes }).where(eq(companies.id, c.companyId)),
  );
  const { company, jt, callId } = await withTenant(c.companyId, async (tx) => {
    const [company] = await tx.select().from(companies);
    const jt = await tx.select().from(jobTypes);
    const [call] = await tx.insert(calls).values({ companyId: c.companyId, fromNumber: "+4740010201", toNumber: "+4721490001", provider: "twilio" }).returning();
    return { company, jt, callId: call.id };
  });
  return { ...c, company, jt, callId };
}

function session(s: Awaited<ReturnType<typeof setup>>, brain: ScriptedBrain, deps: ReturnType<typeof fakeDeps>, opts: { silenceMs?: number } = {}) {
  const transport = new RecordingTransport();
  const sess = new CallSession({
    company: s.company,
    jobTypes: s.jt,
    callId: s.callId,
    callerNumber: "+4740010201",
    isTest: false,
    greeting: fullGreeting(s.company),
    brain,
    transport,
    deps: deps.deps,
    now: () => NOW,
    speechTime: () => 0,
    silenceMs: opts.silenceMs ?? 60_000,
  });
  sess.start();
  return { sess, transport };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("voice agent: a full booking call", () => {
  it("qualifies the job, finds a slot, books it, texts the caller and ends politely", async () => {
    const s = await setup();
    const deps = fakeDeps([
      { userId: s.userId, start: tomorrow9, end: new Date(tomorrow9.getTime() + 45 * 60_000) },
      { userId: s.userId, start: thu1330, end: new Date(thu1330.getTime() + 45 * 60_000) },
    ]);
    const brain = new ScriptedBrain([
      { text: "Det kan vi hjelpe med. Hva heter du, og hvilken adresse gjelder det?" },
      { tools: [{ name: "save_caller_details", input: { name: "Ola Nordmann", address: "Kirkegata 15 Oslo", job_type: "Varmtvannsbereder", description: "Berederen lekker i bunnen" } }] },
      { text: "Takk, Ola. Et øyeblikk, jeg sjekker kalenderen.", tools: [{ name: "find_befaring_slots", input: { part_of_day: "any" } }] },
      (req) => {
        const last = JSON.stringify(req.messages.at(-1));
        expect(last).toContain("i morgen klokken ni");
        expect(last).toContain("på torsdag klokken halv to");
        return { text: "Jeg har ledig i morgen klokken ni, eller torsdag klokken halv to. Hva passer best?" };
      },
      { tools: [{ name: "book_befaring", input: { slot_id: "S1" } }] },
      { text: "Da er befaringen booket i morgen klokken ni i Kirkegata 15. Du får en SMS. Var det noe mer?" },
      { tools: [{ name: "end_call", input: { reason: "done", goodbye_message: "Takk for at du ringte. Ha en fin dag!" } }] },
    ]);
    const { sess, transport } = session(s, brain, deps);

    await sess.onCallerText("Hei, berederen min lekker.");
    await sess.onCallerText("Ola Nordmann, Kirkegata 15 i Oslo.");
    await sess.onCallerText("I morgen klokken ni passer fint.");
    await sess.onCallerText("Nei, det var alt.");
    await wait(20);

    // What the caller heard
    expect(transport.utterances[0]).toBe("Det kan vi hjelpe med. Hva heter du, og hvilken adresse gjelder det?");
    expect(transport.utterances.at(-1)).toBe("Takk for at du ringte. Ha en fin dag!");
    expect(transport.ended).toEqual({ action: "end", reason: "done" });

    // First user turn carries the call context; system prompt is cached and complete
    const first = brain.requests[0];
    expect(first.messages[0].content).toContain("Innringers nummer: 400 10 201");
    expect(first.messages[0].content).toContain("Hei, berederen min lekker.");
    expect(first.system[1].cache_control).toEqual({ type: "ephemeral" });
    expect(first.system[1].text).toContain("Fjordbyen Rør AS");

    // Booking + SMS + owner alert
    expect(deps.booked).toHaveLength(1);
    expect(deps.booked[0].slot.start).toEqual(tomorrow9);
    expect(deps.booked[0].details.address).toBe("Kirkegata 15, 0153 Oslo");
    expect(deps.sent[0].to).toBe("+4740010201");
    expect(deps.sent[0].body).toContain("Befaring hos Fjordbyen Rør AS er bekreftet tirsdag 17. november kl. 09:00");
    expect(deps.notified.map((n) => n.kind)).toEqual(["booked"]);

    // Database: lead + call outcome + transcript
    const [lead] = await withTenant(s.companyId, (tx) => tx.select().from(leads));
    expect(lead).toMatchObject({ name: "Ola Nordmann", address: "Kirkegata 15, 0153 Oslo", jobTypeText: "Varmtvannsbereder", inServiceArea: true, phone: "+4740010201", source: "phone" });
    const [call] = await withTenant(s.companyId, (tx) => tx.select().from(calls).where(eq(calls.id, s.callId)));
    expect(call.outcome).toBe("booked");
    expect(call.leadId).toBe(lead.id);
    expect(call.transcript.filter((e) => e.role === "caller").map((e) => e.text)).toEqual([
      "Hei, berederen min lekker.",
      "Ola Nordmann, Kirkegata 15 i Oslo.",
      "I morgen klokken ni passer fint.",
      "Nei, det var alt.",
    ]);
    expect(call.transcript[0].text).toContain("AI-assistent");
    expect(call.aiUsage?.turns).toBe(7);
    await sess.close();
  });
});

describe("voice agent: emergencies", () => {
  it("transfers an emergency live to the owner and alerts them", async () => {
    const s = await setup();
    const deps = fakeDeps([]);
    const brain = new ScriptedBrain([
      {
        text: "Steng hovedkranen hvis du kan. ",
        tools: [{ name: "save_caller_details", input: { description: "Vann renner fra taket i stua", urgency: "emergency", address: "Kirkegata 15 Oslo" } }],
      },
      { tools: [{ name: "transfer_to_human", input: { reason: "emergency", message_to_caller: "Jeg setter deg over til vakthavende nå." } }] },
    ]);
    const { sess, transport } = session(s, brain, deps);
    await sess.onCallerText("Det renner vann fra taket!");
    await wait(20);
    expect(transport.ended).toEqual({ action: "transfer" });
    expect(transport.utterances.at(-1)).toBe("Jeg setter deg over til vakthavende nå.");
    expect(deps.notified[0].kind).toBe("emergency");
    expect(deps.notified[0].body).toContain("AKUTT");
    const [call] = await withTenant(s.companyId, (tx) => tx.select().from(calls).where(eq(calls.id, s.callId)));
    expect(call.isEmergency).toBe(true);
    expect(call.outcome).toBe("emergency");
  });

  it("does not transfer when forwarding is off, but still alerts the owner and keeps the call going", async () => {
    const s = await setup({ forwardNumber: null });
    const deps = fakeDeps([]);
    const brain = new ScriptedBrain([
      { tools: [{ name: "transfer_to_human", input: { reason: "emergency", message_to_caller: "Jeg setter deg over." } }] },
      (req) => {
        expect(JSON.stringify(req.messages.at(-1))).toContain("Kan ikke sette over");
        return { text: "Jeg har varslet vakthavende, som ringer deg straks." };
      },
    ]);
    const { sess, transport } = session(s, brain, deps);
    await sess.onCallerText("Det lukter brent fra sikringsskapet!");
    expect(transport.ended).toBeNull();
    expect(transport.utterances.at(-1)).toBe("Jeg har varslet vakthavende, som ringer deg straks.");
    expect(deps.notified[0].kind).toBe("emergency");
    await sess.close();
  });
});

describe("voice agent: guard rails", () => {
  it("ends sales calls politely and records the outcome", async () => {
    const s = await setup();
    const brain = new ScriptedBrain([{ tools: [{ name: "end_call", input: { reason: "sales", goodbye_message: "Takk, men vi er ikke interessert. Ha en fin dag!" } }] }]);
    const { sess, transport } = session(s, brain, fakeDeps([]));
    await sess.onCallerText("Hei, jeg ringer om en fantastisk annonsepakke.");
    await wait(10);
    expect(transport.ended).toEqual({ action: "end", reason: "sales" });
    const [call] = await withTenant(s.companyId, (tx) => tx.select().from(calls).where(eq(calls.id, s.callId)));
    expect(call.outcome).toBe("sales");
  });

  it("rejects invalid tool input, unknown slots, out-of-area bookings and double bookings", async () => {
    const s = await setup();
    const deps = fakeDeps([{ userId: s.userId, start: tomorrow9, end: new Date(tomorrow9.getTime() + 45 * 60_000) }]);
    const results: string[] = [];
    const grab = (req: BrainRequest) => {
      results.push(JSON.stringify(req.messages.at(-1)));
    };
    const brain = new ScriptedBrain([
      // turn 1
      { tools: [{ name: "book_befaring", input: {} }] },
      (r) => (grab(r), { tools: [{ name: "find_befaring_slots", input: {} }] }),
      (r) => (grab(r), { tools: [{ name: "save_caller_details", input: { name: "Kari", address: "Storgata 1, Tromsø" } }] }),
      (r) => (grab(r), { tools: [{ name: "find_befaring_slots", input: {} }] }),
      (r) => (grab(r), { text: "Den adressen dekker vi dessverre ikke. Har du en annen adresse?" }),
      // turn 2
      { tools: [{ name: "save_caller_details", input: { address: "Kirkegata 15 Oslo" } }, { name: "find_befaring_slots", input: {} }] },
      (r) => (grab(r), { tools: [{ name: "book_befaring", input: { slot_id: "S99" } }] }),
      (r) => (grab(r), { tools: [{ name: "book_befaring", input: { slot_id: "S1" } }] }),
      (r) => (grab(r), { tools: [{ name: "book_befaring", input: { slot_id: "S1" } }] }),
      (r) => (grab(r), { text: "Ferdig." }),
    ]);
    const { sess } = session(s, brain, deps);
    await sess.onCallerText("Jeg vil ha befaring");
    await sess.onCallerText("Det gjelder hytta i Oslo, Kirkegata 15");
    expect(results[0]).toContain("Ugyldige felter: slot_id");
    expect(results[1]).toContain("Spør om adressen");
    expect(results[2]).toContain("UTENFOR området");
    expect(results[3]).toContain("utenfor området firmaet dekker");
    expect(results[4]).toContain("S1: i morgen klokken ni");
    expect(results[5]).toContain("Ukjent slot_id");
    expect(results[6]).toContain("Booket i morgen klokken ni med Kari");
    expect(results[7]).toContain("allerede booket");
    expect(deps.booked).toHaveLength(1);
    await sess.close();
  });

  it("forces a spoken reply instead of looping on tools forever", async () => {
    const s = await setup();
    const loop = { tools: [{ name: "flag_for_followup", input: { reason: "x" } }] };
    const brain = new ScriptedBrain([loop, loop, loop, loop, loop, (req) => (expect(req.noTools).toBe(true), { text: "Jeg har notert det." })]);
    const { sess, transport } = session(s, brain, fakeDeps([]));
    await sess.onCallerText("Hei");
    expect(brain.requests).toHaveLength(6);
    expect(transport.utterances.at(-1)).toBe("Jeg har notert det.");
    await sess.close();
  });

  it("stops talking when the caller interrupts, and never runs two turns at once", async () => {
    const s = await setup();
    const brain = new ScriptedBrain([
      { text: "Dette er et ganske langt svar som tar tid å si høyt for innringeren.", delayMs: 15 },
      { text: "Beklager, si det igjen?" },
    ]);
    const { sess, transport } = session(s, brain, fakeDeps([]));
    const first = sess.onCallerText("Hei");
    await wait(40);
    sess.onInterrupt("Dette er et");
    const second = sess.onCallerText("Vent litt, jeg har et spørsmål");
    await Promise.all([first, second]);
    expect(brain.maxActive).toBe(1);
    const req2 = JSON.stringify(brain.requests[1].messages);
    expect(req2).toContain("avbrøt deg etter å ha hørt: «Dette er et»");
    expect(req2).toContain("Vent litt, jeg har et spørsmål");
    expect(transport.utterances.at(-1)).toBe("Beklager, si det igjen?");
    expect(sess.transcript.some((e) => e.role === "agent" && e.text.endsWith("…"))).toBe(true);
    await sess.close();
  });

  it("checks on silence, then ends the call", async () => {
    const s = await setup();
    const { sess, transport } = session(s, new ScriptedBrain([]), fakeDeps([]), { silenceMs: 30 });
    await wait(150);
    expect(transport.utterances[0]).toBe("Er du der fortsatt?");
    expect(transport.utterances.at(-1)).toContain("hører deg dessverre ikke");
    expect(transport.ended).toEqual({ action: "end", reason: "silence" });
  });

  it("recovers from one AI error and gives up gracefully after two", async () => {
    const s = await setup();
    const brain = new ScriptedBrain([{ error: new Error("overloaded") }, { error: new Error("overloaded") }]);
    const { sess, transport } = session(s, brain, fakeDeps([]));
    await sess.onCallerText("Hallo?");
    expect(transport.utterances[0]).toContain("teknisk problem");
    await sess.onCallerText("Hallo igjen?");
    await wait(10);
    expect(transport.ended?.action).toBe("end");
    const [call] = await withTenant(s.companyId, (tx) => tx.select().from(calls).where(eq(calls.id, s.callId)));
    expect(call.flagged).toBe(true);
  });

  it("switches to English when asked", async () => {
    const s = await setup();
    const brain = new ScriptedBrain([{ tools: [{ name: "set_language", input: { language: "en" } }] }, { text: "Of course, how can I help?" }]);
    const { sess, transport } = session(s, brain, fakeDeps([]));
    await sess.onCallerText("Do you speak English?");
    expect(transport.languages).toEqual(["en"]);
    expect(transport.utterances.at(-1)).toBe("Of course, how can I help?");
    await sess.close();
  });
});

describe("prompt and speech helpers", () => {
  it("speaks times the Norwegian way", () => {
    expect(spokenTimeNb(9, 0)).toBe("klokken ni");
    expect(spokenTimeNb(9, 30)).toBe("klokken halv ti");
    expect(spokenTimeNb(13, 0)).toBe("klokken ett");
    expect(spokenTimeNb(10, 45)).toBe("kvart på elleve");
    expect(spokenTimeNb(12, 15)).toBe("kvart over tolv");
    expect(spokenTimeNb(14, 20)).toBe("ti på halv tre");
    expect(spokenSlot(tomorrow9, "Europe/Oslo", "nb", NOW)).toBe("i morgen klokken ni");
    expect(spokenSlot(thu1330, "Europe/Oslo", "nb", NOW)).toBe("på torsdag klokken halv to");
    expect(spokenSlot(new Date("2026-11-30T09:00:00Z"), "Europe/Oslo", "nb", NOW)).toBe("mandag 30. november klokken ti");
    expect(spokenSlot(thu1330, "Europe/Oslo", "en", NOW)).toBe("Thursday 19 November at half past 1 pm");
  });

  it("includes company facts and per-call context in the right places", async () => {
    const s = await setup({ agentInstructions: "Befaring er gratis i Oslo." });
    const sys = buildSystemPrompt(s.company, s.jt);
    expect(sys[0].text).toContain("SLIK SNAKKER DU");
    expect(sys[1].text).toContain("Befaring er gratis i Oslo.");
    expect(sys[1].text).toContain("Varmtvannsbereder");
    expect(sys.map((b) => b.text).join()).not.toMatch(/\d{2}:\d{2} \d{4}/); // no timestamps in the cached part
    const ctx = callContext(s.company, { callerNumber: null, greeting: "Hei", now: NOW });
    expect(ctx).toContain("mandag 16. november 2026 kl. 10:00");
    expect(ctx).toContain("Innringers nummer: skjult");
  });
});
