/**
 * Typed mirror of db/migrations/*.sql for Drizzle queries.
 * The SQL files are the source of truth; tests/schema-drift.test.ts checks
 * that every column declared here exists in the real database.
 */
import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  doublePrecision,
  bigserial,
  primaryKey,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export type TimeRange = { start: string; end: string };
export type BusinessHours = Record<"1" | "2" | "3" | "4" | "5" | "6" | "7", TimeRange[]>;

export const DEFAULT_BUSINESS_HOURS: BusinessHours = {
  "1": [{ start: "07:00", end: "15:30" }],
  "2": [{ start: "07:00", end: "15:30" }],
  "3": [{ start: "07:00", end: "15:30" }],
  "4": [{ start: "07:00", end: "15:30" }],
  "5": [{ start: "07:00", end: "14:30" }],
  "6": [],
  "7": [],
};

export type TranscriptEntry = {
  role: "caller" | "agent" | "system";
  text: string;
  at: string; // ISO timestamp
};

export type CallSummary = {
  summary: string;
  outcome: string;
  job_type: string | null;
  urgency: "low" | "normal" | "high" | "emergency";
  follow_up: string | null;
};

export const companies = pgTable("companies", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  orgNumber: text("org_number"),
  trade: text("trade").notNull().default("general"),
  phone: text("phone"),
  email: text("email"),
  baseAddress: text("base_address"),
  baseLat: doublePrecision("base_lat"),
  baseLng: doublePrecision("base_lng"),
  serviceRadiusKm: integer("service_radius_km").notNull().default(40),
  servicePostcodes: text("service_postcodes").array().notNull().default([]),
  timezone: text("timezone").notNull().default("Europe/Oslo"),
  locale: text("locale").notNull().default("nb"),
  businessHours: jsonb("business_hours").$type<BusinessHours>().notNull().default(DEFAULT_BUSINESS_HOURS),
  befaringMinutes: integer("befaring_minutes").notNull().default(45),
  bufferMinutes: integer("buffer_minutes").notNull().default(15),
  minNoticeHours: integer("min_notice_hours").notNull().default(3),
  bookingHorizonDays: integer("booking_horizon_days").notNull().default(21),
  greetingText: text("greeting_text").notNull().default("Hva kan jeg hjelpe deg med?"),
  agentInstructions: text("agent_instructions").notNull().default(""),
  smsSenderName: text("sms_sender_name"),
  recordingEnabled: boolean("recording_enabled").notNull().default(true),
  recordingRetentionDays: integer("recording_retention_days").notNull().default(90),
  transcriptRetentionDays: integer("transcript_retention_days").notNull().default(730),
  forwardEmergencies: boolean("forward_emergencies").notNull().default(true),
  forwardOnRequest: boolean("forward_on_request").notNull().default(false),
  forwardNumber: text("forward_number"),
  forwardHours: text("forward_hours").notNull().default("always"),
  notifyNumbers: text("notify_numbers").array().notNull().default([]),
  notifyOn: text("notify_on").array().notNull().default(["booked", "lead", "emergency", "missed"]),
  vipNumbers: text("vip_numbers").array().notNull().default([]),
  blockedNumbers: text("blocked_numbers").array().notNull().default([]),
  require2fa: boolean("require_2fa").notNull().default(false),
  sendReminders: boolean("send_reminders").notNull().default(true),
  onboardingStep: text("onboarding_step").notNull().default("business"),
  trialEndsAt: ts("trial_ends_at").notNull().default(sql`now() + interval '14 days'`),
  subscriptionStatus: text("subscription_status").notNull().default("trialing"),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  currentPeriodEnd: ts("current_period_end"),
  deletionRequestedAt: ts("deletion_requested_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  phone: text("phone"),
  passwordHash: text("password_hash").notNull(),
  locale: text("locale").notNull().default("nb"),
  totpSecretEnc: text("totp_secret_enc"),
  totpEnabledAt: ts("totp_enabled_at"),
  backupCodes: text("backup_codes").array().notNull().default([]),
  failedLogins: integer("failed_logins").notNull().default(0),
  lockedUntil: ts("locked_until"),
  lastLoginAt: ts("last_login_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const memberships = pgTable(
  "memberships",
  {
    companyId: uuid("company_id").notNull(),
    userId: uuid("user_id").notNull(),
    role: text("role").$type<"owner" | "admin" | "member">().notNull(),
    doesBefaring: boolean("does_befaring").notNull().default(true),
    color: text("color").notNull().default("#0f766e"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.companyId, t.userId] })],
);

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  companyId: uuid("company_id"),
  mfaPending: boolean("mfa_pending").notNull().default(false),
  ip: text("ip"),
  userAgent: text("user_agent"),
  createdAt: ts("created_at").notNull().defaultNow(),
  lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
  expiresAt: ts("expires_at").notNull(),
});

