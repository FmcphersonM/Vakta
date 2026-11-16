import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

// Implemented in step 4 (voice agent).
export function handleRelayUpgrade(_req: IncomingMessage, socket: Duplex, _head: Buffer) {
  socket.destroy();
}
