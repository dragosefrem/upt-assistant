import { CampusPage } from "@/components/campus/CampusPage";
import { getLocale, getT } from "@/i18n/server";
import { requireOnboardedUser } from "@/lib/auth";
import { facultyOf } from "@/lib/catalog";
import { parseCampusLink } from "@/lib/campuspath/links";
import { groupRooms } from "@/lib/campuspath/rooms";
import { currentSemester, placeResolver, studentWeek } from "@/lib/schedule";

export async function generateMetadata() {
  const t = await getT();
  return { title: t.campus.page.title };
}

/**
 * Walks on campus through the UPT 360° tour: the student's own rooms first, a planner for any
 * room or place, and the walkthrough video with its steps. `?from=…&to=…&dest=…` opens a route.
 */
export default async function CampusRoute({ searchParams }: PageProps<"/campus">) {
  const user = await requireOnboardedUser();
  const locale = await getLocale();
  const link = parseCampusLink(await searchParams);
  const semester = currentSemester();
  const place = placeResolver(user.facultyId);
  const rooms = semester ? groupRooms(studentWeek(user, semester), place, locale, facultyOf(user.facultyId)?.name ?? null) : [];
  return (
    <CampusPage
      // A new address (a link from elsewhere in the app) starts the page over.
      key={[locale, link.from, link.to, link.dest, link.building, link.at, link.date, link.course].join("|")}
      initial={link}
      rooms={rooms}
      hasSemester={!!semester}
      admin={user.role === "admin"}
      mapsKey={process.env.GOOGLE_MAPS_EMBED_KEY?.trim() || null}
    />
  );
}
