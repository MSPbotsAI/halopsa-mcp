/**
 * Users domain handler
 *
 * Provides tools for contact (HaloPSA "User") operations: search, get,
 * create (with duplicate-prevention by email), and update (partial, with
 * activate/deactivate via `inactive`). PRD-20396.
 *
 * Note on naming: the installed SDK (`@wyre-ai/node-halopsa@1.1.0`) already
 * supports this entity, but exposes it as `client.contacts`, not
 * `client.users` — HaloPSA's own `/Users` endpoint models a contact, and the
 * SDK's resource class is named `ContactsResource` accordingly. This domain
 * keeps the ticket's requested tool names (`halopsa_users_*`, matching every
 * other domain's `halopsa_<domain>_<action>` convention) and calls
 * `client.contacts.*` underneath — a naming-only translation, not a design
 * change (see docs/tickets/PRD-20396.md, Tech design §11 risk note).
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { DomainHandler, CallToolResult } from "../utils/types.js";
import { getClient } from "../utils/client.js";
import { listResult } from "../utils/list-shape.js";

/**
 * Get user domain tools
 */
function getTools(): Tool[] {
  return [
    {
      name: "halopsa_users_search",
      description: "Search contacts by name or email",
      inputSchema: {
        type: "object" as const,
        properties: {
          query: {
            type: "string",
          },
          limit: {
            type: "number",
            description: "Maximum number of results (default: 50)",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "halopsa_users_get",
      description: "Get contact details by ID",
      inputSchema: {
        type: "object" as const,
        properties: {
          contact_id: {
            type: "number",
          },
        },
        required: ["contact_id"],
      },
    },
    {
      name: "halopsa_users_create",
      description:
        "Create a contact; refuses and reports the existing record if the email is already in use",
      inputSchema: {
        type: "object" as const,
        properties: {
          name: {
            type: "string",
          },
          email: {
            type: "string",
          },
          client_id: {
            type: "number",
            description:
              "HaloPSA client (company) this contact belongs to. Required by HaloPSA's Contact entity.",
          },
          site_id: {
            type: "number",
            description:
              "HaloPSA site this contact belongs to; defaults to the client's main site when omitted",
          },
          phonenumber: {
            type: "string",
          },
        },
        // client_id is required in addition to the ticket's stated name+email:
        // the SDK's ContactCreateData requires it (a HaloPSA contact is always
        // a child of a client), discovered once the SDK's actual types could be
        // read (PRD-20396 Tech design §11 flagged this as unverified at design
        // time). Does not change any AC — AC5 only says "the required fields".
        required: ["name", "email", "client_id"],
      },
    },
    {
      name: "halopsa_users_update",
      description:
        "Update only the fields provided; set inactive to deactivate or reactivate a contact",
      inputSchema: {
        type: "object" as const,
        properties: {
          contact_id: {
            type: "number",
          },
          name: {
            type: "string",
          },
          email: {
            type: "string",
          },
          phonenumber: {
            type: "string",
          },
          inactive: {
            type: "boolean",
            description: "true deactivates, false reactivates",
          },
        },
        required: ["contact_id"],
      },
    },
  ];
}

/**
 * Handle a user domain tool call
 */
async function handleCall(
  toolName: string,
  args: Record<string, unknown>
): Promise<CallToolResult> {
  const client = await getClient();

  switch (toolName) {
    case "halopsa_users_search": {
      const limit = (args.limit as number) || 50;
      const response = await client.contacts.list({
        search: args.query as string,
        pageSize: limit,
      });

      return listResult(response, "users");
    }

    case "halopsa_users_get": {
      const contactId = args.contact_id as number;
      const contact = await client.contacts.get(contactId);

      return {
        content: [{ type: "text", text: JSON.stringify(contact, null, 2) }],
      };
    }

    case "halopsa_users_create": {
      const email = args.email as string;
      const clientId = args.client_id as number;

      // Duplicate-prevention: look up by email before creating. HaloPSA's
      // /Users list excludes inactive contacts by default, so without
      // widening the search this silently misses a deactivated contact
      // with the same email and a duplicate gets created (PRD-20396
      // rework, INT finding F1, AC6 amended 2026-10-14).
      //
      // Round-2 rework fix (`inactive: true`, this SDK's typed
      // `ContactListParams.inactive`) looked right and passed its own unit
      // test, but round-3 INT retest (Minnie Zhou, 2026-10-14) found
      // HaloPSA's GET /Users silently ignores that parameter — the unit
      // test only asserted the object passed to `client.contacts.list`,
      // never the actual query string HaloPSA receives, so it could not
      // have caught this. HaloPSA instead documents `includeinactive` for
      // "also return inactive contacts" on this list endpoint; it is not
      // part of this SDK's typed `ContactListParams`
      // (@wyre-ai/node-halopsa@1.1.0 src/types/contacts.ts:28-37 only
      // declares `inactive`), so — same as this repo's own
      // `domains/lookups.ts` precedent for `showall`/`showinactive` on
      // other Halo entities whose include-inactive flag isn't in the
      // SDK's types either — it is sent as an untyped param via `as
      // never`. Deliberately *not* also sending `inactive: true`: that key
      // has no observed effect on this endpoint and keeping it around
      // would misleadingly suggest it does something.
      const duplicateCheckParams: Record<string, unknown> = {
        search: email,
        includeinactive: true,
      };
      const existingSearch = await client.contacts.list(
        duplicateCheckParams as never
      );
      const existing = (existingSearch.users ?? []).find(
        (row) =>
          typeof row.emailaddress === "string" &&
          row.emailaddress.toLowerCase() === email.toLowerCase()
      );

      if (existing) {
        const existingIsInactive = existing.inactive === true;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  created: false,
                  reason: existingIsInactive
                    ? "A contact with this email already exists but is inactive; use halopsa_users_update to reactivate it instead of creating a new one"
                    : "A contact with this email already exists",
                  existing_contact: {
                    id: existing.id,
                    email: existing.emailaddress,
                    ...(existingIsInactive ? { inactive: true } : {}),
                  },
                },
                null,
                2
              ),
            },
          ],
        };
      }

      // site_id is optional in this tool's schema, but HaloPSA's /Users
      // endpoint rejects a create with no site (400 "A Site must be
      // selected") — PRD-20396 rework, INT finding F3. When the caller
      // omits it, default to the client's own main site rather than
      // widening the schema to require it.
      let siteId = args.site_id as number | undefined;
      if (siteId === undefined) {
        const parentClient = await client.clients.get(clientId);
        siteId = parentClient.main_site_id;
      }

      const newContact = await client.contacts.create({
        name: args.name as string,
        client_id: clientId,
        emailaddress: email,
        site_id: siteId,
        phonenumber: args.phonenumber as string | undefined,
      });

      return {
        content: [
          { type: "text", text: JSON.stringify(newContact, null, 2) },
        ],
      };
    }

    case "halopsa_users_update": {
      const contactId = args.contact_id as number;
      const payload = {
        name: args.name as string | undefined,
        emailaddress: args.email as string | undefined,
        phonenumber: args.phonenumber as string | undefined,
        inactive: args.inactive as boolean | undefined,
      };

      const updated = await client.contacts.update(contactId, payload);

      return {
        content: [{ type: "text", text: JSON.stringify(updated, null, 2) }],
      };
    }

    default:
      return {
        content: [{ type: "text", text: `Unknown user tool: ${toolName}` }],
        isError: true,
      };
  }
}

export const usersHandler: DomainHandler = {
  getTools,
  handleCall,
};
