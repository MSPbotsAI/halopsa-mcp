/**
 * Tests for users (contacts) domain handler
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AsyncLocalStorage } from "node:async_hooks";

// Create mock functions using vi.hoisted so they're available when vi.mock is hoisted
const {
  mockContactsList,
  mockContactsGet,
  mockContactsCreate,
  mockContactsUpdate,
  mockClientsGet,
  mockClient,
} = vi.hoisted(() => {
  const mockContactsList = vi.fn();
  const mockContactsGet = vi.fn();
  const mockContactsCreate = vi.fn();
  const mockContactsUpdate = vi.fn();
  const mockClientsGet = vi.fn();

  const mockClient = {
    contacts: {
      list: mockContactsList,
      get: mockContactsGet,
      create: mockContactsCreate,
      update: mockContactsUpdate,
    },
    clients: {
      get: mockClientsGet,
    },
  };

  return {
    mockContactsList,
    mockContactsGet,
    mockContactsCreate,
    mockContactsUpdate,
    mockClientsGet,
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
import { usersHandler } from "../../domains/users.js";

describe("Users Domain Handler", () => {
  beforeEach(() => {
    mockContactsList.mockClear();
    mockContactsGet.mockClear();
    mockContactsCreate.mockClear();
    mockContactsUpdate.mockClear();
    mockClientsGet.mockClear();

    // Default: no duplicate on the create-path's lookup, empty on search.
    mockContactsList.mockResolvedValue({ record_count: 0, users: [] });
    // Default: client 10's main site is 1 (used by the omitted-site_id
    // default path, TC-HALO-005/TC-HALO-016, PRD-20396 rework F3).
    mockClientsGet.mockResolvedValue({ id: 10, name: "Acme", main_site_id: 1 });
    mockContactsGet.mockResolvedValue({
      id: 101,
      name: "Jane",
      emailaddress: "jane@x.com",
      phonenumber: "111",
      inactive: false,
    });
    mockContactsCreate.mockResolvedValue({
      id: 200,
      name: "New Contact",
      emailaddress: "new@x.com",
    });
    mockContactsUpdate.mockResolvedValue({
      id: 101,
      name: "Jane",
      emailaddress: "jane@x.com",
      phonenumber: "222",
      inactive: false,
    });
  });

  describe("getTools", () => {
    it("should return all user tools", () => {
      const tools = usersHandler.getTools();

      expect(tools.length).toBe(4);

      const toolNames = tools.map((t) => t.name);
      expect(toolNames).toContain("halopsa_users_search");
      expect(toolNames).toContain("halopsa_users_get");
      expect(toolNames).toContain("halopsa_users_create");
      expect(toolNames).toContain("halopsa_users_update");
    });

    it("halopsa_users_search should require query", () => {
      const tools = usersHandler.getTools();
      const tool = tools.find((t) => t.name === "halopsa_users_search");

      expect(tool).toBeDefined();
      expect(tool?.inputSchema.required).toContain("query");
    });

    it("halopsa_users_get should require contact_id", () => {
      const tools = usersHandler.getTools();
      const tool = tools.find((t) => t.name === "halopsa_users_get");

      expect(tool).toBeDefined();
      expect(tool?.inputSchema.required).toContain("contact_id");
    });

    it("halopsa_users_create should require name, email, and client_id", () => {
      const tools = usersHandler.getTools();
      const tool = tools.find((t) => t.name === "halopsa_users_create");

      expect(tool).toBeDefined();
      expect(tool?.inputSchema.required).toContain("name");
      expect(tool?.inputSchema.required).toContain("email");
      expect(tool?.inputSchema.required).toContain("client_id");
    });

    it("halopsa_users_update should require only contact_id", () => {
      const tools = usersHandler.getTools();
      const tool = tools.find((t) => t.name === "halopsa_users_update");

      expect(tool).toBeDefined();
      expect(tool?.inputSchema.required).toEqual(["contact_id"]);
    });
  });

  describe("handleCall", () => {
    describe("halopsa_users_search", () => {
      // TC-HALO-001 (AC1)
      it("should list only contacts matching the query", async () => {
        mockContactsList.mockResolvedValue({
          record_count: 1,
          users: [{ id: 1, name: "Jane", emailaddress: "jane@x.com" }],
        });

        const result = await usersHandler.handleCall("halopsa_users_search", {
          query: "jane",
        });

        expect(result.isError).toBeUndefined();
        const data = JSON.parse(result.content[0].text);
        expect(data.record_count).toBe(1);
        expect(data.users).toHaveLength(1);
        expect(data.users[0].name).toBe("Jane");
        expect(mockContactsList).toHaveBeenCalledWith({
          search: "jane",
          pageSize: 50,
        });
      });

      // TC-HALO-002 (AC2)
      it("should return an empty list, not an error, when nothing matches", async () => {
        mockContactsList.mockResolvedValue({ record_count: 0, users: [] });

        const result = await usersHandler.handleCall("halopsa_users_search", {
          query: "zzz-no-match",
        });

        expect(result.isError).toBeUndefined();
        const data = JSON.parse(result.content[0].text);
        expect(data.record_count).toBe(0);
        expect(data.users).toEqual([]);
      });
    });

    describe("halopsa_users_get", () => {
      // TC-HALO-003 (AC3)
      it("should return the full contact record by id", async () => {
        const result = await usersHandler.handleCall("halopsa_users_get", {
          contact_id: 101,
        });

        expect(result.isError).toBeUndefined();
        const data = JSON.parse(result.content[0].text);
        expect(data.id).toBe(101);
        expect(data.name).toBe("Jane");
        expect(mockContactsGet).toHaveBeenCalledWith(101);
      });

      // TC-HALO-004 (AC4)
      it("should surface a clear error for an unknown contact id", async () => {
        mockContactsGet.mockRejectedValue(new Error("Contact 999999 not found"));

        await expect(
          usersHandler.handleCall("halopsa_users_get", { contact_id: 999999 })
        ).rejects.toThrow("Contact 999999 not found");
      });
    });

    describe("halopsa_users_create", () => {
      // TC-HALO-005 (AC5). site_id expectation updated for PRD-20396 rework
      // F3: when the caller omits site_id, the handler now looks up the
      // client's main_site_id and sends that instead of undefined (was
      // `site_id: undefined` before the fix — see docs/tickets/PRD-20396.md
      // "Self-test" for why that line changed).
      it("should create the contact when no existing contact has that email", async () => {
        mockContactsList.mockResolvedValue({ record_count: 0, users: [] });

        const result = await usersHandler.handleCall("halopsa_users_create", {
          name: "New Contact",
          email: "new@x.com",
          client_id: 10,
        });

        expect(result.isError).toBeUndefined();
        expect(mockContactsCreate).toHaveBeenCalledTimes(1);
        expect(mockContactsCreate).toHaveBeenCalledWith({
          name: "New Contact",
          client_id: 10,
          emailaddress: "new@x.com",
          site_id: 1,
          phonenumber: undefined,
        });

        const data = JSON.parse(result.content[0].text);
        expect(data.id).toBe(200);
      });

      // TC-HALO-006 (AC6)
      it("should refuse to create and report the existing contact on an exact email match", async () => {
        mockContactsList.mockResolvedValue({
          record_count: 1,
          users: [{ id: 101, name: "Jane", emailaddress: "jane@x.com" }],
        });

        const result = await usersHandler.handleCall("halopsa_users_create", {
          name: "Duplicate Jane",
          email: "jane@x.com",
          client_id: 10,
        });

        expect(mockContactsCreate).not.toHaveBeenCalled();
        const data = JSON.parse(result.content[0].text);
        expect(data.created).toBe(false);
        expect(data.existing_contact).toEqual({ id: 101, email: "jane@x.com" });
      });

      // TC-HALO-007 (AC6)
      it("should detect a duplicate email case-insensitively", async () => {
        mockContactsList.mockResolvedValue({
          record_count: 1,
          users: [{ id: 101, name: "Jane", emailaddress: "Jane@X.com" }],
        });

        const result = await usersHandler.handleCall("halopsa_users_create", {
          name: "Duplicate Jane",
          email: "jane@x.com",
          client_id: 10,
        });

        expect(mockContactsCreate).not.toHaveBeenCalled();
        const data = JSON.parse(result.content[0].text);
        expect(data.created).toBe(false);
        expect(data.existing_contact.id).toBe(101);
      });

      // TC-HALO-015 (AC6, amended). PRD-20396 rework, INT finding F1: the
      // duplicate-check search must include inactive contacts (HaloPSA
      // excludes them by default), and a match against an inactive contact
      // must still block creation, flagging it as inactive so the caller
      // knows to reactivate rather than create a second record.
      it("should treat an inactive contact's email as a duplicate too, and flag it inactive", async () => {
        mockContactsList.mockResolvedValue({
          record_count: 1,
          users: [
            {
              id: 125,
              name: "Former Employee",
              emailaddress: "prd20396-int-test@example.com",
              inactive: true,
            },
          ],
        });

        const result = await usersHandler.handleCall("halopsa_users_create", {
          name: "Former Employee",
          email: "prd20396-int-test@example.com",
          client_id: 12,
        });

        expect(mockContactsList).toHaveBeenCalledWith({
          search: "prd20396-int-test@example.com",
          inactive: true,
        });
        expect(mockContactsCreate).not.toHaveBeenCalled();
        const data = JSON.parse(result.content[0].text);
        expect(data.created).toBe(false);
        expect(data.existing_contact).toEqual({
          id: 125,
          email: "prd20396-int-test@example.com",
          inactive: true,
        });
        expect(data.reason).toContain("halopsa_users_update");
      });

      // TC-HALO-016 (AC11, new). PRD-20396 rework, INT finding F3: when
      // site_id is omitted, HaloPSA rejects the create (400 "A Site must be
      // selected") unless a site is supplied; default to the client's own
      // main_site_id instead of widening the schema to require it.
      it("should default site_id to the client's main site when omitted", async () => {
        mockClientsGet.mockResolvedValue({ id: 12, name: "Acme", main_site_id: 7 });

        const result = await usersHandler.handleCall("halopsa_users_create", {
          name: "New Contact",
          email: "newer@x.com",
          client_id: 12,
        });

        expect(result.isError).toBeUndefined();
        expect(mockClientsGet).toHaveBeenCalledWith(12);
        expect(mockContactsCreate).toHaveBeenCalledWith(
          expect.objectContaining({ client_id: 12, site_id: 7 })
        );
      });

      // Regression guard (dev-added, not an AC on its own): an explicit
      // site_id must bypass the client lookup entirely, not be overridden
      // by it.
      it("should use the caller-provided site_id as-is and skip the client lookup", async () => {
        const result = await usersHandler.handleCall("halopsa_users_create", {
          name: "New Contact",
          email: "explicit@x.com",
          client_id: 12,
          site_id: 99,
        });

        expect(result.isError).toBeUndefined();
        expect(mockClientsGet).not.toHaveBeenCalled();
        expect(mockContactsCreate).toHaveBeenCalledWith(
          expect.objectContaining({ site_id: 99 })
        );
      });
    });

    describe("halopsa_users_update", () => {
      // TC-HALO-008 (AC7)
      it("should send only the fields the caller provided", async () => {
        await usersHandler.handleCall("halopsa_users_update", {
          contact_id: 101,
          phonenumber: "222",
        });

        expect(mockContactsUpdate).toHaveBeenCalledWith(101, {
          name: undefined,
          emailaddress: undefined,
          phonenumber: "222",
          inactive: undefined,
        });
      });

      // TC-HALO-009 (AC7)
      it("should be a legal no-op when only contact_id is sent", async () => {
        const result = await usersHandler.handleCall("halopsa_users_update", {
          contact_id: 101,
        });

        expect(result.isError).toBeUndefined();
        expect(mockContactsUpdate).toHaveBeenCalledWith(101, {
          name: undefined,
          emailaddress: undefined,
          phonenumber: undefined,
          inactive: undefined,
        });
      });

      // TC-HALO-010 (AC8)
      it("should deactivate a contact via inactive true", async () => {
        await usersHandler.handleCall("halopsa_users_update", {
          contact_id: 101,
          inactive: true,
        });

        expect(mockContactsUpdate).toHaveBeenCalledWith(
          101,
          expect.objectContaining({ inactive: true })
        );
      });

      // TC-HALO-011 (AC8)
      it("should reactivate a contact via inactive false", async () => {
        await usersHandler.handleCall("halopsa_users_update", {
          contact_id: 101,
          inactive: false,
        });

        expect(mockContactsUpdate).toHaveBeenCalledWith(
          101,
          expect.objectContaining({ inactive: false })
        );
      });
    });

    describe("unknown tool", () => {
      it("should return error for unknown tool", async () => {
        const result = await usersHandler.handleCall("halopsa_users_unknown", {});

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("Unknown user tool");
      });
    });
  });
});

// TC-HALO-014 (AC10). The generic mechanism this relies on — AsyncLocalStorage
// request-scoped credentials plus a credentialKey()-keyed client cache in
// utils/client.ts — is unmodified by this ticket and already covered generically
// by src/__tests__/client.test.ts. What's specific to this ticket is that the
// *five new tools* route through getClient() like every other tool and never
// retain state across calls, so this test proves that property at the handler
// layer: two concurrent calls, differentiated only by which async context they
// run in, must never see each other's data. It uses a real AsyncLocalStorage
// (not the mocked module-level getClient's fixed single client) to genuinely
// exercise concurrent-context propagation through users.ts's real handleCall.
describe("multi-tenant isolation", () => {
  it("should never resolve another tenant's client or data (PRD-20396, OWASP API1 BOLA)", async () => {
    const isolationStore = new AsyncLocalStorage<string>();
    mockContactsList.mockImplementation(async () => {
      const tenant = isolationStore.getStore();
      return tenant === "tenant-a"
        ? {
            record_count: 1,
            users: [{ id: 1, name: "A-Contact", emailaddress: "a@tenant-a.example" }],
          }
        : {
            record_count: 1,
            users: [{ id: 2, name: "B-Contact", emailaddress: "b@tenant-b.example" }],
          };
    });

    // Run concurrently (not sequentially) so the test actually exercises
    // AsyncLocalStorage's isolation under interleaving, not just two separate
    // calls that happen not to race.
    const [resultA, resultB] = await Promise.all([
      isolationStore.run("tenant-a", () =>
        usersHandler.handleCall("halopsa_users_search", { query: "contact" })
      ),
      isolationStore.run("tenant-b", () =>
        usersHandler.handleCall("halopsa_users_search", { query: "contact" })
      ),
    ]);

    const dataA = JSON.parse(resultA.content[0].text);
    const dataB = JSON.parse(resultB.content[0].text);

    expect(dataA.users[0].emailaddress).toBe("a@tenant-a.example");
    expect(dataB.users[0].emailaddress).toBe("b@tenant-b.example");
    // Tenant A's result must never contain tenant B's data and vice versa.
    expect(JSON.stringify(dataA)).not.toContain("tenant-b");
    expect(JSON.stringify(dataB)).not.toContain("tenant-a");
  });
});
