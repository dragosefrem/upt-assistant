import { after } from "next/server";
import { and, desc, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { scrapeRuns } from "@/db/schema";
import { getUser } from "@/lib/auth";
import { runScrape } from "@/scraper/engine";

const Body = z.object({
  catalog: z.boolean(),
  timetables: z.boolean(),
  exams: z.boolean(),
  facultyIds: z.array(z.number().int()).max(50).optional(),
  dryRun: z.boolean().optional(),
});

async function admin() {
  const user = await getUser();
  return user?.role === "admin" ? user : null;
}

/** Starts a scrape in the background and returns its run id for polling. */
export async function POST(request: Request) {
  const user = await admin();
  if (!user) return Response.json({ error: "Administrators only" }, { status: 403 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  if (!parsed.data.catalog && !parsed.data.timetables && !parsed.data.exams) {
    return Response.json({ error: "Choose at least one thing to scrape." }, { status: 400 });
  }

  const db = getDb();
  // Two runs at once would interleave their replace-and-prune steps.
  const cutoff = new Date(Date.now() - 20 * 60_000).toISOString();
  const active = db.select({ id: scrapeRuns.id }).from(scrapeRuns).where(and(eq(scrapeRuns.status, "running"), gt(scrapeRuns.startedAt, cutoff))).get();
  if (active) return Response.json({ error: "A scrape is already running.", runId: active.id }, { status: 409 });

  // The run row is inserted synchronously before the first network call, so the id is
  // available immediately while the work continues after the response is sent.
  const run = runScrape({ ...parsed.data, triggeredBy: user.email });
  const started = db.select({ id: scrapeRuns.id }).from(scrapeRuns).orderBy(desc(scrapeRuns.id)).limit(1).get();
  after(() => run.catch((err) => console.error("Scrape run crashed", err)));
  return Response.json({ runId: started?.id ?? null });
}

/** Status and log of one run (`?run=`), or the most recent runs. */
export async function GET(request: Request) {
  if (!(await admin())) return Response.json({ error: "Administrators only" }, { status: 403 });
  const db = getDb();
  const id = Number(new URL(request.url).searchParams.get("run"));
  if (id) {
    const run = db.select().from(scrapeRuns).where(eq(scrapeRuns.id, id)).get();
    return run ? Response.json({ run }) : Response.json({ error: "Unknown run" }, { status: 404 });
  }
  return Response.json({ runs: db.select().from(scrapeRuns).orderBy(desc(scrapeRuns.id)).limit(10).all() });
}
