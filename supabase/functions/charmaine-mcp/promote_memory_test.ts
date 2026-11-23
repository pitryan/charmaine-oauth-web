import assert from "node:assert/strict";
import {
  promoteMemory,
  type PromoteMemoryClient,
  promoteMemorySchema,
} from "./promote_memory.ts";

type Row = {
  memory_key: string;
  title: string;
  canon_status: string;
  details: Record<string, unknown>;
};

type Failure = { message: string };

class FakeClient {
  selectCalls: {
    table: string;
    columns: string;
    filters: [string, string][];
  }[] = [];
  updateCalls: {
    table: string;
    values: Record<string, unknown>;
    columns?: string;
    filters: [string, string][];
  }[] = [];
  selectError?: Failure;
  updateError?: Failure;
  concurrentPromotion = false;

  constructor(public rows: Row[]) {}

  from(table: string) {
    return {
      select: (columns: string) => {
        const filters: [string, string][] = [];
        this.selectCalls.push({ table, columns, filters });
        const query = {
          eq(column: string, value: string) {
            filters.push([column, value]);
            return query;
          },
          maybeSingle: () => {
            if (this.selectError) {
              return Promise.resolve({ data: null, error: this.selectError });
            }
            const data =
              this.rows.find((row) =>
                filters.every(([column, value]) =>
                  String(row[column as keyof Row]) === value
                )
              ) ?? null;
            return Promise.resolve({ data, error: null });
          },
        };
        return query;
      },
      update: (values: Record<string, unknown>) => {
        const filters: [string, string][] = [];
        const call = { table, values, filters } as {
          table: string;
          values: Record<string, unknown>;
          columns?: string;
          filters: [string, string][];
        };
        this.updateCalls.push(call);
        const query = {
          eq(column: string, value: string) {
            filters.push([column, value]);
            return query;
          },
          select(columns: string) {
            call.columns = columns;
            return query;
          },
          maybeSingle: () => {
            if (this.updateError) {
              return Promise.resolve({ data: null, error: this.updateError });
            }
            const row = this.rows.find((candidate) =>
              filters.every(([column, value]) =>
                String(candidate[column as keyof Row]) === value
              )
            );
            if (!row) return Promise.resolve({ data: null, error: null });
            Object.assign(row, values);
            if (this.concurrentPromotion) {
              return Promise.resolve({ data: null, error: null });
            }
            return Promise.resolve({ data: row, error: null });
          },
        };
        return query;
      },
    };
  }
}

function fixture(
  canonStatus = "draft",
  details: Record<string, unknown> = {},
) {
  const fake = new FakeClient([{
    memory_key: "memory-001",
    title: "Kenangan uji",
    canon_status: canonStatus,
    details,
  }]);
  return {
    fake,
    client: fake as unknown as PromoteMemoryClient,
  };
}

function payload(result: Awaited<ReturnType<typeof promoteMemory>>) {
  assert.equal(result.isError, undefined);
  return JSON.parse(result.content[0].text) as {
    promoted: boolean;
    already_canon: boolean;
    memory: Row;
  };
}

Deno.test(
  "schema rejects caller-controlled ownership, status, and invalid metadata",
  () => {
    for (
      const args of [
        { memory_key: "memory-001", owner_id: crypto.randomUUID() },
        { memory_key: "memory-001", canon_status: "canon" },
        { memory_key: "memory-001", occurred_at: "yesterday" },
        { memory_key: "memory-001", note: "   " },
        { memory_key: "   " },
      ]
    ) assert.throws(() => promoteMemorySchema.parse(args));
  },
);

