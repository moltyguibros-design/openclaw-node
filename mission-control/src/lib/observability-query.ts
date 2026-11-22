export const MAX_EVENTS = 1000;

export function eventsUrl(limit: number, level: string, module: string): string {
  const p = new URLSearchParams({ hours: "24", limit: String(limit) });
  if (level === "error") p.set("error", "true");
  if (module !== "all") p.set("module", module);
  return `/api/observability/events?${p}`;
}
