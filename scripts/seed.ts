/**
 * Creates the demo company "Fjordbyen Rør AS" with team, services, leads,
 * befaringer and call history, so the dashboard can be explored right away.
 *   pnpm db:seed
 * Safe to run again: the demo company is deleted and re-created.
 */
import { DateTime } from "luxon";
import { eq, inArray } from "drizzle-orm";
import { loadEnvFile } from "./load-env";

loadEnvFile();

const { withSystem, closeDb } = await import("../src/lib/db/client");
const s = await import("../src/lib/db/schema");
const { hashPassword } = await import("../src/lib/auth/password");
const { DEFAULT_JOB_TYPES } = await import("../src/lib/trades");
const { ensureMockNumberPool } = await import("../src/lib/telephony/numbers");

export const DEMO = {
  slug: "fjordbyen-ror",
  email: "demo@vakta.no",
  password: "Demo-passord-2026",
};

const TZ = "Europe/Oslo";
const now = DateTime.now().setZone(TZ);

/** Next weekday (Mon–Fri) at hh:mm, offset by n working days from today. */
function workday(offset: number, hh: number, mm = 0) {
  let d = now.startOf("day");
  let moved = 0;
  while (moved < offset || d.weekday > 5) {
    d = d.plus({ days: 1 });
    if (d.weekday <= 5) moved++;
  }
  return d.set({ hour: hh, minute: mm });
}

