import { z } from "zod";
import type { SupabaseContext } from "@supabase/server";

const MEMORY_COLUMNS = "memory_key,title,canon_status,details";
const RETURN_COLUMNS = "memory_key,title,canon_status";

export const promoteMemorySchema = z.object({
  memory_key: z.string().trim().min(1).max(160),
  occurred_at: z.string().trim().datetime({ offset: true }).optional(),
  note: z.string().trim().min(1).max(1000).optional(),
}).strict();

export type PromoteMemoryClient = Pick<SupabaseContext["supabase"], "from">;

type MemoryRow = {
  memory_key: string;
  title: string;
  canon_status: string;
  details?: unknown;
};

type ToolResult = {
  isError?: boolean;
  content: { type: "text"; text: string }[];
};

function textResult(value: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
  };
}

function unavailableResult(): ToolResult {
  // Use one response for missing, foreign, and non-promotable rows so the tool
  // never reveals whether another owner has a matching globally unique key.
  return {
    isError: true,
    content: [{
      type: "text",
      text: "Memori tidak ditemukan atau tidak dapat dipromosikan.",
    }],
  };
}

function plainObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function success(row: MemoryRow, promoted: boolean): ToolResult {
  return textResult({
    promoted,
    already_canon: !promoted,
    memory: {
      memory_key: row.memory_key,
      title: row.title,
      canon_status: row.canon_status,
    },
  });
}

async function findMemory(
  supabase: PromoteMemoryClient,
  memoryKey: string,
): Promise<{
  data: MemoryRow | null;
  error: { message: string } | null;
}> {
  return await supabase
    .from("charmaine_memories")
    .select(MEMORY_COLUMNS)
    .eq("memory_key", memoryKey)
    .maybeSingle() as {
      data: MemoryRow | null;
      error: { message: string } | null;
    };
}

export async function promoteMemory(
  supabase: PromoteMemoryClient,
  { memory_key, occurred_at, note }: z.output<typeof promoteMemorySchema>,
  now: () => Date = () => new Date(),
): Promise<ToolResult> {
  const existing = await findMemory(supabase, memory_key);

  if (existing.error) {
    return {
      isError: true,
      content: [{
        type: "text",
        text: "Gagal memeriksa memori.",
      }],
    };
  }

  if (!existing.data) return unavailableResult();
  if (plainObject(existing.data.details).memory_type === "plan") {
    return unavailableResult();
  }
  if (existing.data.canon_status === "canon") {
    return success(existing.data, false);
  }
  if (existing.data.canon_status !== "draft") return unavailableResult();

  const details = plainObject(existing.data.details);
  const previousCanonization = plainObject(details.canonization);
  const nextDetails = {
    ...details,
    ...(occurred_at === undefined ? {} : { occurred_at }),
    canonization: {
      ...previousCanonization,
      canonized_at: now().toISOString(),
      ...(occurred_at === undefined ? {} : { occurred_at }),
      ...(note === undefined ? {} : { note }),
    },
  };

  const updated = await supabase
    .from("charmaine_memories")
    .update({ canon_status: "canon", details: nextDetails })
    .eq("memory_key", memory_key)
    .eq("canon_status", "draft")
    .select(RETURN_COLUMNS)
    .maybeSingle() as {
      data: MemoryRow | null;
      error: { message: string } | null;
    };

  if (updated.error) {
    return {
      isError: true,
      content: [{
        type: "text",
        text: "Gagal menjadikan memori canon.",
      }],
    };
  }

  if (updated.data) return success(updated.data, true);

  // A concurrent retry may have promoted the row after the first read. Read it
  // once more so callers receive an idempotent success instead of a false error.
  const replay = await findMemory(supabase, memory_key);
  if (!replay.error && replay.data?.canon_status === "canon") {
    return success(replay.data, false);
  }
  return unavailableResult();
}
