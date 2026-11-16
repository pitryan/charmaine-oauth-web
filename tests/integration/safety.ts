export const API_URL = "http://127.0.0.1:55431";
export const CALLBACK_URL = "http://127.0.0.1:55430/callback";

export function assertLocalDockerEndpoint(value: unknown): string {
  if (
    typeof value !== "string" ||
    (!/^unix:\/\/\/[^?#\s]+$/.test(value) &&
      !/^npipe:\/{4}\.\/pipe\/[\w.-]+$/.test(value))
  ) {
    throw new Error(
      "Docker must use a local Unix socket or local Windows named pipe",
    );
  }
  return value;
}

/** Every test and bootstrap HTTP request is restricted to this local fixture. */
export function assertLocalUrl(value: string | URL): URL {
  const url = new URL(value);
  if (
    url.origin !== API_URL || url.username || url.password || url.hash
  ) {
    throw new Error(
      "Integration requests must use the fixed local fixture URL",
    );
  }
  return url;
}

export function localFetch(
  input: string | URL,
  init: RequestInit = {},
): Promise<Response> {
  const url = assertLocalUrl(input);
  if (init.redirect && init.redirect !== "manual") {
    throw new Error("Integration HTTP redirects must be inspected manually");
  }
  return fetch(url, {
    ...init,
    redirect: "manual",
    signal: init.signal ?? AbortSignal.timeout(15_000),
  });
}
