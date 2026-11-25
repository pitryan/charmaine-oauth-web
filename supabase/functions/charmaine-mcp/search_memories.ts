import { z } from "zod";
import type { SupabaseContext } from "@supabase/server";
import { presentMemory } from "./memory_output.ts";

const MEMORY_COLUMNS =
  "memory_key,title,memory_text,perspective,period,school_year,event_year," +
  "category,people,tags,emotion,importance,origin,canon_status,clarity," +
  "created_at,details";

export const searchMemoriesSchema = z.object({
  query: z.string().trim().min(2).max(100),
  canon_status: z.enum(["draft", "canon"]).optional(),
  memory_type: z.enum(["event", "fact", "plan", "state"]).optional(),
  limit: z.number().int().min(1).max(10).default(5),
}).strict();

export type SearchMemoriesClient = Pick<SupabaseContext["supabase"], "from">;

type SearchMemoryInput = z.output<typeof searchMemoriesSchema>;
type SearchRow = Record<string, unknown> & {
  memory_key: string;
  created_at?: string;
};
type SearchResult = {
  data: SearchRow[] | null;
  error: { message: string } | null;
};

function escapeIlike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
}

function queryByColumn(
  supabase: SearchMemoriesClient,
  column: "title" | "memory_text",
  pattern: string,
  { canon_status, memory_type, limit }: SearchMemoryInput,
) {
  let query = supabase
    .from("charmaine_memories")
    .select(MEMORY_COLUMNS)
    .ilike(column, pattern)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (canon_status) query = query.eq("canon_status", canon_status);
  if (memory_type) query = query.eq("details->>memory_type", memory_type);
  return query;
}

function createdAt(row: SearchRow): number {
  if (typeof row.created_at !== "string") return 0;
  const value = Date.parse(row.created_at);
  return Number.isNaN(value) ? 0 : value;
}

function conversationalRow(row: SearchRow): Record<string, unknown> {
  const { created_at: _createdAt, ...memory } = row;
  return presentMemory(memory);
}

export async function searchMemories(
  supabase: SearchMemoriesClient,
  input: SearchMemoryInput,
): Promise<{
  isError?: boolean;
  content: { type: "text"; text: string }[];
}> {
  const pattern = `%${escapeIlike(input.query)}%`;
  const [titleResult, textResult] = await Promise.all([
    queryByColumn(supabase, "title", pattern, input),
    queryByColumn(supabase, "memory_text", pattern, input),
  ]) as [SearchResult, SearchResult];

  if (titleResult.error || textResult.error) {
    return {
      isError: true,
      content: [{
        type: "text",
        text: "Pencarian memori gagal.",
      }],
    };
  }

  const byKey = new Map<string, SearchRow>();
  for (const row of [...(titleResult.data ?? []), ...(textResult.data ?? [])]) {
    if (typeof row.memory_key !== "string") continue;
    const existing = byKey.get(row.memory_key);
    if (!existing || createdAt(row) > createdAt(existing)) {
      byKey.set(row.memory_key, row);
    }
  }

  const memories = [...byKey.values()]
    .sort((left, right) =>
      createdAt(right) - createdAt(left) ||
      left.memory_key.localeCompare(right.memory_key)
    )
    .slice(0, input.limit)
    .map(conversationalRow);

  return {
    content: [{
      type: "text",
      text: JSON.stringify({ count: memories.length, memories }),
    }],
  };
}
