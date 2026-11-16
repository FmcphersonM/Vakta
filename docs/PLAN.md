# Vakta – technical plan

> "Vakta" is a working name. Change it in `.env` (`NEXT_PUBLIC_APP_NAME`) when you pick the real brand.

## 1. What we are building

An AI phone receptionist for Norwegian trades businesses (rørlegger, elektriker, tømrer, taktekker…).
When the owner can't pick up, Vakta answers, talks Norwegian (English fallback), qualifies the job,
books a **befaring** into the real calendar, texts the caller a confirmation and tells the company.
Everything is visible in a mobile-first web dashboard.

## 2. Architecture (one picture)

```
 Caller ──► Norwegian number (Twilio, IE1/Dublin region)
              │  webhook (HTTPS, signed)                     ┌──────────────────────────┐
              ▼                                               │  Vakta server (Node)     │
        /api/telephony/twilio/voice ──TwiML──► ConversationRelay ◄──WebSocket──► Voice agent│
              │                              (Twilio does STT + TTS,           │  (Claude,   │
              │                               nb-NO voice, barge-in)           │  streaming, │
              ▼                                                                │  tools)     │
        Postgres (EU, row-level security per company) ◄────────────────────────┤             │
              ▲                                                                └─────┬──────┘
              │                                                                      │
  Dashboard (Next.js, nb/en)   Google / Outlook calendar   SMS (Twilio)   Stripe billing
```

* **One Node process** runs the Next.js dashboard *and* the voice WebSocket (custom `server.ts`).
  It can be split into two services later without code changes.
* **Voice pipeline:** Twilio *ConversationRelay* handles speech-to-text, text-to-speech and
  interruptions (barge-in) next to the phone network, so we only exchange **text** with Twilio.
  Claude's reply is **streamed token by token** into the text-to-speech, so the caller hears the
  first words while the rest is still being generated. Static prompt parts are cached.
* **Agent tools:** save caller details, find befaring slots, book befaring, transfer to owner
  (emergencies), switch language, end call (spam/sales/finished).
* **Booking engine:** pure, unit-tested function. Uses business hours, befaring length, buffer,
  existing befaringer, busy time from Google/Outlook, and **travel time** between jobs
  (addresses geocoded with Kartverket's free address API; travel time estimated from distance,
  upgradeable to Google Routes). Double-booking is impossible at database level
  (Postgres exclusion constraint).
* **Calendar sync:** OAuth to Google Calendar and Microsoft 365. Busy times are pulled every
  10 minutes and checked live at booking; befaringer are pushed as events; drag-to-reschedule
  updates both.

## 3. Stack

| Concern | Choice | Why |
|---|---|---|
| Web app | Next.js 16 (App Router) + TypeScript + Tailwind | as suggested; server components keep the phone UI fast |
| Database | PostgreSQL 16 + Drizzle ORM, hand-written SQL migrations | RLS policies + exclusion constraints need real SQL |
| Tenant isolation | Postgres **Row-Level Security** (forced) + `app.company_id` per transaction | a forgotten `WHERE` can't leak another company's data |
| Auth | Own implementation: scrypt passwords, server-side sessions, TOTP 2FA + backup codes, rate limiting | small, auditable, no third-party identity provider holding EU personal data |
| Telephony + SMS | Twilio (Norwegian numbers, ConversationRelay, Messaging), EU region IE1 | best documented real-time voice; recordings stored in Ireland |
| Speech | via ConversationRelay: Google `nb-NO` Chirp 3 HD voice / Deepgram or Google STT | no extra vendor contracts; switchable per env var |
| LLM | Claude (`claude-opus-5-5`, low effort for the live call; configurable) | quality of Norwegian + tool use |
| Billing | Stripe Checkout + Customer Portal, NOK, 14-day trial | standard |
| Email | Any SMTP provider (EU one recommended, e.g. Brevo/Mailgun EU) | invitations, password reset |
| Hosting | Render, **Frankfurt** region (web service + Postgres + cron jobs) | managed, EU, WebSockets supported; `render.yaml` included |
| Tests | Vitest (unit + DB integration), Playwright (end-to-end) | |

