import { getDb, schema } from "@/db";

export const dynamic = "force-dynamic";

/** Railway checks the migrated database on the mounted volume before admitting traffic. */
export function GET() {
  try {
    getDb().select({ id: schema.semesters.id }).from(schema.semesters).limit(1).get();
    return new Response(null, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("SQLite readiness check failed", error);
    return new Response(null, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
