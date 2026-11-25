import assert from "node:assert/strict";
import {
  searchMemories,
  type SearchMemoriesClient,
  searchMemoriesSchema,
} from "./search_memories.ts";

type Row = Record<string, unknown> & {
  memory_key: string;
  title: string;
  memory_text: string;
  canon_status: string;
  created_at: string;
  details?: Record<string, unknown>;
};

type Result = {
  data: Row[] | null;
  error: { message: string } | null;
};

function literalNeedle(pattern: string): string {
  const inner = pattern.slice(1, -1);
  let result = "";
  for (let index = 0; index < inner.length; index += 1) {
    if (inner[index] === "\\" && index + 1 < inner.length) index += 1;
    result += inner[index];
  }
  return result.toLowerCase();
}

class FakeQuery implements PromiseLike<Result> {
  selected?: string;
  search?: { column: string; pattern: string };
  filters: [string, string][] = [];
  ordering?: { column: string; ascending: boolean };
  maximum?: number;

  constructor(
    private source: Row[],
    private errors: Partial<Record<"title" | "memory_text", string>>,
  ) {}

  select(columns: string) {
    this.selected = columns;
    return this;
  }

  ilike(column: string, pattern: string) {
    this.search = { column, pattern };
    return this;
  }

  eq(column: string, value: string) {
    this.filters.push([column, value]);
    return this;
  }

  order(column: string, options: { ascending: boolean }) {
    this.ordering = { column, ...options };
    return this;
  }

  limit(maximum: number) {
    this.maximum = maximum;
    return this;
  }

  then<T = Result, U = never>(
    resolve?: ((value: Result) => T | PromiseLike<T>) | null,
    reject?: ((reason: unknown) => U | PromiseLike<U>) | null,
  ): Promise<T | U> {
    const search = this.search;
    if (!search) throw new Error("Missing ilike call");
    const errorMessage = this.errors[search.column as "title" | "memory_text"];
    if (errorMessage) {
      return Promise.resolve({ data: null, error: { message: errorMessage } })
        .then(resolve, reject);
    }

    const needle = literalNeedle(search.pattern);
    const filtered = this.source.filter((row) => {
      if (!String(row[search.column] ?? "").toLowerCase().includes(needle)) {
        return false;
      }
      return this.filters.every(([column, value]) => {
        if (column === "details->>memory_type") {
          return row.details?.memory_type === value;
        }
        return row[column] === value;
      });
    });
    if (this.ordering) {
      const { column, ascending } = this.ordering;
      filtered.sort((left, right) =>
        String(left[column]).localeCompare(String(right[column])) *
        (ascending ? 1 : -1)
      );
    }
    const data = this.maximum === undefined
      ? filtered
      : filtered.slice(0, this.maximum);
    return Promise.resolve({ data, error: null }).then(resolve, reject);
  }
}

function fixture(
  source: Row[],
  errors: Partial<Record<"title" | "memory_text", string>> = {},
) {
  const queries: FakeQuery[] = [];
  const tables: string[] = [];
  const fake = {
    from(table: string) {
      tables.push(table);
      const query = new FakeQuery(source, errors);
      queries.push(query);
      return query;
    },
  };
  const client = fake as unknown as SearchMemoriesClient;
  return {
    queries,
    tables,
    run: (args: unknown) =>
      searchMemories(client, searchMemoriesSchema.parse(args)),
  };
}

function payload(result: Awaited<ReturnType<typeof searchMemories>>) {
  assert.ok(!result.isError);
  return JSON.parse(result.content[0].text) as {
    count: number;
    memories: Row[];
  };
}

const rows: Row[] = [
  {
    memory_key: "title-only",
    title: "Hari hujan pertama",
    memory_text: "Kami menunggu di teras.",
    canon_status: "canon",
    created_at: "2026-11-24T04:00:00Z",
    details: { memory_type: "event" },
  },
  {
    memory_key: "text-only",
    title: "Menunggu bersama",
    memory_text: "Hari hujan itu terasa hangat.",
    canon_status: "draft",
    created_at: "2026-11-24T03:00:00Z",
    details: { memory_type: "event" },
  },
  {
    memory_key: "both",
    title: "Hari hujan di rumah",
    memory_text: "Aku masih mengingat hari hujan itu.",
    canon_status: "canon",
    created_at: "2026-11-24T05:00:00Z",
    details: { memory_type: "state" },
  },
];

Deno.test("search matches title and memory text, deduplicates, and sorts newest", async () => {
  const f = fixture(rows);
  const result = payload(await f.run({ query: "hari hujan", limit: 10 }));

  assert.deepEqual(result.memories.map((row) => row.memory_key), [
    "both",
    "title-only",
    "text-only",
  ]);
  assert.equal(result.count, 3);
  assert.ok(result.memories.every((row) => !("created_at" in row)));
  assert.deepEqual(f.tables, ["charmaine_memories", "charmaine_memories"]);
  assert.deepEqual(f.queries.map((query) => query.search?.column), [
    "title",
    "memory_text",
  ]);
});

Deno.test("filters and final limit apply to both searches", async () => {
  const source = [
    ...rows,
    {
      ...rows[0],
      memory_key: "newest-canon-event",
      created_at: "2026-11-24T06:00:00Z",
    },
  ];
  const f = fixture(source);
  const result = payload(
    await f.run({
      query: "hari hujan",
      canon_status: "canon",
      memory_type: "event",
      limit: 1,
    }),
  );

  assert.deepEqual(result.memories.map((row) => row.memory_key), [
    "newest-canon-event",
  ]);
  for (const query of f.queries) {
    assert.deepEqual(query.filters, [
      ["canon_status", "canon"],
      ["details->>memory_type", "event"],
    ]);
    assert.equal(query.maximum, 1);
    assert.deepEqual(query.ordering, {
      column: "created_at",
      ascending: false,
    });
  }
});

Deno.test("percent and underscore are escaped as literal search text", async () => {
  const source = [
    {
      ...rows[0],
      memory_key: "literal",
      title: "Kode %_ khusus",
    },
    {
      ...rows[1],
      memory_key: "wildcard-lookalike",
      title: "Kode ab khusus",
    },
  ];
  const f = fixture(source);
  const result = payload(await f.run({ query: "%_" }));

  assert.deepEqual(result.memories.map((row) => row.memory_key), ["literal"]);
  assert.deepEqual(f.queries.map((query) => query.search?.pattern), [
    "%\\%\\_%",
    "%\\%\\_%",
  ]);
});

Deno.test("one failed query fails the combined search", async () => {
  const f = fixture(rows, { title: "synthetic database error" });
  const result = await f.run({ query: "hari hujan" });
  assert.equal(result.isError, true);
  assert.equal(result.content[0].text, "Pencarian memori gagal.");
  assert.doesNotMatch(result.content[0].text, /synthetic database error/);
});

Deno.test("schema trims input and rejects unsupported fields", () => {
  assert.deepEqual(searchMemoriesSchema.parse({ query: "  hujan  " }), {
    query: "hujan",
    limit: 5,
  });
  assert.throws(() =>
    searchMemoriesSchema.parse({ query: "hujan", owner_id: "foreign" })
  );
});
