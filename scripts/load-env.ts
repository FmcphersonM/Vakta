import { existsSync } from "node:fs";
import path from "node:path";

/** Loads .env for scripts run outside Next.js (Node 22 has a built-in loader). */
export function loadEnvFile() {
  const file = path.resolve(import.meta.dirname, "../.env");
  if (existsSync(file)) process.loadEnvFile(file);
}
