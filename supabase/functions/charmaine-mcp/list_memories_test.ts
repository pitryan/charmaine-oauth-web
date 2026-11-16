import assert from "node:assert/strict";
import { normalizeCategory } from "./categories.ts";
import {
  listMemories,
  type ListMemoriesClient,
  listMemoriesSchema,
} from "./list_memories.ts";

const categories = [
  ["sekolah_dan_kelas", ["sekolah", "kelas", "sd"]],
  ["rumah_dan_keluarga", ["rumah", "keluarga"]],
  ["teman_dan_permainan", ["teman", "permainan", "main"]],
  ["kantin_dan_perjalanan", ["kantin", "perjalanan"]],
  ["hobi_dan_imajinasi", ["hobi", "imajinasi"]],
  ["hal_kecil_yang_membekas", ["hal kecil", "momen kecil"]],
  ["kesan_sepintas_tentang_pit", ["pit", "kesan tentang pit"]],
] as const;

type Row = Record<string, unknown> & {
  memory_key: string;
  school_year: string;
  category: string;
  canon_status: string;
};
type Result = {
  data: Row[] | null;
  error: { message: string } | null;
  count: number | null;
};

// Synthetic, deliberately unsorted data; these are not production memories.
const rows: Row[] = [
  {
    memory_key: "m05",
    school_year: "2009/2010",
    category: "sekolah_dan_kelas",
    canon_status: "draft",
  },
  {
    memory_key: "m01",
    school_year: "2009/2010",
    category: "sekolah_dan_kelas",
    canon_status: "canon",
  },
  {
    memory_key: "m09",
    school_year: "2010/2011",
    category: "sekolah_dan_kelas",
    canon_status: "canon",
  },
  {
    memory_key: "m03",
    school_year: "2009/2010",
    category: "rumah_dan_keluarga",
    canon_status: "draft",
  },
  {
    memory_key: "m08",
    school_year: "2009/2010",
    category: "sekolah_dan_kelas",
    canon_status: "canon",
  },
  {
    memory_key: "m02",
    school_year: "2010/2011",
    category: "rumah_dan_keluarga",
    canon_status: "canon",
  },
];

class FakeQuery implements PromiseLike<Result> {
  filters: [string, string][] = [];
  ordering?: { column: string; ascending: boolean };
  bounds?: [number, number];

  constructor(private source: Row[], private override?: Result) {}

  eq(column: string, value: string) {
    this.filters.push([column, value]);
    return this;
  }
  order(column: string, options: { ascending: boolean }) {
    this.ordering = { column, ...options };
    return this;
  }
  range(from: number, to: number) {
    this.bounds = [from, to];
    return this;
  }
  then<T = Result, U = never>(
    resolve?: ((value: Result) => T | PromiseLike<T>) | null,
    reject?: ((reason: unknown) => U | PromiseLike<U>) | null,
  ): Promise<T | U> {
    const filtered = this.source.filter((row) =>
      this.filters.every(([column, value]) => row[column] === value)
    );
    const order = this.ordering;
    if (order) {
      filtered.sort((a, b) =>
        String(a[order.column]).localeCompare(String(b[order.column])) *
        (order.ascending ? 1 : -1)
      );
    }
    const result = this.override ?? {
      data: this.bounds
        ? filtered.slice(this.bounds[0], this.bounds[1] + 1)
        : filtered,
      count: filtered.length,
      error: null,
    };
    return Promise.resolve(result).then(resolve, reject);
  }
}

function fixture(source = rows, override?: Result) {
  const query = new FakeQuery(source, override);
  const calls: { table?: string; columns?: string; count?: string } = {};
  const fake = {
    from(table: string) {
      calls.table = table;
      return {
        select(columns: string, options: { count: string }) {
          calls.columns = columns;
          calls.count = options.count;
          return query;
        },
      };
    },
  };
  // The fake implements only the read-query methods exercised by this handler.
  const client = fake as unknown as ListMemoriesClient;
  return {
    query,
    calls,
    run: (args: unknown = {}) =>
      listMemories(client, listMemoriesSchema.parse(args)),
  };
}

