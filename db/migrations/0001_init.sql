-- Vakta initial schema.
-- Every table that holds a company's data has a company_id column and a FORCED
-- row-level-security policy. Application code sets `app.company_id` (or, for
-- trusted system tasks such as inbound-call routing, `app.system = on`) inside
-- each transaction. Without that setting a query sees zero rows: fail-closed.

CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE OR REPLACE FUNCTION app_company_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.company_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app_is_system() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.system', true), '') = 'on'
$$;

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

-- ───────────────────────────── companies ─────────────────────────────
CREATE TABLE companies (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                       text NOT NULL,
  slug                       text NOT NULL UNIQUE,
  org_number                 text,
  trade                      text NOT NULL DEFAULT 'general'
                               CHECK (trade IN ('plumber','electrician','carpenter','roofer','painter','general')),
  phone                      text,
  email                      text,
  base_address               text,
  base_lat                   double precision,
  base_lng                   double precision,
  service_radius_km          integer NOT NULL DEFAULT 40 CHECK (service_radius_km BETWEEN 1 AND 500),
  service_postcodes          text[] NOT NULL DEFAULT '{}',
  timezone                   text NOT NULL DEFAULT 'Europe/Oslo',
  locale                     text NOT NULL DEFAULT 'nb' CHECK (locale IN ('nb','en')),
  business_hours             jsonb NOT NULL DEFAULT '{"1":[{"start":"07:00","end":"15:30"}],"2":[{"start":"07:00","end":"15:30"}],"3":[{"start":"07:00","end":"15:30"}],"4":[{"start":"07:00","end":"15:30"}],"5":[{"start":"07:00","end":"14:30"}],"6":[],"7":[]}',
  befaring_minutes           integer NOT NULL DEFAULT 45 CHECK (befaring_minutes BETWEEN 15 AND 480),
  buffer_minutes             integer NOT NULL DEFAULT 15 CHECK (buffer_minutes BETWEEN 0 AND 240),
  min_notice_hours           integer NOT NULL DEFAULT 3 CHECK (min_notice_hours BETWEEN 0 AND 168),
  booking_horizon_days       integer NOT NULL DEFAULT 21 CHECK (booking_horizon_days BETWEEN 1 AND 120),
  greeting_text              text NOT NULL DEFAULT 'Hva kan jeg hjelpe deg med?',
  agent_instructions         text NOT NULL DEFAULT '',
  sms_sender_name            text CHECK (sms_sender_name IS NULL OR sms_sender_name ~ '^[A-Za-z0-9 ]{1,11}$'),
  recording_enabled          boolean NOT NULL DEFAULT true,
  recording_retention_days   integer NOT NULL DEFAULT 90 CHECK (recording_retention_days BETWEEN 1 AND 3650),
  transcript_retention_days  integer NOT NULL DEFAULT 730 CHECK (transcript_retention_days BETWEEN 30 AND 3650),
  forward_emergencies        boolean NOT NULL DEFAULT true,
  forward_on_request         boolean NOT NULL DEFAULT false,
  forward_number             text,
  forward_hours              text NOT NULL DEFAULT 'always'
                               CHECK (forward_hours IN ('always','business_hours','outside_business_hours')),
  notify_numbers             text[] NOT NULL DEFAULT '{}',
  notify_on                  text[] NOT NULL DEFAULT '{booked,lead,emergency,missed}',
  vip_numbers                text[] NOT NULL DEFAULT '{}',
  blocked_numbers            text[] NOT NULL DEFAULT '{}',
  require_2fa                boolean NOT NULL DEFAULT false,
  onboarding_step            text NOT NULL DEFAULT 'business'
                               CHECK (onboarding_step IN ('business','services','hours','phone','test','done')),
  trial_ends_at              timestamptz NOT NULL DEFAULT now() + interval '14 days',
  subscription_status        text NOT NULL DEFAULT 'trialing'
                               CHECK (subscription_status IN ('trialing','active','past_due','canceled','unpaid','incomplete','paused')),
  stripe_customer_id         text UNIQUE,
  stripe_subscription_id     text UNIQUE,
  current_period_end         timestamptz,
  deletion_requested_at      timestamptz,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER companies_touch BEFORE UPDATE ON companies FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ───────────────────────────── users & auth (global) ─────────────────
CREATE TABLE users (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email            citext NOT NULL UNIQUE,
  name             text NOT NULL,
  phone            text,
  password_hash    text NOT NULL,
  locale           text NOT NULL DEFAULT 'nb' CHECK (locale IN ('nb','en')),
  totp_secret_enc  text,
  totp_enabled_at  timestamptz,
  backup_codes     text[] NOT NULL DEFAULT '{}',
  failed_logins    integer NOT NULL DEFAULT 0,
  locked_until     timestamptz,
  last_login_at    timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER users_touch BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE memberships (
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role          text NOT NULL CHECK (role IN ('owner','admin','member')),
  does_befaring boolean NOT NULL DEFAULT true,
  color         text NOT NULL DEFAULT '#0f766e',
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, user_id)
);
CREATE INDEX memberships_user_idx ON memberships(user_id);

CREATE TABLE sessions (
  id           text PRIMARY KEY,               -- sha256(token), never the token itself
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id   uuid REFERENCES companies(id) ON DELETE SET NULL,
  mfa_pending  boolean NOT NULL DEFAULT false,
  ip           text,
  user_agent   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

CREATE TABLE login_attempts (
  id         bigserial PRIMARY KEY,
  email      citext,
  ip         text,
  success    boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_attempts_email_idx ON login_attempts(email, created_at);
CREATE INDEX login_attempts_ip_idx ON login_attempts(ip, created_at);

CREATE TABLE password_resets (
  token_hash text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE email_outbox (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  to_email   text NOT NULL,
  subject    text NOT NULL,
  body_text  text NOT NULL,
  status     text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed','logged')),
  error      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at    timestamptz
);

CREATE TABLE stripe_events (
  id           text PRIMARY KEY,
  type         text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);

-- ───────────────────────────── tenant tables ─────────────────────────
CREATE TABLE invitations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  email       citext NOT NULL,
  role        text NOT NULL CHECK (role IN ('admin','member')),
  token_hash  text NOT NULL UNIQUE,
  invited_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  expires_at  timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE dpa_acceptances (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  version     text NOT NULL,
  ip          text,
  accepted_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE job_types (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name             text NOT NULL,
  description      text NOT NULL DEFAULT '',
  befaring_minutes integer CHECK (befaring_minutes IS NULL OR befaring_minutes BETWEEN 15 AND 480),
  needs_befaring   boolean NOT NULL DEFAULT true,
  active           boolean NOT NULL DEFAULT true,
  sort             integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX job_types_company_idx ON job_types(company_id, sort);

CREATE TABLE phone_numbers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid REFERENCES companies(id) ON DELETE SET NULL,   -- NULL = free number in the pool
  e164         text NOT NULL UNIQUE,
  provider     text NOT NULL CHECK (provider IN ('twilio','mock')),
  provider_sid text,
  sms_capable  boolean NOT NULL DEFAULT false,
  status       text NOT NULL DEFAULT 'available' CHECK (status IN ('available','assigned','released')),
  assigned_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE leads (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name             text,
  phone            text,
  email            text,
  address          text,
  postcode         text,
  city             text,
  lat              double precision,
  lng              double precision,
  in_service_area  boolean,
  job_type_id      uuid REFERENCES job_types(id) ON DELETE SET NULL,
  job_type_text    text,
  description      text,
  urgency          text NOT NULL DEFAULT 'normal' CHECK (urgency IN ('low','normal','high','emergency')),
  preferred_times  text,
  status           text NOT NULL DEFAULT 'new' CHECK (status IN ('new','booked','quoted','won','lost')),
  source           text NOT NULL DEFAULT 'phone' CHECK (source IN ('phone','manual','simulator')),
  value_nok        integer,
  notes            text,
  contacted_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX leads_company_status_idx ON leads(company_id, status, created_at DESC);
CREATE INDEX leads_company_phone_idx ON leads(company_id, phone);
CREATE TRIGGER leads_touch BEFORE UPDATE ON leads FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE calls (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  phone_number_id     uuid REFERENCES phone_numbers(id) ON DELETE SET NULL,
  lead_id             uuid REFERENCES leads(id) ON DELETE SET NULL,
  provider            text NOT NULL DEFAULT 'twilio',
  provider_call_sid   text UNIQUE,
  from_number         text,
  to_number           text,
  forwarded_from      text,
  is_test             boolean NOT NULL DEFAULT false,
  status              text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed','failed')),
  outcome             text CHECK (outcome IN ('booked','lead_captured','transferred','emergency','spam','sales','hangup','info','failed','service_inactive','blocked')),
  is_emergency        boolean NOT NULL DEFAULT false,
  flagged             boolean NOT NULL DEFAULT false,
  flag_reason         text,
  language            text NOT NULL DEFAULT 'nb',
  started_at          timestamptz NOT NULL DEFAULT now(),
  ended_at            timestamptz,
  duration_seconds    integer,
  transcript          jsonb NOT NULL DEFAULT '[]',
  summary             text,
  summary_json        jsonb,
  recording_sid       text,
  recording_status    text,
  recording_duration  integer,
  recording_deleted_at timestamptz,
  transferred_to      text,
  reviewed_at         timestamptz,
  ai_usage            jsonb,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX calls_company_started_idx ON calls(company_id, started_at DESC);
CREATE INDEX calls_company_from_idx ON calls(company_id, from_number);

CREATE TABLE appointments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  lead_id           uuid REFERENCES leads(id) ON DELETE SET NULL,
  call_id           uuid REFERENCES calls(id) ON DELETE SET NULL,
  assigned_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  title             text NOT NULL,
  starts_at         timestamptz NOT NULL,
  ends_at           timestamptz NOT NULL,
  address           text,
  lat               double precision,
  lng               double precision,
  customer_name     text,
  customer_phone    text,
  notes             text,
  status            text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','completed','cancelled','no_show')),
  created_by        text NOT NULL DEFAULT 'ai' CHECK (created_by IN ('ai','user')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT appointments_time_order CHECK (ends_at > starts_at),
  -- The database itself refuses two overlapping befaringer for the same person.
  CONSTRAINT appointments_no_overlap EXCLUDE USING gist (
    company_id WITH =, assigned_user_id WITH =, tstzrange(starts_at, ends_at) WITH &&
  ) WHERE (status = 'scheduled' AND assigned_user_id IS NOT NULL)
);
CREATE INDEX appointments_company_start_idx ON appointments(company_id, starts_at);
CREATE TRIGGER appointments_touch BEFORE UPDATE ON appointments FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE calendar_connections (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider           text NOT NULL CHECK (provider IN ('google','microsoft')),
  account_email      text,
  access_token_enc   text,
  refresh_token_enc  text,
  token_expires_at   timestamptz,
  calendar_id        text NOT NULL DEFAULT 'primary',
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active','error','revoked')),
  last_error         text,
  last_synced_at     timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, user_id, provider)
);

CREATE TABLE busy_blocks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES calendar_connections(id) ON DELETE CASCADE,
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX busy_blocks_lookup_idx ON busy_blocks(company_id, user_id, starts_at);

CREATE TABLE appointment_sync (
  appointment_id    uuid NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  connection_id     uuid NOT NULL REFERENCES calendar_connections(id) ON DELETE CASCADE,
  company_id        uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  external_event_id text NOT NULL,
  synced_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (appointment_id, connection_id)
);

CREATE TABLE sms_messages (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  to_number      text NOT NULL,
  sender         text NOT NULL,
  body           text NOT NULL,
  purpose        text NOT NULL CHECK (purpose IN ('booking_confirmation','owner_notification','reschedule','cancellation','reminder','other')),
  provider       text NOT NULL,
  provider_sid   text,
  status         text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','delivered','failed','undelivered','simulated')),
  error          text,
  call_id        uuid REFERENCES calls(id) ON DELETE SET NULL,
  appointment_id uuid REFERENCES appointments(id) ON DELETE SET NULL,
  lead_id        uuid REFERENCES leads(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sms_company_created_idx ON sms_messages(company_id, created_at DESC);

CREATE TABLE privacy_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('erasure','export')),
  subject_phone text NOT NULL,
  requested_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  result        jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz
);

CREATE TABLE audit_logs (
  id          bigserial PRIMARY KEY,
  company_id  uuid REFERENCES companies(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  actor       text NOT NULL DEFAULT 'user' CHECK (actor IN ('user','ai','system')),
  action      text NOT NULL,
  entity_type text,
  entity_id   text,
  metadata    jsonb NOT NULL DEFAULT '{}',
  ip          text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_company_created_idx ON audit_logs(company_id, created_at DESC);

-- Audit log is append-only: no UPDATE ever, DELETE only by system retention jobs.
CREATE OR REPLACE FUNCTION audit_logs_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'audit_logs is append-only';
  END IF;
  IF TG_OP = 'DELETE' AND NOT app_is_system() THEN
    RAISE EXCEPTION 'audit_logs rows can only be deleted by system retention';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_guard();

-- ───────────────────────────── row-level security ────────────────────
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON companies
  USING (id = app_company_id() OR app_is_system())
  WITH CHECK (id = app_company_id() OR app_is_system());

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'memberships','invitations','dpa_acceptances','job_types','phone_numbers','leads','calls',
    'appointments','calendar_connections','busy_blocks','appointment_sync','sms_messages',
    'privacy_requests'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (company_id = app_company_id() OR app_is_system()) WITH CHECK (company_id = app_company_id() OR app_is_system())',
      t);
  END LOOP;
END $$;

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_read ON audit_logs FOR SELECT
  USING (company_id = app_company_id() OR app_is_system());
CREATE POLICY audit_insert ON audit_logs FOR INSERT
  WITH CHECK (company_id IS NULL OR company_id = app_company_id() OR app_is_system());
CREATE POLICY audit_delete ON audit_logs FOR DELETE USING (app_is_system());
