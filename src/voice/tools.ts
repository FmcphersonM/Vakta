import { z } from "zod";
import { eq } from "drizzle-orm";
import { withTenant } from "../lib/db/client";
import { calls, leads, type Company, type JobType, type Urgency } from "../lib/db/schema";
import { normalizePhone } from "../lib/format";
import type { GeoResult } from "../lib/booking/geocode";
import { spokenSlot } from "./speech";
import type { BetaTool } from "./brain";
import { audit } from "../lib/audit";
import { canForwardNow } from "../lib/hours";
import { sms } from "../lib/sms/templates";

// ── Tool definitions (what Claude sees) ─────────────────────────────────────

const tool = (name: string, description: string, properties: Record<string, unknown>, required: string[] = []): BetaTool => ({
  name,
  description,
  eager_input_streaming: true,
  input_schema: { type: "object", properties, required, additionalProperties: false },
});

export const TOOL_DEFS: BetaTool[] = [
  tool(
    "save_caller_details",
    "Lagrer eller oppdaterer opplysninger om innringeren og jobben. Kall så fort du får nye opplysninger; send bare feltene du har. Returnerer hva som fortsatt mangler, og om adressen er innenfor området firmaet dekker.",
    {
      name: { type: "string", description: "Innringerens navn" },
      callback_phone: { type: "string", description: "Nummer kunden vil bli ringt på, hvis annet enn nummeret de ringer fra" },
      address: { type: "string", description: "Adressen der jobben skal gjøres: gate, nummer, postnummer/sted" },
      job_type: { type: "string", description: "Type jobb, helst en av firmaets tjenester" },
      description: { type: "string", description: "Kort beskrivelse av problemet/jobben med kundens egne detaljer" },
      urgency: { type: "string", enum: ["low", "normal", "high", "emergency"] },
      preferred_times: { type: "string", description: "Når det passer for kunden, med kundens ord" },
      email: { type: "string" },
    },
  ),
  tool(
    "find_befaring_slots",
    "Finner ledige tider for befaring i firmaets ekte kalender, med hensyn til kjøretid mellom oppdrag. Krever at adressen er lagret først. Returnerer opptil tre tider med slot_id og hvordan tiden skal sies.",
    {
      earliest_date: { type: "string", description: "Tidligste dato (YYYY-MM-DD), hvis kunden har ønske" },
      latest_date: { type: "string", description: "Seneste dato (YYYY-MM-DD), hvis kunden har ønske" },
      part_of_day: { type: "string", enum: ["morning", "afternoon", "any"], description: "Formiddag, ettermiddag eller hva som helst" },
    },
  ),
  tool("book_befaring", "Booker en befaring på en tid fra find_befaring_slots. Sender SMS-bekreftelse til kunden.", { slot_id: { type: "string" } }, ["slot_id"]),
  tool(
    "transfer_to_human",
    "Setter samtalen over til firmaets vakthavende på mobil. Bruk ved akutte situasjoner, eller når kunden ber om et menneske og det er tillatt. Hvis det er tillatt, sier du message_to_caller og samtalen settes over. Hvis ikke, får du beskjed om hva du skal gjøre.",
    {
      reason: { type: "string", enum: ["emergency", "caller_request"] },
      message_to_caller: { type: "string", description: "Det du sier rett før du setter over, f.eks. «Jeg setter deg over til vakthavende nå.»" },
    },
    ["reason", "message_to_caller"],
  ),
  tool(
    "flag_for_followup",
    "Markerer samtalen slik at firmaet ser den øverst og ringer tilbake (f.eks. klage, faktura, spørsmål du ikke kan svare på).",
    { reason: { type: "string", description: "Kort forklaring til firmaet" } },
    ["reason"],
  ),
  tool("set_language", "Bytter språket for tale og talegjenkjenning.", { language: { type: "string", enum: ["nb", "en"] } }, ["language"]),
  tool(
    "end_call",
    "Avslutter samtalen etter at goodbye_message er sagt.",
    {
      reason: { type: "string", enum: ["done", "spam", "sales", "wrong_number"] },
      goodbye_message: { type: "string", description: "Kort avslutning som sies høyt" },
    },
    ["reason", "goodbye_message"],
  ),
];

