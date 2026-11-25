import { z } from "zod";
import type { SupabaseContext } from "@supabase/server";

export const promoteMemorySchema = z.object({
  memory_key: z.string().trim().min(1).max(160),
  expected_title: z.string().trim().min(1).max(200),
  confirmation: z.literal("JADIKAN CANON"),
  note: z.string().trim().min(1).max(1000).optional(),
}).strict();

export type PromoteMemoryClient = Pick<SupabaseContext["supabase"], "rpc">;

type PromotedMemory = {
  memory_key: string;
  title: string;
  canon_status: "canon";
  promoted: boolean;
};

type ToolResult = {
  isError?: boolean;
  content: { type: "text"; text: string }[];
};

function unavailableResult(): ToolResult {
  // Missing, foreign, stale-title, invalid, and rejected promotions deliberately
  // share one response so callers cannot probe another owner's memories.
  return {
    isError: true,
    content: [{
      type: "text",
      text: "Memori tidak ditemukan atau tidak dapat dipromosikan.",
    }],
  };
}

function promotedRow(value: unknown): PromotedMemory | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const row = value as Record<string, unknown>;
  if (
    typeof row.memory_key !== "string" ||
    typeof row.title !== "string" ||
    row.canon_status !== "canon" ||
    typeof row.promoted !== "boolean"
  ) return null;

  return {
    memory_key: row.memory_key,
    title: row.title,
    canon_status: row.canon_status,
    promoted: row.promoted,
  };
}

export async function promoteMemory(
  supabase: PromoteMemoryClient,
  {
    memory_key,
    expected_title,
    confirmation,
    note,
  }: z.output<typeof promoteMemorySchema>,
): Promise<ToolResult> {
  try {
    const result = await supabase.rpc("promote_charmaine_memory", {
      p_memory_key: memory_key,
      p_expected_title: expected_title,
      p_confirmation: confirmation,
      p_note: note ?? null,
    }).maybeSingle() as {
      data: unknown;
      error: { message: string } | null;
    };

    if (result.error) return unavailableResult();
    const row = promotedRow(result.data);
    if (!row || row.memory_key !== memory_key || row.title !== expected_title) {
      return unavailableResult();
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          promoted: row.promoted,
          already_canon: !row.promoted,
          memory: {
            memory_key: row.memory_key,
            title: row.title,
            canon_status: row.canon_status,
          },
        }),
      }],
    };
  } catch {
    return unavailableResult();
  }
}
