# Vakta — AI-resepsjonist for håndverkere

Vakta answers the phone for Norwegian builders, electricians, plumbers and roofers when
they can't. It talks Norwegian (and English), finds out what the job is, books a
**befaring** straight into the real calendar, texts the customer a confirmation and tells
the business. Everything shows up in a simple dashboard that works on a phone.

> "Vakta" is a working name. Change it with `NEXT_PUBLIC_APP_NAME`.

- [What you can do with it](#what-you-can-do-with-it)
- [Try it on your own computer](#try-it-on-your-own-computer)
- [What works without any accounts](#what-works-without-any-accounts)
- [Connecting the real services](#connecting-the-real-services)
- [Putting it online (Render, Frankfurt)](#putting-it-online-render-frankfurt)
- [How a call works](#how-a-call-works)
- [Privacy and security](#privacy-and-security)
- [Tests](#tests)
- [For developers](#for-developers)
- [Status and next steps](#status-and-next-steps)

---

## What you can do with it

| Screen | What it's for |
|---|---|
| **I dag** (Today) | Today's befaringer with address and one-tap call, new leads, missed/emergency calls that need a call back. |
| **Kalender** | Week and day view. Drag a befaring to move it (optionally texting the customer). Colours per team member. Google/Outlook busy time shown in grey. |
| **Henvendelser** (Leads) | Every enquiry with status *Ny → Befaring booket → Tilbud sendt → Vunnet/Tapt*, search, one-tap call, notes, SMS history. |
| **Samtaler** (Calls) | Every call. Opening a call shows the AI **summary first**, then the recording, then the full transcript. |
| **Innstillinger** | Business & service area, opening hours & befaring length, services, the AI's greeting, forwarding & alerts, phone number, calendars, team, subscription, security (2FA), privacy (GDPR), change log. |
| **Test AI-en** | Talk or type to your own receptionist in the browser — uses your real settings and calendar. |

New companies sign up and go through a 5-step setup (business → services → hours → phone
number → test call). It takes about 6 minutes.

---

## Try it on your own computer

You need **Node.js 22**, **pnpm** and **PostgreSQL 16** (or Docker).

1. Get the code and install:
   ```bash
   git clone <your-repository-url> vakta
   ```
   ```bash
   cd vakta && corepack enable && pnpm install
   ```
2. Start a database. Easiest with Docker:
   ```bash
   docker run -d --name vakta-db -e POSTGRES_USER=vakta -e POSTGRES_PASSWORD=vakta -e POSTGRES_DB=vakta -p 5432:5432 postgres:16
   ```
   (On Ubuntu with PostgreSQL installed you can instead run `pnpm db:local`.)
3. Create your settings file and fill in the three secrets:
   ```bash
   cp .env.example .env
   ```
   Put long random values in `SESSION_SECRET`, `ENCRYPTION_KEY` and `CRON_SECRET`
   (generate with `openssl rand -base64 48`).
4. Create the tables and the demo company:
   ```bash
   pnpm db:migrate && pnpm db:seed
   ```
5. Start Vakta:
   ```bash
   pnpm dev
   ```
6. Open <http://localhost:3000> and log in with **demo@vakta.no** / **Demo-passord-2026**
   (demo company *Fjordbyen Rør AS*, Oslo, with three team members, leads, befaringer and calls).

---

## What works without any accounts

Everything except real phone calls and real messages has a safe stand-in, so you can click
through the whole product first.

| Feature | Without keys | With keys |
|---|---|---|
| Dashboard, leads, calendar, settings, onboarding | ✅ works | ✅ |
| Phone numbers | test numbers (+47 21 49 …) | real Norwegian numbers (Twilio) |
| SMS | stored and shown as "Simulert" | sent for real (Twilio) |
| AI receptionist | needs `ANTHROPIC_API_KEY` | ✅ in the browser test, and on real calls with Twilio |
| Calendar sync | buttons disabled | Google / Outlook |
| Subscriptions | "not set up" notice | Stripe |
| E-mails (invites, password reset) | printed in the server log | sent via your SMTP provider |

---

## Connecting the real services

Put each value in `.env` (local) or in the Render dashboard (online), then restart.

### 1. Claude (the AI) — `ANTHROPIC_API_KEY`
Create a key at console.anthropic.com. Optional: `VOICE_MODEL` (default `claude-opus-5-5`,
run at low effort for quick replies) and `SUMMARY_MODEL`.

### 2. Twilio (numbers, calls, SMS)
1. Create the Twilio account in the **Ireland (IE1)** region so recordings and call data stay in the EU,
   and upgrade it (trial accounts can't buy Norwegian numbers).
2. *Regulatory Compliance → Bundles*: create a **Norwegian bundle** with your company's Norwegian
   address. Copy the bundle SID and address SID into `TWILIO_NO_BUNDLE_SID` / `TWILIO_NO_ADDRESS_SID`.
3. *Voice → ConversationRelay*: accept the AI/ML features addendum to switch it on.
4. Copy `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` (IE1 region), and preferably create an API key
   (`TWILIO_API_KEY_SID` / `TWILIO_API_KEY_SECRET`). Remove `TELEPHONY_PROVIDER=mock`.
5. `APP_URL` must be the public **https** address of your server (Twilio calls it).
6. Fill the number pool and give the demo company a real number:
   ```bash
   pnpm twilio:setup --buy 2
   ```
   ```bash
   pnpm twilio:setup --demo
   ```
   (Already own numbers? Use `pnpm twilio:setup --import` instead of `--buy`.)
7. Call the number. 🎉

Voice settings (`TTS_PROVIDER`, `TTS_VOICE_NB`, `STT_PROVIDER`, `STT_MODEL_NB`) can be changed
without code. Default: Google's Norwegian "Chirp 3 HD" voice and Deepgram speech recognition —
compare against Google's recogniser on real Norwegian calls and keep the better one.

### 3. Stripe (subscriptions)
1. Create a product "Vakta Standard" with a **monthly NOK price**; copy its price ID to `STRIPE_PRICE_ID`.
2. Copy the secret key to `STRIPE_SECRET_KEY`.
3. Add a webhook endpoint `https://<your-domain>/api/stripe/webhook` with the events
   `checkout.session.completed` and `customer.subscription.*`; copy its signing secret to `STRIPE_WEBHOOK_SECRET`.
4. Turn on the Customer Portal (Settings → Billing → Customer portal).

### 4. Google Calendar
Google Cloud console → enable *Google Calendar API* → OAuth client (Web). Redirect URI:
`https://<your-domain>/api/integrations/google/callback`. Scope used: `calendar.events`.
Copy `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`. Google must verify the app before other
companies can connect (allow a few weeks).

### 5. Outlook / Microsoft 365
Microsoft Entra → App registrations → new app, *accounts in any organisation and personal accounts*.
Redirect URI (Web): `https://<your-domain>/api/integrations/microsoft/callback`.
API permissions: `Calendars.ReadWrite`, `User.Read`, `offline_access`. Create a client secret.
Copy `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET`.

### 6. E-mail — `SMTP_URL`
Any SMTP provider (an EU one such as Brevo or Mailgun EU is recommended), e.g.
`smtps://user:password@smtp-relay.brevo.com:465`, plus `EMAIL_FROM`.

---

## Putting it online (Render, Frankfurt)

1. Push this repository to GitHub.
2. In Render: **New → Blueprint**, pick the repository. `render.yaml` creates the web service and
   a PostgreSQL database, both in **Frankfurt**.
3. Fill in the values it asks for (see above). `SESSION_SECRET`, `ENCRYPTION_KEY` and `CRON_SECRET`
   are generated for you — **never change `ENCRYPTION_KEY` later**.
4. Point your domain at the service and set `APP_URL` to it.
5. Run `pnpm twilio:setup --buy 2` once (Render shell) to fill the number pool.

Database migrations run automatically on every deploy. Background jobs (calendar refresh,
reminders, retention) run inside the server; they are safe with several instances.

---

## How a call works

```
Caller → Norwegian number (Twilio, Ireland)
  → /api/telephony/twilio/voice     decides in milliseconds: AI / VIP straight to owner / blocked / inactive
  → Twilio ConversationRelay        speech-to-text + text-to-speech, caller can interrupt
  ⇄ WebSocket /api/voice/relay      our agent: Claude streams the reply word by word,
                                    tools: save details · find slots · book · transfer · end call
  → befaring in the database + Google/Outlook, SMS to caller, SMS to owner
  → after the call: AI summary, lead status, missed-call/emergency flags on "I dag"
```

- The greeting always says it's an AI assistant and (if on) that the call is recorded. That part can't be removed.
- Emergencies (water leak, burning smell from the fuse box …): safety advice, owner gets an SMS
  immediately, and the call is put through to the owner's mobile if forwarding is on.
- Sales calls and spam are ended politely. Silence → "Er du der fortsatt?" → polite goodbye.
- Forwarding your own mobile: dial `**004*<your Vakta number>#` (shown in Settings → Telefonnummer).

---

## Privacy and security

- **EU storage**: database and app in Frankfurt; recordings in Twilio's Irish region.
  Claude processes the conversation text via Anthropic's API (see *Open decisions* below).
- **Tenant isolation**: every company's data is protected by PostgreSQL row-level security —
  even a programming mistake can't show one company another's data (tested).
- **Login**: scrypt-hashed passwords, 2FA with authenticator apps + backup codes (owners can require
  it for the whole team), lockout after failed attempts, sessions stored server-side.
- **Secrets**: calendar tokens and 2FA secrets encrypted (AES-256-GCM). All Twilio and Stripe
  webhooks are signature-checked.
- **GDPR tools** (Settings → Personvern): export everything about a phone number, delete everything
  about a phone number (also recordings at Twilio and synced calendar events), automatic deletion of
  recordings (default 90 days) and transcripts (default 2 years), account deletion after 30 days.
- **Change log** of every action (append-only), DPA acceptance recorded at sign-up
  (`/legal/dpa` — a draft that must be reviewed by a lawyer), public caller privacy page per company
  (`/personvern/<company>`).

---

## Tests

```bash
pnpm test
```
88 automated tests: tenant isolation, login/2FA, telephony webhooks, the voice agent (with a
scripted stand-in for Claude), booking engine, calendar sync, SMS, billing, retention.

```bash
VAKTA_FAKE_AI=1 pnpm dev
```
```bash
pnpm test:e2e
```
9 browser tests on a phone-sized screen: sign-up & onboarding, 2FA, leads, calendar booking and
double-booking protection, and a complete test call that books a befaring.
(`VAKTA_FAKE_AI=1` swaps Claude for a scripted stand-in; it is refused in production.)

---

## For developers

| Path | What |
|---|---|
| `server.ts` | Node server: Next.js + voice WebSocket on one port, starts background jobs |
| `db/migrations/*.sql` | Database schema incl. row-level security (source of truth) |
| `src/lib/db/` | Drizzle schema, `withTenant()` / `withSystem()` helpers |
| `src/lib/auth/` | sessions, passwords, TOTP, rate limiting, sign-up |
| `src/lib/telephony/` | Twilio provider, TwiML, inbound routing, number pool, webhook checks |
| `src/voice/` | the agent: `session.ts` (conversation loop), `tools.ts`, `prompt.ts`, `relay.ts` (Twilio socket), `simulator.ts` |
| `src/lib/booking/` | `engine.ts` (pure slot finder with travel time), geocoding, booking service |
| `src/lib/calendar/` | Google/Microsoft REST, OAuth, sync |
| `src/lib/sms/`, `src/lib/notify.ts` | texts and owner alerts |
| `src/lib/billing/` | Stripe + who may use the service |
| `src/lib/gdpr/`, `src/lib/jobs/` | export/erasure, retention and other background jobs |
| `src/app/` | pages (`(app)` dashboard, `(auth)`, `onboarding`) and API routes |
| `tests/`, `e2e/` | Vitest and Playwright tests |

Useful commands: `pnpm typecheck`, `pnpm cron <job>` (run a background job by hand),
`pnpm db:reset` (development only).

---

## Status and next steps

**Built and tested:** everything in the MVP list — multi-tenant database & 2FA login, dashboard,
telephony, voice agent, travel-aware booking, Google/Outlook sync, SMS, Stripe billing, onboarding,
GDPR tooling, demo company.

**Not yet verified against the live services** (no accounts connected yet): real Twilio calls,
Norwegian speech quality, real Claude conversations, Stripe checkout, Google/Microsoft OAuth.
These are covered by tests with stand-ins that follow each provider's documented API.
First thing after connecting them: make 10–20 real test calls and tune the greeting, prompt, voice
and speech-recognition settings.

**Open decisions** (see `docs/PLAN.md`): product name & price, who the number pool is registered to,
recording default, where Claude runs (Anthropic API vs. an EU-region cloud), Opus vs. Haiku for
live calls, legal review of the DPA and privacy texts.
