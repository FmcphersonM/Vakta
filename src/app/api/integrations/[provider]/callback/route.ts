import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/current";
import { verifyToken } from "@/lib/crypto";
import { env } from "@/lib/env";
import { providers } from "@/lib/calendar/providers";
import { saveConnection } from "@/lib/calendar/sync";
import { withTenant } from "@/lib/db/client";
import { audit } from "@/lib/audit";

export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const url = new URL(req.url);
  const back = (q: string) => NextResponse.redirect(`${env().APP_URL}/settings/calendar?${q}`);
  if (provider !== "google" && provider !== "microsoft") return back("error=provider");
  const state = verifyToken<{ u: string; c: string; p: string }>(url.searchParams.get("state"));
  const cur = await getCurrentSession();
  if (!state || state.p !== provider || !cur || cur.user.id !== state.u || cur.session.companyId !== state.c) return back("error=state");
  const code = url.searchParams.get("code");
  if (!code) return back("error=denied");
  try {
    const t = await providers[provider].exchange(code);
    await saveConnection({ companyId: state.c, userId: state.u, provider, email: t.email ?? null, accessToken: t.accessToken, refreshToken: t.refreshToken, expiresAt: t.expiresAt });
    await withTenant(state.c, (tx) => audit(tx, { companyId: state.c, userId: state.u, action: `calendar.connected.${provider}` }));
    return back(`connected=${provider}`);
  } catch (e) {
    console.error("[calendar] oauth callback failed", e);
    return back("error=exchange");
  }
}
