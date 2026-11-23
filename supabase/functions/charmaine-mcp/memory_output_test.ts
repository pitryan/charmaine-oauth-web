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
      canonization: {
        canonized_at: "2026-11-23T00:00:00Z",
        occurred_at: "2026-11-22T00:00:00Z",
        note: "Sudah dikonfirmasi.",
      },
    },
  );
});

Deno.test("retrieval tolerates missing or non-object legacy details", () => {
  for (const details of [undefined, null, [], "legacy"]) {
    assert.deepEqual(presentMemory({ memory_key: "legacy", details }), {
      memory_key: "legacy",
    });
  }
});
