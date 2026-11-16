/** Run one background job by hand:  pnpm cron retention */
import { loadEnvFile } from "./load-env";
loadEnvFile();
const { runJob, JOBS } = await import("../src/lib/jobs");
const { closeDb } = await import("../src/lib/db/client");
const name = process.argv[2] as keyof typeof JOBS;
if (!name || !(name in JOBS)) {
  console.error(`Usage: pnpm cron <${Object.keys(JOBS).join("|")}>`);
  process.exit(1);
}
console.log(name, JSON.stringify(await runJob(name)));
await closeDb();
