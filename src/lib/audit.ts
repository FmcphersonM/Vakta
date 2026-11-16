import { auditLogs } from "./db/schema";
import type { Tx } from "./db/client";

export type AuditEntry = {
  companyId: string | null;
  userId?: string | null;
  actor?: "user" | "ai" | "system";
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  ip?: string | null;
};

/** Append-only audit trail. Call inside the same transaction as the change. */
export async function audit(tx: Tx, e: AuditEntry) {
  await tx.insert(auditLogs).values({
    companyId: e.companyId,
    userId: e.userId ?? null,
    actor: e.actor ?? "user",
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId,
    metadata: e.metadata ?? {},
    ip: e.ip ?? null,
  });
}
