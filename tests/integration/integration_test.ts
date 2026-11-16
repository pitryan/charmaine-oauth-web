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
    const result = await this.request("tools/call", { name, arguments: args });
    assert.ok(!result.isError, `${name} must not return a tool error`);
    return result;
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
          ["list_memories", "ping", "search_memories"],
        );
        assert.equal(
          contentText(await client.tool("ping")),
          "MCP Charmaine aktif!",
        );
        const all = await expectList(client, { limit: 20 }, expected.all);
        assert.ok(all.memories.every((row) => row.clarity === "unspecified"));
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
    "password-only sessions cannot read memories and OAuth cannot write",
    async () => {
      const login = await passwordLogin(config, config.users.a);
      const plain = new McpClient(config, login);
      await plain.initialize();
      await expectList(plain, {}, []);
      const a = await authorize(config, metadata, clientId, config.users.a);
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
          canon_status: "draft",
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
        "?memory_key=eq.LOCAL-002",
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
