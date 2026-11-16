import { JOBS, runJob, type JobName } from "./index";

/** In-process scheduler. Safe with several instances (each job takes a DB lock). */
export function startScheduler() {
  for (const name of Object.keys(JOBS) as JobName[]) {
    const tick = () =>
      runJob(name)
        .then((r) => r !== "skipped" && process.env.NODE_ENV !== "production" && console.log(`[jobs] ${name}:`, JSON.stringify(r)))
        .catch((e) => console.error(`[jobs] ${name} failed`, e));
    // Stagger the first run so startup stays fast.
    setTimeout(tick, 30_000 + Math.random() * 30_000).unref();
    setInterval(tick, JOBS[name].everyMs).unref();
  }
}