Deno.test(
  "draft promotion preserves details and records canonization metadata",
  async () => {
    const { fake, client } = fixture("draft", {
      existing: "kept",
      canonization: { provenance: "kept" },
    });
    const result = payload(
      await promoteMemory(
        client,
        promoteMemorySchema.parse({
          memory_key: " memory-001 ",
          occurred_at: "2026-11-23T10:00:00+07:00",
          note: "Project selesai dan sudah dikonfirmasi.",
        }),
        () => new Date("2026-11-23T04:00:00.000Z"),
      ),
    );

    assert.deepEqual(result, {
      promoted: true,
      already_canon: false,
      memory: {
        memory_key: "memory-001",
        title: "Kenangan uji",
        canon_status: "canon",
      },
    });
    assert.deepEqual(fake.updateCalls[0].filters, [
      ["memory_key", "memory-001"],
      ["canon_status", "draft"],
    ]);
    assert.deepEqual(fake.rows[0].details, {
      existing: "kept",
      occurred_at: "2026-11-23T10:00:00+07:00",
      canonization: {
        provenance: "kept",
        canonized_at: "2026-11-23T04:00:00.000Z",
        occurred_at: "2026-11-23T10:00:00+07:00",
        note: "Project selesai dan sudah dikonfirmasi.",
      },
    });
  },
);

Deno.test("already-canon replay succeeds without another update", async () => {
  const { fake, client } = fixture("canon", { existing: true });
  const result = payload(
    await promoteMemory(
      client,
      promoteMemorySchema.parse({ memory_key: "memory-001" }),
    ),
  );
  assert.equal(result.promoted, false);
  assert.equal(result.already_canon, true);
  assert.equal(fake.updateCalls.length, 0);
  assert.deepEqual(fake.rows[0].details, { existing: true });
});

Deno.test(
  "missing and non-promotable rows use the same non-leaking response",
  async () => {
    const missing = new FakeClient([]);
    const archived = fixture("archived");
    const plan = fixture("draft", { memory_type: "plan" });
    const args = promoteMemorySchema.parse({ memory_key: "memory-001" });
    const missingResult = await promoteMemory(
      missing as unknown as PromoteMemoryClient,
      args,
    );
    const archivedResult = await promoteMemory(archived.client, args);
    const planResult = await promoteMemory(plan.client, args);
    assert.equal(missingResult.isError, true);
    assert.deepEqual(missingResult, archivedResult);
    assert.deepEqual(missingResult, planResult);
    assert.equal(missing.updateCalls.length, 0);
    assert.equal(archived.fake.updateCalls.length, 0);
    assert.equal(plan.fake.updateCalls.length, 0);
  },
);

Deno.test("missing memory type remains promotable for legacy rows", async () => {
  const { fake, client } = fixture("draft", { legacy: true });
  const result = payload(
    await promoteMemory(
      client,
      promoteMemorySchema.parse({ memory_key: "memory-001" }),
    ),
  );
  assert.equal(result.promoted, true);
  assert.equal(fake.rows[0].canon_status, "canon");
});

Deno.test("concurrent promotion is returned as an idempotent replay", async () => {
  const { fake, client } = fixture();
  fake.concurrentPromotion = true;
  const result = payload(
    await promoteMemory(
      client,
      promoteMemorySchema.parse({ memory_key: "memory-001" }),
      () => new Date("2026-11-23T04:00:00.000Z"),
    ),
  );
  assert.equal(result.promoted, false);
  assert.equal(result.already_canon, true);
  assert.equal(fake.selectCalls.length, 2);
  assert.equal(fake.updateCalls.length, 1);
});

Deno.test("database failures are surfaced without leaking details", async () => {
  const readFailure = fixture();
  readFailure.fake.selectError = { message: "read denied" };
  const args = promoteMemorySchema.parse({ memory_key: "memory-001" });
  const readResult = await promoteMemory(readFailure.client, args);
  assert.equal(readResult.isError, true);
  assert.doesNotMatch(readResult.content[0].text, /read denied/);

  const updateFailure = fixture();
  updateFailure.fake.updateError = { message: "update denied" };
  const updateResult = await promoteMemory(updateFailure.client, args);
  assert.equal(updateResult.isError, true);
  assert.doesNotMatch(updateResult.content[0].text, /update denied/);
});
