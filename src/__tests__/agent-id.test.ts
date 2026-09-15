/**
 * Tests for the halo_agent_id argument guard.
 */

import { describe, it, expect } from "vitest";
import { readHaloAgentId } from "../utils/agent-id.js";

describe("readHaloAgentId", () => {
  it("reads a plain integer", () => {
    expect(readHaloAgentId({ halo_agent_id: 14 })).toBe(14);
  });

  it("accepts a numeric string", () => {
    expect(readHaloAgentId({ halo_agent_id: " 14 " })).toBe(14);
  });

  it("returns undefined when absent and optional", () => {
    expect(readHaloAgentId({})).toBeUndefined();
    expect(readHaloAgentId({ halo_agent_id: null })).toBeUndefined();
  });

  it("throws when absent and required", () => {
    expect(() => readHaloAgentId({}, { required: true })).toThrow(
      /halo_agent_id is required/
    );
  });

  // Regression: a caller sent its own platform agent id as `agent_id`. Ignoring
  // the stale name would silently drop the assignment, so it is rejected by name.
  it("rejects a leftover agent_id and names the replacement", () => {
    expect(() => readHaloAgentId({ agent_id: 14 })).toThrow(/use halo_agent_id/);
    expect(() => readHaloAgentId({ agent_id: 14 })).toThrow(
      /halopsa_agents_list/
    );
  });

  it("prefers halo_agent_id when both are present", () => {
    expect(readHaloAgentId({ agent_id: 999, halo_agent_id: 14 })).toBe(14);
  });

  // The production failure: a 19-digit platform id overflows HaloPSA's 32-bit
  // column, and HaloPSA answered only with a byte offset into the request.
  it("rejects an id too large for HaloPSA", () => {
    expect(() =>
      readHaloAgentId({ halo_agent_id: "5032310761632013429" })
    ).toThrow(/positive integer up to 2147483647/);
    expect(() =>
      readHaloAgentId({ halo_agent_id: "5032310761632013429" })
    ).toThrow(/5032310761632013429/);
  });

  it("rejects non-integers, zero and negatives", () => {
    for (const bad of [0, -1, 1.5, "abc", {}, true]) {
      expect(() => readHaloAgentId({ halo_agent_id: bad })).toThrow(
        /must be the ID of an agent in HaloPSA/
      );
    }
  });
});
