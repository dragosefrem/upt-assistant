import { CampusPage } from "@/components/campus/CampusPage";
import { getLocale, getT } from "@/i18n/server";
import { requireOnboardedUser } from "@/lib/auth";
import { facultyOf } from "@/lib/catalog";
import { parseCampusLink } from "@/lib/campuspath/links";
import { groupRooms } from "@/lib/campuspath/rooms";
import { currentSemester, placeByName, placeResolver, studentWeek } from "@/lib/schedule";

export async function generateMetadata() {
  const t = await getT();
  return { title: t.campus.page.title };
}

/**
 * Campus route planner, classroom directory and UPT 360° walkthroughs. `?from=…&to=…&dest=…` opens a route.
 */
export default async function CampusRoute({ searchParams }: PageProps<"/campus">) {
  const user = await requireOnboardedUser();
  const locale = await getLocale();
  const link = parseCampusLink(await searchParams);
  const semester = currentSemester();
  const place = placeResolver(user.facultyId);
  const faculty = facultyOf(user.facultyId)?.name ?? null;
  const rooms = semester ? groupRooms(studentWeek(user, semester), place, locale) : [];
  return (
    <CampusPage
      // A new address (a link from elsewhere in the app) starts the page over.
      key={[locale, link.from, link.to, link.dest, link.building, link.at, link.date, link.course].join("|")}
      initial={link}
      rooms={rooms}
      faculty={faculty}
      initialPlace={link.building ? placeByName(link.building, user.facultyId) : null}
      hasSemester={!!semester}
      admin={user.role === "admin"}
      mapsKey={process.env.GOOGLE_MAPS_EMBED_KEY?.trim() || null}
    />
  );
}
