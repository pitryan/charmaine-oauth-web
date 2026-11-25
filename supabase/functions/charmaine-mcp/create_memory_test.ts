import assert from "node:assert/strict";
import {
  createMemory,
  type CreateMemoryClient,
  createMemorySchema,
  newMemoryKey,
} from "./create_memory.ts";

const IDEMPOTENCY_KEY = "123e4567-e89b-42d3-a456-426614174000";

type Row = {
  memory_key: string;
  title: string;
  canon_status: string;
  created_at: string;
  details: Record<string, unknown>;
};

type DbResult = {
  data: Row | null;
  error: { code?: string; message: string } | null;
};

function fakeClient(options: {
  existing?: Row | null;
  insert?: DbResult;
  raced?: Row | null;
  selectError?: DbResult["error"];
} = {}) {
  const inserted: Record<string, unknown>[] = [];
  let selectCount = 0;
  const client = {
    from(table: string) {
      assert.equal(table, "charmaine_memories");
      return {
        select(columns: string) {
          assert.equal(
            columns,
            "memory_key,title,canon_status,created_at,details",
          );
          return {
            eq(column: string, value: string) {
              assert.equal(column, "details->>idempotency_key");
              assert.equal(value, IDEMPOTENCY_KEY);
              return {
                maybeSingle() {
                  const data = selectCount++ === 0
                    ? options.existing ?? null
                    : options.raced ?? options.existing ?? null;
                  return Promise.resolve({
                    data,
                    error: options.selectError ?? null,
                  });
                },
              };
            },
          };
        },
        insert(row: Record<string, unknown>) {
          inserted.push(row);
          return {
            select(columns: string) {
              assert.equal(
                columns,
                "memory_key,title,canon_status,created_at,details",
              );
              return {
                single() {
                  return Promise.resolve(
                    options.insert ?? {
                      data: {
                        memory_key: String(row.memory_key),
                        title: String(row.title),
                        canon_status: "draft",
                        created_at: "2026-11-23T00:00:00Z",
                        details: row.details as Record<string, unknown>,
                      },
                      error: null,
                    },
                  );
                },
              };
            },
          };
        },
      };
    },
  };
  return {
    client: client as unknown as CreateMemoryClient,
    inserted,
    get selectCount() {
      return selectCount;
    },
  };
}

function input(overrides: Record<string, unknown> = {}) {
  return createMemorySchema.parse({
    idempotency_key: IDEMPOTENCY_KEY,
    title: "Project Charmaine dimulai",
    memory_text: "Kami mulai menyusun otak memori Charmaine.",
    factual_core: ["Project Charmaine mulai disusun bersama Pit."],
    continuity_mode: "shared_experience",
    memory_type: "event",
    tags: ["project", "charmaine"],
    ...overrides,
  });
}

function payload(result: Awaited<ReturnType<typeof createMemory>>) {
  assert.ok(!result.isError);
  return JSON.parse(result.content[0].text) as {
    replayed: boolean;
    memory: Row;
  };
}

Deno.test("schema rejects ownership and canon overrides", () => {
  assert.throws(() => input({ owner_id: crypto.randomUUID() }));
  assert.throws(() => input({ canon_status: "canon" }));
  assert.throws(() => input({ importance: 6 }));
  assert.throws(() => input({ idempotency_key: "not-a-uuid" }));
  assert.throws(() => input({ memory_type: "plan" }));
  assert.throws(() => input({ perspective: "pit" }));
  assert.throws(() => input({ expected_at: "2026-12-01T12:00:00+07:00" }));
  assert.throws(() => input({ details: { canonization: {} } }));
  assert.throws(() => input({ details: { request_hash: "caller-value" } }));
  assert.throws(() => input({ details: { factual_core: ["bypass"] } }));
});

Deno.test("schema models human temporal precision without invented time", () => {
  assert.equal(
    input({
      temporal_precision: "day",
      occurred_on: "2024-02-29",
      event_year: 2024,
    }).occurred_on,
    "2024-02-29",
  );
  assert.equal(
    input({ temporal_precision: "year", event_year: 2014 }).event_year,
    2014,
  );
  assert.equal(
    input({ temporal_precision: "period", period: "awal masa SMP" }).period,
    "awal masa SMP",
  );

  assert.throws(() =>
    input({ temporal_precision: "day", occurred_on: "2023-02-29" })
  );
  assert.throws(() =>
    input({
      temporal_precision: "instant",
      occurred_at: "2026-11-23T12:00:00+07:00",
      event_year: 2025,
    })
  );
  assert.throws(() =>
    input({ temporal_precision: "unknown", event_year: 2026 })
  );
});

Deno.test("memory key is random and collision-resistant in shape", () => {
  const first = newMemoryKey();
  const second = newMemoryKey();
  assert.notEqual(first, second);
  assert.match(first, /^mem_[0-9a-f-]{36}$/);
});