function payload(result: Awaited<ReturnType<typeof listMemories>>) {
  assert.ok(!result.isError);
  assert.equal(result.content[0].type, "text");
  return JSON.parse(result.content[0].text) as {
    count: number;
    total: number;
    offset: number;
    memories: Row[];
  };
}

for (const [canonical, aliases] of categories) {
  Deno.test(`canonical and aliases filter ${canonical}`, async () => {
    const source: Row[] = [{
      memory_key: "fixture",
      school_year: "2009/2010",
      category: canonical,
      canon_status: "draft",
      clarity: "fixture clarity",
    }];
    for (const category of [canonical, ...aliases]) {
      assert.equal(normalizeCategory(category), canonical);
      const f = fixture(source);
      const result = payload(await f.run({ category }));
      assert.deepEqual(f.query.filters, [["category", canonical]]);
      assert.deepEqual(result.memories, source);
      assert.equal(result.count, 1);
      assert.equal(result.total, 1);
    }
  });
}

Deno.test("case and repeated separators normalize known categories", () => {
  for (const [canonical] of categories) {
    for (
      const input of [
        `  ${canonical.toUpperCase()}  `,
        canonical.replaceAll("_", "   "),
        canonical.replaceAll("_", "--"),
        canonical.replaceAll("_", "__"),
      ]
    ) assert.equal(normalizeCategory(input), canonical);
  }
  assert.equal(
    normalizeCategory("  MoMeN   KeCiL  "),
    "hal_kecil_yang_membekas",
  );
  assert.equal(
    normalizeCategory("KESAN-TENTANG-PIT"),
    "kesan_sepintas_tentang_pit",
  );
  assert.equal(
    normalizeCategory(" \tHaL -_ KeCiL\n"),
    "hal_kecil_yang_membekas",
  );
});

Deno.test("unknown and prototype-like categories remain exact filters", async () => {
  for (
    const category of [
      "sekolahh",
      " Custom Category ",
      "constructor",
      "__proto__",
      "toString",
      "sekolah%",
      "sekolah,keluarga",
      "teman sekolah",
      "sekolah keluarga",
      "   ",
    ]
  ) {
    assert.equal(normalizeCategory(category), category);
    const f = fixture();
    assert.deepEqual(payload(await f.run({ category })), {
      count: 0,
      total: 0,
      offset: 0,
      memories: [],
    });
    assert.deepEqual(f.query.filters, [["category", category]]);
  }
});

Deno.test("future canonical categories remain directly queryable", async () => {
  const source = [{ ...rows[0], category: "kategori_periode_baru" }];
  const f = fixture(source);
  assert.deepEqual(
    payload(await f.run({ category: "kategori_periode_baru" })).memories,
    source,
  );
  assert.deepEqual(f.query.filters, [["category", "kategori_periode_baru"]]);
});

Deno.test("omitted filters retain projection, exact count, order, and defaults", async () => {
  const f = fixture();
  const result = payload(await f.run());
  assert.deepEqual(f.calls, {
    table: "charmaine_memories",
    columns:
      "memory_key,title,memory_text,school_year,category,canon_status,clarity",
    count: "exact",
  });
  assert.deepEqual(f.query.filters, []);
  assert.deepEqual(f.query.ordering, { column: "memory_key", ascending: true });
  assert.deepEqual(f.query.bounds, [0, 9]);
  assert.equal(result.count, 6);
  assert.equal(result.total, 6);
  assert.equal(result.offset, 0);
  assert.deepEqual(result.memories.map((row) => row.memory_key), [
    "m01",
    "m02",
    "m03",
    "m05",
    "m08",
    "m09",
  ]);
});

