/**
 * Vakta server: serves the Next.js dashboard and accepts the real-time voice
 * WebSocket from Twilio ConversationRelay on the same port.
 *   pnpm dev    → development
 *   pnpm start  → production (after `pnpm build`)
 */
import { createServer } from "node:http";
import next from "next";
import { loadEnvFile } from "./scripts/load-env";

loadEnvFile();

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.HOST ?? "0.0.0.0";

async function main() {
  const app = next({ dev, hostname, port });
  const handle = app.getRequestHandler();
  await app.prepare();
  const nextUpgrade = app.getUpgradeHandler();

  const server = createServer((req, res) => {
    void handle(req, res);
  });

  server.on("upgrade", (req, socket, head) => {
    const { pathname } = new URL(req.url ?? "/", "http://localhost");
    if (pathname === "/api/voice/relay") {
      import("./src/voice/relay")
        .then((m) => m.handleRelayUpgrade(req, socket, head))
        .catch((err) => {
          console.error("[voice] upgrade failed", err);
          socket.destroy();
        });
      return;
    }
    void nextUpgrade(req, socket, head);
  });

  // Background jobs (calendar sync, retention) run in-process unless disabled.
  if (process.env.DISABLE_INPROCESS_CRON !== "1") {
    import("./src/lib/jobs/scheduler").then((m) => m.startScheduler()).catch((e) => console.error("[cron]", e));
  }

  server.listen(port, hostname, () => {
    console.log(`> Vakta ready on http://localhost:${port} (${dev ? "development" : "production"})`);
  });

  const shutdown = () => {
    server.close();
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