Deno.test("create inserts an RLS-owned draft without owner input", async () => {
  const fake = fakeClient();
  const result = payload(
    await createMemory(
      fake.client,
      input({
        details: { note: "kept" },
        temporal_precision: "instant",
        occurred_at: "2026-11-23T12:00:00+07:00",
      }),
    ),
  );

  assert.equal(result.replayed, false);
  assert.equal(result.memory.canon_status, "draft");
  assert.equal(fake.inserted.length, 1);
  const row = fake.inserted[0];
  assert.ok(!("owner_id" in row));
  assert.ok(!("canon_status" in row));
  assert.equal(row.origin, "mcp_user_entry");
  assert.equal(row.category, "slice_of_life");
  assert.equal(row.perspective, "charmaine");
  assert.deepEqual(row.people, []);
  assert.equal((row.details as Record<string, unknown>).note, "kept");
  assert.equal((row.details as Record<string, unknown>).memory_type, "event");
  assert.deepEqual(
    (row.details as Record<string, unknown>).factual_core,
    ["Project Charmaine mulai disusun bersama Pit."],
  );
  assert.equal(
    (row.details as Record<string, unknown>).continuity_mode,
    "shared_experience",
  );
  assert.equal(
    (row.details as Record<string, unknown>).temporal_precision,
    "instant",
  );
  assert.deepEqual(
    (row.details as Record<string, unknown>).uncertain_fields,
    [],
  );
  assert.equal(
    (row.details as Record<string, unknown>).occurred_at,
    "2026-11-23T12:00:00+07:00",
  );
  assert.ok(!("expected_at" in (row.details as Record<string, unknown>)));
  assert.equal(
    (row.details as Record<string, unknown>).idempotency_key,
    IDEMPOTENCY_KEY,
  );
  assert.match(
    String((row.details as Record<string, unknown>).request_hash),
    /^[0-9a-f]{64}$/,
  );
});

Deno.test("matching replay returns existing row without insert", async () => {
  const parsed = input();
  const firstFake = fakeClient();
  await createMemory(firstFake.client, parsed);
  const inserted = firstFake.inserted[0];
  const existing: Row = {
    memory_key: String(inserted.memory_key),
    title: String(inserted.title),
    canon_status: "draft",
    created_at: "2026-11-23T00:00:00Z",
    details: inserted.details as Record<string, unknown>,
  };
  const replayFake = fakeClient({ existing });
  const result = payload(await createMemory(replayFake.client, parsed));
  assert.equal(result.replayed, true);
  assert.equal(replayFake.inserted.length, 0);
});

Deno.test("reusing an idempotency key for another request is rejected", async () => {
  const parsed = input();
  const firstFake = fakeClient();
  await createMemory(firstFake.client, parsed);
  const inserted = firstFake.inserted[0];
  const existing: Row = {
    memory_key: String(inserted.memory_key),
    title: String(inserted.title),
    canon_status: "draft",
    created_at: "2026-11-23T00:00:00Z",
    details: inserted.details as Record<string, unknown>,
  };
  const replayFake = fakeClient({ existing });
  const result = await createMemory(
    replayFake.client,
    input({ title: "Permintaan yang berbeda" }),
  );
  assert.equal(result.isError, true);
  assert.equal(replayFake.inserted.length, 0);
  assert.match(result.content[0].text, /sudah dipakai/);
});

Deno.test("unique race is resolved only through an RLS-visible matching row", async () => {
  const parsed = input();
  const seedFake = fakeClient();
  await createMemory(seedFake.client, parsed);
  const inserted = seedFake.inserted[0];
  const raced: Row = {
    memory_key: String(inserted.memory_key),
    title: String(inserted.title),
    canon_status: "draft",
    created_at: "2026-11-23T00:00:00Z",
    details: inserted.details as Record<string, unknown>,
  };
  const fake = fakeClient({
    insert: {
      data: null,
      error: { code: "23505", message: "unique violation" },
    },
    raced,
  });
  const result = payload(await createMemory(fake.client, parsed));
  assert.equal(result.replayed, true);
  assert.equal(fake.selectCount, 2);
});

Deno.test("database errors do not leak database details", async () => {
  const selectFailure = fakeClient({
    selectError: { message: "sensitive database detail" },
  });
  const selectResult = await createMemory(selectFailure.client, input());
  assert.equal(selectResult.isError, true);
  assert.doesNotMatch(selectResult.content[0].text, /sensitive/);

  const insertFailure = fakeClient({
    insert: { data: null, error: { message: "secret constraint" } },
  });
  const insertResult = await createMemory(insertFailure.client, input());
  assert.equal(insertResult.isError, true);
  assert.doesNotMatch(insertResult.content[0].text, /secret/);
});

Deno.test("stored metadata stays within the correction RPC ceiling", async () => {
  const fake = fakeClient();
  const result = await createMemory(
    fake.client,
    input({
      factual_core: Array.from({ length: 20 }, () => "f".repeat(500)),
      uncertain_fields: Array.from({ length: 50 }, () => "u".repeat(120)),
      details: { note: "n".repeat(3_000) },
    }),
  );

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /terlalu besar/);
  assert.equal(fake.inserted.length, 0);
});
