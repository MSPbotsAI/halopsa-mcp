/**
 * Tests for credential resolution on the gateway / Workers transports.
 *
 * `buildCredentials` is the shared ingress for both the gateway header path
 * (`resolveGatewayCredentials`) and the Workers env path, so testing it directly
 * covers every non-stdio credential source.
 */

import { describe, it, expect } from "vitest";
import { buildCredentials, formatToolError } from "../mcp-server.js";

describe("buildCredentials", () => {
  it("returns an error when the client id or secret is missing", () => {
    expect(buildCredentials(undefined, "secret", "acme", undefined).error).toMatch(
      /Missing credentials/
    );
    expect(buildCredentials("id", undefined, "acme", undefined).error).toMatch(
      /Missing credentials/
    );
  });

  it("returns creds when a valid tenant is provided", () => {
    const { creds, error } = buildCredentials("id", "secret", "acme", undefined);
    expect(error).toBeUndefined();
    expect(creds).toEqual({
      clientId: "id",
      clientSecret: "secret",
      tenant: "acme",
      baseUrl: undefined,
    });
  });

  // Regression: issue #73. A blank optional Base URL field arrives as the literal
  // "${user_config.halopsa_base_url}". It must be dropped so the truthy placeholder
  // does not defeat the `!tenant && !baseUrl` guard and reach the SDK.
  it("drops an unresolved base URL placeholder and keeps the tenant", () => {
    const { creds, error } = buildCredentials(
      "id",
      "secret",
      "acme",
      "${user_config.halopsa_base_url}"
    );
    expect(error).toBeUndefined();
    expect(creds).toEqual({
      clientId: "id",
      clientSecret: "secret",
      tenant: "acme",
      baseUrl: undefined,
    });
  });

  it("drops an unresolved tenant placeholder and keeps the base URL", () => {
    const { creds, error } = buildCredentials(
      "id",
      "secret",
      "${user_config.halopsa_tenant}",
      "https://api.halopsa.com"
    );
    expect(error).toBeUndefined();
    expect(creds).toEqual({
      clientId: "id",
      clientSecret: "secret",
      tenant: undefined,
      baseUrl: "https://api.halopsa.com",
    });
  });

  it("errors when both tenant and base URL are unresolved placeholders", () => {
    const { creds, error } = buildCredentials(
      "id",
      "secret",
      "${user_config.halopsa_tenant}",
      "${user_config.halopsa_base_url}"
    );
    expect(creds).toBeUndefined();
    expect(error).toMatch(/Missing tenant/);
  });
});
describe("formatToolError", () => {
  // Regression: a HaloPSA 400 used to reach the caller as the SDK's bare
  // template ("... rejected the request parameters"), naming neither the field
  // nor the reason, because only `error.message` was surfaced.
  it("appends the HaloPSA response body to a bad-request message", () => {
    const err = Object.assign(
      new Error(
        "Bad request (400): POST https://acme.halopsa.com/api/Tickets rejected the request parameters"
      ),
      { statusCode: 400, response: { error: "team_id is not updatable" } }
    );
    const text = formatToolError(err);
    expect(text).toContain("rejected the request parameters");
    expect(text).toContain('HaloPSA response: {"error":"team_id is not updatable"}');
  });

  it("lists field-level validation errors", () => {
    const err = Object.assign(new Error("Validation error"), {
      statusCode: 400,
      errors: [
        { field: "team_id", message: "must be an existing team" },
        { field: "summary", message: "required" },
      ],
      response: { detail: "see errors" },
    });
    const text = formatToolError(err);
    expect(text).toContain("Field errors: team_id: must be an existing team; summary: required");
    expect(text).toContain('HaloPSA response: {"detail":"see errors"}');
  });

  it("truncates an oversized response body", () => {
    const err = Object.assign(new Error("Bad request (400)"), {
      response: "x".repeat(5000),
    });
    const text = formatToolError(err);
    expect(text).toContain("(truncated)");
    expect(text.length).toBeLessThan(2500);
  });

  it("leaves a plain error untouched", () => {
    expect(formatToolError(new Error("Resource not found"))).toBe("Resource not found");
  });

  it("omits an empty or absent response body", () => {
    expect(formatToolError(Object.assign(new Error("boom"), { response: {} }))).toBe("boom");
    expect(formatToolError(Object.assign(new Error("boom"), { response: null }))).toBe("boom");
  });

  it("handles non-Error throws", () => {
    expect(formatToolError("just a string")).toBe("just a string");
  });
});
