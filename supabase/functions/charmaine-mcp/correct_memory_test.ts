import assert from "node:assert/strict";
import {
  correctMemory,
  type CorrectMemoryClient,
  correctMemorySchema,
} from "./correct_memory.ts";

type RpcRow = {
  memory_key: string;
  title: string;
  canon_status: string;
  [key: string]: unknown;
};

type RpcError = { message: string };

class FakeClient {
  calls: { name: string; args: Record<string, unknown> }[] = [];
  data: unknown = {
    memory_key: "memory-001",
    title: "Judul yang dikoreksi",
    canon_status: "draft",
    owner_id: "must-not-leak",
    details: { request_hash: "must-not-leak" },
  } satisfies RpcRow;
  error: RpcError | null = null;
  thrown: unknown;

  rpc(name: string, args: Record<string, unknown>) {
    this.calls.push({ name, args });
    return {
      maybeSingle: () => {
        if (this.thrown !== undefined) throw this.thrown;
        return Promise.resolve({ data: this.data, error: this.error });
      },
    };
  }
}

function input(overrides: Record<string, unknown> = {}) {
  return correctMemorySchema.parse({
    memory_key: " memory-001 ",
    expected_title: " Judul lama ",
    confirmation: "KOREKSI MEMORI",
    changes: {
      title: " Judul yang dikoreksi ",
      memory_type: "event",
      factual_core: ["Pit mengonfirmasi judul memori yang benar."],
      continuity_mode: "shared_experience",
      temporal_precision: "instant",
      uncertain_fields: [],
      occurred_at: "2026-11-23T16:00:00+07:00",
      details_patch: { source_note: "Dikonfirmasi Pit" },
    },
    ...overrides,
  });
}

function payload(result: Awaited<ReturnType<typeof correctMemory>>) {
  assert.equal(result.isError, undefined);
  return JSON.parse(result.content[0].text) as {
    corrected: boolean;
    memory: RpcRow;
  };
}

Deno.test("schema is strict and requires explicit correction confirmation", () => {
  assert.throws(() => input({ owner_id: crypto.randomUUID() }));
  assert.throws(() => input({ canon_status: "draft" }));
  assert.throws(() => input({ confirmation: "ya" }));
  assert.throws(() => input({ memory_key: "   " }));
  assert.throws(() => input({ expected_title: "   " }));
  assert.throws(() => input({ changes: {} }));
  assert.throws(() => input({ changes: { details_patch: {} } }));
  assert.throws(() => input({ changes: { owner_id: "someone" } }));
});

Deno.test("schema validates correction fields and internal detail keys", () => {
  assert.throws(() => input({ changes: { importance: 6 } }));
  assert.throws(() => input({ changes: { event_year: 0 } }));
  assert.throws(() => input({ changes: { memory_type: "plan" } }));
  assert.throws(() => input({ changes: { occurred_at: "yesterday" } }));
  assert.throws(() =>
    input({ changes: { occurred_at: "2026-11-23T16:00:00+07:00" } })
  );
  assert.throws(() =>
    input({
      changes: {
        temporal_precision: "day",
        occurred_on: "2023-02-29",
      },
    })
  );
  assert.throws(() =>
    input({
      changes: { temporal_precision: "unknown", event_year: 2026 },
    })
  );

  for (
    const key of [
      "memory_type",
      "expected_at",
      "occurred_at",
      "idempotency_key",
      "request_hash",
      "canonization",
      "corrected_at",
      "correction_history",
      "factual_core",
      "continuity_mode",
      "temporal_precision",
      "uncertain_fields",
      "occurred_on",
      "temporal_note",
    ]
  ) {
    assert.throws(() =>
      input({ changes: { details_patch: { [key]: "caller-value" } } })
    );
  }
});

Deno.test("calls the correction RPC with trimmed validated input", async () => {
  const fake = new FakeClient();
  const parsed = input();
  const result = payload(
    await correctMemory(fake as unknown as CorrectMemoryClient, parsed),
  );

  assert.deepEqual(fake.calls, [{
    name: "correct_charmaine_memory",
    args: {
      p_memory_key: "memory-001",
      p_expected_title: "Judul lama",
      p_confirmation: "KOREKSI MEMORI",
      p_changes: {
        title: "Judul yang dikoreksi",
        memory_type: "event",
        occurred_at: "2026-11-23T16:00:00+07:00",
        event_year: null,
        period: null,
        school_year: null,
        details_patch: {
          source_note: "Dikonfirmasi Pit",
          factual_core: ["Pit mengonfirmasi judul memori yang benar."],
          continuity_mode: "shared_experience",
          uncertain_fields: [],
          temporal_precision: "instant",
          occurred_on: null,
          temporal_note: null,
        },
      },
    },
  }]);
  assert.deepEqual(result, {
    corrected: true,
    memory: {
      memory_key: "memory-001",
      title: "Judul yang dikoreksi",
      canon_status: "draft",
    },
  });
});

Deno.test("day-only correction clears stale clock fields atomically", async () => {
  const fake = new FakeClient();
  const parsed = input({
    changes: {
      temporal_precision: "day",
      occurred_on: "2024-02-29",
      event_year: 2024,
    },
  });
  await correctMemory(fake as unknown as CorrectMemoryClient, parsed);

  assert.deepEqual(fake.calls[0].args.p_changes, {
    occurred_at: null,
    event_year: 2024,
    period: null,
    school_year: null,
    details_patch: {
      temporal_precision: "day",
      occurred_on: "2024-02-29",
      temporal_note: null,
    },
  });
});

Deno.test("success exposes only safe metadata and requires draft status", async () => {
  const fake = new FakeClient();
  const success = payload(
    await correctMemory(fake as unknown as CorrectMemoryClient, input()),
  );
  assert.deepEqual(Object.keys(success.memory).sort(), [
    "canon_status",
    "memory_key",
    "title",
  ]);

  fake.data = {
    memory_key: "memory-001",
    title: "Judul yang dikoreksi",
    canon_status: "canon",
  };
  const nonDraft = await correctMemory(
    fake as unknown as CorrectMemoryClient,
    input(),
  );
  assert.equal(nonDraft.isError, true);
});

Deno.test("missing, foreign, stale, and database failures do not leak", async () => {
  const parsed = input();
  const cases: FakeClient[] = [];

  const missing = new FakeClient();
  missing.data = null;
  cases.push(missing);

  const foreign = new FakeClient();
  foreign.error = { message: "RLS rejected another owner's row" };
  cases.push(foreign);

  const wrongRow = new FakeClient();
  wrongRow.data = {
    memory_key: "memory-999",
    title: "Wrong row",
    canon_status: "draft",
  };
  cases.push(wrongRow);

  const thrown = new FakeClient();
  thrown.thrown = new Error("secret database failure");
  cases.push(thrown);

  let expectedText: string | undefined;
  for (const fake of cases) {
    const result = await correctMemory(
      fake as unknown as CorrectMemoryClient,
      parsed,
    );
    assert.equal(result.isError, true);
    assert.doesNotMatch(result.content[0].text, /RLS|owner|secret|database/i);
    expectedText ??= result.content[0].text;
    assert.equal(result.content[0].text, expectedText);
  }
});
