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
  // The building a link names is the one this student's timetable gives the room, with what
  // is known about it: whether a rule placed the room there or it is only a guess.
  const own = link.to ? place(link.to) : null;
  let timetablePlace = own?.guessed ? null : own;
  if (link.building && link.building !== timetablePlace?.name) timetablePlace = placeByName(link.building, user.facultyId);
  const rooms = semester ? groupRooms(studentWeek(user, semester), place, locale) : [];
  return (
    <CampusPage
      // A new address (a link from elsewhere in the app) starts the page over.
      key={[locale, link.from, link.to, link.dest, link.building, link.at, link.date, link.course].join("|")}
      initial={link}
      timetablePlace={timetablePlace}
      rooms={rooms}
      faculty={faculty}
      hasSemester={!!semester}
      admin={user.role === "admin"}
      mapsKey={process.env.GOOGLE_MAPS_EMBED_KEY?.trim() || null}
    />
  );
}