const schemas = {
  save_caller_details: z.object({
    name: z.string().max(120).optional(),
    callback_phone: z.string().max(40).optional(),
    address: z.string().max(300).optional(),
    job_type: z.string().max(120).optional(),
    description: z.string().max(2000).optional(),
    urgency: z.enum(["low", "normal", "high", "emergency"]).optional(),
    preferred_times: z.string().max(300).optional(),
    email: z.string().max(200).optional(),
  }),
  find_befaring_slots: z.object({
    earliest_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    latest_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    part_of_day: z.enum(["morning", "afternoon", "any"]).optional(),
  }),
  book_befaring: z.object({ slot_id: z.string().max(20) }),
  transfer_to_human: z.object({ reason: z.enum(["emergency", "caller_request"]), message_to_caller: z.string().min(1).max(400) }),
  flag_for_followup: z.object({ reason: z.string().min(1).max(500) }),
  set_language: z.object({ language: z.enum(["nb", "en"]) }),
  end_call: z.object({ reason: z.enum(["done", "spam", "sales", "wrong_number"]), goodbye_message: z.string().min(1).max(400) }),
};

// ── Dependencies (real ones in production, fakes in tests) ──────────────────

export type Slot = { userId: string; start: Date; end: Date; travelMinutes?: number };

export interface BookingService {
  findSlots(
    company: Company,
    req: { lat: number | null; lng: number | null; minutes: number; earliest?: Date; latest?: Date; partOfDay?: "morning" | "afternoon" | "any" },
  ): Promise<Slot[]>;
  book(
    company: Company,
    slot: Slot,
    details: { leadId: string; callId: string; title: string; address: string | null; lat: number | null; lng: number | null; name: string | null; phone: string | null; notes: string | null },
  ): Promise<{ id: string; startsAt: Date; assigneeName: string | null }>;
  inServiceArea(company: Company, geo: GeoResult | null, postcode?: string | null): boolean | null;
}

export type ToolDeps = {
  booking: BookingService;
  geocode: (address: string) => Promise<GeoResult | null>;
  sendSms: (input: { to: string; body: string; purpose: "booking_confirmation"; leadId: string; appointmentId: string; callId: string }) => Promise<unknown>;
  notifyOwner: (kind: "booked" | "emergency", body: string, refs: { callId: string; leadId?: string | null; appointmentId?: string | null }) => Promise<unknown>;
};

export type TerminalAction = { kind: "transfer"; message: string } | { kind: "end"; message: string; reason: string };

export type ToolResult = { content: string; isError?: boolean; terminal?: TerminalAction; language?: "nb" | "en" };

// ── Per-call state + executor ───────────────────────────────────────────────

export class CallTools {
  leadId: string | null = null;
  booked = false;
  emergency = false;
  private slots = new Map<string, Slot>();
  private slotCounter = 0;
  private geo: GeoResult | null = null;
  private lead: { name?: string; phone?: string | null; address?: string; jobType?: string; description?: string; urgency?: Urgency; preferredTimes?: string } = {};

  constructor(
    private company: Company,
    private jobTypes: JobType[],
    private callId: string,
    private callerNumber: string | null,
    private deps: ToolDeps,
    private now: () => Date = () => new Date(),
    private isTest = false,
  ) {
    this.lead.phone = callerNumber;
  }