## 4. Data model (all company tables carry `company_id` and are RLS-protected)

`companies` (settings: hours, service area, befaring length, greeting, forwarding rules, billing state) ·
`users`, `memberships` (owner/admin/member, field worker flag), `sessions` ·
`phone_numbers` (pool + assigned) · `calls` (transcript, summary, outcome, recording ref) ·
`leads` (new/booked/quoted/won/lost) · `appointments` (befaringer, external event ids) ·
`calendar_connections` (encrypted tokens), `busy_blocks` · `job_types` · `sms_messages` ·
`audit_logs` (append-only) · `privacy_requests` · `dpa_acceptances` · `invitations` · `stripe_events`.

## 5. GDPR / security

* All data in the EU (Render Frankfurt, Twilio IE1). Claude is called through Anthropic's API —
  see the open decision below about EU-only processing.
* The greeting **always** says the caller is talking to an AI assistant and, if enabled, that the
  call is recorded. This part of the greeting can't be removed in settings.
* Deletion/export on request per phone number (calls, recordings at Twilio, transcripts, leads,
  befaringer, SMS) from *Settings → Privacy*. Automatic retention (recordings 90 days by default).
* Data processing agreement (template) accepted and logged at sign-up.
* Audit log of every change, 2FA (TOTP), encrypted OAuth tokens and 2FA secrets (AES-256-GCM),
  signed webhooks, signed WebSocket URLs, security headers.

## 6. Build order

1. Database + auth → 2. Dashboard skeleton → 3. Telephony → 4. Voice agent → 5. Booking →
6. Calendar sync → 7. SMS → 8. Billing → 9. Onboarding → demo company.

Everything that needs an external account has a **local stand-in** (mock phone numbers, SMS
log, browser-based "test call" simulator) so the whole product can be clicked through before
any keys exist. Real providers switch on automatically when their keys are set.

## 7. Accounts and keys needed from you

| # | What | Needed for | Notes |
|---|---|---|---|
| 1 | **GitHub repository** (empty, private) | keeping the code | this build runs in a temporary cloud machine — code must be pushed somewhere |
| 2 | **Anthropic API key** | the AI conversation + call summaries | console.anthropic.com |
| 3 | **Twilio account** (upgraded, not trial) with **Norwegian regulatory bundle** and 1+ Norwegian numbers; Account SID, API key + secret; ConversationRelay enabled (accept the AI/ML addendum in the console) | phone numbers, calls, SMS, recordings | create it in region **IE1**; Norwegian numbers need a Norwegian business address |
| 4 | **Stripe account** (test keys first): secret key, webhook secret, one monthly NOK price | subscriptions | |
| 5 | **Google Cloud OAuth client** with Calendar API enabled | Google Calendar sync | production use requires Google's OAuth app verification (takes days–weeks) |
| 6 | **Microsoft Entra app registration** (multi-tenant, `Calendars.ReadWrite`, `offline_access`) | Outlook / Microsoft 365 sync | |
| 7 | **SMTP credentials** (EU provider) | invitations, password reset | optional for the demo |
| 8 | **Render account** (paid plan, Frankfurt) + a domain name | hosting | I can deploy with the connected Render integration once you approve the cost |

## 8. Business decisions needed from you

1. Product name and price (placeholder: 990 kr/mnd + MVA, 14-day free trial, no card up front).
2. Whose name the Norwegian numbers are registered to (your company owning a number pool is fastest
   and is what makes "working number in under 10 minutes" possible).
3. Recording default (placeholder: **on**, with notice in the greeting, deleted after 90 days).
4. Claude data location: Anthropic API (processing may happen outside the EU under SCCs/DPF) vs.
   Claude via AWS Bedrock / Google Vertex in an EU region (code supports switching later).
5. Model choice for live calls: `claude-opus-5-5` at low effort (default, best quality) vs.
   `claude-haiku-5-5` (cheaper, likely faster). Measure both on real calls before deciding.
6. Legal review of the DPA template and privacy notice (they are drafts, not legal advice).
