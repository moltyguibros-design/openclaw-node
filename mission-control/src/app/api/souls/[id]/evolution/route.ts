import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { soulEvolutionLog } from "@/lib/db/schema";
import { and, eq, desc } from "drizzle-orm";
import fs from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { isSafeId } from "@/lib/safe-path";
import { SOULS_DIR } from "@/lib/config";

const execFileAsync = promisify(execFile);

interface EvolutionEvent {
  eventId: string;
  soulId: string;
  category: string;
  trigger: string;
  summary: string;
  proposedChange: {
    target: string;
    action: string;
    content?: Record<string, unknown>;
  };
  reviewStatus: string;
}

async function readJson(file: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf-8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

// What a soul may record is set in the registry (evolutionEnabled) and in its
// capabilities.json (evolutionConfig.captureTypes; absent means any category).
async function captureRefusal(soulId: string, category: unknown): Promise<NextResponse | null> {
  const registry = (await readJson(path.join(SOULS_DIR, "registry.json"))) as
    { souls?: Array<{ id: string; evolutionEnabled?: boolean }> } | null;
  const soul = registry?.souls?.find((s) => s.id === soulId);
  if (!soul) {
    return NextResponse.json({ error: "Soul not found" }, { status: 404 });
  }
  if (soul.evolutionEnabled === false) {
    return NextResponse.json({ error: `evolution is disabled for ${soulId}` }, { status: 409 });
  }
  const capabilities = (await readJson(path.join(SOULS_DIR, soulId, "capabilities.json"))) as
    { evolutionConfig?: { captureTypes?: unknown } } | null;
  const captureTypes = capabilities?.evolutionConfig?.captureTypes;
  if (Array.isArray(captureTypes) && !captureTypes.includes(category)) {
    return NextResponse.json(
      { error: `category must be one of: ${captureTypes.join(", ")}` },
      { status: 400 }
    );
  }
  return null;
}

// GET /api/souls/:id/evolution - Get evolution events for a soul
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: soulId } = await params;
    if (!isSafeId(soulId)) {
      return NextResponse.json({ error: "invalid soul id" }, { status: 400 });
    }
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || "pending";

    const db = getDb();

    const events = await db
      .select()
      .from(soulEvolutionLog)
      .where(eq(soulEvolutionLog.soulId, soulId))
      .orderBy(desc(soulEvolutionLog.timestamp));

    // If status filter requested
    const filtered =
      status === "all"
        ? events
        : events.filter((e) => e.reviewStatus === status);

    // Load full event details from events.jsonl
    const eventsPath = path.join(
      SOULS_DIR,
      soulId,
      "evolution",
      "events.jsonl"
    );

    let fullEvents: EvolutionEvent[] = [];
    try {
      const content = await fs.readFile(eventsPath, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);
      fullEvents = lines.map((line) => JSON.parse(line));
    } catch {
      // events.jsonl might be empty or not exist yet
    }

    // Merge DB records with full event details
    const merged = filtered.map((dbEvent) => {
      const fullEvent = fullEvents.find((e) => e.eventId === dbEvent.eventId);
      return {
        ...dbEvent,
        proposedChange: fullEvent?.proposedChange,
        category: fullEvent?.category,
        trigger: fullEvent?.trigger,
      };
    });

    return NextResponse.json(merged);
  } catch (error) {
    console.error("Failed to load evolution events:", error);
    return NextResponse.json(
      { error: "Failed to load evolution events" },
      { status: 500 }
    );
  }
}

