import { z } from "zod";
import type { SupabaseContext } from "@supabase/server";
import { normalizeCategory } from "./categories.ts";
import { presentMemory } from "./memory_output.ts";

const MEMORY_COLUMNS =
  "memory_key,title,memory_text,period,school_year,event_year,category," +
  "people,tags,emotion,canon_status,clarity,importance,created_at,details";

export const listMemoriesSchema = z.object({
  school_year: z.string().optional(),
  period: z.string().trim().min(1).max(160).optional(),
  event_year: z.number().int().min(1).max(9999).optional(),
  category: z.string().optional().describe(
    "Kategori baku atau alias: sekolah/kelas/sd, rumah/keluarga, " +
      "teman/permainan/main, kantin/perjalanan, hobi/imajinasi, " +
      "hal kecil/momen kecil, pit/kesan tentang pit. " +
      "Huruf besar/kecil, spasi, dan tanda hubung dinormalisasi.",
  ),
  canon_status: z.enum(["draft", "canon"]).optional().describe(
    "Status editorial memori. Draft belum dikonfirmasi; canon sudah dikonfirmasi.",
  ),
  memory_type: z.enum(["event", "fact", "plan", "state"]).optional(),
  limit: z.number().int().min(1).max(20).default(10),
  offset: z.number().int().min(0).default(0),
});

// The read-only subset of the request-scoped Supabase client used by this tool.
export type ListMemoriesClient = Pick<SupabaseContext["supabase"], "from">;

export async function listMemories(
  supabase: ListMemoriesClient,
  {
    school_year,
    period,
    event_year,
    category,
    canon_status,
    memory_type,
    limit,
    offset,
  }: z.output<typeof listMemoriesSchema>,
): Promise<{
  isError?: boolean;
  content: { type: "text"; text: string }[];
}> {
  // The caller supplies its OAuth user client, so RLS also scopes the total.
  let query = supabase
    .from("charmaine_memories")
    .select(
      MEMORY_COLUMNS,
      { count: "exact" },
    )
    .order("memory_key", { ascending: true })
    .range(offset, offset + limit - 1);

  if (school_year) {
    query = query.eq("school_year", school_year);
  }

  if (period) {
    query = query.eq("period", period);
  }

  if (event_year !== undefined) {
    query = query.eq("event_year", event_year);
  }

  if (category) {
    query = query.eq("category", normalizeCategory(category));
  }

  if (canon_status) {
    query = query.eq("canon_status", canon_status);
  }

  if (memory_type) {
    query = query.eq("details->>memory_type", memory_type);
  }

  const { data, error, count } = await query;

  if (error) {
    return {
      isError: true,
      content: [{
        type: "text" as const,
        text: `Gagal mengambil memori: ${error.message}`,
      }],
    };
  }

  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({
        count: data?.length ?? 0,
        total: count ?? 0,
        offset,
        memories: (data ?? []).map((row) => presentMemory(row)),
      }),
    }],
  };
}
