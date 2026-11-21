import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { restoreHiddenClass, setContactSharing } from "@/app/(app)/settings/actions";
import { saveCoursesAction } from "@/app/onboarding/actions";
import { getDb } from "@/db";
import { courses, entries, faculties, semesters, userOverrides, users } from "@/db/schema";
import { requireOnboardedUser, requireUser, type User } from "@/lib/auth";

vi.mock("@/lib/auth", { spy: true });
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`Redirect to ${path}`); } }));
process.env.DATABASE_PATH = ":memory:";

let student: User;

beforeAll(() => {
  student = getDb().insert(users).values({
    id: "student", name: "Test Student", email: "s@example.com", passwordHash: "unused", feedToken: "s",
    onboardedAt: "2026-11-21T12:00:00Z",
  }).returning().get();
});

it("persists an explicit sharing choice for the signed-in account", async () => {
  const db = getDb();
  const other = db.insert(users).values({
    id: "colleague", name: "Colleague", email: "colleague@example.com", passwordHash: "unused", feedToken: "colleague",
  }).returning().get();
  const sharesDetails = (id: string) => db.select().from(users).where(eq(users.id, id)).get()!.shareActivityDetails;
  vi.mocked(requireOnboardedUser).mockResolvedValue(student);
  const form = new FormData();
  form.set("userId", other.id);
  form.set("sharing", "availability");
  await setContactSharing(form);
  await setContactSharing(form);
  expect(sharesDetails(student.id)).toBe(false);
  expect(sharesDetails(other.id)).toBe(true);
  form.set("sharing", "unexpected");
  await setContactSharing(form);
  expect(sharesDetails(student.id)).toBe(false);
  form.set("sharing", "details");
  await setContactSharing(form);
  expect(sharesDetails(student.id)).toBe(true);
});

describe("course choices", () => {
  it.each([
    ["/settings#courses", "/settings#courses"],
    ["/guide?tab=first-week#first-week", "/guide?tab=first-week#first-week"],
    ["/", "/"],
    ["https://example.org", "/settings"],
    ["", "/settings"],
  ])("saves the form with return destination %j", async (requested, expected) => {
    vi.mocked(requireUser).mockResolvedValueOnce(student);
    const form = new FormData();
    form.set("returnTo", requested);
    await expect(saveCoursesAction(form)).rejects.toThrow(new Error(`Redirect to ${expected}`));
  });
});

describe("restoring a hidden class", () => {
  it("shows just this student's class again and retains their existing time change", async () => {
    const db = getDb();
    const semester = db.select().from(semesters).where(eq(semesters.isCurrent, true)).get()!;
    const faculty = db.insert(faculties).values({ slug: "test", name: "Test" }).returning().get();
    const course = db.insert(courses).values({ key: "math", name: "Mathematics", facultyId: faculty.id, semesterId: semester.id }).returning().get();
    const entry = db.insert(entries).values({ key: "math-lab", courseId: course.id, semesterId: semester.id, kind: "lab", day: 2, startMin: 480, endMin: 600, rawText: "Math" }).returning().get();
    db.insert(users).values({ id: "other", name: "Other", email: "o@example.com", passwordHash: "unused", feedToken: "o" }).run();
    db.insert(userOverrides).values([
      { userId: student.id, entryId: entry.id, hidden: true, startMin: 510 },
      { userId: "other", entryId: entry.id, hidden: true },
    ]).run();
    vi.mocked(requireOnboardedUser).mockResolvedValue(student);
    await restoreHiddenClass(entry.id);
    await restoreHiddenClass(entry.id);
    expect(db.select().from(userOverrides).where(eq(userOverrides.userId, student.id)).get()).toMatchObject({ hidden: false, startMin: 510 });
    expect(db.select().from(userOverrides).where(eq(userOverrides.userId, "other")).get()?.hidden).toBe(true);
  });
});
