import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { makeMemories } from "./fixtures.ts";
import {
  API_URL,
  assertLocalDockerEndpoint,
  assertLocalUrl,
  localFetch,
} from "./safety.ts";

const root = dirname(fileURLToPath(import.meta.url));
const repository = resolve(root, "../..");
const scratch = join(root, ".work");
const cliVersion = "3.1.0";
const decoder = new TextDecoder();
const secrets: string[] = [];

// No inherited Supabase credentials, linked project, remote Docker endpoint,
// dotenv file, or production configuration is used by subprocesses.
const env: Record<string, string> = {};
for (
  const name of [
    "PATH",
    "Path",
    "SystemRoot",
    "SYSTEMROOT",
    "WINDIR",
    "COMSPEC",
    "PATHEXT",
    "HOME",
    "USERPROFILE",
    "TMP",
    "TEMP",
    "TMPDIR",
    "DENO_DIR",
  ]
) {
  const value = Deno.env.get(name);
  if (value) env[name] = value;
}

function diagnostic(bytes: Uint8Array): string {
  let text = decoder.decode(bytes);
  for (const secret of secrets) text = text.replaceAll(secret, "[redacted]");
  // CLI status/start can contain local credentials. Never relay their output.
  return text.split(/\r?\n/).filter((line) =>
    !/key|password|secret|token|jwt|jwks|bearer|postgres(?:ql)?:\/\//i.test(
      line,
    )
  ).slice(-12).join("\n");
}

async function command(executable: string, args: string[]): Promise<string> {
  let result: Deno.CommandOutput;
  try {
    result = await new Deno.Command(executable, {
      args,
      cwd: root,
      env,
      clearEnv: true,
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    }).output();
  } catch {
    throw new Error(
      `Cannot run ${executable}. Install the documented local prerequisites.`,
    );
  }
  if (!result.success) {
    throw new Error(
      `${executable} ${args[0]} failed (${result.code}).\n${
        diagnostic(result.stderr)
      }`,
    );
  }
  return decoder.decode(result.stdout).trim();
}

async function preflight() {
  console.log("Checking the local Docker engine and Supabase CLI...");
  const inheritedHost = Deno.env.get("DOCKER_HOST");
  if (inheritedHost) assertLocalDockerEndpoint(inheritedHost);
  const endpoint = inheritedHost ?? JSON.parse(
    await command("docker", [
      "context",
      "inspect",
      "--format",
      "{{json .Endpoints.docker.Host}}",
    ]),
  );
  env.DOCKER_HOST = assertLocalDockerEndpoint(endpoint);
  await command("docker", ["version", "--format", "{{.Server.Version}}"]);
  const version = await command("supabase", ["--version"]);
  if (version !== cliVersion) {
    throw new Error(
      `Use Supabase CLI ${cliVersion} for this reproducible test stack.`,
    );
  }
  // Refuse a pre-existing service on the fixed fixture API port.
  try {
    const connection = await Deno.connect({
      hostname: "127.0.0.1",
      port: 55431,
    });
    connection.close();
  } catch (error) {
    if (error instanceof Deno.errors.ConnectionRefused) return;
    throw error;
  }
  throw new Error(
    "Port 55431 is already occupied. Existing services will not be touched.",
  );
}

async function writeProject(workdir: string, projectId: string) {
  const supabase = join(workdir, "supabase");
  const functions = join(supabase, "functions", "charmaine-mcp");
  await Deno.mkdir(functions, { recursive: true });
  await Deno.mkdir(join(supabase, "migrations"));
  const template = await Deno.readTextFile(
    join(root, "supabase", "config.toml"),
  );
  await Deno.writeTextFile(
    join(supabase, "config.toml"),
    template.replace("PROJECT_ID", projectId),
  );
  await Deno.copyFile(
    join(
      root,
      "supabase",
      "migrations",
      "00000000000000_local_test_schema.sql",
    ),
    join(supabase, "migrations", "00000000000000_local_test_schema.sql"),
  );
  // Test the checked-out implementation, not a reimplementation or mock server.
  for (
    const file of [
      "index.ts",
      "categories.ts",
      "list_memories.ts",
      "deno.json",
      "deno.lock",
    ]
  ) {
    await Deno.copyFile(
      join(repository, "supabase", "functions", "charmaine-mcp", file),
      join(functions, file),
    );
  }
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  await Deno.writeTextFile(
    join(supabase, "signing_keys.json"),
    JSON.stringify([{
      ...jwk,
      kid: crypto.randomUUID(),
      alg: "ES256",
      use: "sig",
      key_ops: ["sign", "verify"],
      ext: true,
    }]),
    { mode: 0o600 },
  );
}

