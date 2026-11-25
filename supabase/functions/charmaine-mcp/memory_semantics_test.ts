import assert from "node:assert/strict";
import { z } from "zod";
import {
  addTemporalConsistencyIssues,
  isValidOccurredOn,
  semanticDetailsAreValid,
  semanticDetailsSchema,
  semanticMemoryFields,
} from "./memory_semantics.ts";

const temporalSchema = z.object({
  ...semanticMemoryFields,
  occurred_at: z.string().datetime({ offset: true }).nullable().optional(),
  event_year: z.number().int().min(1).max(9999).nullable().optional(),
  period: z.string().trim().min(1).nullable().optional(),
  school_year: z.string().trim().min(1).nullable().optional(),
}).superRefine(addTemporalConsistencyIssues);

const base = {
  factual_core: ["Pit menyampaikan satu fakta."],
  continuity_mode: "told_by_pit" as const,
};

Deno.test("semantic metadata trims facts and applies safe temporal defaults", () => {
  assert.deepEqual(
    semanticDetailsSchema.parse({
      factual_core: ["  Pit menyampaikan satu fakta.  "],
      continuity_mode: "told_by_pit",
    }),
    {
      factual_core: ["Pit menyampaikan satu fakta."],
      continuity_mode: "told_by_pit",
      temporal_precision: "unknown",
      uncertain_fields: [],
    },
  );
});

Deno.test("factual core is required, bounded, and nonempty", () => {
  for (const factual_core of [[], ["   "], Array(21).fill("fakta")]) {
    assert.equal(
      semanticDetailsSchema.safeParse({
        factual_core,
        continuity_mode: "told_by_pit",
      }).success,
      false,
    );
  }

  assert.equal(
    semanticDetailsSchema.safeParse({
      factual_core: ["x".repeat(501)],
      continuity_mode: "told_by_pit",
    }).success,
    false,
  );
});

Deno.test("continuity mode rejects unknown values", () => {
  assert.equal(
    semanticDetailsSchema.safeParse({
      factual_core: ["fakta"],
      continuity_mode: "silently_invented",
    }).success,
    false,
  );
});

Deno.test("occurred_on validates real calendar dates and leap years", () => {
  for (const value of ["2024-02-29", "2000-02-29", "2026-11-24"]) {
    assert.equal(isValidOccurredOn(value), true, value);
  }
  for (
    const value of [
      "2023-02-29",
      "1900-02-29",
      "2026-13-01",
      "2026-04-31",
      "0000-01-01",
      "24-01-01",
    ]
  ) {
    assert.equal(isValidOccurredOn(value), false, value);
  }
});

Deno.test("instant precision requires timestamp and rejects date-only", () => {
  assert.equal(
    temporalSchema.safeParse({
      ...base,
      temporal_precision: "instant",
      occurred_at: "2026-11-24T10:30:00+07:00",
      event_year: 2026,
    }).success,
    true,
  );
  assert.equal(
    temporalSchema.safeParse({ ...base, temporal_precision: "instant" })
      .success,
    false,
  );
  assert.equal(
    temporalSchema.safeParse({
      ...base,
      temporal_precision: "instant",
      occurred_at: "2026-11-24T10:30:00+07:00",
      occurred_on: "2026-11-24",
    }).success,
    false,
  );
});

Deno.test("day precision requires date-only and rejects invented time", () => {
  assert.equal(
    temporalSchema.safeParse({
      ...base,
      temporal_precision: "day",
      uncertain_fields: [],
      occurred_on: "2026-11-24",
      event_year: 2026,
    }).success,
    true,
  );
  assert.equal(
    temporalSchema.safeParse({ ...base, temporal_precision: "day" }).success,
    false,
  );
  assert.equal(
    temporalSchema.safeParse({
      ...base,
      temporal_precision: "day",
      uncertain_fields: [],
      occurred_on: "2026-11-24",
      occurred_at: "2026-11-24T00:00:00+07:00",
    }).success,
    false,
  );
});

Deno.test("year precision requires event_year and rejects exact anchors", () => {
  assert.equal(
    temporalSchema.safeParse({
      ...base,
      temporal_precision: "year",
      event_year: 2014,
    }).success,
    true,
  );
  assert.equal(
    temporalSchema.safeParse({ ...base, temporal_precision: "year" }).success,
    false,
  );
  assert.equal(
    temporalSchema.safeParse({
      ...base,
      temporal_precision: "year",
      event_year: 2014,
      occurred_on: "2014-08-17",
    }).success,
    false,
  );
});

Deno.test("period precision accepts a broad anchor and rejects exact anchors", () => {
  for (
    const anchor of [
      { period: "awal masa SMP" },
      { school_year: "2014/2015" },
      { temporal_note: "sekitar semester pertama" },
    ]
  ) {
    assert.equal(
      temporalSchema.safeParse({
        ...base,
        temporal_precision: "period",
        ...anchor,
      }).success,
      true,
    );
  }
  assert.equal(
    temporalSchema.safeParse({ ...base, temporal_precision: "period" }).success,
    false,
  );
  assert.equal(
    temporalSchema.safeParse({
      ...base,
      temporal_precision: "period",
      period: "masa SMP",
      occurred_at: "2014-08-17T12:00:00+07:00",
    }).success,
    false,
  );
});

Deno.test("unknown precision rejects every concrete temporal anchor", () => {
  assert.equal(temporalSchema.safeParse(base).success, true);

  for (
    const anchor of [
      { occurred_at: "2026-11-24T10:30:00+07:00" },
      { occurred_on: "2026-11-24" },
      { event_year: 2026 },
      { period: "masa kini" },
      { school_year: "2026/2027" },
    ]
  ) {
    assert.equal(
      temporalSchema.safeParse({ ...base, ...anchor }).success,
      false,
    );
  }
});

Deno.test("event_year must agree with exact timestamp or date-only anchor", () => {
  assert.equal(
    temporalSchema.safeParse({
      ...base,
      temporal_precision: "instant",
      occurred_at: "2026-12-31T23:00:00-05:00",
      event_year: 2025,
    }).success,
    false,
  );
  assert.equal(
    temporalSchema.safeParse({
      ...base,
      temporal_precision: "day",
      occurred_on: "2014-08-17",
      event_year: 2015,
    }).success,
    false,
  );
});

Deno.test("stored semantic details allow internal keys but still validate time", () => {
  assert.equal(
    semanticDetailsAreValid({
      ...base,
      temporal_precision: "day",
      uncertain_fields: [],
      occurred_on: "2026-11-24",
      occurred_at: null,
      memory_type: "event",
      idempotency_key: "internal",
    }, { event_year: 2026 }),
    true,
  );
  assert.equal(
    semanticDetailsAreValid({
      ...base,
      temporal_precision: "day",
      uncertain_fields: [],
      occurred_on: "2026-11-24",
      occurred_at: null,
      memory_type: "event",
    }, { event_year: 2025 }),
    false,
  );
  assert.equal(
    semanticDetailsAreValid({
      temporal_precision: "unknown",
      uncertain_fields: [],
    }),
    false,
  );
});
