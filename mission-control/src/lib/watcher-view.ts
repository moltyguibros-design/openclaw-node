export function watcherViews<T extends { status?: string; ts: string }>(events: T[]) {
  return {
    stream: events.slice(0, 100),
    failures: events
      .filter((e) => e.status === "noop" || e.status === "error")
      .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
      .slice(0, 100),
  };
}