Deno.test("year-only filter preserves draft and canon statuses", async () => {
  const f = fixture();
  const result = payload(await f.run({ school_year: "2009/2010" }));
  assert.deepEqual(f.query.filters, [["school_year", "2009/2010"]]);
  assert.deepEqual(result.memories.map((row) => row.memory_key), [
    "m01",
    "m03",
    "m05",
    "m08",
  ]);
  assert.deepEqual(result.memories.map((row) => row.canon_status), [
    "canon",
    "draft",
    "draft",
    "canon",
  ]);
  assert.equal(result.count, 4);
  assert.equal(result.total, 4);
});

Deno.test("combined filters count all matches before applying pagination", async () => {
  const f = fixture();
  const result = payload(
    await f.run({
      school_year: "2009/2010",
      category: "sd",
      limit: 2,
      offset: 1,
    }),
  );
  assert.deepEqual([...f.query.filters].sort(), [
    ["category", "sekolah_dan_kelas"],
    ["school_year", "2009/2010"],
  ]);
  assert.deepEqual(f.query.bounds, [1, 2]);
  assert.deepEqual(result.memories.map((row) => row.memory_key), [
    "m05",
    "m08",
  ]);
  assert.equal(result.count, 2);
  assert.equal(result.total, 3);
  assert.equal(result.offset, 1);
});

Deno.test("successive and partial pages preserve total and stable order", async () => {
  const first = payload(await fixture().run({ category: "kelas", limit: 2 }));
  const second = payload(
    await fixture().run({ category: "kelas", limit: 2, offset: 2 }),
  );
  const partial = payload(
    await fixture().run({ category: "kelas", limit: 3, offset: 3 }),
  );
  assert.deepEqual(first.memories.map((row) => row.memory_key), ["m01", "m05"]);
  assert.deepEqual(second.memories.map((row) => row.memory_key), [
    "m08",
    "m09",
  ]);
  assert.deepEqual(partial.memories.map((row) => row.memory_key), ["m09"]);
  assert.deepEqual([first.count, second.count, partial.count], [2, 2, 1]);
  assert.deepEqual([first.total, second.total, partial.total], [4, 4, 4]);
});

Deno.test("nonmatching year returns empty data and zero total", async () => {
  assert.deepEqual(payload(await fixture().run({ school_year: "2099/2100" })), {
    count: 0,
    total: 0,
    offset: 0,
    memories: [],
  });
});

Deno.test("empty page preserves supplied total", async () => {
  const f = fixture([], { data: [], count: 4, error: null });
  assert.deepEqual(payload(await f.run({ offset: 99 })), {
    count: 0,
    total: 4,
    offset: 99,
    memories: [],
  });
});

Deno.test("null data/count retain existing fallbacks", async () => {
  const f = fixture([], { data: null, count: null, error: null });
  assert.deepEqual(payload(await f.run({ offset: 2 })), {
    count: 0,
    total: 0,
    offset: 2,
    memories: [],
  });
});

Deno.test("query errors including range errors remain MCP errors", async () => {
  for (
    const message of [
      "fixture query failure",
      "Requested range not satisfiable",
    ]
  ) {
    const f = fixture([], { data: null, count: null, error: { message } });
    assert.deepEqual(await f.run({ offset: 99 }), {
      isError: true,
      content: [{ type: "text", text: `Gagal mengambil memori: ${message}` }],
    });
  }
});

Deno.test("schema retains defaults and rejects invalid pagination/filter types", () => {
  assert.deepEqual(listMemoriesSchema.parse({}), { limit: 10, offset: 0 });
  assert.equal(listMemoriesSchema.parse({ limit: 1 }).limit, 1);
  assert.equal(listMemoriesSchema.parse({ limit: 20 }).limit, 20);
  for (
    const args of [
      { limit: 0 },
      { limit: 21 },
      { limit: 1.5 },
      { limit: "2" },
      { offset: -1 },
      { offset: 0.5 },
      { offset: "1" },
      { limit: Infinity },
      { offset: NaN },
      { school_year: 2009 },
      { category: 1 },
    ]
  ) assert.throws(() => listMemoriesSchema.parse(args));
});