  async run(name: string, rawInput: unknown): Promise<ToolResult> {
    const schema = schemas[name as keyof typeof schemas];
    if (!schema) return { content: `Ukjent verktøy: ${name}`, isError: true };
    const parsed = schema.safeParse(rawInput);
    if (!parsed.success) return { content: `Ugyldige felter: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`, isError: true };
    try {
      switch (name) {
        case "save_caller_details": return await this.saveDetails(parsed.data as z.infer<typeof schemas.save_caller_details>);
        case "find_befaring_slots": return await this.findSlots(parsed.data as z.infer<typeof schemas.find_befaring_slots>);
        case "book_befaring": return await this.book(parsed.data as z.infer<typeof schemas.book_befaring>);
        case "transfer_to_human": return await this.transfer(parsed.data as z.infer<typeof schemas.transfer_to_human>);
        case "flag_for_followup": return await this.flag((parsed.data as z.infer<typeof schemas.flag_for_followup>).reason);
        case "set_language": {
          const lang = (parsed.data as z.infer<typeof schemas.set_language>).language;
          return { content: lang === "en" ? "Language switched to English." : "Språk byttet til norsk.", language: lang };
        }
        case "end_call": {
          const d = parsed.data as z.infer<typeof schemas.end_call>;
          if (d.reason === "spam" || d.reason === "sales" || d.reason === "wrong_number") {
            await this.setCall({ outcome: d.reason === "wrong_number" ? "info" : d.reason });
          }
          return { content: "ok", terminal: { kind: "end", message: d.goodbye_message, reason: d.reason } };
        }
      }
    } catch (e) {
      console.error(`[voice] tool ${name} failed`, e);
      return { content: "Noe gikk galt i systemet. Noter henvendelsen og si at firmaet ringer tilbake.", isError: true };
    }
    return { content: "?", isError: true };
  }

  private async setCall(values: Partial<typeof calls.$inferInsert>) {
    await withTenant(this.company.id, (tx) => tx.update(calls).set(values).where(eq(calls.id, this.callId)));
  }

  private matchJobType(text: string | undefined) {
    if (!text) return null;
    const t = text.toLowerCase();
    return this.jobTypes.find((j) => j.name.toLowerCase() === t) ?? this.jobTypes.find((j) => t.includes(j.name.toLowerCase()) || j.name.toLowerCase().includes(t)) ?? null;
  }

  private missing() {
    const m: string[] = [];
    if (!this.lead.description && !this.lead.jobType) m.push("hva jobben gjelder");
    if (!this.lead.name) m.push("navn");
    if (!this.lead.address) m.push("adresse");
    if (!this.lead.phone) m.push("telefonnummer");
    return m;
  }

  private async saveDetails(d: z.infer<typeof schemas.save_caller_details>): Promise<ToolResult> {
    let addressNote = "";
    let inArea: boolean | null = null;
    if (d.address && d.address !== this.lead.address) {
      this.geo = await this.deps.geocode(d.address);
      this.lead.address = this.geo?.address ?? d.address;
      inArea = this.deps.booking.inServiceArea(this.company, this.geo);
      addressNote = this.geo
        ? ` Adressen er registrert som «${this.geo.address}».${inArea === false ? " Den er UTENFOR området firmaet dekker – ikke book befaring." : ""}`
        : " Fant ikke adressen i adresseregisteret – be kunden bekrefte gate, nummer og sted.";
    }
    if (d.name) this.lead.name = d.name;
    if (d.callback_phone) this.lead.phone = normalizePhone(d.callback_phone) ?? d.callback_phone;
    if (d.job_type) this.lead.jobType = d.job_type;
    if (d.description) this.lead.description = d.description;
    if (d.urgency) this.lead.urgency = d.urgency;
    if (d.preferred_times) this.lead.preferredTimes = d.preferred_times;
    const jt = this.matchJobType(this.lead.jobType);

    const values = {
      name: this.lead.name ?? null,
      phone: this.lead.phone ?? null,
      email: d.email ?? undefined,
      address: this.lead.address ?? null,
      postcode: this.geo?.postcode ?? null,
      city: this.geo?.city ?? null,
      lat: this.geo?.lat ?? null,
      lng: this.geo?.lng ?? null,
      inServiceArea: inArea ?? undefined,
      jobTypeId: jt?.id ?? null,
      jobTypeText: jt?.name ?? this.lead.jobType ?? null,
      description: this.lead.description ?? null,
      urgency: this.lead.urgency ?? "normal",
      preferredTimes: this.lead.preferredTimes ?? null,
    };
    await withTenant(this.company.id, async (tx) => {
      if (this.leadId) {
        await tx.update(leads).set(values).where(eq(leads.id, this.leadId));
      } else {
        const [row] = await tx.insert(leads).values({ ...values, companyId: this.company.id, source: this.isTest ? "simulator" : "phone" }).returning({ id: leads.id });
        this.leadId = row.id;
        await tx.update(calls).set({ leadId: row.id }).where(eq(calls.id, this.callId));
        await audit(tx, { companyId: this.company.id, actor: "ai", action: "lead.created", entityType: "lead", entityId: row.id });
      }
      if (values.urgency === "emergency") await tx.update(calls).set({ isEmergency: true }).where(eq(calls.id, this.callId));
    });
    if (values.urgency === "emergency") this.emergency = true;
    const missing = this.missing();
    return { content: `Lagret.${addressNote}${missing.length ? ` Mangler fortsatt: ${missing.join(", ")}.` : " Alt nødvendig er registrert."}` };
  }

