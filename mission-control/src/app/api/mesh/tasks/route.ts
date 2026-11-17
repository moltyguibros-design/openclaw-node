import { getNats, getTasksKv } from "@/lib/nats";
import { listMeshTasks } from "@/lib/sync/mesh-kv";
import { isSafeId } from "@/lib/safe-path";
import { requestDaemon } from "@/lib/mesh-request";
import crypto from "crypto";

export const dynamic = "force-dynamic";

/**
 * GET /api/mesh/tasks — List all tasks from NATS KV.
 * Available on all nodes (read from shared KV).
 */
export async function GET() {
  if (!(await getTasksKv())) {
    return Response.json({ tasks: [], natsAvailable: false });
  }

  const tasks = await listMeshTasks();
  tasks.sort((a, b) => {
    if ((b.priority || 0) !== (a.priority || 0)) return (b.priority || 0) - (a.priority || 0);
    return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
  });

  return Response.json({ tasks, natsAvailable: true });
}

/** The fields a proposer sets; the daemon owns the rest (status, owner, lease, plan linkage). */
const SUBMIT_FIELDS = [
  "description", "priority", "budget_minutes", "metric", "success_criteria",
  "scope", "tags", "preferred_nodes", "exclude_nodes",
] as const;

/**
 * POST /api/mesh/tasks — Submit a new task through the task daemon (mesh.tasks.submit).
 *
 * The daemon creates it, so its checks hold here too: an existing task_id, a
 * daemon-owned field and a refused metric are all refused, never overwritten.
 */
export async function POST(req: Request) {
  const body = await req.json();
  if (!body.title) {
    return Response.json({ error: "title is required" }, { status: 400 });
  }

  const suffix = crypto.randomBytes(3).toString("hex");
  const now = new Date();
  const dateStr =
    now.getFullYear().toString() +
    (now.getMonth() + 1).toString().padStart(2, "0") +
    now.getDate().toString().padStart(2, "0");
  const taskId = body.task_id ?? `T-${dateStr}-${suffix}`;
  if (!isSafeId(taskId)) {
    return Response.json({ error: "task_id must be letters, digits, '.', '_' or '-'" }, { status: 400 });
  }

  const submission: Record<string, unknown> = { task_id: taskId, title: body.title };
  for (const key of SUBMIT_FIELDS) if (body[key] !== undefined) submission[key] = body[key];

  const outcome = await requestDaemon(await getNats(), "mesh.tasks.submit", () => submission);
  if (!outcome.ok) {
    return Response.json({ error: outcome.error }, { status: outcome.code === "TASK_EXISTS" ? 409 : outcome.status });
  }
  return Response.json({ ok: true, task: outcome.reply.data }, { status: 201 });
}
