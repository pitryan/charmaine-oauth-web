import assert from "node:assert/strict";
import {
  API_URL,
  assertLocalDockerEndpoint,
  assertLocalUrl,
  localFetch,
} from "./safety.ts";

Deno.test("Docker guard rejects remote daemons and UNC named pipes", () => {
  for (
    const endpoint of [
      "unix:///var/run/docker.sock",
      "npipe:////./pipe/docker_engine",
    ]
  ) {
    assert.equal(assertLocalDockerEndpoint(endpoint), endpoint);
  }
  for (
    const endpoint of [
      "tcp://127.0.0.1:2375",
      "ssh://remote",
      "npipe:////remote/pipe/docker_engine",
      "unix://remote/docker.sock",
      null,
    ]
  ) {
    assert.throws(() => assertLocalDockerEndpoint(endpoint));
  }
});

Deno.test("local integration guard accepts only its fixed loopback API", () => {
  assert.equal(assertLocalUrl(`${API_URL}/auth/v1/health`).origin, API_URL);
  for (
    const url of [
      "https://example.supabase.co/auth/v1/admin/users",
      "http://127.0.0.1:54321/rest/v1/charmaine_memories",
      "http://localhost:55431/auth/v1/health",
      "http://127.0.0.1.evil.example:55431/",
      "http://127.0.0.1:55431@evil.example/",
      "http://user:password@127.0.0.1:55431/",
      "https://127.0.0.1:55431/",
      "http://127.0.0.1:55431/#fragment",
    ]
  ) assert.throws(() => assertLocalUrl(url));
});

Deno.test("local integration guard refuses remote requests before fetch", () => {
  assert.throws(() => localFetch("https://example.supabase.co/"));
  assert.throws(() => localFetch(API_URL, { redirect: "follow" }));
});