export const loginAttempts = pgTable("login_attempts", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  email: text("email"),
  ip: text("ip"),
  success: boolean("success").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const passwordResets = pgTable("password_resets", {
  tokenHash: text("token_hash").primaryKey(),
  userId: uuid("user_id").notNull(),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const emailOutbox = pgTable("email_outbox", {
  id: uuid("id").primaryKey().defaultRandom(),
  toEmail: text("to_email").notNull(),
  subject: text("subject").notNull(),
  bodyText: text("body_text").notNull(),
  status: text("status").notNull().default("queued"),
  error: text("error"),
  createdAt: ts("created_at").notNull().defaultNow(),
  sentAt: ts("sent_at"),
});

export const stripeEvents = pgTable("stripe_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  processedAt: ts("processed_at").notNull().defaultNow(),
});

export const invitations = pgTable("invitations", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  email: text("email").notNull(),
  role: text("role").$type<"admin" | "member">().notNull(),
  tokenHash: text("token_hash").notNull(),
  invitedBy: uuid("invited_by"),
  expiresAt: ts("expires_at").notNull(),
  acceptedAt: ts("accepted_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const dpaAcceptances = pgTable("dpa_acceptances", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  userId: uuid("user_id"),
  version: text("version").notNull(),
  ip: text("ip"),
  acceptedAt: ts("accepted_at").notNull().defaultNow(),
});

export const jobTypes = pgTable("job_types", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  befaringMinutes: integer("befaring_minutes"),
  needsBefaring: boolean("needs_befaring").notNull().default(true),
  active: boolean("active").notNull().default(true),
  sort: integer("sort").notNull().default(0),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const phoneNumbers = pgTable("phone_numbers", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id"),
  e164: text("e164").notNull().unique(),
  provider: text("provider").$type<"twilio" | "mock">().notNull(),
  providerSid: text("provider_sid"),
  smsCapable: boolean("sms_capable").notNull().default(false),
  status: text("status").$type<"available" | "assigned" | "released">().notNull().default("available"),
  assignedAt: ts("assigned_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export type LeadStatus = "new" | "booked" | "quoted" | "won" | "lost";
export type Urgency = "low" | "normal" | "high" | "emergency";

export const leads = pgTable("leads", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  name: text("name"),
  phone: text("phone"),
  email: text("email"),
  address: text("address"),
  postcode: text("postcode"),
  city: text("city"),
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  inServiceArea: boolean("in_service_area"),
  jobTypeId: uuid("job_type_id"),
  jobTypeText: text("job_type_text"),
  description: text("description"),
  urgency: text("urgency").$type<Urgency>().notNull().default("normal"),
  preferredTimes: text("preferred_times"),
  status: text("status").$type<LeadStatus>().notNull().default("new"),
  source: text("source").$type<"phone" | "manual" | "simulator">().notNull().default("phone"),
  valueNok: integer("value_nok"),
  notes: text("notes"),
  contactedAt: ts("contacted_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export type CallOutcome =
  | "booked"
  | "lead_captured"
  | "transferred"
  | "emergency"
  | "spam"
  | "sales"
  | "hangup"
  | "info"
  | "failed"
  | "service_inactive"
  | "blocked";

export const calls = pgTable("calls", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  phoneNumberId: uuid("phone_number_id"),
  leadId: uuid("lead_id"),
  provider: text("provider").notNull().default("twilio"),
  providerCallSid: text("provider_call_sid"),
  fromNumber: text("from_number"),
  toNumber: text("to_number"),
  forwardedFrom: text("forwarded_from"),
  isTest: boolean("is_test").notNull().default(false),
  status: text("status").$type<"in_progress" | "completed" | "failed">().notNull().default("in_progress"),
  outcome: text("outcome").$type<CallOutcome>(),
  isEmergency: boolean("is_emergency").notNull().default(false),
  flagged: boolean("flagged").notNull().default(false),
  flagReason: text("flag_reason"),
  language: text("language").notNull().default("nb"),
  startedAt: ts("started_at").notNull().defaultNow(),
  endedAt: ts("ended_at"),
  durationSeconds: integer("duration_seconds"),
  transcript: jsonb("transcript").$type<TranscriptEntry[]>().notNull().default([]),
  summary: text("summary"),
  summaryJson: jsonb("summary_json").$type<CallSummary>(),
  recordingSid: text("recording_sid"),
  recordingStatus: text("recording_status"),
  recordingDuration: integer("recording_duration"),
  recordingDeletedAt: ts("recording_deleted_at"),
  transferredTo: text("transferred_to"),
  reviewedAt: ts("reviewed_at"),
  aiUsage: jsonb("ai_usage").$type<Record<string, number>>(),
  postProcessedAt: ts("post_processed_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export type AppointmentStatus = "scheduled" | "completed" | "cancelled" | "no_show";

export const appointments = pgTable("appointments", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  leadId: uuid("lead_id"),
  callId: uuid("call_id"),
  assignedUserId: uuid("assigned_user_id"),
  title: text("title").notNull(),
  startsAt: ts("starts_at").notNull(),
  endsAt: ts("ends_at").notNull(),
  address: text("address"),
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  customerName: text("customer_name"),
  customerPhone: text("customer_phone"),
  notes: text("notes"),
  status: text("status").$type<AppointmentStatus>().notNull().default("scheduled"),
  createdBy: text("created_by").$type<"ai" | "user">().notNull().default("ai"),
  reminderSentAt: ts("reminder_sent_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const calendarConnections = pgTable("calendar_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  userId: uuid("user_id").notNull(),
  provider: text("provider").$type<"google" | "microsoft">().notNull(),
  accountEmail: text("account_email"),
  accessTokenEnc: text("access_token_enc"),
  refreshTokenEnc: text("refresh_token_enc"),
  tokenExpiresAt: ts("token_expires_at"),
  calendarId: text("calendar_id").notNull().default("primary"),
  status: text("status").$type<"active" | "error" | "revoked">().notNull().default("active"),
  lastError: text("last_error"),
  lastSyncedAt: ts("last_synced_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const busyBlocks = pgTable("busy_blocks", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  userId: uuid("user_id").notNull(),
  connectionId: uuid("connection_id").notNull(),
  startsAt: ts("starts_at").notNull(),
  endsAt: ts("ends_at").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const appointmentSync = pgTable(
  "appointment_sync",
  {
    appointmentId: uuid("appointment_id").notNull(),
    connectionId: uuid("connection_id").notNull(),
    companyId: uuid("company_id").notNull(),
    externalEventId: text("external_event_id").notNull(),
    syncedAt: ts("synced_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.appointmentId, t.connectionId] })],
);

export type SmsPurpose =
  | "booking_confirmation"
  | "owner_notification"
  | "reschedule"
  | "cancellation"
  | "reminder"
  | "other";

export const smsMessages = pgTable("sms_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  toNumber: text("to_number").notNull(),
  sender: text("sender").notNull(),
  body: text("body").notNull(),
  purpose: text("purpose").$type<SmsPurpose>().notNull(),
  provider: text("provider").notNull(),
  providerSid: text("provider_sid"),
  status: text("status").notNull().default("queued"),
  error: text("error"),
  callId: uuid("call_id"),
  appointmentId: uuid("appointment_id"),
  leadId: uuid("lead_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const privacyRequests = pgTable("privacy_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  kind: text("kind").$type<"erasure" | "export">().notNull(),
  subjectPhone: text("subject_phone").notNull(),
  requestedBy: uuid("requested_by"),
  result: jsonb("result").$type<Record<string, unknown>>(),
  createdAt: ts("created_at").notNull().defaultNow(),
  completedAt: ts("completed_at"),
});

export const auditLogs = pgTable("audit_logs", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  companyId: uuid("company_id"),
  userId: uuid("user_id"),
  actor: text("actor").$type<"user" | "ai" | "system">().notNull().default("user"),
  action: text("action").notNull(),
  entityType: text("entity_type"),
  entityId: text("entity_id"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  ip: text("ip"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export type Company = typeof companies.$inferSelect;
export type User = typeof users.$inferSelect;
export type Lead = typeof leads.$inferSelect;
export type Call = typeof calls.$inferSelect;
export type Appointment = typeof appointments.$inferSelect;
export type JobType = typeof jobTypes.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type CalendarConnection = typeof calendarConnections.$inferSelect;
