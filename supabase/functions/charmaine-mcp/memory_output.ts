import { z } from "zod";
import {
  semanticDetailsAreValid,
  storedSemanticDetailsSchema,
} from "./memory_semantics.ts";

type MemoryRow = Record<string, unknown>;

function plainObject(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function optionalTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return z.string().datetime({ offset: true }).safeParse(value).success
    ? value
    : undefined;
}

function optionalBoundedText(
  value: unknown,
  maximum: number,
): string | undefined {
  return typeof value === "string" && value.trim().length > 0 &&
      value.length <= maximum
    ? value
    : undefined;
}

function temporalColumns(record: MemoryRow) {
  return {
    event_year: typeof record.event_year === "number"
      ? record.event_year
      : undefined,
    period: typeof record.period === "string" || record.period === null
      ? record.period
      : undefined,
    school_year:
      typeof record.school_year === "string" || record.school_year === null
        ? record.school_year
        : undefined,
  };
}

/**
 * Return only conversational memory metadata. Internal idempotency and request
 * hashes stay in the database and are never exposed through retrieval tools.
 */
export function presentMemory(row: unknown): MemoryRow {
  const record = plainObject(row);
  if (!record) return {};
  const { details: rawDetails, ...memory } = record;
  const details = plainObject(rawDetails);
  if (!details) return memory;

  const memoryType = typeof details.memory_type === "string" &&
      ["event", "fact", "plan", "state"].includes(details.memory_type)
    ? details.memory_type
    : undefined;
  const expectedAt = optionalTimestamp(details.expected_at);
  const canonization = plainObject(details.canonization);
  const semanticKeys = [
    "factual_core",
    "continuity_mode",
    "temporal_precision",
    "uncertain_fields",
    "occurred_on",
    "temporal_note",
  ];
  const hasSemanticMetadata = semanticKeys.some((key) => key in details);
  const hasValidSemantics = semanticDetailsAreValid(
    details,
    temporalColumns(record),
  );
  const occurredAt = hasSemanticMetadata && !hasValidSemantics
    ? undefined
    : optionalTimestamp(details.occurred_at);
  const semanticResult = hasValidSemantics
    ? storedSemanticDetailsSchema.safeParse(details)
    : undefined;
  const semantic = semanticResult?.success ? semanticResult.data : undefined;

  const safeCanonization = canonization
    ? {
      ...(optionalTimestamp(canonization.canonized_at) === undefined
        ? {}
        : { canonized_at: canonization.canonized_at }),
      ...(optionalTimestamp(canonization.occurred_at) === undefined
        ? {}
        : { occurred_at: canonization.occurred_at }),
      ...(optionalBoundedText(canonization.note, 1_000) === undefined
        ? {}
        : { note: canonization.note }),
    }
    : undefined;

  return {
    ...memory,
    ...(memoryType === undefined ? {} : { memory_type: memoryType }),
    ...(expectedAt === undefined ? {} : { expected_at: expectedAt }),
    ...(occurredAt === undefined ? {} : { occurred_at: occurredAt }),
    ...(semantic === undefined ? {} : {
      factual_core: semantic.factual_core,
      continuity_mode: semantic.continuity_mode,
      temporal_precision: semantic.temporal_precision,
      uncertain_fields: semantic.uncertain_fields,
      ...(semantic.occurred_on === undefined
        ? {}
        : { occurred_on: semantic.occurred_on }),
      ...(semantic.temporal_note === undefined
        ? {}
        : { temporal_note: semantic.temporal_note }),
    }),
    ...(safeCanonization && Object.keys(safeCanonization).length > 0
      ? { canonization: safeCanonization }
      : {}),
  };
}
