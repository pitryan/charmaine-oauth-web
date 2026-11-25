import assert from "node:assert/strict";
import { EXPECTED } from "./fixtures.ts";
import { assertLocalUrl, localFetch } from "./safety.ts";
import {
  apiHeaders,
  authorize,
  beginAuthorization,
  decide,
  discovery,
  exchange,
  jsonResponse,
  jwtClaims,
  object,
  passwordLogin,
  readConfig,
  registerClient,
  type TestConfig,
  textField,
} from "./oauth.ts";

type Json = Record<string, unknown>;
class McpClient {
  private nextId = 1;
  private session?: string;
  private protocol = "2025-11-25";
  constructor(private config: TestConfig, private token: string) {}
  async response(
    method: string,
    params: Json = {},
    notification = false,
  ): Promise<Response> {
    const headers = apiHeaders(this.config, this.token);
    headers.set("Content-Type", "application/json");
    headers.set("Accept", "application/json, text/event-stream");
    headers.set("MCP-Protocol-Version", this.protocol);
    if (this.session) headers.set("Mcp-Session-Id", this.session);
    return await localFetch(this.config.mcpUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        ...(notification ? {} : { id: this.nextId++ }),
        method,
        params,
      }),
    });
  }
  async request(method: string, params: Json = {}): Promise<Json> {
    const response = await this.response(method, params);
    const raw = await response.text();
    assert.equal(response.status, 200, `MCP ${method} must succeed`);
    this.session = response.headers.get("Mcp-Session-Id") ?? this.session;
    let envelope: unknown;
    try {
      if (response.headers.get("content-type")?.includes("text/event-stream")) {
        const messages = raw.split(/\r?\n\r?\n/).map((event) =>
          event.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((
            line,
          ) => line.slice(5).trimStart()).join("\n")
        ).filter(Boolean).map((data) => JSON.parse(data));
        envelope = messages.find((message) => message.id === this.nextId - 1);
      } else envelope = JSON.parse(raw);
    } catch {
      throw new Error(`MCP ${method} response was not valid JSON/SSE`);
    }
    const message = object(envelope, `Missing MCP ${method} result`);
    assert.ok(!("error" in message), `MCP ${method} returned a protocol error`);
    return object(message.result, `Missing MCP ${method} result object`);
  }
  async initialize(): Promise<void> {
    const result = await this.request("initialize", {
      protocolVersion: this.protocol,
      capabilities: {},
      clientInfo: { name: "charmaine-local-integration", version: "1.0.0" },
    });
    this.protocol = textField(
      result.protocolVersion,
      "Missing negotiated protocol",
    );
    assert.equal(
      object(result.serverInfo, "Missing server information").name,
      "charmaine-mcp",
    );
    const notification = await this.response(
      "notifications/initialized",
      {},
      true,
    );
    await notification.body?.cancel();
    assert.ok(
      notification.status === 202 || notification.status === 200,
      "Initialization notification must be accepted",
    );
  }
  async tool(name: string, args: Json = {}): Promise<Json> {
    const result = await this.toolResult(name, args);
    assert.ok(!result.isError, `${name} must not return a tool error`);
    return result;
  }
  async toolResult(name: string, args: Json = {}): Promise<Json> {
    return await this.request("tools/call", { name, arguments: args });
  }
}
function contentText(result: Json): string {
  assert.ok(
    Array.isArray(result.content) && result.content.length > 0,
    "Expected MCP content",
  );
  const block = object(result.content[0], "Expected MCP content block");
  assert.equal(block.type, "text");
  return textField(block.text, "Expected MCP text");
}
function jsonContent(result: Json): Json {
  let value: unknown;
  try {
    value = JSON.parse(contentText(result));
  } catch {
    throw new Error("MCP tool returned invalid JSON content");
  }
  return object(value, "Expected MCP JSON object");
}
interface MemoryResult {
  count: number;
  total?: number;
  offset?: number;
  memories: Json[];
}
function memories(result: Json): MemoryResult {
  let value: unknown;
  try {
    value = JSON.parse(contentText(result));
  } catch {
    throw new Error("Memory tool returned invalid JSON content");
  }
  const data = object(value, "Expected memory result");
  assert.ok(Array.isArray(data.memories));
  return data as unknown as MemoryResult;
}
function keys(data: MemoryResult): string[] {
  return data.memories.map((row) =>
    textField(row.memory_key, "Missing memory key")
  );
}
async function expectList(
  client: McpClient,
  args: Json,
  expected: readonly string[],
  total = expected.length,
): Promise<MemoryResult> {
  const data = memories(await client.tool("list_memories", args));
  assert.deepEqual(keys(data), expected);
  assert.equal(data.count, expected.length);
  assert.equal(data.total, total);
  assert.equal(data.offset, args.offset ?? 0);
  return data;
}
async function deniedMcp(
  config: TestConfig,
  token?: string,
): Promise<Response> {
  const headers = apiHeaders(config, token);
  headers.set("Content-Type", "application/json");
  headers.set("Accept", "application/json, text/event-stream");
  const response = await localFetch(config.mcpUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    }),
  });
  await response.body?.cancel();
  assert.equal(
    response.status,
    401,
    "Missing, invalid, or expired user JWT must be rejected",
  );
  return response;
}
async function rest(
  config: TestConfig,
  token: string,
  suffix: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = apiHeaders(config, token);
  headers.set("Content-Type", "application/json");
  headers.set("Prefer", "return=representation");
  return await localFetch(
    `${config.apiUrl}/rest/v1/charmaine_memories${suffix}`,
    { ...init, headers },
  );
}
async function rpc(
  config: TestConfig,
  token: string,
  name: string,
  args: Json,
): Promise<Response> {
  const headers = apiHeaders(config, token);
  headers.set("Content-Type", "application/json");
  return await localFetch(`${config.apiUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers,
    body: JSON.stringify(args),
  });
}
Deno.test("real local OAuth, MCP and two-user RLS", async (t) => {
  const config = readConfig();
  const metadata = await discovery(config);
  const clientId = await registerClient(config, metadata);
  await t.step(
    "OAuth challenge, discovery, and invalid credentials",
    async () => {
      const denied = await deniedMcp(config);
      const challenge = denied.headers.get("WWW-Authenticate") ?? "";
      const match = /resource_metadata="([^"]+)"/i.exec(challenge);
      assert.ok(match, "Missing OAuth protected-resource discovery challenge");
      const response = await localFetch(assertLocalUrl(match[1]));
      const resource = await jsonResponse(
        response,
        "Protected-resource metadata",
      );
      assert.equal(response.status, 200);
      assert.ok(
        Array.isArray(resource.authorization_servers) &&
          resource.authorization_servers.includes(metadata.issuer),
        "Resource metadata must name the local issuer",
      );
      await deniedMcp(config, "not-a-valid-jwt");
    },
  );
  await t.step("PKCE mismatch, code replay, and denied consent", async () => {
    const login = await passwordLogin(config, config.users.a);
    const bad = await beginAuthorization(config, metadata, clientId);
    const badRedirect = await decide(
      config,
      bad,
      login,
      config.users.a,
      "approve",
    );
    const mismatch = await exchange(
      config,
      metadata,
      bad,
      textField(badRedirect.searchParams.get("code"), "Missing code"),
      "x".repeat(43),
    );
    assert.equal(mismatch.status, 400, "Wrong PKCE verifier must fail");
    assert.ok(!mismatch.data.access_token);
    const valid = await beginAuthorization(config, metadata, clientId);
    const validRedirect = await decide(
      config,
      valid,
      login,
      config.users.a,
      "approve",
    );
    const code = textField(
      validRedirect.searchParams.get("code"),
      "Missing code",
    );
    assert.equal((await exchange(config, metadata, valid, code)).status, 200);
    const replay = await exchange(config, metadata, valid, code);
    assert.equal(replay.status, 400);
    assert.ok(!replay.data.access_token);
    const deniedClient = await registerClient(config, metadata);
    const deniedRequest = await beginAuthorization(
      config,
      metadata,
      deniedClient,
    );
    await decide(config, deniedRequest, login, config.users.a, "deny");
  });
  await t.step(
    "both OAuth users retain isolated aliases, filters, pages and totals",
    async () => {
      for (
        const [user, expected, marker, foreign] of [
          [config.users.a, EXPECTED.ownerA, "A_ONLY", "B_ONLY"],
          [config.users.b, EXPECTED.ownerB, "B_ONLY", "A_ONLY"],
        ] as const
      ) {
        const issued = await authorize(config, metadata, clientId, user);
        const client = new McpClient(config, issued.access_token);
        await client.initialize();
        const listed = await client.request("tools/list");
        assert.ok(Array.isArray(listed.tools));
        assert.deepEqual(
          listed.tools.map((tool) => object(tool, "Expected tool").name).sort(),
          [
            "correct_memory",
            "create_memory",
            "delete_memory",
            "list_memories",
            "ping",
            "promote_memory",
            "search_memories",
          ],
        );
        assert.equal(
          contentText(await client.tool("ping")),
          "MCP Charmaine aktif!",
        );
        const all = await expectList(client, { limit: 20 }, expected.all);
        assert.ok(all.memories.every((row) => row.clarity === "unspecified"));
        const firstLegacy = all.memories[0];
        assert.equal(firstLegacy?.title, `LOCAL FIXTURE ${expected.all[0]}`);
        assert.equal(
          firstLegacy?.memory_text,
          `LOCAL FIXTURE shared-fixture ${marker} ${expected.all[0]}`,
        );
        assert.ok(firstLegacy && !("memory_type" in firstLegacy));
        assert.ok(firstLegacy && !("expected_at" in firstLegacy));
        if (marker === "A_ONLY") {
          assert.deepEqual(
            [...new Set(all.memories.map((row) => row.canon_status))].sort(),
            ["archived", "au", "canon", "draft"],
          );
        }
        await expectList(
          client,
          { school_year: "2009/2010", limit: 20 },
          expected.year2009,
        );
        await expectList(
          client,
          { school_year: "2010/2011", limit: 20 },
          expected.year2010,
        );
        for (
          const category of [
            "sekolah_dan_kelas",
            "sekolah",
            "kelas",
            "sd",
            " SEKOLAH--DAN KELAS ",
          ]
        ) await expectList(client, { category }, expected.school);
        const categoryCases = [
          [
            "rumah_dan_keluarga",
            ["rumah", "keluarga"],
            marker === "A_ONLY" ? ["LOCAL-007"] : ["LOCAL-006"],
          ],
          [
            "teman_dan_permainan",
            ["teman", "permainan", "main"],
            marker === "A_ONLY" ? ["LOCAL-009"] : [],
          ],
          [
            "kantin_dan_perjalanan",
            ["kantin", "perjalanan"],
            marker === "A_ONLY" ? ["LOCAL-011"] : [],
          ],
          [
            "hobi_dan_imajinasi",
            ["hobi", "imajinasi"],
            marker === "A_ONLY" ? ["LOCAL-013"] : [],
          ],
          ["hal_kecil_yang_membekas", [
            "hal kecil",
            "momen kecil",
            "MOMEN--KECIL",
          ], marker === "A_ONLY" ? ["LOCAL-015"] : []],
          [
            "kesan_sepintas_tentang_pit",
            ["pit", "kesan tentang pit"],
            marker === "A_ONLY" ? ["LOCAL-017"] : [],
          ],
        ] as const;
        for (const [canonical, aliases, expectedKeys] of categoryCases) {
          for (const category of [canonical, ...aliases]) {
            await expectList(client, { category }, expectedKeys);
          }
        }
        await expectList(
          client,
          { category: "sd", school_year: "2009/2010" },
          expected.schoolYear2009,
        );
        await expectList(client, { category: "sekolah keluarga" }, []);
        await expectList(
          client,
          { category: "sekolah", limit: 1, offset: 1 },
          expected.school.slice(1, 2),
          expected.school.length,
        );
        await expectList(
          client,
          { limit: 2, offset: expected.all.length - 1 },
          expected.all.slice(-1),
          expected.all.length,
        );
        await expectList(client, { school_year: "2099/2100" }, []);
        for (const query of ["shared-fixture", marker]) {
          const found = memories(
            await client.tool("search_memories", { query, limit: 10 }),
          );
          assert.deepEqual(keys(found).sort(), [...expected.all].sort());
          assert.equal(found.count, expected.all.length);
        }
        const hidden = memories(
          await client.tool("search_memories", { query: foreign, limit: 10 }),
        );
        assert.deepEqual(keys(hidden), []);
        assert.equal(hidden.count, 0);
      }
    },
  );
  await t.step(
    "legacy plans stay readable but require correction before canon",
    async () => {
      const issued = await authorize(
        config,
        metadata,
        clientId,
        config.users.a,
      );
      const client = new McpClient(config, issued.access_token);
      await client.initialize();

      const legacy = await expectList(
        client,
        { memory_type: "plan", canon_status: "draft", limit: 20 },
        ["LOCAL-017"],
      );
      assert.equal(
        legacy.memories[0]?.expected_at,
        "2030-01-01T09:00:00+07:00",
      );

      const rejected = await client.toolResult("promote_memory", {
        memory_key: "LOCAL-017",
        expected_title: "LOCAL FIXTURE LOCAL-017",
        confirmation: "JADIKAN CANON",
      });
      assert.equal(rejected.isError, true);

      const unconfirmedCorrection = await rpc(
        config,
        issued.access_token,
        "correct_charmaine_memory",
        {
          p_memory_key: "LOCAL-017",
          p_expected_title: "LOCAL FIXTURE LOCAL-017",
          p_confirmation: "tidak sah",
          p_changes: { memory_text: "must not be stored" },
        },
      );
      assert.equal(unconfirmedCorrection.status, 400);

      const corrected = jsonContent(
        await client.tool("correct_memory", {
          memory_key: "LOCAL-017",
          expected_title: "LOCAL FIXTURE LOCAL-017",
          confirmation: "KOREKSI MEMORI",
          changes: {
            memory_type: "event",
            memory_text: "LOCAL FIXTURE legacy-corrected A_ONLY LOCAL-017",
          },
        }),
      );
      assert.equal(corrected.corrected, true);
      assert.equal(
        object(corrected.memory, "Missing corrected legacy memory")
          .canon_status,
        "draft",
      );

      const found = memories(
        await client.tool("search_memories", {
          query: "legacy-corrected",
          canon_status: "draft",
          memory_type: "event",
          limit: 10,
        }),
      );
      assert.deepEqual(keys(found), ["LOCAL-017"]);
      assert.equal(found.memories[0]?.memory_type, "event");
      assert.ok(!("expected_at" in found.memories[0]));
      assert.ok(!("canonization" in found.memories[0]));
    },
  );
  await t.step(
    "OAuth owner can create one idempotent draft and promote only its own row",
    async () => {
      const issuedA = await authorize(
        config,
        metadata,
        clientId,
        config.users.a,
      );
      const issuedB = await authorize(
        config,
        metadata,
        clientId,
        config.users.b,
      );
      const clientA = new McpClient(config, issuedA.access_token);
      const clientB = new McpClient(config, issuedB.access_token);
      await clientA.initialize();
      await clientB.initialize();

      const draft = {
        idempotency_key: "11111111-1111-4111-8111-111111111111",
        title: "LOCAL WRITE project draft",
        memory_text:
          "LOCAL WRITE shared-write-marker A_ONLY project masih berjalan",
        memory_type: "event",
        factual_core: [
          "Pit mengonfirmasi pengujian alur tulis Charmaine Memory.",
        ],
        continuity_mode: "shared_experience",
        temporal_precision: "day",
        uncertain_fields: ["exact_time"],
        period: "masa_kini",
        event_year: 2026,
        category: "project",
        tags: ["local-integration", "write-test"],
        occurred_on: "2026-11-23",
        temporal_note: "Tanggal diketahui, jam kejadian tidak diketahui.",
      };

      const contradictory = await clientA.toolResult("create_memory", {
        ...draft,
        idempotency_key: "33333333-3333-4333-8333-333333333333",
        title: "LOCAL WRITE contradictory time",
        occurred_at: "2026-11-23T12:00:00+07:00",
      });
      assert.equal(contradictory.isError, true);

      const created = jsonContent(await clientA.tool("create_memory", draft));
      assert.equal(created.replayed, false);
      const createdMemory = object(created.memory, "Missing created memory");
      const memoryKey = textField(
        createdMemory.memory_key,
        "Missing created memory key",
      );
      assert.match(memoryKey, /^mem_[0-9a-f-]{36}$/);
      assert.equal(createdMemory.canon_status, "draft");

      const replayed = jsonContent(await clientA.tool("create_memory", draft));
      assert.equal(replayed.replayed, true);
      assert.equal(
        object(replayed.memory, "Missing replay memory").memory_key,
        memoryKey,
      );

      const listedA = memories(
        await clientA.tool("list_memories", {
          period: "masa_kini",
          event_year: 2026,
          canon_status: "draft",
          memory_type: "event",
          limit: 20,
        }),
      );
      assert.deepEqual(keys(listedA), [memoryKey]);
      assert.equal(listedA.total, 1);

      const foundA = memories(
        await clientA.tool("search_memories", {
          query: "shared-write-marker",
          limit: 10,
        }),
      );
      assert.deepEqual(keys(foundA), [memoryKey]);
      assert.deepEqual(foundA.memories[0]?.factual_core, draft.factual_core);
      assert.equal(
        foundA.memories[0]?.continuity_mode,
        draft.continuity_mode,
      );
      assert.equal(
        foundA.memories[0]?.temporal_precision,
        draft.temporal_precision,
      );
      assert.equal(foundA.memories[0]?.occurred_on, draft.occurred_on);
      assert.ok(!("occurred_at" in foundA.memories[0]));
      const foundByTitle = memories(
        await clientA.tool("search_memories", {
          query: "project draft",
          canon_status: "draft",
        }),
      );
      assert.deepEqual(keys(foundByTitle), [memoryKey]);
      const foundB = memories(
        await clientB.tool("search_memories", {
          query: "shared-write-marker",
          limit: 10,
        }),
      );
      assert.deepEqual(keys(foundB), []);

      const foreignPromotion = await clientB.toolResult("promote_memory", {
        memory_key: memoryKey,
        expected_title: draft.title,
        confirmation: "JADIKAN CANON",
      });
      assert.equal(foreignPromotion.isError, true);
      assert.match(contentText(foreignPromotion), /tidak ditemukan/i);

      const promoted = jsonContent(
        await clientA.tool("promote_memory", {
          memory_key: memoryKey,
          expected_title: draft.title,
          confirmation: "JADIKAN CANON",
          note: "Project selesai dan sudah dikonfirmasi.",
        }),
      );
      assert.equal(promoted.promoted, true);
      assert.equal(
        object(promoted.memory, "Missing promoted memory").canon_status,
        "canon",
      );

      const promotionReplay = jsonContent(
        await clientA.tool("promote_memory", {
          memory_key: memoryKey,
          expected_title: draft.title,
          confirmation: "JADIKAN CANON",
        }),
      );
      assert.equal(promotionReplay.promoted, false);
      assert.equal(promotionReplay.already_canon, true);

      const canonSearch = memories(
        await clientA.tool("search_memories", {
          query: "shared-write-marker",
          canon_status: "canon",
          limit: 10,
        }),
      );
      assert.deepEqual(keys(canonSearch), [memoryKey]);
      const draftSearch = memories(
        await clientA.tool("search_memories", {
          query: "shared-write-marker",
          canon_status: "draft",
          limit: 10,
        }),
      );
      assert.deepEqual(keys(draftSearch), []);

      const correction = {
        memory_key: memoryKey,
        expected_title: draft.title,
        confirmation: "KOREKSI MEMORI",
        changes: {
          memory_text:
            "LOCAL WRITE corrected-write-marker A_ONLY project sudah selesai",
        },
      };
      const missingCorrection = {
        ...correction,
        memory_key: "mem_00000000-0000-4000-8000-000000000000",
      };
      const foreignCorrection = await clientB.toolResult(
        "correct_memory",
        correction,
      );
      const absentCorrection = await clientB.toolResult(
        "correct_memory",
        missingCorrection,
      );
      assert.equal(foreignCorrection.isError, true);
      assert.equal(absentCorrection.isError, true);
      assert.equal(
        contentText(foreignCorrection),
        contentText(absentCorrection),
        "Foreign and missing corrections must be indistinguishable",
      );

      const deletion = {
        memory_key: memoryKey,
        expected_title: draft.title,
        confirmation: "HAPUS PERMANEN",
      };
      const missingDeletion = {
        ...deletion,
        memory_key: "mem_00000000-0000-4000-8000-000000000000",
      };
      const foreignDeletion = jsonContent(
        await clientB.tool("delete_memory", deletion),
      );
      const absentDeletion = jsonContent(
        await clientB.tool("delete_memory", missingDeletion),
      );
      assert.equal(foreignDeletion.deleted, false);
      assert.equal(foreignDeletion.already_absent, true);
      assert.deepEqual(
        foreignDeletion,
        absentDeletion,
        "Foreign and missing deletions must be indistinguishable",
      );

      const stillCanon = memories(
        await clientA.tool("search_memories", {
          query: "shared-write-marker",
          canon_status: "canon",
          limit: 10,
        }),
      );
      assert.deepEqual(keys(stillCanon), [memoryKey]);

      const corrected = jsonContent(
        await clientA.tool("correct_memory", correction),
      );
      assert.equal(corrected.corrected, true);
      const correctedMemory = object(
        corrected.memory,
        "Missing corrected memory",
      );
      assert.equal(correctedMemory.memory_key, memoryKey);
      assert.equal(correctedMemory.title, draft.title);
      assert.equal(correctedMemory.canon_status, "draft");

      const oldText = memories(
        await clientA.tool("search_memories", {
          query: "shared-write-marker",
          limit: 10,
        }),
      );
      assert.deepEqual(keys(oldText), []);
      const correctedText = memories(
        await clientA.tool("search_memories", {
          query: "corrected-write-marker",
          canon_status: "draft",
          limit: 10,
        }),
      );
      assert.deepEqual(keys(correctedText), [memoryKey]);
      assert.equal(
        correctedText.memories[0]?.memory_text,
        correction.changes.memory_text,
      );
      assert.equal(correctedText.memories[0]?.memory_type, "event");
      assert.ok(!("expected_at" in correctedText.memories[0]));
      assert.ok(!("canonization" in correctedText.memories[0]));

      const directDeletion = await rest(
        config,
        issuedA.access_token,
        `?memory_key=eq.${memoryKey}`,
        { method: "DELETE" },
      );
      const directDeletionError = await jsonResponse(
        directDeletion,
        "Denied direct delete",
      );
      assert.equal(directDeletion.status, 403);
      assert.equal(directDeletionError.code, "42501");

      const unconfirmedDeletion = await rpc(
        config,
        issuedA.access_token,
        "delete_charmaine_memory",
        {
          p_memory_key: memoryKey,
          p_expected_title: draft.title,
          p_confirmation: "tidak sah",
        },
      );
      assert.equal(unconfirmedDeletion.status, 400);

      const deleted = jsonContent(
        await clientA.tool("delete_memory", deletion),
      );
      assert.equal(deleted.deleted, true);
      assert.equal(deleted.already_absent, false);
      const deletedMemory = object(deleted.memory, "Missing deleted memory");
      assert.equal(deletedMemory.memory_key, memoryKey);
      assert.equal(deletedMemory.title, draft.title);
      assert.equal(deletedMemory.canon_status, "draft");

      const deletedSearch = memories(
        await clientA.tool("search_memories", {
          query: "corrected-write-marker",
          limit: 10,
        }),
      );
      assert.deepEqual(keys(deletedSearch), []);
      const deletedRows = await rest(
        config,
        issuedA.access_token,
        `?select=memory_key&memory_key=eq.${memoryKey}`,
      );
      assert.equal(deletedRows.status, 200);
      assert.deepEqual(await deletedRows.json(), []);

      const deletionReplay = jsonContent(
        await clientA.tool("delete_memory", deletion),
      );
      assert.equal(deletionReplay.deleted, false);
      assert.equal(deletionReplay.already_absent, true);
      assert.deepEqual(deletionReplay, absentDeletion);
    },
  );
  await t.step(
    "password-only sessions cannot write and OAuth writes remain owner-scoped",
    async () => {
      const login = await passwordLogin(config, config.users.a);
      const plain = new McpClient(config, login);
      await plain.initialize();
      await expectList(plain, {}, []);
      const plainWrite = await plain.toolResult("create_memory", {
        idempotency_key: "22222222-2222-4222-8222-222222222222",
        title: "Password-only write",
        memory_text: "This must be rejected without an OAuth client_id.",
      });
      assert.equal(plainWrite.isError, true);
      const plainCorrection = await plain.toolResult("correct_memory", {
        memory_key: "mem_00000000-0000-4000-8000-000000000000",
        expected_title: "Password-only correction",
        confirmation: "KOREKSI MEMORI",
        changes: { memory_text: "This must also be rejected." },
      });
      assert.equal(plainCorrection.isError, true);
      const plainDeletion = await plain.toolResult("delete_memory", {
        memory_key: "mem_00000000-0000-4000-8000-000000000000",
        expected_title: "Password-only deletion",
        confirmation: "HAPUS PERMANEN",
      });
      assert.equal(plainDeletion.isError, true);

      const a = await authorize(config, metadata, clientId, config.users.a);
      const malformedSemantics = await rest(config, a.access_token, "", {
        method: "POST",
        body: JSON.stringify({
          memory_key: "LOCAL-INVALID-SEMANTICS",
          title: "Synthetic invalid semantic write",
          memory_text: "LOCAL FIXTURE invalid date-only memory",
          perspective: "charmaine",
          event_year: 2026,
          origin: "mcp_user_entry",
          details: {
            memory_type: "event",
            factual_core: ["A deliberately invalid date is supplied."],
            continuity_mode: "told_by_pit",
            temporal_precision: "day",
            uncertain_fields: [],
            occurred_on: "2026-02-30",
          },
        }),
      });
      const malformedError = await jsonResponse(
        malformedSemantics,
        "Rejected malformed semantics",
      );
      assert.ok(
        malformedSemantics.status === 400 || malformedSemantics.status === 403,
        "Malformed semantics must be rejected by RLS or the check constraint",
      );
      assert.ok(
        malformedError.code === "42501" || malformedError.code === "23514",
        "Malformed semantics must fail policy or semantic validation",
      );

      const hidden = await rest(
        config,
        a.access_token,
        "?select=memory_key&memory_key=eq.LOCAL-002",
      );
      const hiddenRows = await hidden.json();
      assert.equal(hidden.status, 200);
      assert.deepEqual(hiddenRows, []);
      const attempted = await rest(config, a.access_token, "", {
        method: "POST",
        body: JSON.stringify({
          memory_key: "LOCAL-FORBIDDEN",
          owner_id: config.users.b.id,
          title: "Synthetic forbidden write",
          memory_text: "LOCAL FIXTURE forbidden write",
          school_year: "2009/2010",
          category: "sekolah_dan_kelas",
        }),
      });
      const insertError = await jsonResponse(attempted, "Denied insert");
      assert.equal(attempted.status, 403);
      assert.ok(
        insertError.code === "42501",
        "Insert must be denied by database privileges/RLS",
      );
      const changed = await rest(
        config,
        a.access_token,
        "?memory_key=eq.LOCAL-001",
        {
          method: "PATCH",
          body: JSON.stringify({ memory_text: "forbidden replacement" }),
        },
      );
      const updateError = await jsonResponse(changed, "Denied update");
      assert.equal(changed.status, 403);
      assert.ok(
        updateError.code === "42501",
        "Update must be denied by database privileges/RLS",
      );

      const directPromotion = await rest(
        config,
        a.access_token,
        "?memory_key=eq.LOCAL-002",
        {
          method: "PATCH",
          body: JSON.stringify({
            canon_status: "canon",
            details: { attempted_by_foreign_owner: true },
          }),
        },
      );
      const directPromotionError = await jsonResponse(
        directPromotion,
        "Denied direct promotion",
      );
      assert.equal(directPromotion.status, 403);
      assert.equal(directPromotionError.code, "42501");

      const b = await authorize(config, metadata, clientId, config.users.b);
      const clientB = new McpClient(config, b.access_token);
      await clientB.initialize();
      const unchanged = await expectList(
        clientB,
        { limit: 20 },
        EXPECTED.ownerB.all,
      );
      assert.ok(
        unchanged.memories.every((row) =>
          typeof row.memory_text === "string" &&
          row.memory_text.includes("B_ONLY")
        ),
        "Forbidden writes must leave the other user's rows unchanged",
      );
      assert.equal(
        unchanged.memories.find((row) => row.memory_key === "LOCAL-002")
          ?.canon_status,
        "draft",
      );
    },
  );
  await t.step(
    "a genuinely issued OAuth JWT is rejected after expiry",
    async () => {
      const issued = await authorize(
        config,
        metadata,
        clientId,
        config.users.a,
      );
      assert.ok(
        issued.expires_in <= 90,
        "Local OAuth expiry must stay short for this integration test",
      );
      const claims = jwtClaims(issued.access_token);
      assert.ok(typeof claims.exp === "number");
      const client = new McpClient(config, issued.access_token);
      await client.initialize();
      await client.tool("ping");
      const deadline = (claims.exp as number) * 1000 + 1100;
      assert.ok(
        deadline - Date.now() <= 92_000,
        "Unexpected local JWT lifetime",
      );
      while (Date.now() < deadline) {
        console.info("Waiting for the local OAuth test token to expire...");
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(20_000, deadline - Date.now()))
        );
      }
      await deniedMcp(config, issued.access_token);
    },
  );
});
