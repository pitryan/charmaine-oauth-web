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
    memory_type: "plan",
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
  assert.throws(() => input({ details: { canonization: {} } }));
  assert.throws(() => input({ details: { request_hash: "caller-value" } }));
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
        expected_at: "2026-12-01T12:00:00+07:00",
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
  assert.equal((row.details as Record<string, unknown>).memory_type, "plan");
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
