import assert from "node:assert/strict";
import {
  deleteMemory,
  type DeleteMemoryClient,
  deleteMemorySchema,
} from "./delete_memory.ts";

const MEMORY_KEY = "mem_123e4567-e89b-42d3-a456-426614174000";
const TITLE = "Hari kita menyalakan otak Charmaine";

type RpcResult = {
  data: unknown;
  error: { message: string } | null;
};

function fakeClient(result: RpcResult) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  let thrown: unknown;
  const client = {
    rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      if (thrown !== undefined) throw thrown;
      return Promise.resolve(result);
    },
  };
  return {
    client: client as unknown as DeleteMemoryClient,
    calls,
    throw(error: unknown) {
      thrown = error;
    },
  };
}

function input(overrides: Record<string, unknown> = {}) {
  return deleteMemorySchema.parse({
    memory_key: MEMORY_KEY,
    expected_title: TITLE,
    confirmation: "HAPUS PERMANEN",
    ...overrides,
  });
}

function payload(result: Awaited<ReturnType<typeof deleteMemory>>) {
  assert.ok(!result.isError);
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

Deno.test("schema requires an exact permanent-delete confirmation", () => {
  assert.deepEqual(input({ memory_key: `  ${MEMORY_KEY}  ` }), {
    memory_key: MEMORY_KEY,
    expected_title: TITLE,
    confirmation: "HAPUS PERMANEN",
  });
  for (
    const args of [
      { confirmation: "hapus permanen" },
      { confirmation: "HAPUS PERMANEN " },
      { confirmation: true },
      { memory_key: "   " },
      { expected_title: "   " },
      { owner_id: crypto.randomUUID() },
      { canon_status: "draft" },
    ]
  ) assert.throws(() => input(args));
});

Deno.test("owned memory is deleted through the atomic RPC", async () => {
  const fake = fakeClient({
    data: [{
      memory_key: MEMORY_KEY,
      title: TITLE,
      canon_status: "canon",
      memory_text: "must not be returned",
      details: { secret: "must not be returned" },
    }],
    error: null,
  });

  const result = payload(await deleteMemory(fake.client, input()));

  assert.deepEqual(fake.calls, [{
    name: "delete_charmaine_memory",
    args: {
      p_memory_key: MEMORY_KEY,
      p_expected_title: TITLE,
      p_confirmation: "HAPUS PERMANEN",
    },
  }]);
  assert.deepEqual(result, {
    deleted: true,
    already_absent: false,
    memory: {
      memory_key: MEMORY_KEY,
      title: TITLE,
      canon_status: "canon",
    },
  });
});

Deno.test(
  "missing, foreign, title-mismatched, and repeated deletes are indistinguishable",
  async () => {
    for (const data of [[], null]) {
      const fake = fakeClient({ data, error: null });
      assert.deepEqual(payload(await deleteMemory(fake.client, input())), {
        deleted: false,
        already_absent: true,
      });
    }
  },
);

Deno.test("database errors do not leak database details", async () => {
  const fake = fakeClient({
    data: null,
    error: { message: "sensitive database detail" },
  });
  const result = await deleteMemory(fake.client, input());
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Gagal menghapus memori/);
  assert.doesNotMatch(result.content[0].text, /sensitive/);

  const thrown = fakeClient({ data: null, error: null });
  thrown.throw(new Error("secret transport failure"));
  const thrownResult = await deleteMemory(thrown.client, input());
  assert.equal(thrownResult.isError, true);
  assert.match(thrownResult.content[0].text, /Gagal menghapus memori/);
  assert.doesNotMatch(thrownResult.content[0].text, /secret|transport/);
});
