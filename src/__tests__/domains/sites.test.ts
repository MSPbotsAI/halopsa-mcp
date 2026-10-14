/**
 * Tests for sites domain handler
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSitesList, mockClient } = vi.hoisted(() => {
  const mockSitesList = vi.fn();

  const mockClient = {
    sites: {
      list: mockSitesList,
    },
  };

  return { mockSitesList, mockClient };
});

vi.mock("../../utils/client.js", () => ({
  getClient: () => Promise.resolve(mockClient),
  clearClient: vi.fn(),
  getCredentials: () => ({
    clientId: "test",
    clientSecret: "test",
    tenant: "test",
  }),
}));

import { sitesHandler } from "../../domains/sites.js";

describe("Sites Domain Handler", () => {
  beforeEach(() => {
    mockSitesList.mockClear();

    mockSitesList.mockResolvedValue({
      record_count: 2,
      sites: [
        { id: 1, name: "HQ", client_id: 10 },
        { id: 2, name: "Branch", client_id: 10 },
      ],
    });
  });

  describe("getTools", () => {
    it("should return the site tool", () => {
      const tools = sitesHandler.getTools();

      expect(tools.length).toBe(1);
      expect(tools.map((t) => t.name)).toContain("halopsa_sites_list");
    });

    it("halopsa_sites_list should have correct schema", () => {
      const tools = sitesHandler.getTools();
      const listTool = tools.find((t) => t.name === "halopsa_sites_list");

      expect(listTool).toBeDefined();
      expect(listTool?.inputSchema.properties).toHaveProperty("client_id");
      expect(listTool?.inputSchema.properties).toHaveProperty("limit");
    });
  });

  describe("handleCall", () => {
    describe("halopsa_sites_list", () => {
      // TC-HALO-012 (AC9)
      it("should list all sites with id and name", async () => {
        const result = await sitesHandler.handleCall("halopsa_sites_list", {});

        expect(result.isError).toBeUndefined();
        const data = JSON.parse(result.content[0].text);
        expect(data.record_count).toBe(2);
        expect(data.sites).toHaveLength(2);
        expect(data.sites[0]).toMatchObject({ id: 1, name: "HQ" });
        expect(data.sites[1]).toMatchObject({ id: 2, name: "Branch" });
      });

      it("should forward an optional client_id filter to the API", async () => {
        await sitesHandler.handleCall("halopsa_sites_list", {
          client_id: 10,
          limit: 25,
        });

        expect(mockSitesList).toHaveBeenCalledWith({
          client_id: 10,
          pageSize: 25,
        });
      });

      it("should default limit to 50 when not provided", async () => {
        await sitesHandler.handleCall("halopsa_sites_list", {});

        expect(mockSitesList).toHaveBeenCalledWith({
          client_id: undefined,
          pageSize: 50,
        });
      });

      it("should return an empty list, not an error, when the tenant has zero sites", async () => {
        mockSitesList.mockResolvedValue({ record_count: 0, sites: [] });

        const result = await sitesHandler.handleCall("halopsa_sites_list", {});

        expect(result.isError).toBeUndefined();
        const data = JSON.parse(result.content[0].text);
        expect(data.record_count).toBe(0);
        expect(data.sites).toEqual([]);
      });
    });

    describe("unknown tool", () => {
      it("should return error for unknown tool", async () => {
        const result = await sitesHandler.handleCall("halopsa_sites_unknown", {});

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("Unknown site tool");
      });
    });
  });
});
