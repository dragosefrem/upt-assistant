import { getUser } from "@/lib/auth";
import { planTrip } from "@/lib/directions";
import { placeResolver } from "@/lib/schedule";

/** Travel suggestions from a position to the building that holds a room. */
export async function GET(request: Request) {
  const user = await getUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  const url = new URL(request.url);
  const lat = Number(url.searchParams.get("lat"));
  const lng = Number(url.searchParams.get("lng"));
  const room = url.searchParams.get("room");
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return Response.json({ error: "Invalid position" }, { status: 400 });
  }
  const place = placeResolver(user.facultyId)(room);
  if (!place) return Response.json({ error: "No known location for this room" }, { status: 404 });
  return Response.json({ place, trip: planTrip({ lat, lng }, place) });
}
