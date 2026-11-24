import { getNats, getTasksKv } from "@/lib/nats";
import { getMeshTask } from "@/lib/sync/mesh-kv";
import { signOperatorRequest } from "@/lib/mesh-sign";
import { requestDaemon } from "@/lib/mesh-request";
import { isSafeId } from "@/lib/safe-path";

export const dynamic = "force-dynamic";

/**
 * GET /api/mesh/tasks/:id — Get a single task from KV.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!(await getTasksKv())) {
    return Response.json({ error: "NATS unavailable" }, { status: 503 });
  }

  const found = await getMeshTask(id);
  if (!found) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  return Response.json(found);
}

const STATUS_BY_CODE: Record<string, number> = { TASK_NOT_FOUND: 404, TASK_TERMINAL: 409, INVALID_UPDATE: 400 };

/**
 * PATCH /api/mesh/tasks/:id — Edit a live task through the task daemon
 * (mesh.tasks.update, a signed operator action).
 *
 * The editable fields are the daemon's one list (lib/mesh-tasks.js
 * EDITABLE_TASK_FIELDS): a body naming any other field is refused whole (400),
 * a task that has ended cannot be edited, and the daemon applies the edit with
 * its own CAS. Status, owner, result, plan linkage and review stay daemon-owned.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!isSafeId(id)) {
    return Response.json({ error: "invalid task id" }, { status: 400 });
  }
  const updates = await req.json();

  const outcome = await requestDaemon(await getNats(), "mesh.tasks.update", () =>
    signOperatorRequest({ ...updates, task_id: id })
  );
  if (!outcome.ok) {
    return Response.json({ error: outcome.error }, { status: (outcome.code && STATUS_BY_CODE[outcome.code]) || outcome.status });
  }
  return Response.json({ ok: true, task: outcome.reply.data });
}
