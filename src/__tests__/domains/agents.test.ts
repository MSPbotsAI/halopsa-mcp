/**
 * Tests for agents domain handler
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Create mock functions using vi.hoisted so they're available when vi.mock is hoisted
const { mockAgentsList, mockAgentsGet, mockTeamsList, mockClient } =
  vi.hoisted(() => {
    const mockAgentsList = vi.fn();
    const mockAgentsGet = vi.fn();
    const mockTeamsList = vi.fn();

    const mockClient = {
      agents: {
        list: mockAgentsList,
        get: mockAgentsGet,
      },
      teams: {
        list: mockTeamsList,
      },
    };

    return {
      mockAgentsList,
      mockAgentsGet,
      mockTeamsList,
      mockClient,
    };
  });

// Mock the client module before importing the handler
vi.mock("../../utils/client.js", () => ({
  getClient: () => Promise.resolve(mockClient),
  clearClient: vi.fn(),
  getCredentials: () => ({
    clientId: "test",
    clientSecret: "test",
    tenant: "test",
  }),
}));

// Import handler after mocking
import { agentsHandler } from "../../domains/agents.js";

describe("Agents Domain Handler", () => {
  beforeEach(() => {
    // Clear call history but NOT return values
    mockAgentsList.mockClear();
    mockAgentsGet.mockClear();
    mockTeamsList.mockClear();

    // Reset mock implementations
    mockAgentsList.mockResolvedValue({
      record_count: 2,
      agents: [
        { id: 1, name: "John Doe", email: "john@example.com" },
        { id: 2, name: "Jane Smith", email: "jane@example.com" },
      ],
    });
    mockAgentsGet.mockResolvedValue({
      id: 1,
      name: "John Doe",
      email: "john@example.com",
      team_id: 5,
    });
    mockTeamsList.mockResolvedValue({
      record_count: 2,
      teams: [
        { id: 1, name: "Support" },
        { id: 2, name: "Engineering" },
      ],
    });
  });

  describe("getTools", () => {
    it("should return all agent tools", () => {
      const tools = agentsHandler.getTools();

      expect(tools.length).toBe(3);

      const toolNames = tools.map((t) => t.name);
      expect(toolNames).toContain("halopsa_agents_list");
      expect(toolNames).toContain("halopsa_agents_get");
      expect(toolNames).toContain("halopsa_teams_list");
    });

    it("halopsa_agents_list should have correct schema", () => {
      const tools = agentsHandler.getTools();
      const listTool = tools.find((t) => t.name === "halopsa_agents_list");

      expect(listTool).toBeDefined();
      expect(listTool?.inputSchema.properties).toHaveProperty("team_id");
      expect(listTool?.inputSchema.properties).toHaveProperty("inactive");
      expect(listTool?.inputSchema.properties).toHaveProperty("limit");
    });

    it("halopsa_agents_get should require agent_id", () => {
      const tools = agentsHandler.getTools();
      const getTool = tools.find((t) => t.name === "halopsa_agents_get");

      expect(getTool).toBeDefined();
      expect(getTool?.inputSchema.required).toContain("agent_id");
    });

    it("halopsa_teams_list should have optional limit parameter", () => {
      const tools = agentsHandler.getTools();
      const teamsTool = tools.find((t) => t.name === "halopsa_teams_list");

      expect(teamsTool).toBeDefined();
      expect(teamsTool?.inputSchema.properties).toHaveProperty("limit");
      expect(teamsTool?.inputSchema.required).toBeUndefined();
    });
  });

  describe("handleCall", () => {
    describe("halopsa_agents_list", () => {
      it("should list agents with default parameters", async () => {
        const result = await agentsHandler.handleCall("halopsa_agents_list", {});

        expect(result.isError).toBeUndefined();
        expect(result.content[0].type).toBe("text");

        const data = JSON.parse(result.content[0].text);
        expect(data.record_count).toBe(2);
        expect(data.agents).toHaveLength(2);
      });

      it("should pass filters to API", async () => {
        await agentsHandler.handleCall("halopsa_agents_list", {
          team_id: 1,
          inactive: true,
          limit: 25,
        });

        expect(mockAgentsList).toHaveBeenCalledWith({
          team_id: 1,
          inactive: true,
          pageSize: 25,
        });
      });
    });

    describe("halopsa_agents_get", () => {
      it("should get a single agent", async () => {
        const result = await agentsHandler.handleCall("halopsa_agents_get", {
          agent_id: 1,
        });

        expect(result.isError).toBeUndefined();

        const data = JSON.parse(result.content[0].text);
        expect(data.id).toBe(1);
        expect(data.name).toBe("John Doe");
        expect(data.email).toBe("john@example.com");
      });
    });

    describe("halopsa_teams_list", () => {
      it("should list teams with default parameters", async () => {
        const result = await agentsHandler.handleCall("halopsa_teams_list", {});

        expect(result.isError).toBeUndefined();

        const data = JSON.parse(result.content[0].text);
        expect(data.record_count).toBe(2);
        expect(data.teams).toHaveLength(2);
      });

      it("should pass limit to API", async () => {
        await agentsHandler.handleCall("halopsa_teams_list", {
          limit: 100,
        });

        expect(mockTeamsList).toHaveBeenCalledWith({
          pageSize: 100,
        });
      });
    });

    // Halo does not wrap every list endpoint the way /Tickets and /Client do.
    // These are the shapes that made halopsa_teams_list return {} and
    // halopsa_agents_list return a bare record_count against a live tenant.
    describe("list responses Halo does not wrap as expected", () => {
      it("should read rows from a bare array response", async () => {
        mockTeamsList.mockResolvedValueOnce([
          { id: 1, name: "1st Line Support" },
          { id: 3, name: "2nd Line Support" },
        ]);

        const result = await agentsHandler.handleCall("halopsa_teams_list", {});
        const data = JSON.parse(result.content[0].text);

        expect(data.record_count).toBe(2);
        expect(data.teams).toHaveLength(2);
        expect(data.teams[1]).toEqual({ id: 3, name: "2nd Line Support" });
        expect(data.unrecognised_response).toBeUndefined();
      });

      it("should read rows from an array under a different key", async () => {
        mockTeamsList.mockResolvedValueOnce({
          record_count: 2,
          records: [{ id: 1, name: "Support" }, { id: 3, name: "Infrastructure" }],
        });

        const result = await agentsHandler.handleCall("halopsa_teams_list", {});
        const data = JSON.parse(result.content[0].text);

        expect(data.record_count).toBe(2);
        expect(data.teams).toHaveLength(2);
        expect(data.unrecognised_response).toBeUndefined();
      });

      it("should surface the raw response when it carries a count but no rows", async () => {
        mockAgentsList.mockResolvedValueOnce({ record_count: 21 });

        const result = await agentsHandler.handleCall("halopsa_agents_list", {});
        const data = JSON.parse(result.content[0].text);

        // The count Halo reported is kept, so "21 rows we could not find" stays
        // distinguishable from "no rows" -- the old code dropped both silently.
        expect(data.record_count).toBe(21);
        expect(data.agents).toEqual([]);
        expect(data.unrecognised_response).toEqual({ record_count: 21 });
      });

      it("should surface an empty object rather than reporting an empty list", async () => {
        mockTeamsList.mockResolvedValueOnce({});

        const result = await agentsHandler.handleCall("halopsa_teams_list", {});
        const data = JSON.parse(result.content[0].text);

        expect(data.record_count).toBe(0);
        expect(data.teams).toEqual([]);
        expect(data.unrecognised_response).toEqual({});
      });

      it("should not guess when several arrays could be the rows", async () => {
        const ambiguous = {
          record_count: 2,
          teams_a: [{ id: 1 }],
          teams_b: [{ id: 2 }],
        };
        mockTeamsList.mockResolvedValueOnce(ambiguous);

        const result = await agentsHandler.handleCall("halopsa_teams_list", {});
        const data = JSON.parse(result.content[0].text);

        expect(data.teams).toEqual([]);
        expect(data.unrecognised_response).toEqual(ambiguous);
      });

      it("should leave the documented shape untouched", async () => {
        const result = await agentsHandler.handleCall("halopsa_teams_list", {});
        const data = JSON.parse(result.content[0].text);

        expect(data).toEqual({
          record_count: 2,
          teams: [
            { id: 1, name: "Support" },
            { id: 2, name: "Engineering" },
          ],
        });
      });
    });

    describe("unknown tool", () => {
      it("should return error for unknown tool", async () => {
        const result = await agentsHandler.handleCall("halopsa_agents_unknown", {});

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("Unknown agent tool");
      });
    });
  });
});