// POST /api/souls/:id/evolution - Create new evolution event (used by souls)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: soulId } = await params;
    if (!isSafeId(soulId)) {
      return NextResponse.json({ error: "invalid soul id" }, { status: 400 });
    }
    const body = await request.json();
    const { eventId, category, summary, proposedChange } = body ?? {};
    const nonEmpty = (v: unknown) => typeof v === "string" && v.trim() !== "";
    const isObject = proposedChange !== null && typeof proposedChange === "object" && !Array.isArray(proposedChange);
    // approve can only find a safe eventId, and the row's NOT NULL columns
    // would otherwise fail after the line was written.
    if (!isSafeId(eventId) || !nonEmpty(category) || !nonEmpty(summary) || !isObject) {
      return NextResponse.json(
        { error: "eventId (letters, digits, . _ -), category, summary and a proposedChange object are required" },
        { status: 400 }
      );
    }
    const refusal = await captureRefusal(soulId, category);
    if (refusal) return refusal;

    const db = getDb();
    const existing = db
      .select({ id: soulEvolutionLog.id })
      .from(soulEvolutionLog)
      .where(eq(soulEvolutionLog.eventId, eventId))
      .get();
    if (existing) {
      return NextResponse.json({ error: `event ${eventId} already exists` }, { status: 409 });
    }

    // Approval only happens through PATCH, so a new event is always pending.
    const event = { ...body, soulId, reviewStatus: "pending" };
    await db.insert(soulEvolutionLog).values({
      soulId,
      eventId,
      eventType: category,
      description: summary,
      reviewStatus: "pending",
    });

    // The row goes first: approve reads the first matching line, so a line
    // without a row would shadow a corrected retry.
    const eventsPath = path.join(SOULS_DIR, soulId, "evolution", "events.jsonl");
    try {
      await fs.mkdir(path.dirname(eventsPath), { recursive: true });
      await fs.appendFile(eventsPath, JSON.stringify(event) + "\n");
    } catch (appendError) {
      await db.delete(soulEvolutionLog).where(eq(soulEvolutionLog.eventId, eventId));
      throw appendError;
    }

    return NextResponse.json({ success: true, eventId });
  } catch (error) {
    console.error("Failed to create evolution event:", error);
    return NextResponse.json(
      { error: "Failed to create evolution event" },
      { status: 500 }
    );
  }
}

