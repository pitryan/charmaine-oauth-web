import { z } from "zod";
import type { SupabaseContext } from "@supabase/server";

const shortText = z.string().trim().min(1).max(120);
const optionalText = (maximum: number) =>
  z.string().trim().min(1).max(maximum).nullable().optional();
const memoryDetails = z.record(z.string(), z.unknown()).refine(
  (value) => JSON.stringify(value).length <= 10_000,
  "Details terlalu besar.",
).refine(
  (value) =>
    [
      "memory_type",
      "expected_at",
      "occurred_at",
      "idempotency_key",
      "request_hash",
      "canonization",
    ].every((key) => !(key in value)),
  "Details memakai nama metadata internal.",
);

export const createMemorySchema = z.object({
  idempotency_key: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  memory_text: z.string().trim().min(1).max(20_000),
  perspective: shortText.default("charmaine"),
  period: optionalText(160),
  school_year: optionalText(40),
  event_year: z.number().int().min(1).max(9999).nullable().optional(),
  category: shortText.default("slice_of_life"),
  people: z.array(shortText).max(50).default([]),
  tags: z.array(shortText).max(50).default([]),
  emotion: optionalText(120),
  clarity: shortText.default("clear"),
  importance: z.number().int().min(1).max(5).default(3),
  memory_type: z.enum(["event", "fact", "plan", "state"]).default("event"),
  expected_at: z.string().datetime({ offset: true }).nullable().optional(),
  occurred_at: z.string().datetime({ offset: true }).nullable().optional(),
  details: memoryDetails.default({}),
}).strict();

type CreateMemoryInput = z.output<typeof createMemorySchema>;

const RESULT_COLUMNS = "memory_key,title,canon_status,created_at,details";

type MemoryResult = {
  memory_key: string;
  title: string;
  canon_status: string;
  created_at: string;
  details?: Record<string, unknown> | null;
};

type QueryError = {
  code?: string;
  message: string;
};

// The request-scoped user client keeps both reads and writes subject to RLS.
export type CreateMemoryClient = Pick<SupabaseContext["supabase"], "from">;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
        .join(",")
    }}`;
  }
  return JSON.stringify(value) ?? "null";
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function newMemoryKey(): string {
  return `mem_${crypto.randomUUID()}`;
}

async function requestHash(input: CreateMemoryInput): Promise<string> {
  const { idempotency_key: _idempotencyKey, ...request } = input;
  return await sha256(stableJson(request));
}

function resultPayload(memory: MemoryResult, replayed: boolean) {
  return {
    replayed,
    memory: {
      memory_key: memory.memory_key,
      title: memory.title,
      canon_status: memory.canon_status,
      created_at: memory.created_at,
    },
  };
}

function content(value: unknown) {
  return [{ type: "text" as const, text: JSON.stringify(value) }];
}

function error(message: string) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}

async function findExisting(
  supabase: CreateMemoryClient,
  idempotencyKey: string,
): Promise<{ data: MemoryResult | null; error: QueryError | null }> {
  const { data, error } = await supabase
    .from("charmaine_memories")
    .select(RESULT_COLUMNS)
    .eq("details->>idempotency_key", idempotencyKey)
    .maybeSingle();
  return {
    data: data as MemoryResult | null,
    error: error as QueryError | null,
  };
}

function isMatchingReplay(
  memory: MemoryResult,
  idempotencyKey: string,
  hash: string,
): boolean {
  return memory.details?.idempotency_key === idempotencyKey &&
    memory.details?.request_hash === hash;
}

export async function createMemory(
  supabase: CreateMemoryClient,
  input: CreateMemoryInput,
): Promise<{
  isError?: boolean;
  content: { type: "text"; text: string }[];
}> {
  const memoryKey = newMemoryKey();
  const hash = await requestHash(input);

  const existing = await findExisting(supabase, input.idempotency_key);
  if (existing.error) return error("Gagal memeriksa permintaan memori.");
  if (existing.data) {
    if (!isMatchingReplay(existing.data, input.idempotency_key, hash)) {
      return error("Idempotency key sudah dipakai untuk memori yang berbeda.");
    }
    return { content: content(resultPayload(existing.data, true)) };
  }

  const {
    idempotency_key,
    memory_type,
    expected_at,
    occurred_at,
    details,
    ...fields
  } = input;
  const row = {
    ...fields,
    memory_key: memoryKey,
    origin: "mcp_user_entry",
    details: {
      ...details,
      memory_type,
      expected_at: expected_at ?? null,
      occurred_at: occurred_at ?? null,
      idempotency_key,
      request_hash: hash,
    },
  };

  const { data, error: insertError } = await supabase
    .from("charmaine_memories")
    .insert(row)
    .select(RESULT_COLUMNS)
    .single();

  if (!insertError && data && (data as MemoryResult).canon_status === "draft") {
    return {
      content: content(resultPayload(data as MemoryResult, false)),
    };
  }

  // A concurrent retry can lose the per-owner idempotency race. Read the row
  // back through the same user-scoped client before deciding it failed.
  if ((insertError as QueryError | null)?.code === "23505") {
    const raced = await findExisting(supabase, idempotency_key);
    if (
      !raced.error && raced.data &&
      isMatchingReplay(raced.data, idempotency_key, hash)
    ) {
      return { content: content(resultPayload(raced.data, true)) };
    }
  }

  return error("Gagal membuat memori draft.");
}
