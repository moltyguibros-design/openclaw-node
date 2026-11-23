import { afterEach, describe, expect, it, vi } from "vitest";
import { mutate } from "swr";

vi.mock("swr", () => ({ default: vi.fn(), mutate: vi.fn(async () => undefined) }));

import {
  addClusterMember,
  createCluster,
  createDependency,
  createMeshTask,
  createProject,
  createTask,
  deleteCluster,
  deleteTask,
  dispatchCollabTask,
  interveneSession,
  removeClusterMember,
  updateMeshTask,
  updateTask,
} from "../hooks";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(mutate).mockClear();
});

const matchers = () =>
  vi.mocked(mutate).mock.calls.map(([key]) => key).filter((key): key is (k: unknown) => boolean => typeof key === "function");

const reply = (body: unknown, status: number) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));

it("rejects with the route's error on a non-2xx reply, so the session card can show it", async () => {
  vi.stubGlobal("fetch", reply({ error: "NATS unavailable" }, 503));
  await expect(interveneSession({ action: "abort", sessionId: "s1" })).rejects.toThrow("NATS unavailable");
});

it("resolves the body on success", async () => {
  vi.stubGlobal("fetch", reply({ ok: true, action: "aborted" }, 200));
  await expect(interveneSession({ action: "abort", sessionId: "s1" })).resolves.toEqual({
    ok: true,
    action: "aborted",
  });
});

const raw = (body: string, status: number) => vi.fn(async () => new Response(body, { status }));

const refusable: Array<[string, () => Promise<unknown>]> = [
  ["createTask", () => createTask({ title: "x" })],
  ["updateTask", () => updateTask("t1", { title: "x" })],
  ["deleteTask", () => deleteTask("t1")],
  ["createProject", () => createProject({ id: "p", title: "p" })],
  ["createDependency", () => createDependency({ sourceId: "a", targetId: "b" })],
  ["createCluster", () => createCluster({ name: "c" })],
  ["deleteCluster", () => deleteCluster("c")],
  ["addClusterMember", () => addClusterMember("c", "n")],
  ["removeClusterMember", () => removeClusterMember("c", "n")],
  ["dispatchCollabTask", () => dispatchCollabTask({ title: "x" })],
  ["createMeshTask", () => createMeshTask({ title: "x" })],
  ["updateMeshTask", () => updateMeshTask("m1", { title: "x" })],
];

describe("mutation helpers reject a refused write instead of resolving the error body", () => {
  it.each(refusable)("%s rejects with the route's error", async (_name, call) => {
    vi.stubGlobal("fetch", reply({ error: "exists" }, 409));
    await expect(call()).rejects.toThrow("exists");
  });

  it.each(refusable)("%s rejects with the status when the body is not JSON", async (_name, call) => {
    vi.stubGlobal("fetch", raw("<html>Bad Gateway</html>", 502));
    await expect(call()).rejects.toThrow("HTTP 502");
  });

  it("still revalidates the cache when the write is refused, so the UI snaps back", async () => {
    vi.mocked(mutate).mockClear();
    vi.stubGlobal("fetch", reply({ error: "Task not found" }, 404));
    await expect(updateTask("t1", { kanbanColumn: "done" })).rejects.toThrow("Task not found");
    expect(mutate).toHaveBeenCalledWith("/api/tasks");
  });

  it("resolves the body on success", async () => {
    vi.stubGlobal("fetch", reply({ id: "x" }, 201));
    await expect(createTask({ title: "x" })).resolves.toEqual({ id: "x" });
  });
});

it("revalidates every keyed variant of the session list, not a bare key no hook uses", async () => {
  vi.stubGlobal("fetch", reply({ ok: true, action: "aborted" }, 200));
  await interveneSession({ action: "abort", sessionId: "s1" });
  const calls = vi.mocked(mutate).mock.calls.map(([key]) => key);
  expect(calls).not.toContain("/api/cowork/sessions");
  const sessions = matchers().find((m) => m("/api/cowork/sessions?status=recruiting,active"));
  expect(sessions?.("/api/cowork/sessions?status=converged,completed,aborted&limit=8")).toBe(true);
  expect(sessions?.("/api/tasks")).toBe(false);
});

it("dispatchCollabTask revalidates the keyed session list", async () => {
  vi.stubGlobal("fetch", reply({ ok: true }, 200));
  await dispatchCollabTask({ title: "t" });
  expect(vi.mocked(mutate).mock.calls.map(([key]) => key)).not.toContain("/api/cowork/sessions");
  expect(matchers().some((m) => m("/api/cowork/sessions?status=recruiting,active"))).toBe(true);
});
