export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build"
      && process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    const { startGoogleCalendarWorker } = await import("./lib/google-worker");
    startGoogleCalendarWorker();
  }
}
