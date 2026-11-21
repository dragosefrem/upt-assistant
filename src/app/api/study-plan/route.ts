import { z } from "zod";
import { getLocale, getT } from "@/i18n/server";
import { getUser } from "@/lib/auth";
import { clearStudyPlan, proposeStudyPlan, saveStudyPlan, studyBlocks, upcomingExams, type StudyRequest } from "@/lib/study-plan";

const Options = z.object({
  hoursPerExam: z.number().min(2).max(40).optional(),
  maxPerDay: z.number().int().min(1).max(4).optional(),
  restOnSunday: z.boolean().optional(),
  save: z.boolean().optional(),
});

function describe(userRequest: StudyRequest, user: Parameters<typeof proposeStudyPlan>[0]) {
  const plan = proposeStudyPlan(user, userRequest);
  return {
    sessionMinutes: plan.sessionMinutes,
    exams: plan.exams.map((x) => ({
      key: x.key,
      course: x.course,
      date: x.date,
      startMin: x.startMin,
      alsoOn: x.alsoOn ?? [],
      sessions: plan.sessions.filter((s) => s.examKey === x.key).map((s) => ({ date: s.date, startMin: s.startMin, endMin: s.endMin, review: s.review })),
      short: plan.short.find((s) => s.examKey === x.key) ?? null,
    })),
    plan,
  };
}

/** What the exams page needs to offer a plan: the exams known so far and the blocks already saved. */
export async function GET() {
  const user = await getUser();
  if (!user) return Response.json({ error: (await getT()).common.status.notSignedIn }, { status: 401 });
  return Response.json({ exams: upcomingExams(user).length, saved: studyBlocks(user.id).length });
}

/** Proposes a plan with the given options; with `save: true` also writes it to the calendar. */
export async function POST(request: Request) {
  const t = await getT();
  const user = await getUser();
  if (!user) return Response.json({ error: t.common.status.notSignedIn }, { status: 401 });
  const parsed = Options.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: t.study.plan.card.failed }, { status: 400 });
  const { save, ...options } = parsed.data;
  const { plan, ...view } = describe(options, user);
  const saved = save ? saveStudyPlan(user.id, plan.sessions, user.locale ?? (await getLocale())) : studyBlocks(user.id).length;
  return Response.json({ ...view, saved, justSaved: !!save });
}

export async function DELETE() {
  const user = await getUser();
  if (!user) return Response.json({ error: (await getT()).common.status.notSignedIn }, { status: 401 });
  return Response.json({ removed: clearStudyPlan(user.id) });
}
