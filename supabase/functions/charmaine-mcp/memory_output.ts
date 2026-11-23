type MemoryRow = Record<string, unknown>;

function plainObject(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function optionalTimestamp(value: unknown): string | null | undefined {
  return typeof value === "string" || value === null ? value : undefined;
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

  const memoryType = typeof details.memory_type === "string"
    ? details.memory_type
    : undefined;
  const expectedAt = optionalTimestamp(details.expected_at);
  const occurredAt = optionalTimestamp(details.occurred_at);
  const canonization = plainObject(details.canonization);

  const safeCanonization = canonization
    ? {
      ...(typeof canonization.canonized_at === "string"
        ? { canonized_at: canonization.canonized_at }
        : {}),
      ...(typeof canonization.occurred_at === "string"
        ? { occurred_at: canonization.occurred_at }
        : {}),
      ...(typeof canonization.note === "string"
        ? { note: canonization.note }
        : {}),
    }
    : undefined;

  return {
    ...memory,
    ...(memoryType === undefined ? {} : { memory_type: memoryType }),
    ...(expectedAt === undefined ? {} : { expected_at: expectedAt }),
    ...(occurredAt === undefined ? {} : { occurred_at: occurredAt }),
    ...(safeCanonization && Object.keys(safeCanonization).length > 0
      ? { canonization: safeCanonization }
      : {}),
  };
}
