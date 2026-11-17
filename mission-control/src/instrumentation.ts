export async function register() {
  // nats and better-sqlite3 load only in the Node.js runtime, and a build has no bus to follow.
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { startTraceIngest } = await import("./lib/trace-ingest");
  startTraceIngest();
}
