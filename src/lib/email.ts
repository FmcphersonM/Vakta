import nodemailer from "nodemailer";
import { eq } from "drizzle-orm";
import { getDb } from "./db/client";
import { emailOutbox } from "./db/schema";
import { env, features } from "./env";

/**
 * Sends a plain-text e-mail through SMTP when configured; otherwise the message
 * is stored in email_outbox and printed to the server log (development).
 */
export async function sendEmail(msg: { to: string; subject: string; text: string }) {
  const db = getDb();
  const [row] = await db.insert(emailOutbox).values({ toEmail: msg.to, subject: msg.subject, bodyText: msg.text }).returning();
  if (!features.email()) {
    console.log(`[email:not-sent] to=${msg.to} subject="${msg.subject}"\n${msg.text}`);
    await db.update(emailOutbox).set({ status: "logged" }).where(eq(emailOutbox.id, row.id));
    return;
  }
  try {
    const transport = nodemailer.createTransport(env().SMTP_URL);
    await transport.sendMail({ from: env().EMAIL_FROM, to: msg.to, subject: msg.subject, text: msg.text });
    await db.update(emailOutbox).set({ status: "sent", sentAt: new Date() }).where(eq(emailOutbox.id, row.id));
  } catch (e) {
    await db.update(emailOutbox).set({ status: "failed", error: String(e) }).where(eq(emailOutbox.id, row.id));
    throw e;
  }
}
