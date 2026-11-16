// Runs before every test file: point the app at the test database.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://vakta:vakta@localhost:5432/vakta_test";
process.env.SESSION_SECRET ??= "test-session-secret-0123456789-abcdefghijklmnop";
process.env.ENCRYPTION_KEY ??= "test-encryption-key-0123456789-abcdefghijklmnop";
process.env.CRON_SECRET ??= "test-cron-secret-123456";
process.env.APP_URL = "https://vakta.test";
process.env.TELEPHONY_PROVIDER = "mock";
process.env.ANTHROPIC_API_KEY = "";
process.env.STRIPE_SECRET_KEY = "";
