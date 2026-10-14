/**
 * Proves the actual HTTP query parameter HaloPSA receives for the users
 * domain's duplicate-check search (PRD-20396), end to end through the real
 * production code path.
 *
 * `domains/users.test.ts` mocks `utils/client.js` entirely, so its
 * assertions only prove what object `src/domains/users.ts` passes to
 * `client.contacts.list(...)` -- never what query string actually reaches
 * HaloPSA. Round-2 rework shipped `inactive: true`, whose own unit test
 * asserted exactly that call and passed; round-3 INT retest (Minnie Zhou,
 * 2026-10-14) found HaloPSA's live GET /Users silently ignores that
 * parameter, so a duplicate was still created.
 *
 * This file does *not* mock `utils/client.js` or hand-construct a params
 * object: it drives `usersHandler.handleCall("halopsa_users_create", ...)`
 * -- the real handler -- through the real `getClient()` / real
 * `@wyre-ai/node-halopsa` SDK, with only the network boundary (`fetch`)
 * stubbed. The assertion is against the literal query string the stubbed
 * `fetch` received, which is the thing round 2's mocked-SDK-call test
 * structurally could not see.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { clearClient } from "../utils/client.js";
import { usersHandler } from "../domains/users.js";

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: { get: () => "application/json" },
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

describe("halopsa_users_create duplicate-check query params (real SDK, stubbed fetch)", () => {
  const ORIGINAL_ENV = { ...process.env };
  let calls: { url: string; method: string }[];

  beforeEach(() => {
    clearClient();
    process.env.HALOPSA_CLIENT_ID = "test-client-id";
    process.env.HALOPSA_CLIENT_SECRET = "test-client-secret";
    process.env.HALOPSA_BASE_URL = "http://localhost";
    delete process.env.HALOPSA_TENANT;

    calls = [];
    const fetchMock = vi.fn(async (input: unknown, init?: { method?: string }) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ url, method });

      if (url.endsWith("/auth/token")) {
        return jsonResponse({
          access_token: "test-token",
          token_type: "Bearer",
          expires_in: 3600,
        });
      }
      if (url.includes("/api/Users") && method === "GET") {
        // Duplicate-check search: no existing contact.
        return jsonResponse({ record_count: 0, users: [] });
      }
      if (url.includes("/api/Users") && method === "POST") {
        return jsonResponse([
          {
            id: 999,
            name: "New Contact",
            emailaddress: "prd20396-int-test@example.com",
            client_id: 12,
            site_id: 7,
            inactive: false,
          },
        ]);
      }
      throw new Error(`Unexpected fetch ${method} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.unstubAllGlobals();
    clearClient();
  });

  // TC-HALO-017 (AC6, dev-added · PRD-20396 rework round 3, INT finding F1
  // retest). `site_id` is supplied explicitly so this case doesn't also
  // need to stub the client main-site lookup (AC11/F3, already covered
  // elsewhere) -- it isolates the one thing round 2's test could not see.
  it("sends includeinactive=true (not inactive=true) on the real /Users query string", async () => {
    const result = await usersHandler.handleCall("halopsa_users_create", {
      name: "New Contact",
      email: "prd20396-int-test@example.com",
      client_id: 12,
      site_id: 7,
    });

    expect(result.isError).toBeUndefined();

    const listCall = calls.find(
      (c) => c.url.includes("/api/Users") && c.method === "GET"
    );
    expect(listCall).toBeDefined();

    const queryParams = new URL(listCall!.url).searchParams;
    expect(queryParams.get("includeinactive")).toBe("true");
    expect(queryParams.get("search")).toBe("prd20396-int-test@example.com");
    // Round 2's parameter name must not silently reappear: if a future
    // edit reintroduces `inactive: true` alongside or instead of
    // `includeinactive`, this failing is the signal.
    expect(queryParams.has("inactive")).toBe(false);
  });
});
