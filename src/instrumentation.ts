export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build") {
    const { startUptEventSync } = await import("./scraper/upt-event-sync");
    startUptEventSync();
  }
}
