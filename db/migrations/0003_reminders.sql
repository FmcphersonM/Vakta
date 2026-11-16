-- Day-before SMS reminders to customers.
ALTER TABLE appointments ADD COLUMN reminder_sent_at timestamptz;
ALTER TABLE companies ADD COLUMN send_reminders boolean NOT NULL DEFAULT true;
