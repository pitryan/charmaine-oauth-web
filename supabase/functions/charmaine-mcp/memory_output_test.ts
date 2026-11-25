import assert from "node:assert/strict";
import { presentMemory } from "./memory_output.ts";

Deno.test("retrieval exposes useful metadata but hides internal details", () => {
  assert.deepEqual(
    presentMemory({
      memory_key: "mem-1",
      title: "Project selesai",
      details: {
        memory_type: "plan",
        expected_at: "2026-11-30T00:00:00Z",
        occurred_at: "2026-11-22T00:00:00Z",
        factual_core: ["Project selesai pada 22 November 2026."],
        continuity_mode: "shared_experience",
        temporal_precision: "instant",
        uncertain_fields: [],
        temporal_note: "Waktu diketahui dari catatan proyek.",
        idempotency_key: "internal-key",
        request_hash: "internal-hash",
        arbitrary_private_metadata: "internal-value",
        canonization: {
          canonized_at: "2026-11-23T00:00:00Z",
          occurred_at: "2026-11-22T00:00:00Z",
          note: "Sudah dikonfirmasi.",
          internal: "hidden",
        },
      },
    }),
    {
      memory_key: "mem-1",
      title: "Project selesai",
      memory_type: "plan",
      expected_at: "2026-11-30T00:00:00Z",
      occurred_at: "2026-11-22T00:00:00Z",
      factual_core: ["Project selesai pada 22 November 2026."],
      continuity_mode: "shared_experience",
      temporal_precision: "instant",
      uncertain_fields: [],
      temporal_note: "Waktu diketahui dari catatan proyek.",
      canonization: {
        canonized_at: "2026-11-23T00:00:00Z",
        occurred_at: "2026-11-22T00:00:00Z",
        note: "Sudah dikonfirmasi.",
      },
    },
  );
});

Deno.test("retrieval exposes valid day-only semantics without invented time", () => {
  assert.deepEqual(
    presentMemory({
      memory_key: "mem-day",
      perspective: "charmaine",
      details: {
        memory_type: "event",
        occurred_at: null,
        factual_core: ["Pit datang pada 29 Februari 2024."],
        continuity_mode: "told_by_pit",
        temporal_precision: "day",
        uncertain_fields: ["weather"],
        occurred_on: "2024-02-29",
      },
    }),
    {
      memory_key: "mem-day",
      perspective: "charmaine",
      memory_type: "event",
      factual_core: ["Pit datang pada 29 Februari 2024."],
      continuity_mode: "told_by_pit",
      temporal_precision: "day",
      uncertain_fields: ["weather"],
      occurred_on: "2024-02-29",
    },
  );
});

Deno.test("retrieval hides malformed semantic metadata and arbitrary details", () => {
  assert.deepEqual(
    presentMemory({
      memory_key: "malformed",
      details: {
        memory_type: "event",
        factual_core: [],
        continuity_mode: "invented-mode",
        temporal_precision: "day",
        uncertain_fields: [],
        occurred_on: "2024-02-30",
        private_note: "must stay hidden",
      },
    }),
    { memory_key: "malformed", memory_type: "event" },
  );
});

Deno.test("retrieval hides contradictory semantic time and malformed timestamps", () => {
  assert.deepEqual(
    presentMemory({
      memory_key: "contradictory",
      details: {
        memory_type: "event",
        occurred_at: "2024-02-29T10:00:00Z",
        factual_core: ["Tanggal diketahui, tetapi jam tidak."],
        continuity_mode: "shared_experience",
        temporal_precision: "day",
        uncertain_fields: [],
        occurred_on: "2024-02-29",
        canonization: {
          canonized_at: "not-a-timestamp",
          occurred_at: "also-not-a-timestamp",
          note: " ",
        },
      },
    }),
    { memory_key: "contradictory", memory_type: "event" },
  );
});

Deno.test("retrieval requires every stored semantic field", () => {
  assert.deepEqual(
    presentMemory({
      memory_key: "partial-v2",
      details: {
        memory_type: "fact",
        factual_core: ["Metadata ini belum lengkap."],
        continuity_mode: "told_by_pit",
      },
    }),
    { memory_key: "partial-v2", memory_type: "fact" },
  );
});

Deno.test("retrieval tolerates missing or non-object legacy details", () => {
  for (const details of [undefined, null, [], "legacy"]) {
    assert.deepEqual(presentMemory({ memory_key: "legacy", details }), {
      memory_key: "legacy",
    });
  }
});