  private async findSlots(d: z.infer<typeof schemas.find_befaring_slots>): Promise<ToolResult> {
    if (!this.lead.address) return { content: "Spør om adressen og lagre den med save_caller_details først.", isError: true };
    if (this.deps.booking.inServiceArea(this.company, this.geo) === false) {
      return { content: "Adressen er utenfor området firmaet dekker. Ikke book. Noter henvendelsen og si at firmaet tar kontakt." };
    }
    const jt = this.matchJobType(this.lead.jobType);
    if (jt && !jt.needsBefaring) return { content: `${jt.name} krever ikke befaring. Registrer henvendelsen og si at firmaet tar kontakt.` };
    const tz = this.company.timezone;
    const day = (s?: string, end = false) => (s ? new Date(`${s}T${end ? "23:59:59" : "00:00:00"}${offsetFor(s, tz)}`) : undefined);
    const slots = await this.deps.booking.findSlots(this.company, {
      lat: this.geo?.lat ?? null,
      lng: this.geo?.lng ?? null,
      minutes: jt?.befaringMinutes ?? this.company.befaringMinutes,
      earliest: day(d.earliest_date),
      latest: day(d.latest_date, true),
      partOfDay: d.part_of_day,
    });
    if (!slots.length) return { content: "Ingen ledige tider i det tidsrommet. Spør om et annet tidsrom, eller noter ønsket tid og si at firmaet ringer tilbake." };
    const lang = this.company.locale === "en" ? "en" : "nb";
    const lines = slots.slice(0, 3).map((s) => {
      const id = `S${++this.slotCounter}`;
      this.slots.set(id, s);
      return `${id}: ${spokenSlot(s.start, tz, lang, this.now())}`;
    });
    return { content: `Ledige tider (foreslå høyst to om gangen):\n${lines.join("\n")}` };
  }

