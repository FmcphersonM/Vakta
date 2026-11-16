import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { withSystem } from "@/lib/db/client";
import { companies } from "@/lib/db/schema";
import { LegalPage } from "@/components/legal";
import { fmt } from "@/lib/format";

export const metadata = { title: "Personvern" };

/** Public notice for callers (linked from the greeting and SMS). Only public company info is shown. */
export default async function CallerPrivacy({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [c] = await withSystem((tx) =>
    tx
      .select({ name: companies.name, email: companies.email, phone: companies.phone, orgNumber: companies.orgNumber, recordingEnabled: companies.recordingEnabled, recordingRetentionDays: companies.recordingRetentionDays, transcriptRetentionDays: companies.transcriptRetentionDays })
      .from(companies)
      .where(eq(companies.slug, slug.slice(0, 60))),
  );
  if (!c) notFound();
  return (
    <LegalPage title={`Personvern – samtaler med ${c.name}`}>
      <p>
        Når du ringer {c.name} og vi ikke kan svare selv, tar en digital KI-assistent imot samtalen. Assistenten registrerer hva
        henvendelsen gjelder og kan booke en befaring for deg.
      </p>
      <h2>Hvem er ansvarlig?</h2>
      <p>
        {c.name}
        {c.orgNumber ? ` (org.nr. ${c.orgNumber})` : ""} er behandlingsansvarlig.
        {c.email ? ` E-post: ${c.email}.` : ""}
        {c.phone ? ` Telefon: ${fmt.phone(c.phone)}.` : ""}
      </p>
      <h2>Hva lagres?</h2>
      <ul>
        <li>Telefonnummeret ditt, navn og adresse du oppgir, og beskrivelse av oppdraget.</li>
        <li>En skriftlig logg og et sammendrag av samtalen.</li>
        {c.recordingEnabled && <li>Et lydopptak av samtalen. Du får beskjed om dette i starten av samtalen.</li>}
      </ul>
      <h2>Hvorfor?</h2>
      <p>For å kunne svare på henvendelsen din, avtale befaring og gi deg tilbud (berettiget interesse og avtale, GDPR art. 6 nr. 1 b og f).</p>
      <h2>Hvor lenge?</h2>
      <p>
        {c.recordingEnabled ? `Lydopptak slettes etter ${c.recordingRetentionDays} dager. ` : ""}
        Samtalelogg slettes etter {c.transcriptRetentionDays} dager, med mindre opplysningene trengs for et oppdrag.
      </p>
      <h2>Dine rettigheter</h2>
      <p>
        Du kan be om innsyn, retting eller sletting ved å kontakte {c.name}. Du kan også klage til Datatilsynet (datatilsynet.no).
      </p>
    </LegalPage>
  );
}
