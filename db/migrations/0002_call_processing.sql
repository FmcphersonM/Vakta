-- Post-call processing (summary + notifications) must run exactly once per call.
ALTER TABLE calls ADD COLUMN post_processed_at timestamptz;
-- Twilio callbacks look calls up by SID across tenants (system context).
CREATE INDEX IF NOT EXISTS sms_provider_sid_idx ON sms_messages(provider_sid);