async function main() {
  const passwordHash = await hashPassword(DEMO.password);
  const colleagueHash = await hashPassword("Kollega-passord-2026");

  await withSystem(async (tx) => {
    // Clean up an earlier demo.
    const old = await tx.select({ id: s.companies.id }).from(s.companies).where(eq(s.companies.slug, DEMO.slug));
    if (old.length) await tx.delete(s.companies).where(eq(s.companies.id, old[0].id));
    await tx.delete(s.users).where(inArray(s.users.email, [DEMO.email, "ola@fjordbyen-ror.no", "ahmed@fjordbyen-ror.no"]));

    const [company] = await tx
      .insert(s.companies)
      .values({
        name: "Fjordbyen Rør AS",
        slug: DEMO.slug,
        orgNumber: "999 888 777",
        trade: "plumber",
        phone: "+4722334455",
        email: "post@fjordbyen-ror.no",
        baseAddress: "Kirkegata 15, 0153 Oslo",
        baseLat: 59.9104,
        baseLng: 10.7445,
        serviceRadiusKm: 35,
        smsSenderName: "FjordbyRor",
        greetingText: "Hva kan jeg hjelpe deg med i dag?",
        agentInstructions:
          "Befaring er gratis innenfor Oslo og Bærum. Vi tar ikke jobber på hytter. Ved vannlekkasje: be kunden stenge hovedkranen.",
        forwardNumber: "+4791234567",
        notifyNumbers: ["+4791234567"],
        onboardingStep: "done",
        trialEndsAt: now.plus({ days: 11 }).toJSDate(),
      })
      .returning();
    const cid = company.id;

    const [kari, ola, ahmed] = await tx
      .insert(s.users)
      .values([
        { email: DEMO.email, name: "Kari Nordmann", passwordHash, phone: "+4791234567" },
        { email: "ola@fjordbyen-ror.no", name: "Ola Hansen", passwordHash: colleagueHash },
        { email: "ahmed@fjordbyen-ror.no", name: "Ahmed Rahimi", passwordHash: colleagueHash },
      ])
      .returning();
    await tx.insert(s.memberships).values([
      { companyId: cid, userId: kari.id, role: "owner", doesBefaring: true, color: "#1f5f64" },
      { companyId: cid, userId: ola.id, role: "member", doesBefaring: true, color: "#7c3aed" },
      { companyId: cid, userId: ahmed.id, role: "admin", doesBefaring: true, color: "#c2410c" },
    ]);
    await tx.insert(s.dpaAcceptances).values({ companyId: cid, userId: kari.id, version: "2026-11-v1" });

    const jt = await tx
      .insert(s.jobTypes)
      .values(DEFAULT_JOB_TYPES.plumber.map((j, i) => ({ companyId: cid, name: j.name, description: j.description, sort: i })))
      .returning();
    const job = (name: string) => jt.find((j) => j.name === name)!;

    // Demo phone number (simulated until Twilio is connected).
    await ensureMockNumberPool(tx, 5);
    const [num] = await tx.select().from(s.phoneNumbers).where(eq(s.phoneNumbers.status, "available")).limit(1);
    await tx
      .update(s.phoneNumbers)
      .set({ companyId: cid, status: "assigned", assignedAt: new Date() })
      .where(eq(s.phoneNumbers.id, num.id));

    type LeadSeed = Partial<typeof s.leads.$inferInsert> & { name: string; phone: string };
    const leadSeeds: LeadSeed[] = [
      { name: "Ingrid Solberg", phone: "+4740010201", address: "Thereses gate 22, 0168 Oslo", postcode: "0168", city: "Oslo", lat: 59.9283, lng: 10.7301, jobTypeId: job("Bad og våtrom").id, jobTypeText: "Bad og våtrom", description: "Vil pusse opp badet i 2. etasje, ca. 6 kvm. Ønsker nytt sluk og varmekabler.", status: "booked", preferredTimes: "Formiddag" },
      { name: "Lars Eriksen", phone: "+4740010202", address: "Bygdøy allé 41, 0265 Oslo", postcode: "0265", city: "Oslo", lat: 59.9174, lng: 10.7076, jobTypeId: job("Varmtvannsbereder").id, jobTypeText: "Varmtvannsbereder", description: "Bereder fra 2004 lekker litt i bunnen. Vil bytte til ny 200 liter.", status: "booked", urgency: "high" },
      { name: "Nora Haugen", phone: "+4740010203", address: "Sandakerveien 56, 0477 Oslo", postcode: "0477", city: "Oslo", lat: 59.9393, lng: 10.7604, jobTypeId: job("Tett avløp/sluk").id, jobTypeText: "Tett avløp/sluk", description: "Kjøkkenvasken renner sakte, prøvd avløpsåpner.", status: "new", preferredTimes: "Etter kl. 15" },
      { name: "Magnus Berg", phone: "+4740010204", address: "Kirkeveien 98, 0361 Oslo", postcode: "0361", city: "Oslo", lat: 59.9339, lng: 10.7185, jobTypeId: job("Vannlekkasje").id, jobTypeText: "Vannlekkasje", description: "Vann drypper fra taket i kjelleren under badet. Har stengt hovedkranen.", status: "new", urgency: "emergency" },
      { name: "Sofie Lund", phone: "+4740010205", address: "Griniveien 12, 1356 Bekkestua", postcode: "1356", city: "Bekkestua", lat: 59.9184, lng: 10.5893, jobTypeId: job("Kjøkken – vann og avløp").id, jobTypeText: "Kjøkken – vann og avløp", description: "Nytt kjøkken fra IKEA, trenger tilkobling av vask og oppvaskmaskin.", status: "quoted", valueNok: 14500 },
      { name: "Henrik Dahl", phone: "+4740010206", address: "Trondheimsveien 120, 0565 Oslo", postcode: "0565", city: "Oslo", lat: 59.9255, lng: 10.7778, jobTypeId: job("Bad og våtrom").id, jobTypeText: "Bad og våtrom", description: "Totalrenovering av bad i borettslag.", status: "won", valueNok: 186000 },
      { name: "Emma Johansen", phone: "+4740010207", address: "Holmenkollveien 70, 0784 Oslo", postcode: "0784", city: "Oslo", lat: 59.9551, lng: 10.6767, jobTypeId: job("Varmtvannsbereder").id, jobTypeText: "Varmtvannsbereder", description: "Ønsker pris på ny bereder.", status: "lost", notes: "Valgte en annen leverandør (pris)." },
      { name: "Jonas Pedersen", phone: "+4740010208", address: "Storgata 5, 2000 Lillestrøm", postcode: "2000", city: "Lillestrøm", lat: 59.9559, lng: 11.0504, jobTypeId: job("Bad og våtrom").id, jobTypeText: "Bad og våtrom", description: "Lite bad i kjeller, vil ha dusj.", status: "booked" },
      { name: "Maja Kristiansen", phone: "+4740010209", address: "Ekebergveien 3, 1178 Oslo", postcode: "1178", city: "Oslo", lat: 59.8987, lng: 10.7703, jobTypeId: job("Tett avløp/sluk").id, jobTypeText: "Tett avløp/sluk", description: "Toalettet er tett.", status: "new", urgency: "high" },
    ];
    const leadRows = await tx
      .insert(s.leads)
      .values(
        leadSeeds.map((l, i) => ({
          companyId: cid,
          inServiceArea: true,
          source: "phone" as const,
          urgency: "normal" as const,
          createdAt: now.minus({ hours: 3 + i * 9 }).toJSDate(),
          ...l,
        })),
      )
      .returning();
    const lead = (name: string) => leadRows.find((l) => l.name === name)!;

    const appt = (l: typeof leadRows[number], start: DateTime, userId: string, minutes = 45) => ({
      companyId: cid,
      leadId: l.id,
      assignedUserId: userId,
      title: `Befaring: ${l.jobTypeText}`,
      startsAt: start.toJSDate(),
      endsAt: start.plus({ minutes }).toJSDate(),
      address: l.address,
      lat: l.lat,
      lng: l.lng,
      customerName: l.name,
      customerPhone: l.phone,
      notes: l.description,
      createdBy: "ai" as const,
    });
    const today = now.weekday <= 5 ? now.startOf("day") : workday(0, 0);
    await tx.insert(s.appointments).values([
      appt(lead("Ingrid Solberg"), today.set({ hour: 9 }), kari.id),
      appt(lead("Lars Eriksen"), today.set({ hour: 13, minute: 30 }), ola.id),
      appt(lead("Jonas Pedersen"), workday(1, 10), ahmed.id, 60),
      { ...appt(lead("Henrik Dahl"), workday(2, 8), kari.id, 90), title: "Oppstart bad", createdBy: "user" as const, leadId: lead("Henrik Dahl").id },
      appt(lead("Sofie Lund"), workday(3, 14), ola.id),
    ]);

    // Call history with transcripts and AI summaries.
    const t0 = (minAgo: number) => now.minus({ minutes: minAgo });
    const tr = (start: DateTime, lines: [("caller" | "agent"), string][]) =>
      lines.map(([role, text], i) => ({ role, text, at: start.plus({ seconds: i * 9 }).toISO()! }));

    const callSeeds: (typeof s.calls.$inferInsert)[] = [
      {
        companyId: cid, phoneNumberId: num.id, fromNumber: lead("Magnus Berg").phone, toNumber: num.e164, leadId: lead("Magnus Berg").id,
        status: "completed", outcome: "emergency", isEmergency: true, flagged: true, flagReason: "Vannlekkasje fra tak i kjeller – kunden har stengt hovedkranen. Videresending ble ikke besvart.",
        startedAt: t0(42).toJSDate(), endedAt: t0(39).toJSDate(), durationSeconds: 174, recordingSid: null,
        summary: "Magnus Berg har vannlekkasje fra taket i kjelleren, trolig fra badet over. Hovedkranen er stengt. Forsøkte å sette over til vakttelefon uten svar – ring tilbake snarest.",
        summaryJson: { summary: "Akutt vannlekkasje i kjeller.", outcome: "emergency", job_type: "Vannlekkasje", urgency: "emergency", follow_up: "Ring tilbake snarest" },
        transcript: tr(t0(42), [
          ["agent", "Hei, du har kommet til Fjordbyen Rør. Jeg er en AI-assistent, og samtalen blir tatt opp. Hva kan jeg hjelpe deg med i dag?"],
          ["caller", "Hei, det drypper vann fra taket i kjelleren min, rett under badet."],
          ["agent", "Det høres akutt ut. Har du fått stengt hovedkranen?"],
          ["caller", "Ja, jeg har stengt den nå."],
          ["agent", "Bra. Hva heter du, og hvilken adresse gjelder det?"],
          ["caller", "Magnus Berg, Kirkeveien 98 i Oslo."],
          ["agent", "Takk, Magnus. Jeg setter deg over til vakthavende rørlegger nå. Et øyeblikk."],
        ]),
      },
      {
        companyId: cid, phoneNumberId: num.id, fromNumber: lead("Ingrid Solberg").phone, toNumber: num.e164, leadId: lead("Ingrid Solberg").id,
        status: "completed", outcome: "booked", startedAt: now.minus({ days: 1, hours: 2 }).toJSDate(), endedAt: now.minus({ days: 1, hours: 2 }).plus({ seconds: 212 }).toJSDate(), durationSeconds: 212,
        summary: "Ingrid Solberg vil pusse opp et bad på ca. 6 kvm i Thereses gate 22, med nytt sluk og varmekabler. Befaring booket i dag kl. 09:00 med Kari. SMS-bekreftelse sendt.",
        summaryJson: { summary: "Befaring for badeoppussing booket.", outcome: "booked", job_type: "Bad og våtrom", urgency: "normal", follow_up: null },
        transcript: tr(now.minus({ days: 1, hours: 2 }), [
          ["agent", "Hei, du har kommet til Fjordbyen Rør. Jeg er en AI-assistent, og samtalen blir tatt opp. Hva kan jeg hjelpe deg med i dag?"],
          ["caller", "Hei! Jeg skal pusse opp badet og lurte på om dere kunne komme på befaring."],
          ["agent", "Det kan vi gjerne. Hvor stort er badet, og hva ønsker du å gjøre?"],
          ["caller", "Rundt seks kvadrat. Nytt sluk og varmekabler, og nye fliser."],
          ["agent", "Skjønner. Hvilken adresse gjelder det?"],
          ["caller", "Thereses gate 22 i Oslo."],
          ["agent", "Takk. Passer det best på formiddagen eller ettermiddagen?"],
          ["caller", "Formiddag."],
          ["agent", "Jeg har ledig i morgen klokken ni, eller torsdag klokken ti. Hva passer best?"],
          ["caller", "I morgen klokken ni er perfekt."],
          ["agent", "Da har jeg booket befaring i morgen klokken ni i Thereses gate 22. Du får en bekreftelse på SMS. Var det noe mer?"],
          ["caller", "Nei, takk for hjelpen!"],
        ]),
      },
      {
        companyId: cid, phoneNumberId: num.id, fromNumber: "+4740010299", toNumber: num.e164,
        status: "completed", outcome: "hangup", flagged: true, flagReason: "Innringer la på før vi fikk navn og adresse.",
        startedAt: t0(95).toJSDate(), endedAt: t0(95).plus({ seconds: 14 }).toJSDate(), durationSeconds: 14,
        summary: "Innringeren la på etter hilsenen uten å si hva det gjaldt.",
        transcript: tr(t0(95), [["agent", "Hei, du har kommet til Fjordbyen Rør. Jeg er en AI-assistent, og samtalen blir tatt opp. Hva kan jeg hjelpe deg med i dag?"]]),
      },
      {
        companyId: cid, phoneNumberId: num.id, fromNumber: "+4721999888", toNumber: num.e164,
        status: "completed", outcome: "sales", startedAt: now.minus({ hours: 5 }).toJSDate(), endedAt: now.minus({ hours: 5 }).plus({ seconds: 31 }).toJSDate(), durationSeconds: 31, reviewedAt: new Date(),
        summary: "Selger som tilbød annonsering i katalogtjeneste. Avsluttet høflig.",
        transcript: tr(now.minus({ hours: 5 }), [
          ["agent", "Hei, du har kommet til Fjordbyen Rør. Jeg er en AI-assistent, og samtalen blir tatt opp. Hva kan jeg hjelpe deg med i dag?"],
          ["caller", "Hei, jeg ringer fra Bedriftskatalogen om en annonsepakke for dere."],
          ["agent", "Takk, men vi er ikke interessert i salgshenvendelser på dette nummeret. Ha en fin dag!"],
        ]),
      },
      {
        companyId: cid, phoneNumberId: num.id, fromNumber: lead("Nora Haugen").phone, toNumber: num.e164, leadId: lead("Nora Haugen").id,
        status: "completed", outcome: "lead_captured", startedAt: now.minus({ hours: 3 }).toJSDate(), endedAt: now.minus({ hours: 3 }).plus({ seconds: 128 }).toJSDate(), durationSeconds: 128,
        summary: "Nora Haugen har kjøkkenvask som renner sakte. Ønsker besøk etter kl. 15, men ingen ledige tider passet. Ønsker å bli ringt opp.",
        summaryJson: { summary: "Tett avløp, ønsker oppringing.", outcome: "lead_captured", job_type: "Tett avløp/sluk", urgency: "normal", follow_up: "Ring tilbake for å avtale tid etter kl. 15" },
        transcript: tr(now.minus({ hours: 3 }), [
          ["agent", "Hei, du har kommet til Fjordbyen Rør. Jeg er en AI-assistent, og samtalen blir tatt opp. Hva kan jeg hjelpe deg med i dag?"],
          ["caller", "Vasken på kjøkkenet renner veldig sakte."],
          ["agent", "Det kan vi se på. Hva heter du, og hvilken adresse gjelder det?"],
          ["caller", "Nora Haugen, Sandakerveien 56."],
          ["agent", "Takk, Nora. Når passer det for deg?"],
          ["caller", "Bare etter klokken tre, jeg jobber."],
          ["agent", "Vi har dessverre ingen ledige tider etter klokken tre denne uka. Jeg noterer at du ønsker å bli ringt opp, så tar en av rørleggerne kontakt."],
        ]),
      },
      {
        companyId: cid, phoneNumberId: num.id, fromNumber: lead("Lars Eriksen").phone, toNumber: num.e164, leadId: lead("Lars Eriksen").id,
        status: "completed", outcome: "booked", startedAt: now.minus({ days: 2, hours: 4 }).toJSDate(), endedAt: now.minus({ days: 2, hours: 4 }).plus({ seconds: 176 }).toJSDate(), durationSeconds: 176, reviewedAt: new Date(),
        summary: "Lars Eriksen har en bereder fra 2004 som lekker litt. Ønsker ny 200-liter. Befaring booket med Ola.",
        transcript: tr(now.minus({ days: 2, hours: 4 }), [
          ["agent", "Hei, du har kommet til Fjordbyen Rør. Jeg er en AI-assistent, og samtalen blir tatt opp. Hva kan jeg hjelpe deg med i dag?"],
          ["caller", "Berederen min lekker litt i bunnen."],
        ]),
      },
    ];
    await tx.insert(s.calls).values(callSeeds);

    await tx.insert(s.smsMessages).values([
      {
        companyId: cid, toNumber: lead("Ingrid Solberg").phone!, sender: "FjordbyRor", purpose: "booking_confirmation", provider: "mock", status: "simulated",
        body: `Hei Ingrid! Befaring hos Fjordbyen Rør er bekreftet ${today.set({ hour: 9 }).setLocale("nb").toFormat("cccc d. MMMM 'kl.' HH:mm")}, Thereses gate 22. Spørsmål? Ring 22 33 44 55.`,
        leadId: lead("Ingrid Solberg").id,
      },
    ]);

    console.log(`✓ Demo company created: ${company.name}`);
    console.log(`  Login: ${DEMO.email} / ${DEMO.password}`);
    console.log(`  Demo phone number (simulated): ${num.e164}`);
  });
  await closeDb();
}

main().catch(async (e) => {
  console.error(e);
  await closeDb();
  process.exit(1);
});
