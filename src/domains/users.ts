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
            description: "HaloPSA site this contact belongs to, if known",
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

      // Duplicate-prevention: look up by email before creating. Not a
      // transactional guarantee (read-then-write, no lock on HaloPSA's side
      // either) — see Tech design §9 (non-functional) for why that's accepted.
      const existingSearch = await client.contacts.list({ search: email });
      const existing = (existingSearch.users ?? []).find(
        (row) =>
          typeof row.emailaddress === "string" &&
          row.emailaddress.toLowerCase() === email.toLowerCase()
      );

      if (existing) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  created: false,
                  reason: "A contact with this email already exists",
                  existing_contact: {
                    id: existing.id,
                    email: existing.emailaddress,
                  },
                },
                null,
                2
              ),
            },
          ],
        };
      }

      const newContact = await client.contacts.create({
        name: args.name as string,
        client_id: args.client_id as number,
        emailaddress: email,
        site_id: args.site_id as number | undefined,
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