async function bootstrap(status: Record<string, string>) {
  if (assertLocalUrl(status.API_URL).origin !== API_URL) {
    throw new Error("Unexpected local API URL");
  }
  const publishableKey = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
  const serviceKey = status.SERVICE_ROLE_KEY ?? status.SECRET_KEY;
  if (!publishableKey || !serviceKey) {
    throw new Error("Local CLI did not return fixture API keys");
  }
  secrets.push(...Object.values(status).filter(Boolean));
  const headers = {
    apikey: publishableKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };
  async function createUser(label: string) {
    const email =
      `charmaine-local-${label}-${crypto.randomUUID()}@example.invalid`;
    const password = `Local-${crypto.randomUUID()}-${crypto.randomUUID()}!`;
    secrets.push(password);
    const response = await localFetch(`${API_URL}/auth/v1/admin/users`, {
      method: "POST",
      headers,
      body: JSON.stringify({ email, password, email_confirm: true }),
    });
    if (!response.ok) {
      throw new Error(
        `Local fixture account creation failed (${response.status})`,
      );
    }
    const user = await response.json();
    if (typeof user.id !== "string" || !/^[a-f0-9-]{36}$/i.test(user.id)) {
      throw new Error("Local Auth returned no valid fixture user ID");
    }
    return { id: user.id as string, email, password };
  }
  const a = await createUser("a");
  const b = await createUser("b");
  const response = await localFetch(`${API_URL}/rest/v1/charmaine_memories`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify(makeMemories(a.id, b.id)),
  });
  if (!response.ok) {
    throw new Error(
      `Local synthetic fixture insertion failed (${response.status})`,
    );
  }
  // The service-role key is deliberately excluded from the test process.
  return {
    apiUrl: API_URL,
    mcpUrl: `${API_URL}/functions/v1/charmaine-mcp`,
    publishableKey,
    users: { a, b },
  };
}

async function removeOwnedProject(workdir: string) {
  const actual = await Deno.realPath(workdir);
  const actualScratch = await Deno.realPath(scratch);
  if (
    dirname(actual) !== actualScratch || !basename(actual).startsWith("run-")
  ) {
    throw new Error(
      "Refusing to remove a path outside the generated fixture directory",
    );
  }
  await Deno.remove(actual, { recursive: true });
}

async function main() {
  await preflight();
  await Deno.mkdir(scratch, { recursive: true });
  if ((await Deno.lstat(scratch)).isSymlink) {
    throw new Error("Fixture directory must not be a symlink");
  }
  const workdir = await Deno.makeTempDir({ dir: scratch, prefix: "run-" });
  const projectId = `charmaine-integration-${crypto.randomUUID().slice(0, 8)}`;
  env.SUPABASE_HOME = join(workdir, "cli-home");
  let started = false;
  let stopped = false;
  try {
    await writeProject(workdir, projectId);
    console.log(
      "Starting an isolated local Supabase stack with synthetic schema...",
    );
    started = true;
    await command("supabase", [
      "start",
      "--workdir",
      workdir,
      "--exclude",
      "studio,postgres-meta,realtime,storage-api,imgproxy,mailpit,logflare,vector,supavisor",
    ]);
    const status = JSON.parse(
      await command("supabase", ["status", "--workdir", workdir, "-o", "json"]),
    );
    console.log(
      "Creating two local-only accounts and 12 synthetic memories...",
    );
    const config = await bootstrap(status);
    console.log("Running HTTP OAuth, MCP, and real database RLS assertions...");
    const child = new Deno.Command("deno", {
      args: [
        "test",
        "--config",
        join(root, "deno.json"),
        "--allow-env=CHARMAINE_LOCAL_TEST_CONFIG",
        "--allow-net=127.0.0.1:55431",
        "--deny-read",
        "--deny-write",
        "--deny-run",
        join(root, "integration_test.ts"),
      ],
      cwd: root,
      env: { ...env, CHARMAINE_LOCAL_TEST_CONFIG: JSON.stringify(config) },
      clearEnv: true,
      stdin: "null",
      stdout: "inherit",
      stderr: "inherit",
    }).spawn();
    if (!(await child.status).success) {
      throw new Error("Local OAuth/RLS integration assertions failed");
    }
  } finally {
    if (started) {
      console.log(
        "Stopping and removing only this run's local fixture stack...",
      );
      await command("supabase", [
        "stop",
        "--no-backup",
        "--project-id",
        projectId,
        "--workdir",
        workdir,
      ]);
      stopped = true;
    }
    if (!started || stopped) await removeOwnedProject(workdir);
  }
}

try {
  await main();
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Local integration run failed",
  );
  Deno.exit(1);
}
