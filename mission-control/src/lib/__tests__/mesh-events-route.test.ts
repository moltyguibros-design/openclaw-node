import { afterEach, expect, test, vi } from "vitest";
import { KvWatchInclude } from "nats";

const { watch, stop, unsubscribe } = vi.hoisted(() => {
  const stop = vi.fn();
  const unsubscribe = vi.fn();
  const never = () => new Promise<never>(() => {});
  const watch = vi.fn(async (..._args: unknown[]) => ({
    stop,
    async *[Symbol.asyncIterator]() {
      yield { key: "T-1", operation: "DEL", value: new Uint8Array(), revision: 7 };
      await never();
    },
  }));
  return { watch, stop, unsubscribe };
});

vi.mock("@/lib/nats", async () => {
  const { StringCodec } = await vi.importActual<typeof import("nats")>("nats");
  return {
    sc: StringCodec(),
    getNats: async () => ({
      subscribe: () => ({
        unsubscribe,
        async *[Symbol.asyncIterator]() {
          await new Promise<never>(() => {});
        },
      }),
    }),
    getTasksKv: async () => ({ watch }),
  };
});

afterEach(() => {
  watch.mockClear();
  stop.mockClear();
  unsubscribe.mockClear();
});

async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, needle: string, ms: number) {
  const decoder = new TextDecoder();
  const deadline = Date.now() + ms;
  let text = "";
  while (!text.includes(needle) && Date.now() < deadline) {
    const chunk = await Promise.race([
      reader.read(),
      new Promise<null>((r) => setTimeout(() => r(null), deadline - Date.now())),
    ]);
    if (!chunk || chunk.done) break;
    text += decoder.decode(chunk.value);
  }
  return text;
}

// A plain watch() replayed every MESH_TASKS key on each connect, and a DEL (empty value) was labelled PUT and then dropped.
test("the KV half watches updates only and forwards a delete as DEL without the task body", async () => {
  const { GET } = await import("@/app/api/mesh/events/route");
  const res = await GET();
  const reader = res.body!.getReader();

  const text = await readUntil(reader, "kv.task.updated", 500);

  expect(watch).toHaveBeenCalledWith({ include: KvWatchInclude.UpdatesOnly });
  const frame = text.split("\n\n").find((f) => f.startsWith("event: kv.task.updated"));
  expect(frame).toBeDefined();
  expect(JSON.parse(frame!.split("\ndata: ")[1])).toEqual({ key: "T-1", operation: "DEL", revision: 7 });

  await reader.cancel();
  expect(unsubscribe).toHaveBeenCalledTimes(1);
  expect(stop).toHaveBeenCalledTimes(1);
});
