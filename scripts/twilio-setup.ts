/**
 * Connects Vakta to your Twilio account.
 *   pnpm twilio:setup                 check the connection and list numbers
 *   pnpm twilio:setup --import        add numbers you already own to the pool (and point them at this server)
 *   pnpm twilio:setup --buy 2         buy 2 new Norwegian numbers into the pool
 *   pnpm twilio:setup --demo          give the demo company a real number (replaces its test number)
 */
import { loadEnvFile } from "./load-env";
loadEnvFile();

const { env, features } = await import("../src/lib/env");
const { getTelephony } = await import("../src/lib/telephony/provider");
const { importTwilioNumbers, replenishPool, claimPoolNumber } = await import("../src/lib/telephony/numbers");
const { withSystem, closeDb } = await import("../src/lib/db/client");
const s = await import("../src/lib/db/schema");
const { eq, and } = await import("drizzle-orm");

async function main() {
  if (!features.twilio()) {
    console.error("Twilio is not configured. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in .env (and remove TELEPHONY_PROVIDER=mock).");
    process.exit(1);
  }
  const e = env();
  if (!e.APP_URL.startsWith("https://")) console.warn(`⚠ APP_URL is ${e.APP_URL}. Twilio needs a public https address to reach this server.`);
  const tel = (await getTelephony()) as import("../src/lib/telephony/twilio").TwilioTelephony;
  const owned = await tel.listOwnedNumbers();
  console.log(`✓ Connected to Twilio (${e.TWILIO_REGION}). Numbers in the account: ${owned.map((n) => n.e164).join(", ") || "none"}`);

  const args = process.argv.slice(2);
  if (args.includes("--import")) {
    const r = await importTwilioNumbers();
    console.log(`✓ Imported ${r.added} number(s) into the pool and pointed their webhooks at ${e.APP_URL}`);
  }
  const buyIdx = args.indexOf("--buy");
  if (buyIdx >= 0) {
    const n = Number(args[buyIdx + 1] ?? "1");
    process.env.NUMBER_POOL_SIZE = String(n);
    console.log(`✓ Bought ${await replenishPool()} number(s)`);
  }
  if (args.includes("--demo")) {
    const result = await withSystem(async (tx) => {
      const [demo] = await tx.select().from(s.companies).where(eq(s.companies.slug, "fjordbyen-ror"));
      if (!demo) throw new Error("Demo company not found – run pnpm db:seed first");
      await tx
        .update(s.phoneNumbers)
        .set({ companyId: null, status: "available", assignedAt: null })
        .where(and(eq(s.phoneNumbers.companyId, demo.id), eq(s.phoneNumbers.provider, "mock")));
      return claimPoolNumber(tx, demo.id, "twilio");
    });
    if (!result) throw new Error("No Twilio number in the pool. Run with --import or --buy 1 first.");
    console.log(`✓ Demo company now answers on ${result.e164} – call it!`);
  }
  await closeDb();
}

main().catch(async (err) => {
  console.error(err);
  await closeDb();
  process.exit(1);
});
