import "server-only";

/** Campus walkthroughs (services/campuspath) for server code. Client code imports ./links and ./types. */
export { planCampusRoute, toCampusAnswer, type CampusRouteAnswer, type CampusRouteStep } from "./assistant";
export {
  buildingPins,
  CampuspathError,
  exampleRoute,
  listClassrooms,
  mediaFile,
  planRoute,
  qrCode,
  searchCheckpoints,
  videoStatus,
} from "./client";
export { campusHref, campusJourneyHref, parseCampusLink, routeLink, routeTitle, sharedHref, type CampusLink } from "./links";
export { mapsDirectionsUrl, mapsEmbedUrl, type TravelMode } from "./maps";
export { campuspathBase, campuspathConfig, CampuspathUnavailable, managesCampuspath } from "./service";
export type * from "./types";
