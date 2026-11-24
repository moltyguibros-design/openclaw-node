import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { isSafeId } from "@/lib/safe-path";
import { SOULS_DIR } from "@/lib/config";

const REGISTRY_PATH = path.join(SOULS_DIR, "registry.json");

interface Soul {
  id: string;
  type: string;
  basePath: string;
  capabilities: {
    skills: string[];
    tools: string[];
    mcpServers: string[];
  };
  specializations: string[];
  evolutionEnabled: boolean;
  parentSoul: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SoulRegistry {
  version: string;
  souls: Soul[];
}

async function loadRegistry(): Promise<SoulRegistry> {
  let content: string;
  try {
    content = await fs.readFile(REGISTRY_PATH, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { version: "1.0.0", souls: [] };
    throw err;
  }
  // A corrupt registry must fail the request: read as empty, POST would overwrite it with one soul.
  return JSON.parse(content);
}

async function writeAtomic(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmp, content);
  await fs.rename(tmp, file);
}

async function saveRegistry(registry: SoulRegistry): Promise<void> {
  await writeAtomic(REGISTRY_PATH, JSON.stringify(registry, null, 2));
}

// souls/sync-registry.js rebuilds registry.json from each soul's
// capabilities.json and drops a soul that has none, so every capability
// change made here lands there too. Other keys (permissions) are kept.
async function saveCapabilities(id: string, capabilities: Partial<Soul["capabilities"]> | undefined): Promise<void> {
  const file = path.join(SOULS_DIR, id, "capabilities.json");
  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(await fs.readFile(file, "utf-8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  const pick = (key: keyof Soul["capabilities"]) => {
    const given = capabilities?.[key];
    const kept = existing[key];
    return Array.isArray(given) ? given : Array.isArray(kept) ? kept : [];
  };
  const next = { ...existing, skills: pick("skills"), tools: pick("tools"), mcpServers: pick("mcpServers") };
  await writeAtomic(file, JSON.stringify(next, null, 2) + "\n");
}

// GET /api/souls - List all souls
// GET /api/souls?id=soul-id - Get specific soul
export async function GET(request: NextRequest) {
  try {
    const registry = await loadRegistry();
    const { searchParams } = new URL(request.url);
    const soulId = searchParams.get("id");

    if (soulId) {
      const soul = registry.souls.find((s) => s.id === soulId);
      if (!soul) {
        return NextResponse.json({ error: "Soul not found" }, { status: 404 });
      }
      return NextResponse.json(soul);
    }

    return NextResponse.json(registry.souls);
  } catch (error) {
    console.error("Failed to load souls:", error);
    return NextResponse.json(
      { error: "Failed to load souls" },
      { status: 500 }
    );
  }
}

// POST /api/souls - Register new soul
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (!isSafeId(body?.id)) {
      return NextResponse.json({ error: "invalid soul id" }, { status: 400 });
    }
    const registry = await loadRegistry();

    // Check if soul already exists
    if (registry.souls.find((s) => s.id === body.id)) {
      return NextResponse.json(
        { error: "Soul already exists" },
        { status: 409 }
      );
    }

    const newSoul: Soul = {
      ...body,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    registry.souls.push(newSoul);
    await saveCapabilities(newSoul.id, newSoul.capabilities);
    await saveRegistry(registry);

    return NextResponse.json(newSoul, { status: 201 });
  } catch (error) {
    console.error("Failed to register soul:", error);
    return NextResponse.json(
      { error: "Failed to register soul" },
      { status: 500 }
    );
  }
}

// PATCH /api/souls?id=soul-id - Update soul
export async function PATCH(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const soulId = searchParams.get("id");

    if (!soulId) {
      return NextResponse.json(
        { error: "Soul ID required" },
        { status: 400 }
      );
    }

    const body = await request.json();
    if (body?.id !== undefined && body.id !== soulId) {
      return NextResponse.json({ error: "soul id cannot change" }, { status: 400 });
    }
    const registry = await loadRegistry();
    const soulIndex = registry.souls.findIndex((s) => s.id === soulId);

    if (soulIndex === -1) {
      return NextResponse.json({ error: "Soul not found" }, { status: 404 });
    }

    registry.souls[soulIndex] = {
      ...registry.souls[soulIndex],
      ...body,
      updatedAt: new Date().toISOString(),
    };

    if (body?.capabilities !== undefined) {
      await saveCapabilities(soulId, registry.souls[soulIndex].capabilities);
    }
    await saveRegistry(registry);

    return NextResponse.json(registry.souls[soulIndex]);
  } catch (error) {
    console.error("Failed to update soul:", error);
    return NextResponse.json(
      { error: "Failed to update soul" },
      { status: 500 }
    );
  }
}

// DELETE /api/souls?id=soul-id - Delete soul
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const soulId = searchParams.get("id");

    if (!soulId) {
      return NextResponse.json(
        { error: "Soul ID required" },
        { status: 400 }
      );
    }

    const registry = await loadRegistry();
    const filtered = registry.souls.filter((s) => s.id !== soulId);

    if (filtered.length === registry.souls.length) {
      return NextResponse.json({ error: "Soul not found" }, { status: 404 });
    }

    registry.souls = filtered;
    await saveRegistry(registry);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete soul:", error);
    return NextResponse.json(
      { error: "Failed to delete soul" },
      { status: 500 }
    );
  }
}
