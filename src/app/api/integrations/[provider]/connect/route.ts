import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/current";
import { features } from "@/lib/env";
import { signToken } from "@/lib/crypto";
import { providers } from "@/lib/calendar/providers";

/** Starts "connect my calendar": sends the user to Google / Microsoft. */
export async function GET(_req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const cur = await getCurrentSession();
  if (!cur || cur.session.mfaPending || !cur.session.companyId) return NextResponse.redirect(new URL("/login", _req.url));
  if (provider !== "google" && provider !== "microsoft") return new NextResponse("Unknown provider", { status: 404 });
  if (!(provider === "google" ? features.google() : features.microsoft())) return new NextResponse("Not configured", { status: 503 });
  // Signed state binds the callback to this user + company and expires in 10 min (CSRF protection).
  const state = signToken({ u: cur.user.id, c: cur.session.companyId, p: provider }, 600);
  return NextResponse.redirect(providers[provider].authUrl(state));
}
