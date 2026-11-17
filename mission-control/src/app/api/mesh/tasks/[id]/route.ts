import { getTasksKv } from "@/lib/nats";
import { getMeshTask, updateMeshTaskCAS, MeshTaskEditError } from "@/lib/sync/mesh-kv";

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

/**
 * PATCH /api/mesh/tasks/:id — Update a task with CAS (lib/sync/mesh-kv.ts updateMeshTaskCAS).
 *
 * Authority rules:
 * - Only MESH_TASK_EDITABLE_FIELDS may change; lifecycle fields (status, owner,
 *   lease, result, ...) go through the task daemon's RPCs (400 otherwise)
 * - Lead can update any task
 * - Workers can only update tasks they originated (403)
 * - Revision must match (CAS) to prevent stale writes (409 with the current state)
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!(await getTasksKv())) {
    return Response.json({ error: "NATS unavailable" }, { status: 503 });
  }

  const body = await req.json();
  const { revision, ...updates } = body;

  if (!revision) {
    return Response.json({ error: "revision is required for CAS update" }, { status: 400 });
  }

  try {
    await updateMeshTaskCAS(id, updates, revision);
  } catch (err) {
    if (err instanceof MeshTaskEditError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    // Revision mismatch — return current state so client can retry
    const fresh = await getMeshTask(id);
    return Response.json(
      {
        error: `revision mismatch: expected ${revision}, got ${fresh?.revision}`,
        currentTask: fresh?.task ?? null,
        currentRevision: fresh?.revision,
      },
      { status: 409 }
    );
  }

  const updated = await getMeshTask(id);
  return Response.json({ ok: true, task: updated?.task, revision: updated?.revision });
}
