import assert from "node:assert/strict";
import { assertLocalUrl, CALLBACK_URL, localFetch } from "./safety.ts";

export interface TestUser {
  id: string;
  email: string;
  password: string;
}
export interface TestConfig {
  apiUrl: string;
  mcpUrl: string;
  publishableKey: string;
  users: { a: TestUser; b: TestUser };
}
export interface Tokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}
export interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
}
type Json = Record<string, unknown>;

export function object(value: unknown, label: string): Json {
  assert.ok(
    value !== null && typeof value === "object" && !Array.isArray(value),
    label,
  );
  return value as Json;
}
export function textField(value: unknown, label: string): string {
  assert.ok(typeof value === "string" && value.length > 0, label);
  return value as string;
}
export function readConfig(): TestConfig {
  let value: unknown;
  try {
    value = JSON.parse(Deno.env.get("CHARMAINE_LOCAL_TEST_CONFIG") ?? "");
  } catch {
    throw new Error(
      "Local integration configuration is missing or invalid JSON",
    );
  }
  const config = object(value, "Expected local integration configuration");
  const apiUrl = assertLocalUrl(
    textField(config.apiUrl, "Missing local API URL"),
  );
  const mcpUrl = assertLocalUrl(
    textField(config.mcpUrl, "Missing local MCP URL"),
  );
  assert.equal(apiUrl.pathname, "/", "API URL must be the loopback origin");
  assert.equal(mcpUrl.pathname, "/functions/v1/charmaine-mcp");
  const users = object(config.users, "Missing test accounts");
  for (const key of ["a", "b"]) {
    const user = object(users[key], "Missing test account");
    for (const field of ["id", "email", "password"]) {
      textField(user[field], "Missing test account field");
    }
  }
  textField(config.publishableKey, "Missing local publishable key");
  return config as unknown as TestConfig;
}
// Never include response bodies or request credentials in assertion messages.
export async function jsonResponse(
  response: Response,
  label: string,
): Promise<Json> {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new Error(`${label}: expected a JSON response`);
  }
  return object(value, `${label}: expected a JSON object`);
}
export function apiHeaders(config: TestConfig, token?: string): Headers {
  const headers = new Headers({ apikey: config.publishableKey });
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return headers;
}
export async function discovery(config: TestConfig): Promise<Discovery> {
  const response = await localFetch(
    `${config.apiUrl}/auth/v1/.well-known/oauth-authorization-server`,
    { headers: apiHeaders(config) },
  );
  const data = await jsonResponse(response, "OAuth discovery");
  assert.equal(response.status, 200, "OAuth discovery must succeed");
  for (
    const name of [
      "issuer",
      "authorization_endpoint",
      "token_endpoint",
      "registration_endpoint",
    ]
  ) {
    assertLocalUrl(
      textField(data[name], "Missing local OAuth discovery endpoint"),
    );
  }
  assert.ok(Array.isArray(data.code_challenge_methods_supported));
  assert.ok(data.code_challenge_methods_supported.includes("S256"));
  return data as unknown as Discovery;
}
export async function passwordLogin(
  config: TestConfig,
  user: TestUser,
): Promise<string> {
  const headers = apiHeaders(config);
  headers.set("Content-Type", "application/json");
  const response = await localFetch(
    `${config.apiUrl}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ email: user.email, password: user.password }),
    },
  );
  const data = await jsonResponse(response, "Password login");
  assert.equal(
    response.status,
    200,
    "Synthetic account password login must succeed",
  );
  assert.ok(
    object(data.user, "Expected login user").id === user.id,
    "Login returned wrong test user",
  );
  return textField(
    data.access_token,
    "Password login did not issue an access token",
  );
}
export async function registerClient(
  config: TestConfig,
  metadata: Discovery,
): Promise<string> {
  const headers = apiHeaders(config);
  headers.set("Content-Type", "application/json");
  const response = await localFetch(metadata.registration_endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      client_name: "Charmaine local integration fixture",
      client_type: "public",
      token_endpoint_auth_method: "none",
      redirect_uris: [CALLBACK_URL],
      grant_types: ["authorization_code", "refresh_token"],
    }),
  });
  const data = await jsonResponse(response, "Public client registration");
  assert.equal(
    response.status,
    201,
    "Local dynamic client registration must succeed",
  );
  assert.ok(
    !data.client_secret,
    "Public clients must not receive a client secret",
  );
  assert.ok(data.token_endpoint_auth_method === "none");
  return textField(data.client_id, "Registration did not issue a client ID");
}
function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll(
    "/",
    "_",
  ).replaceAll("=", "");
}
export interface Authorization {
  id: string;
  state: string;
  verifier: string;
  clientId: string;
}
export async function beginAuthorization(
  config: TestConfig,
  metadata: Discovery,
  clientId: string,
): Promise<Authorization> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  const state = base64url(crypto.getRandomValues(new Uint8Array(24)));
  const url = assertLocalUrl(metadata.authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: CALLBACK_URL,
    scope: "email",
    state,
    code_challenge: base64url(new Uint8Array(digest)),
    code_challenge_method: "S256",
  }).toString();
  const response = await localFetch(url, {
    headers: apiHeaders(config),
    redirect: "manual",
  });
  await response.body?.cancel();
  assert.equal(
    response.status,
    302,
    "Authorization must redirect to local consent",
  );
  const redirect = new URL(
    textField(response.headers.get("location"), "Missing consent redirect"),
  );
  assert.equal(redirect.origin, "http://127.0.0.1:55430");
  assert.equal(redirect.pathname, "/oauth/consent");
  return {
    id: textField(
      redirect.searchParams.get("authorization_id"),
      "Missing authorization ID",
    ),
    state,
    verifier,
    clientId,
  };
}
export async function decide(
  config: TestConfig,
  authorization: Authorization,
  passwordToken: string,
  user: TestUser,
  action: "approve" | "deny",
): Promise<URL> {
  const headers = apiHeaders(config, passwordToken);
  headers.set("Origin", "http://127.0.0.1:55430");
  const url = `${config.apiUrl}/auth/v1/oauth/authorizations/${
    encodeURIComponent(authorization.id)
  }`;
  const detailsResponse = await localFetch(url, { headers });
  const details = await jsonResponse(detailsResponse, "Consent details");
  assert.equal(
    detailsResponse.status,
    200,
    "Consent details must be available to logged-in user",
  );
  let redirectValue: unknown = details.redirect_url;
  if ("authorization_id" in details) {
    assert.ok(
      details.authorization_id === authorization.id,
      "Consent request mismatch",
    );
    assert.ok(
      object(details.user, "Missing consent user").id === user.id,
      "Consent user mismatch",
    );
    headers.set("Content-Type", "application/json");
    const consent = await localFetch(`${url}/consent`, {
      method: "POST",
      headers,
      body: JSON.stringify({ action }),
    });
    const result = await jsonResponse(consent, "Consent decision");
    assert.equal(consent.status, 200, "Consent decision must succeed");
    redirectValue = result.redirect_url;
  } else {assert.equal(
      action,
      "approve",
      "Deny test must use a new client without prior consent",
    );}
  const redirect = new URL(
    textField(redirectValue, "Missing consent result redirect"),
  );
  assert.equal(redirect.origin, "http://127.0.0.1:55430");
  assert.equal(redirect.pathname, "/callback");
  assert.ok(
    redirect.searchParams.get("state") === authorization.state,
    "OAuth state mismatch",
  );
  if (action === "deny") {
    assert.equal(redirect.searchParams.get("error"), "access_denied");
    assert.ok(
      !redirect.searchParams.has("code"),
      "Denied consent must not issue a code",
    );
  }
  return redirect;
}
export async function exchange(
  config: TestConfig,
  metadata: Discovery,
  authorization: Authorization,
  code: string,
  verifier = authorization.verifier,
): Promise<{ status: number; data: Json }> {
  const headers = apiHeaders(config);
  headers.set("Content-Type", "application/x-www-form-urlencoded");
  const response = await localFetch(metadata.token_endpoint, {
    method: "POST",
    headers,
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: authorization.clientId,
      redirect_uri: CALLBACK_URL,
      code,
      code_verifier: verifier,
    }),
  });
  return {
    status: response.status,
    data: await jsonResponse(response, "OAuth code exchange"),
  };
}
export function tokens(data: Json): Tokens {
  textField(data.access_token, "OAuth did not issue an access token");
  textField(data.refresh_token, "OAuth did not issue a refresh token");
  assert.ok(
    typeof data.expires_in === "number" && data.expires_in > 0,
    "Missing OAuth token lifetime",
  );
  return data as unknown as Tokens;
}
export function jwtClaims(token: string): Json {
  try {
    const part = token.split(".")[1].replaceAll("-", "+").replaceAll("_", "/");
    return object(
      JSON.parse(atob(part.padEnd(Math.ceil(part.length / 4) * 4, "="))),
      "Expected JWT claims",
    );
  } catch {
    throw new Error("Issued access token is not a readable JWT");
  }
}
export async function authorize(
  config: TestConfig,
  metadata: Discovery,
  clientId: string,
  user: TestUser,
): Promise<Tokens> {
  const login = await passwordLogin(config, user);
  const request = await beginAuthorization(config, metadata, clientId);
  const redirect = await decide(config, request, login, user, "approve");
  const result = await exchange(
    config,
    metadata,
    request,
    textField(redirect.searchParams.get("code"), "Missing authorization code"),
  );
  assert.equal(
    result.status,
    200,
    "Genuine authorization-code exchange must succeed",
  );
  const issued = tokens(result.data);
  const claims = jwtClaims(issued.access_token);
  assert.ok(
    claims.sub === user.id && claims.client_id === clientId,
    "OAuth claims must identify the requested user and client",
  );
  assert.ok(
    claims.role === "authenticated",
    "OAuth token must use authenticated role",
  );
  return issued;
}
