import { z } from "zod";
import type { SupabaseContext } from "@supabase/server";
import {
  addTemporalConsistencyIssues,
  continuityModeSchema,
  factualCoreSchema,
  occurredOnSchema,
  temporalNoteSchema,
  temporalPrecisionValueSchema,
  uncertainFieldsValueSchema,
} from "./memory_semantics.ts";

const shortText = z.string().trim().min(1).max(120);
const nullableText = (maximum: number) =>
  z.string().trim().min(1).max(maximum).nullable();

const RESERVED_DETAIL_KEYS = new Set([
  "memory_type",
  "expected_at",
  "occurred_at",
  "idempotency_key",
  "request_hash",
  "canonization",
  "corrected_at",
  "correction",
  "corrections",
  "correction_history",
  "last_correction",
  "factual_core",
  "continuity_mode",
  "temporal_precision",
  "uncertain_fields",
  "occurred_on",
  "temporal_note",
]);

const detailsPatchSchema = z.record(z.string(), z.unknown()).refine(
  (value) => Object.keys(value).length > 0,
  "Details patch tidak boleh kosong.",
).refine(
  (value) => JSON.stringify(value).length <= 10_000,
  "Details patch terlalu besar.",
).refine(
  (value) => Object.keys(value).every((key) => !RESERVED_DETAIL_KEYS.has(key)),
  "Details patch memakai nama metadata internal.",
);

const correctionChangesSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  memory_text: z.string().trim().min(1).max(20_000).optional(),
  period: nullableText(160).optional(),
  school_year: nullableText(40).optional(),
  event_year: z.number().int().min(1).max(9999).nullable().optional(),
  category: shortText.optional(),
  people: z.array(shortText).max(50).optional(),
  tags: z.array(shortText).max(50).optional(),
  emotion: nullableText(120).optional(),
  clarity: shortText.optional(),
  importance: z.number().int().min(1).max(5).optional(),
  memory_type: z.enum(["event", "fact", "state"]).optional(),
  occurred_at: z.string().trim().datetime({ offset: true }).nullable()
    .optional(),
  occurred_on: occurredOnSchema,
  factual_core: factualCoreSchema.optional(),
  continuity_mode: continuityModeSchema.optional(),
  temporal_precision: temporalPrecisionValueSchema.optional(),
  uncertain_fields: uncertainFieldsValueSchema.optional(),
  temporal_note: temporalNoteSchema,
  details_patch: detailsPatchSchema.optional(),
}).strict().superRefine((value, ctx) => {
  const hasTemporalChange = [
    value.occurred_at,
    value.occurred_on,
    value.event_year,
    value.period,
    value.school_year,
    value.temporal_note,
    value.temporal_precision,
  ].some((entry) => entry !== undefined);

  if (!hasTemporalChange) return;
  if (value.temporal_precision === undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["temporal_precision"],
      message: "Koreksi waktu harus menyertakan temporal_precision.",
    });
    return;
  }
  addTemporalConsistencyIssues(value, ctx);
}).refine(
  (value) => Object.values(value).some((entry) => entry !== undefined),
  "Minimal satu perubahan wajib diberikan.",
);

export const correctMemorySchema = z.object({
  memory_key: z.string().trim().min(1).max(160),
  expected_title: z.string().trim().min(1).max(200),
  confirmation: z.literal("KOREKSI MEMORI"),
  changes: correctionChangesSchema,
}).strict();

type CorrectMemoryInput = z.output<typeof correctMemorySchema>;

export type CorrectMemoryClient = Pick<SupabaseContext["supabase"], "rpc">;

type CorrectedMemory = {
  memory_key: string;
  title: string;
  canon_status: string;
};

type ToolResult = {
  isError?: boolean;
  content: { type: "text"; text: string }[];
};

const TEMPORAL_CHANGE_KEYS = [
  "occurred_at",
  "occurred_on",
  "event_year",
  "period",
  "school_year",
  "temporal_note",
  "temporal_precision",
] as const;

function rpcChanges(changes: CorrectMemoryInput["changes"]) {
  const {
    factual_core,
    continuity_mode,
    temporal_precision,
    uncertain_fields,
    occurred_on,
    temporal_note,
    details_patch,
    ...columns
  } = changes;
  const semanticPatch: Record<string, unknown> = {};

  if (factual_core !== undefined) semanticPatch.factual_core = factual_core;
  if (continuity_mode !== undefined) {
    semanticPatch.continuity_mode = continuity_mode;
  }
  if (uncertain_fields !== undefined) {
    semanticPatch.uncertain_fields = uncertain_fields;
  }

  const hasTemporalChange = TEMPORAL_CHANGE_KEYS.some((key) =>
    changes[key] !== undefined
  );
  if (hasTemporalChange) {
    // A temporal correction replaces the complete temporal anchor set. Clearing
    // omitted anchors prevents stale timestamps from contradicting the new
    // precision after the RPC merges this patch with existing details.
    columns.occurred_at = changes.occurred_at ?? null;
    columns.event_year = changes.event_year ?? null;
    columns.period = changes.period ?? null;
    columns.school_year = changes.school_year ?? null;
    semanticPatch.temporal_precision = temporal_precision;
    semanticPatch.occurred_on = occurred_on ?? null;
    semanticPatch.temporal_note = temporal_note ?? null;
  }

  const mergedDetails = { ...details_patch, ...semanticPatch };
  return {
    ...columns,
    ...(Object.keys(mergedDetails).length === 0
      ? {}
      : { details_patch: mergedDetails }),
  };
}

function unavailableResult(): ToolResult {
  // Missing, foreign, stale-title, and rejected corrections deliberately share
  // one response so callers cannot probe another owner's memories.
  return {
    isError: true,
    content: [{
      type: "text",
      text: "Memori tidak ditemukan atau tidak dapat dikoreksi.",
    }],
  };
}

function correctedRow(value: unknown): CorrectedMemory | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const row = value as Record<string, unknown>;
  if (
    typeof row.memory_key !== "string" ||
    typeof row.title !== "string" ||
    row.canon_status !== "draft"
  ) return null;

  return {
    memory_key: row.memory_key,
    title: row.title,
    canon_status: row.canon_status,
  };
}

export async function correctMemory(
  supabase: CorrectMemoryClient,
  { memory_key, expected_title, confirmation, changes }: CorrectMemoryInput,
): Promise<ToolResult> {
  try {
    const result = await supabase.rpc("correct_charmaine_memory", {
      p_memory_key: memory_key,
      p_expected_title: expected_title,
      p_confirmation: confirmation,
      p_changes: rpcChanges(changes),
    }).maybeSingle() as {
      data: unknown;
      error: { message: string } | null;
    };

    if (result.error) return unavailableResult();
    const memory = correctedRow(result.data);
    if (!memory || memory.memory_key !== memory_key) return unavailableResult();

    return {
      content: [{
        type: "text",
        text: JSON.stringify({ corrected: true, memory }),
      }],
    };
  } catch {
    return unavailableResult();
  }
}