  private async book(d: z.infer<typeof schemas.book_befaring>): Promise<ToolResult> {
    if (this.booked) return { content: "Det er allerede booket en befaring i denne samtalen.", isError: true };
    const slot = this.slots.get(d.slot_id);
    if (!slot) return { content: "Ukjent slot_id. Bruk en tid fra find_befaring_slots.", isError: true };
    if (!this.leadId) return { content: "Lagre kundens opplysninger med save_caller_details først.", isError: true };
    const jt = this.matchJobType(this.lead.jobType);
    let appt;
    try {
      appt = await this.deps.booking.book(this.company, slot, {
        leadId: this.leadId,
        callId: this.callId,
        title: `Befaring: ${jt?.name ?? this.lead.jobType ?? "henvendelse"}`,
        address: this.lead.address ?? null,
        lat: this.geo?.lat ?? null,
        lng: this.geo?.lng ?? null,
        name: this.lead.name ?? null,
        phone: this.lead.phone ?? null,
        notes: [this.lead.description, this.lead.preferredTimes ? `Ønsket tid: ${this.lead.preferredTimes}` : null].filter(Boolean).join("\n") || null,
      });
    } catch (e) {
      if ((e as Error).message === "slot_conflict") {
        this.slots.delete(d.slot_id);
        return { content: "Den tiden ble nettopp tatt. Finn nye tider med find_befaring_slots.", isError: true };
      }
      throw e;
    }
    this.booked = true;
    await this.setCall({ outcome: "booked" });
    const lang = this.company.locale === "en" ? "en" : "nb";
    const base = { companyName: this.company.name, companyPhone: this.company.phone, locale: lang, tz: this.company.timezone } as const;
    if (this.lead.phone) {
      await this.deps.sendSms({
        to: this.lead.phone,
        body: sms.bookingConfirmation({ ...base, name: this.lead.name ?? null, start: appt.startsAt, address: this.lead.address ?? null }),
        purpose: "booking_confirmation",
        leadId: this.leadId,
        appointmentId: appt.id,
        callId: this.callId,
      });
    }
    await this.deps.notifyOwner(
      "booked",
      sms.ownerBooked({ ...base, name: this.lead.name ?? null, phone: this.lead.phone ?? null, start: appt.startsAt, address: this.lead.address ?? null, job: jt?.name ?? this.lead.jobType ?? null, assignee: appt.assigneeName }),
      { callId: this.callId, leadId: this.leadId, appointmentId: appt.id },
    );
    return { content: `Booket ${spokenSlot(appt.startsAt, this.company.timezone, lang, this.now())}${appt.assigneeName ? ` med ${appt.assigneeName.split(" ")[0]}` : ""}. ${this.lead.phone ? "SMS-bekreftelse er sendt." : "Kunden har ikke oppgitt mobilnummer, så ingen SMS."}` };
  }

  private async transfer(d: z.infer<typeof schemas.transfer_to_human>): Promise<ToolResult> {
    const c = this.company;
    const lang = c.locale === "en" ? "en" : "nb";
    if (d.reason === "emergency") {
      this.emergency = true;
      await this.setCall({ isEmergency: true, outcome: "emergency", flagged: true, flagReason: this.lead.description ?? "Akutt henvendelse" });
      await this.deps.notifyOwner(
        "emergency",
        sms.ownerEmergency({ companyName: c.name, companyPhone: c.phone, locale: lang, tz: c.timezone, name: this.lead.name ?? null, phone: this.lead.phone ?? this.callerNumber, summary: [this.lead.description, this.lead.address].filter(Boolean).join(", ") }),
        { callId: this.callId, leadId: this.leadId },
      );
    }
    const allowed = d.reason === "emergency" ? c.forwardEmergencies : c.forwardOnRequest;
    if (!allowed || !canForwardNow(c, this.now())) {
      if (d.reason === "caller_request") await this.flag("Kunden ba om å snakke med et menneske.");
      return {
        content:
          d.reason === "emergency"
            ? "Kan ikke sette over akkurat nå. Vakthavende har fått SMS om saken. Si at noen ringer tilbake så fort som mulig, gi sikkerhetsråd, og avslutt."
            : "Kan ikke sette over akkurat nå. Si at du har notert henvendelsen og at noen ringer tilbake.",
      };
    }
    if (d.reason === "caller_request") await this.setCall({ outcome: "transferred" });
    return { content: "ok", terminal: { kind: "transfer", message: d.message_to_caller } };
  }

  private async flag(reason: string): Promise<ToolResult> {
    await this.setCall({ flagged: true, flagReason: reason.slice(0, 500) });
    return { content: "Markert for oppfølging." };
  }
}

/** UTC offset (e.g. "+01:00") of a time zone on a given date. */
function offsetFor(isoDate: string, tz: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" }).formatToParts(new Date(`${isoDate}T12:00:00Z`));
  const name = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+00:00";
  const m = name.match(/GMT([+-]\d{2}:\d{2})/);
  return m ? m[1] : "+00:00";
}
