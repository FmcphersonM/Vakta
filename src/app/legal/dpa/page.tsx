import { LegalPage } from "@/components/legal";
import { DPA_VERSION } from "@/lib/auth/signup";

export const metadata = { title: "Databehandleravtale" };

const app = process.env.NEXT_PUBLIC_APP_NAME ?? "Vakta";

export default function DpaPage() {
  return (
    <LegalPage title={`Databehandleravtale (versjon ${DPA_VERSION})`} note="UTKAST – må gjennomgås av advokat før lansering.">
      <p>
        Denne avtalen gjelder mellom kunden (behandlingsansvarlig, «Kunden») og leverandøren av {app} (databehandler, «Leverandøren»)
        i henhold til personvernforordningen (GDPR) artikkel 28.
      </p>
      <h2>1. Formål og omfang</h2>
      <p>
        Leverandøren behandler personopplysninger på vegne av Kunden for å besvare innkommende telefonsamtaler, registrere henvendelser,
        booke befaringer, sende SMS-bekreftelser og vise dette i et dashbord. Leverandøren skal kun behandle opplysningene etter Kundens
        dokumenterte instrukser.
      </p>
      <h2>2. Kategorier av opplysninger og registrerte</h2>
      <ul>
        <li>Innringere: telefonnummer, navn, adresse, beskrivelse av oppdrag, ønskede tider, samtaleopptak, transkripsjon og sammendrag.</li>
        <li>Kundens ansatte: navn, e-post, telefonnummer, innloggingsdata, kalendertilgjengelighet.</li>
      </ul>
      <h2>3. Lagring og overføring</h2>
      <p>
        Data lagres i EU/EØS (database i Frankfurt, opptak hos Twilio i Irland). Underleverandører som behandler data utenfor EØS
        (f.eks. KI-språkmodell) benyttes kun med gyldig overføringsgrunnlag (EU-kommisjonens standardavtaler / EU–US Data Privacy Framework).
      </p>
      <h2>4. Underleverandører</h2>
      <ul>
        <li>Render Services (drift, Frankfurt, Tyskland)</li>
        <li>Twilio Ireland Ltd. (telefoni, SMS, opptak, tale-til-tekst og tekst-til-tale)</li>
        <li>Anthropic (KI-språkmodell for samtale og sammendrag)</li>
        <li>Stripe (betaling – kun Kundens fakturadata)</li>
        <li>Google / Microsoft (kun hvis Kunden kobler til kalender)</li>
      </ul>
      <p>Leverandøren varsler Kunden minst 30 dager før nye underleverandører tas i bruk.</p>
      <h2>5. Sikkerhet</h2>
      <ul>
        <li>Streng logisk adskillelse mellom kunder (radnivåsikkerhet i databasen).</li>
        <li>Kryptering under overføring (TLS) og av tilgangsnøkler og hemmeligheter i hvile (AES-256-GCM).</li>
        <li>Tofaktorinnlogging, tilgangsstyring med roller og revisjonslogg over alle endringer.</li>
      </ul>
      <h2>6. Informasjon til innringere</h2>
      <p>
        Hver samtale starter med at innringeren får vite at de snakker med en KI-assistent, og om samtalen tas opp.
        Kunden er ansvarlig for at opptak har et gyldig behandlingsgrunnlag.
      </p>
      <h2>7. De registrertes rettigheter</h2>
      <p>
        Leverandøren tilbyr verktøy for innsyn (eksport) og sletting per telefonnummer, og bistår Kunden med andre forespørsler.
      </p>
      <h2>8. Lagringstid og sletting</h2>
      <p>
        Opptak slettes automatisk etter Kundens valgte lagringstid (standard 90 dager), samtalelogger etter valgt tid (standard 2 år).
        Ved oppsigelse slettes alle Kundens data innen 30 dager.
      </p>
      <h2>9. Avvik</h2>
      <p>Leverandøren varsler Kunden uten ugrunnet opphold, og senest innen 48 timer, etter å ha oppdaget et brudd på personopplysningssikkerheten.</p>
    </LegalPage>
  );
}
