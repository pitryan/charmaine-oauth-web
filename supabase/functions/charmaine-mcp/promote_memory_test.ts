import assert from "node:assert/strict";
import {
  promoteMemory,
  type PromoteMemoryClient,
  promoteMemorySchema,
} from "./promote_memory.ts";

type Failure = { message: string };

class FakeClient {
  rpcCalls: {
    functionName: string;
    args: Record<string, unknown>;
  }[] = [];
  data: unknown = {
    memory_key: "memory-001",
    title: "Kenangan uji",
    canon_status: "canon",
    promoted: true,
  };
  error: Failure | null = null;
  throwError = false;

  rpc(functionName: string, args: Record<string, unknown>) {
    this.rpcCalls.push({ functionName, args });
    return {
      maybeSingle: () => {
        if (this.throwError) {
          return Promise.reject(new Error("transport secret"));
        }
        return Promise.resolve({ data: this.data, error: this.error });
      },
    };
  }
}

function fixture() {
  const fake = new FakeClient();
  return {
    fake,
    client: fake as unknown as PromoteMemoryClient,
  };
}

function args(note?: string) {
  return promoteMemorySchema.parse({
    memory_key: "memory-001",
    expected_title: "Kenangan uji",
    confirmation: "JADIKAN CANON",
    ...(note === undefined ? {} : { note }),
  });
}

function payload(result: Awaited<ReturnType<typeof promoteMemory>>) {
  assert.equal(result.isError, undefined);
  return JSON.parse(result.content[0].text) as {
    promoted: boolean;
    already_canon: boolean;
    memory: {
      memory_key: string;
      title: string;
      canon_status: string;
    };
  };
}

Deno.test("schema requires an exact canon target and confirmation", () => {
  assert.deepEqual(
    promoteMemorySchema.parse({
      memory_key: " memory-001 ",
      expected_title: " Kenangan uji ",
      confirmation: "JADIKAN CANON",
      note: " Sudah dikonfirmasi Pit. ",
    }),
    {
      memory_key: "memory-001",
      expected_title: "Kenangan uji",
      confirmation: "JADIKAN CANON",
      note: "Sudah dikonfirmasi Pit.",
    },
  );

  for (
    const invalid of [
      {
        memory_key: "memory-001",
        expected_title: "Kenangan uji",
      },
      {
        memory_key: "memory-001",
        expected_title: "Kenangan uji",
        confirmation: "jadikan canon",
      },
      {
        memory_key: "memory-001",
        expected_title: " ",
        confirmation: "JADIKAN CANON",
      },
      {
        memory_key: " ",
        expected_title: "Kenangan uji",
        confirmation: "JADIKAN CANON",
      },
      {
        memory_key: "memory-001",
        expected_title: "Kenangan uji",
        confirmation: "JADIKAN CANON",
        note: " ",
      },
      {
        memory_key: "memory-001",
        expected_title: "Kenangan uji",
        confirmation: "JADIKAN CANON",
        owner_id: crypto.randomUUID(),
      },
    ]
  ) assert.throws(() => promoteMemorySchema.parse(invalid));
});

Deno.test("promotion uses one atomic RPC with exact arguments", async () => {
  const { fake, client } = fixture();
  const result = payload(
    await promoteMemory(client, args("Project selesai dan dikonfirmasi.")),
  );

  assert.deepEqual(fake.rpcCalls, [{
    functionName: "promote_charmaine_memory",
    args: {
      p_memory_key: "memory-001",
      p_expected_title: "Kenangan uji",
      p_confirmation: "JADIKAN CANON",
      p_note: "Project selesai dan dikonfirmasi.",
    },
  }]);
  assert.deepEqual(result, {
    promoted: true,
    already_canon: false,
    memory: {
      memory_key: "memory-001",
      title: "Kenangan uji",
      canon_status: "canon",
    },
  });
});

Deno.test("already-canon replay is returned as idempotent success", async () => {
  const { fake, client } = fixture();
  fake.data = {
    memory_key: "memory-001",
    title: "Kenangan uji",
    canon_status: "canon",
    promoted: false,
  };

  const result = payload(await promoteMemory(client, args()));
  assert.equal(result.promoted, false);
  assert.equal(result.already_canon, true);
  assert.equal(fake.rpcCalls[0].args.p_note, null);
});

Deno.test(
  "missing, rejected, malformed, and stale results share one safe error",
  async () => {
    const missing = fixture();
    missing.fake.data = null;
    const rejected = fixture();
    rejected.fake.error = { message: "database policy secret" };
    const malformed = fixture();
    malformed.fake.data = {
      memory_key: "memory-001",
      title: "Kenangan uji",
      canon_status: "draft",
      promoted: true,
    };
    const stale = fixture();
    stale.fake.data = {
      memory_key: "other-memory",
      title: "Kenangan uji",
      canon_status: "canon",
      promoted: true,
    };

    const results = await Promise.all([
      promoteMemory(missing.client, args()),
      promoteMemory(rejected.client, args()),
      promoteMemory(malformed.client, args()),
      promoteMemory(stale.client, args()),
    ]);
    assert.equal(results[0].isError, true);
    for (const result of results) {
      assert.deepEqual(result, results[0]);
      assert.doesNotMatch(
        result.content[0].text,
        /secret|database|other-memory/,
      );
    }
  },
);

Deno.test("transport failures use the same non-leaking response", async () => {
  const { fake, client } = fixture();
  fake.throwError = true;
  const result = await promoteMemory(client, args());
  assert.equal(result.isError, true);
  assert.doesNotMatch(result.content[0].text, /transport secret/);
});
