import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { timetablePdfs } from "@/db/schema";
import { requireUser } from "@/lib/auth";

export async function GET(_request: Request, { params }: RouteContext<"/api/timetables/[id]">) {
  await requireUser();
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id < 1) return new Response(null, { status: 404 });
  const pdf = getDb().select().from(timetablePdfs).where(eq(timetablePdfs.sourceId, id)).get();
  if (!pdf) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(pdf.content), { headers: {
    "Content-Type": "application/pdf",
    "Content-Disposition": `inline; filename="timetable-${id}.pdf"`,
    "Cache-Control": "private, no-cache",
    "X-Content-Type-Options": "nosniff",
  } });
}
