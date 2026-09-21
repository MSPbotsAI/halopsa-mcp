/**
 * Tests for lookups domain handler
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockStatusesList,
  mockPrioritiesList,
  mockTicketTypesList,
  mockCategoriesList,
  mockClient,
} = vi.hoisted(() => {
  const mockStatusesList = vi.fn();
  const mockPrioritiesList = vi.fn();
  const mockTicketTypesList = vi.fn();
  const mockCategoriesList = vi.fn();

  const mockClient = {
    statuses: { list: mockStatusesList },
    priorities: { list: mockPrioritiesList },
    ticketTypes: { list: mockTicketTypesList },
    categories: { list: mockCategoriesList },
  };

  return {
    mockStatusesList,
    mockPrioritiesList,
    mockTicketTypesList,
    mockCategoriesList,
    mockClient,
  };
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

import { lookupsHandler } from "../../domains/lookups.js";

function parse(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text);
}

describe("Lookups Domain Handler", () => {
  beforeEach(() => {
    mockStatusesList.mockClear();
    mockPrioritiesList.mockClear();
    mockTicketTypesList.mockClear();
    mockCategoriesList.mockClear();

    // Bare arrays: this is what Halo's reference endpoints actually answer
    // with, and the shape the SDK's declared return type does not describe.
    mockStatusesList.mockResolvedValue([
      { id: 1, name: "New", type: 0, sequence: 10, isopen: true, junk: "x" },
      { id: 9, name: "Closed", type: 0, sequence: 90, isopen: false },
    ]);
    mockPrioritiesList.mockResolvedValue([
      { id: 1, name: "Critical", slaid: 3, fixtime: 4 },
    ]);
    mockTicketTypesList.mockResolvedValue([
      { id: 21, name: "Incident", use: "reqs", cancreate: true },
    ]);
    mockCategoriesList.mockResolvedValue([
      { id: 5, value: "Hardware>Laptop", type_id: 1 },
      { id: 6, value: "Billing", type_id: 2 },
    ]);
  });

  describe("tool definitions", () => {
    it("exposes a single combined lookup tool", () => {
      const tools = lookupsHandler.getTools();
      expect(tools.map((t) => t.name)).toEqual(["halopsa_lookups_get"]);
    });

    it("does not collide with the server's own halopsa_status tool", () => {
      const names = lookupsHandler.getTools().map((t) => t.name);
      expect(names).not.toContain("halopsa_status");
    });

    it("offers all four reference tables as kinds", () => {
      const [tool] = lookupsHandler.getTools();
      const kinds = (
        tool.inputSchema.properties as Record<string, { items?: { enum?: string[] } }>
      ).kinds;
      expect(kinds.items?.enum).toEqual([
        "statuses",
        "priorities",
        "ticket_types",
        "categories",
      ]);
    });
  });

  describe("halopsa_lookups_get", () => {
    it("reads all four tables when no kinds are given", async () => {
      const payload = parse(
        await lookupsHandler.handleCall("halopsa_lookups_get", {})
      );

      expect(Object.keys(payload)).toEqual([
        "statuses",
        "priorities",
        "ticket_types",
        "categories",
      ]);
      expect(mockStatusesList).toHaveBeenCalledTimes(1);
      expect(mockPrioritiesList).toHaveBeenCalledTimes(1);
      expect(mockTicketTypesList).toHaveBeenCalledTimes(1);
      expect(mockCategoriesList).toHaveBeenCalledTimes(1);
    });

    it("reads only the requested kinds", async () => {
      const payload = parse(
        await lookupsHandler.handleCall("halopsa_lookups_get", {
          kinds: ["statuses"],
        })
      );

      expect(Object.keys(payload)).toEqual(["statuses"]);
      expect(mockCategoriesList).not.toHaveBeenCalled();
    });

    it("ignores unknown kinds and falls back to all four when none survive", async () => {
      const payload = parse(
        await lookupsHandler.handleCall("halopsa_lookups_get", {
          kinds: ["nonsense"],
        })
      );

      expect(Object.keys(payload)).toHaveLength(4);
    });

    it("unwraps a bare array response into rows", async () => {
      const payload = parse(
        await lookupsHandler.handleCall("halopsa_lookups_get", {
          kinds: ["statuses"],
        })
      );

      expect(payload.statuses.record_count).toBe(2);
      expect(payload.statuses.returned).toBe(2);
      expect(payload.statuses.rows[0]).toMatchObject({ id: 1, name: "New" });
    });

    it("unwraps a wrapped response too", async () => {
      mockStatusesList.mockResolvedValue({
        record_count: 1,
        statuses: [{ id: 3, name: "On Hold" }],
      });

      const payload = parse(
        await lookupsHandler.handleCall("halopsa_lookups_get", {
          kinds: ["statuses"],
        })
      );

      expect(payload.statuses.record_count).toBe(1);
      expect(payload.statuses.rows).toEqual([{ id: 3, name: "On Hold" }]);
    });

    it("projects away fields the caller has no use for", async () => {
      const payload = parse(
        await lookupsHandler.handleCall("halopsa_lookups_get", {
          kinds: ["statuses"],
        })
      );

      expect(payload.statuses.rows[0]).not.toHaveProperty("junk");
    });

    it("returns rows untouched when full_response is set", async () => {
      const payload = parse(
        await lookupsHandler.handleCall("halopsa_lookups_get", {
          kinds: ["statuses"],
          full_response: true,
        })
      );

      expect(payload.statuses.rows[0]).toHaveProperty("junk", "x");
    });

    it("passes category_type_id through to Halo as type_id", async () => {
      await lookupsHandler.handleCall("halopsa_lookups_get", {
        kinds: ["categories"],
        category_type_id: 2,
      });

      expect(mockCategoriesList).toHaveBeenCalledWith(
        expect.objectContaining({ type_id: 2 })
      );
    });

    it("scopes statuses and categories by ticket type", async () => {
      await lookupsHandler.handleCall("halopsa_lookups_get", {
        kinds: ["statuses", "categories"],
        tickettype_id: 21,
      });

      expect(mockStatusesList).toHaveBeenCalledWith(
        expect.objectContaining({ tickettype_id: 21 })
      );
      expect(mockCategoriesList).toHaveBeenCalledWith(
        expect.objectContaining({ tickettype_id: 21 })
      );
    });

    it("asks for inactive rows with each endpoint's own flag", async () => {
      await lookupsHandler.handleCall("halopsa_lookups_get", {
        kinds: ["statuses", "ticket_types"],
        include_inactive: true,
      });

      expect(mockStatusesList).toHaveBeenCalledWith(
        expect.objectContaining({ showall: true })
      );
      expect(mockTicketTypesList).toHaveBeenCalledWith(
        expect.objectContaining({ showinactive: true })
      );
    });

    it("caps rows itself, since the reference endpoints ignore page_size", async () => {
      const payload = parse(
        await lookupsHandler.handleCall("halopsa_lookups_get", {
          kinds: ["categories"],
          limit: 1,
        })
      );

      expect(payload.categories.returned).toBe(1);
      expect(payload.categories.truncated).toBe(true);
    });

    it("reports a failing table without losing the ones that worked", async () => {
      mockCategoriesList.mockRejectedValue(new Error("403 Forbidden"));

      const payload = parse(
        await lookupsHandler.handleCall("halopsa_lookups_get", {
          kinds: ["statuses", "categories"],
        })
      );

      expect(payload.categories.error).toContain("403");
      expect(payload.statuses.rows).toHaveLength(2);
    });

    it("explains that categories are written by value, not id", async () => {
      const payload = parse(
        await lookupsHandler.handleCall("halopsa_lookups_get", {
          kinds: ["categories"],
        })
      );

      expect(payload.categories.note).toContain("value");
      expect(payload.categories.rows[0].value).toBe("Hardware>Laptop");
    });

    it("warns that a priority is written by priorityid, not the GUID id", async () => {
      // A live tenant returns id as the SLA-policy GUID and priorityid as the
      // number halopsa_tickets_update wants. Handing both over without saying
      // which is which is how an agent ends up posting a GUID as priority_id.
      mockPrioritiesList.mockResolvedValue([
        {
          id: "c183eb27-0a8a-4380-59fa-08d5c0811dad",
          name: "Urgent",
          priorityid: 1,
          slaid: 2,
        },
      ]);

      const payload = parse(
        await lookupsHandler.handleCall("halopsa_lookups_get", {
          kinds: ["priorities"],
        })
      );

      expect(payload.priorities.note).toContain("priorityid");
      expect(payload.priorities.rows[0]).toMatchObject({
        id: "c183eb27-0a8a-4380-59fa-08d5c0811dad",
        priorityid: 1,
        slaid: 2,
      });
    });

    it("keeps the ticket type defaults a caller would otherwise have to guess", async () => {
      mockTicketTypesList.mockResolvedValue([
        {
          id: 22,
          name: "Incident",
          default_sla: 1,
          default_priority: 4,
          default_team: "1st Line Support",
          kanbanstatuschoice_list: "[]",
        },
      ]);

      const payload = parse(
        await lookupsHandler.handleCall("halopsa_lookups_get", {
          kinds: ["ticket_types"],
        })
      );

      expect(payload.ticket_types.rows[0]).toMatchObject({
        default_sla: 1,
        default_priority: 4,
        default_team: "1st Line Support",
      });
      expect(payload.ticket_types.rows[0]).not.toHaveProperty(
        "kanbanstatuschoice_list"
      );
    });

    it("says what a status `type` actually means", async () => {
      const payload = parse(
        await lookupsHandler.handleCall("halopsa_lookups_get", {
          kinds: ["statuses"],
        })
      );

      expect(payload.statuses.note).toContain("not open vs closed");
    });

    it("rejects an unknown tool name", async () => {
      const result = await lookupsHandler.handleCall("halopsa_lookups_nope", {});
      expect(result.isError).toBe(true);
    });
  });
});
