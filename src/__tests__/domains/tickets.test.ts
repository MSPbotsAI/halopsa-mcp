/**
 * Tests for tickets domain handler
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Create mock functions using vi.hoisted so they're available when vi.mock is hoisted
const {
  mockTicketsList,
  mockTicketsGet,
  mockTicketsCreate,
  mockTicketsUpdate,
  mockActionsList,
  mockActionsCreate,
  mockClient,
} = vi.hoisted(() => {
  const mockTicketsList = vi.fn();
  const mockTicketsGet = vi.fn();
  const mockTicketsCreate = vi.fn();
  const mockTicketsUpdate = vi.fn();
  const mockActionsList = vi.fn();
  const mockActionsCreate = vi.fn();

  const mockClient = {
    tickets: {
      list: mockTicketsList,
      get: mockTicketsGet,
      create: mockTicketsCreate,
      update: mockTicketsUpdate,
    },
    actions: {
      list: mockActionsList,
      create: mockActionsCreate,
    },
  };

  return {
    mockTicketsList,
    mockTicketsGet,
    mockTicketsCreate,
    mockTicketsUpdate,
    mockActionsList,
    mockActionsCreate,
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
import { ticketsHandler } from "../../domains/tickets.js";

describe("Tickets Domain Handler", () => {
  beforeEach(() => {
    // Clear call history but NOT return values
    mockTicketsList.mockClear();
    mockTicketsGet.mockClear();
    mockTicketsCreate.mockClear();
    mockTicketsUpdate.mockClear();
    mockActionsList.mockClear();
    mockActionsCreate.mockClear();

    // Reset mock implementations
    mockTicketsList.mockResolvedValue({
      record_count: 2,
      tickets: [
        { id: 1, summary: "Test ticket 1" },
        { id: 2, summary: "Test ticket 2" },
      ],
    });
    mockTicketsGet.mockResolvedValue({
      id: 1,
      summary: "Test ticket",
      details: "Test details",
    });
    mockTicketsCreate.mockResolvedValue({
      id: 100,
      summary: "New ticket",
      client_id: 5,
    });
    mockTicketsUpdate.mockResolvedValue({
      id: 1,
      summary: "Updated ticket",
      status_id: 2,
    });
    mockActionsList.mockResolvedValue({
      actions: [
        { id: 1, note: "Action 1" },
        { id: 2, note: "Action 2" },
      ],
    });
    mockActionsCreate.mockResolvedValue({
      id: 50,
      ticket_id: 1,
      note: "New action",
    });
  });

  describe("getTools", () => {
    it("should return all ticket tools", () => {
      const tools = ticketsHandler.getTools();

      expect(tools.length).toBe(5);

      const toolNames = tools.map((t) => t.name);
      expect(toolNames).toContain("halopsa_tickets_list");
      expect(toolNames).toContain("halopsa_tickets_get");
      expect(toolNames).toContain("halopsa_tickets_create");
      expect(toolNames).toContain("halopsa_tickets_update");
      expect(toolNames).toContain("halopsa_tickets_add_action");
    });

    it("halopsa_tickets_list should have correct schema", () => {
      const tools = ticketsHandler.getTools();
      const listTool = tools.find((t) => t.name === "halopsa_tickets_list");

      expect(listTool).toBeDefined();
      expect(listTool?.inputSchema.properties).toHaveProperty("client_id");
      expect(listTool?.inputSchema.properties).toHaveProperty("status_id");
      expect(listTool?.inputSchema.properties).toHaveProperty("open_only");
      expect(listTool?.inputSchema.properties).toHaveProperty("limit");
    });

    it("halopsa_tickets_update should expose agent_id and team_id", () => {
      const tools = ticketsHandler.getTools();
      const updateTool = tools.find((t) => t.name === "halopsa_tickets_update");

      expect(updateTool).toBeDefined();
      expect(updateTool?.inputSchema.required).toContain("ticket_id");
      expect(updateTool?.inputSchema.properties).toHaveProperty("agent_id");
      expect(updateTool?.inputSchema.properties).toHaveProperty("team_id");
    });

    it("halopsa_tickets_get should require ticket_id", () => {
      const tools = ticketsHandler.getTools();
      const getTool = tools.find((t) => t.name === "halopsa_tickets_get");

      expect(getTool).toBeDefined();
      expect(getTool?.inputSchema.required).toContain("ticket_id");
    });

    it("halopsa_tickets_create should require summary, client_id, and tickettype_id", () => {
      const tools = ticketsHandler.getTools();
      const createTool = tools.find((t) => t.name === "halopsa_tickets_create");

      expect(createTool).toBeDefined();
      expect(createTool?.inputSchema.required).toContain("summary");
      expect(createTool?.inputSchema.required).toContain("client_id");
      expect(createTool?.inputSchema.required).toContain("tickettype_id");
    });
  });

  describe("handleCall", () => {
    describe("halopsa_tickets_list", () => {
      it("should list tickets with default parameters", async () => {
        const result = await ticketsHandler.handleCall("halopsa_tickets_list", {});

        expect(result.isError).toBeUndefined();
        expect(result.content[0].type).toBe("text");

        const data = JSON.parse(result.content[0].text);
        expect(data.record_count).toBe(2);
        expect(data.tickets).toHaveLength(2);
      });

      it("should pass filters to API", async () => {
        await ticketsHandler.handleCall("halopsa_tickets_list", {
          client_id: 5,
          status_id: 2,
          open_only: true,
          limit: 10,
        });

        expect(mockTicketsList).toHaveBeenCalledWith({
          client_id: 5,
          status_id: 2,
          agent_id: undefined,
          open_only: true,
          closed_only: undefined,
          pageSize: 10,
        });
      });
    });

    describe("halopsa_tickets_get", () => {
      it("should get a single ticket", async () => {
        const result = await ticketsHandler.handleCall("halopsa_tickets_get", {
          ticket_id: 1,
        });

        expect(result.isError).toBeUndefined();

        const data = JSON.parse(result.content[0].text);
        expect(data.id).toBe(1);
        expect(data.summary).toBe("Test ticket");
      });

      it("should include actions when requested", async () => {
        const result = await ticketsHandler.handleCall("halopsa_tickets_get", {
          ticket_id: 1,
          include_actions: true,
        });

        const data = JSON.parse(result.content[0].text);
        expect(data.actions).toBeDefined();
        expect(data.actions).toHaveLength(2);
      });
    });

    describe("halopsa_tickets_create", () => {
      it("should create a ticket with required fields", async () => {
        const result = await ticketsHandler.handleCall("halopsa_tickets_create", {
          summary: "New ticket",
          client_id: 5,
          tickettype_id: 1,
        });

        expect(result.isError).toBeUndefined();

        const data = JSON.parse(result.content[0].text);
        expect(data.id).toBe(100);
        expect(data.summary).toBe("New ticket");
      });

      it("should pass all fields to API", async () => {
        await ticketsHandler.handleCall("halopsa_tickets_create", {
          summary: "New ticket",
          details: "Ticket details",
          client_id: 5,
          tickettype_id: 1,
          priority_id: 3,
          agent_id: 10,
          site_id: 2,
        });

        expect(mockTicketsCreate).toHaveBeenCalledWith({
          summary: "New ticket",
          details: "Ticket details",
          client_id: 5,
          tickettype_id: 1,
          priority_id: 3,
          agent_id: 10,
          site_id: 2,
        });
      });
    });

    describe("halopsa_tickets_update", () => {
      it("should update a ticket", async () => {
        const result = await ticketsHandler.handleCall("halopsa_tickets_update", {
          ticket_id: 1,
          summary: "Updated ticket",
        });

        expect(result.isError).toBeUndefined();

        const data = JSON.parse(result.content[0].text);
        expect(data.summary).toBe("Updated ticket");
      });

      it("should pass update fields to API", async () => {
        await ticketsHandler.handleCall("halopsa_tickets_update", {
          ticket_id: 1,
          summary: "Updated",
          status_id: 2,
          priority_id: 1,
        });

        expect(mockTicketsUpdate).toHaveBeenCalledWith(1, {
          summary: "Updated",
          details: undefined,
          status_id: 2,
          priority_id: 1,
          agent_id: undefined,
          team_id: undefined,
          customfields: undefined,
        });
      });

      it("should pass team_id to API when reassigning a ticket to a team", async () => {
        await ticketsHandler.handleCall("halopsa_tickets_update", {
          ticket_id: 1,
          team_id: 7,
        });

        expect(mockTicketsUpdate).toHaveBeenCalledWith(1, {
          summary: undefined,
          details: undefined,
          status_id: undefined,
          priority_id: undefined,
          agent_id: undefined,
          team_id: 7,
          customfields: undefined,
        });
      });
    });

    describe("halopsa_tickets_update custom fields", () => {
      it("should pass a custom field addressed by id", async () => {
        await ticketsHandler.handleCall("halopsa_tickets_update", {
          ticket_id: 49080,
          custom_fields: [{ id: 291, value: true }],
        });

        expect(mockTicketsUpdate).toHaveBeenCalledWith(
          49080,
          expect.objectContaining({
            customfields: [{ id: 291, value: true }],
          })
        );
      });

      it("should pass a custom field addressed by name", async () => {
        await ticketsHandler.handleCall("halopsa_tickets_update", {
          ticket_id: 49080,
          custom_fields: [{ name: "CFEscalated", value: true }],
        });

        expect(mockTicketsUpdate).toHaveBeenCalledWith(
          49080,
          expect.objectContaining({
            customfields: [{ name: "CFEscalated", value: true }],
          })
        );
      });

      it("should not send an explicit undefined for the absent identifier", async () => {
        await ticketsHandler.handleCall("halopsa_tickets_update", {
          ticket_id: 49080,
          custom_fields: [{ id: 291, value: "escalated" }],
        });

        const payload = mockTicketsUpdate.mock.calls[0][1];
        expect(Object.keys(payload.customfields[0])).toEqual(["id", "value"]);
      });

      it("should carry a null value through so a field can be cleared", async () => {
        await ticketsHandler.handleCall("halopsa_tickets_update", {
          ticket_id: 49080,
          custom_fields: [{ id: 291, value: null }],
        });

        expect(mockTicketsUpdate).toHaveBeenCalledWith(
          49080,
          expect.objectContaining({
            customfields: [{ id: 291, value: null }],
          })
        );
      });

      it("should write custom fields alongside built-in fields", async () => {
        await ticketsHandler.handleCall("halopsa_tickets_update", {
          ticket_id: 49080,
          status_id: 2,
          custom_fields: [{ id: 291, value: true }],
        });

        expect(mockTicketsUpdate).toHaveBeenCalledWith(49080, {
          summary: undefined,
          details: undefined,
          status_id: 2,
          priority_id: undefined,
          agent_id: undefined,
          team_id: undefined,
          customfields: [{ id: 291, value: true }],
        });
      });

      it("should reject an entry identifying no field", async () => {
        await expect(
          ticketsHandler.handleCall("halopsa_tickets_update", {
            ticket_id: 49080,
            custom_fields: [{ value: true }],
          })
        ).rejects.toThrow("needs an id or a name");

        expect(mockTicketsUpdate).not.toHaveBeenCalled();
      });

      it("should reject an entry with no value", async () => {
        await expect(
          ticketsHandler.handleCall("halopsa_tickets_update", {
            ticket_id: 49080,
            custom_fields: [{ id: 291 }],
          })
        ).rejects.toThrow("needs a value");

        expect(mockTicketsUpdate).not.toHaveBeenCalled();
      });

      it("should reject custom_fields that is not an array", async () => {
        await expect(
          ticketsHandler.handleCall("halopsa_tickets_update", {
            ticket_id: 49080,
            custom_fields: { id: 291, value: true },
          })
        ).rejects.toThrow("must be an array");

        expect(mockTicketsUpdate).not.toHaveBeenCalled();
      });
    });

    describe("halopsa_tickets_add_action", () => {
      it("should add an action to a ticket", async () => {
        const result = await ticketsHandler.handleCall("halopsa_tickets_add_action", {
          ticket_id: 1,
          note: "New action",
        });

        expect(result.isError).toBeUndefined();

        const data = JSON.parse(result.content[0].text);
        expect(data.ticket_id).toBe(1);
        expect(data.note).toBe("New action");
      });

      it("should pass all action fields to API", async () => {
        await ticketsHandler.handleCall("halopsa_tickets_add_action", {
          ticket_id: 1,
          note: "Action note",
          outcome: "Resolved",
          timetaken: 30,
          hidden_from_user: true,
        });

        expect(mockActionsCreate).toHaveBeenCalledWith({
          ticket_id: 1,
          note: "Action note",
          outcome: "Resolved",
          timetaken: 30,
          hiddenfromuser: true,
        });
      });
    });

    describe("unknown tool", () => {
      it("should return error for unknown tool", async () => {
        const result = await ticketsHandler.handleCall("halopsa_tickets_unknown", {});

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("Unknown ticket tool");
      });
    });
  });
});