// PATCH /api/souls/:id/evolution?eventId=<id> - Approve/reject evolution
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: soulId } = await params;
    if (!isSafeId(soulId)) {
      return NextResponse.json({ error: "invalid soul id" }, { status: 400 });
    }
    const { searchParams } = new URL(request.url);
    const eventId = searchParams.get("eventId");

    if (!eventId || !isSafeId(eventId)) {
      return NextResponse.json(
        { error: "Event ID required" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { action, reviewedBy } = body;
    if (action !== "approve" && action !== "reject") {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    const db = getDb();

    // Only a pending event of this soul is reviewed, and only once: approve
    // is the only path that changes genes.json, and a reviewed row never
    // changes again.
    const thisEvent = and(eq(soulEvolutionLog.eventId, eventId), eq(soulEvolutionLog.soulId, soulId));
    const [row] = await db.select().from(soulEvolutionLog).where(thisEvent);
    if (!row) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }
    if (row.reviewStatus !== "pending") {
      return NextResponse.json(
        { error: `event is ${row.reviewStatus}, not pending` },
        { status: 409 }
      );
    }

    if (action === "approve") {
      // Load full event from events.jsonl
      const eventsPath = path.join(
        SOULS_DIR,
        soulId,
        "evolution",
        "events.jsonl"
      );
      const content = await fs.readFile(eventsPath, "utf-8");
      const events = content
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      const event = events.find((e: EvolutionEvent) => e.eventId === eventId);

      if (!event) {
        return NextResponse.json({ error: "Event not found" }, { status: 404 });
      }

      // The event's proposedChange.target came from events.jsonl, which any
      // unauthenticated POST above could append to; joined raw it was an
      // arbitrary-JSON-rewrite primitive (review C-8). genes.json is the only
      // target this code knows how to apply, so it is the only one allowed.
      if (event.proposedChange?.target !== "genes.json") {
        return NextResponse.json(
          { error: "unsupported proposedChange.target (only genes.json can be applied)" },
          { status: 400 }
        );
      }
      // Any other action changed nothing and then failed at `git commit`
      // (nothing to commit), leaving the repo on the evolution branch.
      if (event.proposedChange.action !== "add") {
        return NextResponse.json(
          { error: "unsupported proposedChange.action (only add can be applied)" },
          { status: 400 }
        );
      }

      // Every approval is a commit in the souls repo (the installer git-inits
      // it). Without one there is no history to apply into, so refuse before
      // anything is written.
      const gitOpts = { cwd: SOULS_DIR };
      const git = async (...args: string[]) =>
        (await execFileAsync("git", args, gitOpts)).stdout.trim();
      let baseBranch: string;
      try {
        const top = await git("rev-parse", "--show-toplevel");
        if ((await fs.realpath(top)) !== (await fs.realpath(SOULS_DIR))) throw new Error("not the repo root");
        baseBranch = await git("rev-parse", "--abbrev-ref", "HEAD");
      } catch {
        return NextResponse.json(
          { error: `${SOULS_DIR} is not a git repository; re-run the installer, which initializes it` },
          { status: 409 }
        );
      }
      if (baseBranch === "HEAD") {
        return NextResponse.json(
          { error: `${SOULS_DIR} is on a detached HEAD; check out a branch first` },
          { status: 409 }
        );
      }

      // Git commit — use execFile with argument arrays to prevent command injection.
      // Sanitize all user-derived inputs: eventId, soulId, reviewedBy, event.summary
      // could all contain shell metacharacters if crafted maliciously.
      const safeBranch = `evolution/${eventId.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const commitMessage = [
        `evolution(${eventId}): ${event.summary}`,
        "",
        `Event-ID: ${eventId}`,
        `Soul-ID: ${soulId}`,
        `Reviewer: ${reviewedBy}`,
      ].join("\n");
      const targetPath = path.join(SOULS_DIR, soulId, "evolution", "genes.json");
      // A soul's first approved gene creates its genes.json.
      let original: string | null = null;
      try {
        original = await fs.readFile(targetPath, "utf-8");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }

      let branchCreated = false;
      let commitHash: string;
      try {
        await git("checkout", "-b", safeBranch);
        branchCreated = true;
        const existing = original === null ? { version: "1.0.0", genes: [] } : JSON.parse(original);
        existing.genes.push(event.proposedChange.content);
        await fs.writeFile(targetPath, JSON.stringify(existing, null, 2));
        await git("add", `${soulId}/evolution/genes.json`);
        await git("commit", "-m", commitMessage);
        await git("checkout", baseBranch);
        await git("merge", "--ff-only", safeBranch);
        await git("branch", "-d", safeBranch);
        commitHash = await git("rev-parse", "HEAD");
      } catch (gitError) {
        console.error("Git operation failed:", gitError);
        // Undo in this order: back on the base branch (an uncommitted gene
        // rides along, a committed one stays on the branch), then the file as
        // it was and its index entry, then the branch.
        try {
          if ((await git("rev-parse", "--abbrev-ref", "HEAD")) !== baseBranch) await git("checkout", baseBranch);
          if (original === null) await fs.rm(targetPath, { force: true });
          else await fs.writeFile(targetPath, original);
          await git("reset", "-q", "--", `${soulId}/evolution/genes.json`);
          if (branchCreated) await git("branch", "-D", safeBranch);
        } catch (rollbackError) {
          console.error("Evolution rollback failed:", rollbackError);
          return NextResponse.json(
            { error: `Git operation failed and the rollback did too; check ${SOULS_DIR} (branch ${safeBranch})` },
            { status: 500 }
          );
        }
        return NextResponse.json(
          { error: "Git operation failed; genes.json was restored" },
          { status: 500 }
        );
      }

      await db
        .update(soulEvolutionLog)
        .set({
          reviewStatus: "approved",
          commitHash,
          reviewedBy,
          reviewedAt: new Date().toISOString(),
        })
        .where(thisEvent);

      return NextResponse.json({ success: true, commitHash });
    }

    await db
      .update(soulEvolutionLog)
      .set({
        reviewStatus: "rejected",
        reviewedBy,
        reviewedAt: new Date().toISOString(),
      })
      .where(thisEvent);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to review evolution:", error);
    return NextResponse.json(
      { error: "Failed to review evolution" },
      { status: 500 }
    );
  }
}
