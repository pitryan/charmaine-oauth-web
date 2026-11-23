import { z } from "zod";
import type { SupabaseContext } from "@supabase/server";

export const deleteMemorySchema = z.object({
  memory_key: z.string().trim().min(1).max(160),
  expected_title: z.string().trim().min(1).max(200),
  confirmation: z.literal("HAPUS PERMANEN"),
}).strict();

type DeleteMemoryInput = z.output<typeof deleteMemorySchema>;

type DeletedMemory = {
  memory_key: string;
  title: string;
  canon_status: string;
};

export type DeleteMemoryClient = Pick<SupabaseContext["supabase"], "rpc">;

function content(value: unknown) {
  return [{ type: "text" as const, text: JSON.stringify(value) }];
}

function error(message: string) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}

function deletedMemory(value: unknown): DeletedMemory | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const row = value as Record<string, unknown>;
  if (
    typeof row.memory_key !== "string" ||
    typeof row.title !== "string" ||
    typeof row.canon_status !== "string"
  ) return null;
  return {
    memory_key: row.memory_key,
    title: row.title,
    canon_status: row.canon_status,
  };
}

export async function deleteMemory(
  supabase: DeleteMemoryClient,
  input: DeleteMemoryInput,
): Promise<{
  isError?: boolean;
  content: { type: "text"; text: string }[];
}> {
  try {
    const { data, error: rpcError } = await supabase.rpc(
      "delete_charmaine_memory",
      {
        p_memory_key: input.memory_key,
        p_expected_title: input.expected_title,
        p_confirmation: input.confirmation,
      },
    );

    if (rpcError) {
      return error("Gagal menghapus memori secara permanen.");
    }

    const rows = Array.isArray(data) ? data : [];
    const memory = deletedMemory(rows[0]);
    if (!memory) {
      return {
        content: content({ deleted: false, already_absent: true }),
      };
    }

    return {
      content: content({
        deleted: true,
        already_absent: false,
        memory,
      }),
    };
  } catch {
    return error("Gagal menghapus memori secara permanen.");
  }
}
