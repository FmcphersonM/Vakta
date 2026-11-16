import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/current";
import { calendarEvents } from "@/lib/queries/calendar";

export async function GET(req: Request) {
  const cur = await getCurrentSession();
  if (!cur || cur.session.mfaPending || !cur.session.companyId) return new NextResponse("Unauthorized", { status: 401 });
  const url = new URL(req.url);
  const start = new Date(url.searchParams.get("start") ?? "");
  const end = new Date(url.searchParams.get("end") ?? "");
  if (isNaN(+start) || isNaN(+end) || +end - +start > 62 * 86400_000) return new NextResponse("Bad range", { status: 400 });
  const { appts, busy } = await calendarEvents(cur.session.companyId, start, end);
  return NextResponse.json({
    events: appts.map((a) => ({
      id: a.id,
      title: a.customerName ? `${a.customerName} – ${a.title.replace(/^Befaring: /, "")}` : a.title,
      start: a.startsAt.toISOString(),
      end: a.endsAt.toISOString(),
      backgroundColor: a.status === "scheduled" ? (a.color ?? "#2f9195") : "#94a3b8",
      editable: a.status === "scheduled",
      extendedProps: {
        kind: "appointment",
        status: a.status,
        address: a.address,
        customerName: a.customerName,
        customerPhone: a.customerPhone,
        notes: a.notes,
        leadId: a.leadId,
        assignedUserId: a.assignedUserId,
        assignedName: a.assignedName,
        rawTitle: a.title,
        createdBy: a.createdBy,
      },
    })),
    busy: busy.map((b) => ({
      id: `busy-${b.id}`,
      start: b.startsAt.toISOString(),
      end: b.endsAt.toISOString(),
      display: "background",
      extendedProps: { kind: "busy", assignedUserId: b.userId },
    })),
  });
}
