/**
 * Tickets domain handler
 *
 * Provides tools for ticket operations in HaloPSA.
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { CustomField } from "@wyre-ai/node-halopsa";
import type { DomainHandler, CallToolResult } from "../utils/types.js";
import { getClient } from "../utils/client.js";
import { readHaloAgentId } from "../utils/agent-id.js";
import { compactTicket, FULL_RESPONSE_SCHEMA } from "../utils/ticket-shape.js";
import { elicitSelection } from "../utils/elicitation.js";
import { buildTicketCard, TICKET_CARD_META } from "../card.builder.js";

/**
 * Cap on a single logged payload, in characters. `HALOPSA_TICKET_LOG_MAX=0`
 * removes the cap. The default keeps one call's trace readable: a Halo ticket
 * object carries ~300 fields and serialises to over 200 KB, which would bury
 * the request and error lines that the trace exists to show.
 */
const TICKET_LOG_MAX = (() => {
  const raw = process.env.HALOPSA_TICKET_LOG_MAX;
  if (raw === undefined) return 8000;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 8000;
})();

/**
 * Trace one payload of a ticket write to the console.
 *
 * stderr, never stdout: on the stdio transport stdout carries the MCP framing
 * itself, so a stray console.log corrupts the protocol -- the same reason
 * index.ts logs through console.error.
 */
function logTicket(label: string, value: unknown): void {
  let text: string;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    text = String(value);
  }
  if (TICKET_LOG_MAX > 0 && text.length > TICKET_LOG_MAX) {
    text = `${text.slice(0, TICKET_LOG_MAX)}… (truncated, ${text.length} chars total)`;
  }
  console.error(`[halopsa:tickets] ${label} ${text}`);
}

/**
 * Trace a failed ticket write, including the detail the SDK hangs off the
 * error (`statusCode`, parsed `errors`, and HaloPSA's own `response` body) —
 * for a 400 the message itself names neither the field nor the reason.
 */
function logTicketError(tool: string, error: unknown): void {
  const { statusCode, errors, response } = (
    typeof error === "object" && error !== null ? error : {}
  ) as { statusCode?: number; errors?: unknown; response?: unknown };

  const message = error instanceof Error ? error.message : String(error);
  console.error(
    `[halopsa:tickets] ${tool} FAILED${statusCode ? ` status=${statusCode}` : ""} ${message}`
  );
  if (errors !== undefined) logTicket(`${tool} error.errors`, errors);
  if (response !== undefined) logTicket(`${tool} error.response`, response);
}

/**
 * Apply the response shape the caller asked for: HaloPSA's reply verbatim when
 * `full_response` is set, otherwise with its expanded reference records
 * collapsed (see utils/ticket-shape).
 */
function shape(
  // The SDK's Ticket is a closed interface with no index signature; the ticket
  // is plain JSON either way, and the shaping is purely structural.
  ticket: object,
  args: Record<string, unknown>
): Record<string, unknown> {
  const record = ticket as Record<string, unknown>;
  return args.full_response === true ? record : compactTicket(record);
}

/**
 * Validate and normalise the custom_fields tool argument.
 *
 * A field is addressed by id or by name -- Halo accepts either, and an agent
 * that knows a field as "CFEscalated" should not have to look up that it is
 * id 291 first.
 *
 * The SDK's CustomField models a field as it comes back from a *read*, where
 * name and type are always populated. A write only needs the identifier and
 * the new value, and client.tickets.update spreads its data argument into the
 * Halo payload verbatim, so the narrower object built here is what actually
 * goes over the wire; the cast records that gap rather than inventing a name
 * and type we do not have.
 */
function parseCustomFields(raw: unknown): CustomField[] | undefined {
  if (raw === undefined) return undefined;

  if (!Array.isArray(raw)) {
    throw new Error(
      "custom_fields must be an array of { id or name, value } objects"
    );
  }

  return raw.map((entry, index) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error(
        `custom_fields[${index}] must be an object with an id or name and a value`
      );
    }

    const { id, name, value } = entry as {
      id?: unknown;
      name?: unknown;
      value?: unknown;
    };

    if (id === undefined && name === undefined) {
      throw new Error(
        `custom_fields[${index}] needs an id or a name to identify the field`
      );
    }
    if (value === undefined) {
      throw new Error(
        `custom_fields[${index}] needs a value (use null to clear the field)`
      );
    }

    // Omit the absent identifier rather than sending an explicit undefined.
    return {
      ...(id === undefined ? {} : { id }),
      ...(name === undefined ? {} : { name }),
      value,
    } as CustomField;
  });
}

/**
 * Read the category_1..category_4 arguments into the shape the SDK writes.
 *
 * Only the ones the caller actually passed are returned. An update that says
 * nothing about categories must leave the ticket's existing ones alone, and
 * naming a key with an undefined value is the kind of thing that survives one
 * serialiser and clears the field in the next.
 */
function readCategories(
  args: Record<string, unknown>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of ["category_1", "category_2", "category_3", "category_4"]) {
    const value = args[key];
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

/**
 * Schema for one of Halo's four ticket categorisation fields.
 *
 * Halo takes these as the category's full path string, not its id -- the same
 * `value` that halopsa_lookups_get returns for a categories row. Passing an id
 * here silently stores the digits as the category name.
 */
const CATEGORY_SCHEMA = (n: 1 | 2 | 3 | 4) => ({
  type: "string" as const,
  description:
    `Category ${n} as its full path string, e.g. "Hardware>Laptop". ` +
    `Resolve one with halopsa_lookups_get (kinds: ["categories"], category_type_id: ${n}) ` +
    `and pass that row's \`value\` verbatim; this is not an id field.`,
});

/**
 * Get ticket domain tools
 */
function getTools(): Tool[] {
  return [
    {
      name: "halopsa_tickets_list",
      description: "List tickets with optional filters by client, status, agent, open/closed state, or date occurred range",
      inputSchema: {
        type: "object" as const,
        properties: {
          client_id: {
            type: "number",
          },
          status_id: {
            type: "number",
          },
          halo_agent_id: {
            type: "number",
            description:
              "ID of an agent in HaloPSA, as returned by halopsa_agents_list. Not an agent ID from the calling platform.",
          },
          open_only: {
            type: "boolean",
          },
          closed_only: {
            type: "boolean",
          },
          dateoccurred_start: {
            type: "string",
            description: "ISO-8601 start date for tickets (e.g. 2026-04-06T00:00:00Z)",
          },
          dateoccurred_end: {
            type: "string",
            description: "ISO-8601 end date for tickets",
          },
          limit: {
            type: "number",
            description: "Maximum number of results (default: 50)",
          },
          page_no: {
            type: "number",
            description: "Page number (1-indexed) for pagination",
          },
        },
      },
    },
    {
      name: "halopsa_tickets_get",
      description: "Get ticket details by ID",
      _meta: TICKET_CARD_META,
      inputSchema: {
        type: "object" as const,
        properties: {
          ticket_id: {
            type: "number",
          },
          include_actions: {
            type: "boolean",
            description: "Include actions/notes",
          },
          full_response: FULL_RESPONSE_SCHEMA,
        },
        required: ["ticket_id"],
      },
    },
    {
      name: "halopsa_tickets_create",
      description: "Create ticket",
      inputSchema: {
        type: "object" as const,
        properties: {
          summary: {
            type: "string",
          },
          details: {
            type: "string",
          },
          client_id: {
            type: "number",
          },
          tickettype_id: {
            type: "number",
          },
          priority_id: {
            type: "number",
          },
          halo_agent_id: {
            type: "number",
            description:
              "ID of an agent in HaloPSA, as returned by halopsa_agents_list. Not an agent ID from the calling platform.",
          },
          site_id: {
            type: "number",
          },
          category_1: CATEGORY_SCHEMA(1),
          category_2: CATEGORY_SCHEMA(2),
          category_3: CATEGORY_SCHEMA(3),
          category_4: CATEGORY_SCHEMA(4),
          full_response: FULL_RESPONSE_SCHEMA,
        },
        required: ["summary", "client_id", "tickettype_id"],
      },
    },
    {
      name: "halopsa_tickets_update",
      description:
        "Update ticket, including reassigning it to a different agent or team",
      inputSchema: {
        type: "object" as const,
        properties: {
          ticket_id: {
            type: "number",
          },
          summary: {
            type: "string",
          },
          details: {
            type: "string",
          },
          status_id: {
            type: "number",
          },
          priority_id: {
            type: "number",
          },
          halo_agent_id: {
            type: "number",
            description:
              "Assigned agent, by HaloPSA agent ID. Resolve a name to an ID with halopsa_agents_list. Not an agent ID from the calling platform.",
          },
          team_id: {
            type: "number",
            description:
              "Assigned team, by ID. Resolve a name to an ID with halopsa_teams_list.",
          },
          category_1: CATEGORY_SCHEMA(1),
          category_2: CATEGORY_SCHEMA(2),
          category_3: CATEGORY_SCHEMA(3),
          category_4: CATEGORY_SCHEMA(4),
          custom_fields: {
            type: "array",
            description:
              "Custom fields to write. Address each field by id or by name; " +
              "match the value to the field type (checkbox takes a boolean).",
            items: {
              type: "object",
              properties: {
                id: {
                  type: "number",
                  description: "Custom field id, e.g. 291.",
                },
                name: {
                  type: "string",
                  description:
                    "Custom field name, e.g. CFEscalated. Use when the id is unknown.",
                },
                value: {
                  type: ["string", "number", "boolean", "null"],
                  description: "New value; null clears the field.",
                },
              },
              required: ["value"],
            },
          },
          full_response: FULL_RESPONSE_SCHEMA,
        },
        required: ["ticket_id"],
      },
    },
    {
      name: "halopsa_tickets_add_action",
      description: "Add note to ticket",
      _meta: TICKET_CARD_META,
      inputSchema: {
        type: "object" as const,
        properties: {
          ticket_id: {
            type: "number",
          },
          note: {
            type: "string",
          },
          outcome: {
            type: "string",
          },
          timetaken: {
            type: "number",
            description: "Minutes",
          },
          hidden_from_user: {
            type: "boolean",
          },
        },
        required: ["ticket_id", "note"],
      },
    },
  ];
}

/**
 * Handle a ticket domain tool call
 */
async function handleCall(
  toolName: string,
  args: Record<string, unknown>
): Promise<CallToolResult> {
  const client = await getClient();

  switch (toolName) {
    case "halopsa_tickets_list": {
      const limit = (args.limit as number) || 50;
      const pageNo = args.page_no as number | undefined;
      const dateStart = args.dateoccurred_start as string | undefined;
      const dateEnd = args.dateoccurred_end as string | undefined;
      let openOnly = args.open_only as boolean | undefined;
      const closedOnly = args.closed_only as boolean | undefined;

      const haloAgentId = readHaloAgentId(args);

      const hasFilters =
        args.client_id || args.status_id || args.halo_agent_id ||
        args.open_only !== undefined || args.closed_only !== undefined ||
        dateStart || dateEnd;

      if (!hasFilters) {
        const selection = await elicitSelection(
          "No filters provided. Would you like to narrow the ticket list?",
          "date_range",
          [
            { value: "open", label: "Open tickets only" },
            { value: "today", label: "Today's tickets" },
            { value: "past_week", label: "Past week" },
            { value: "past_month", label: "Past month" },
            { value: "all", label: "All tickets (no filter)" },
          ]
        );

        if (selection === "open") {
          openOnly = true;
        }
      }

      const response = await client.tickets.list({
        client_id: args.client_id as number | undefined,
        status_id: args.status_id as number | undefined,
        agent_id: haloAgentId,
        open_only: openOnly,
        closed_only: closedOnly,
        dateoccurred_start: dateStart,
        dateoccurred_end: dateEnd,
        pageSize: limit,
        pageNo: pageNo,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                record_count: response.record_count,
                tickets: response.tickets,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    case "halopsa_tickets_get": {
      const ticketId = args.ticket_id as number;
      const includeActions = args.include_actions as boolean | undefined;

      const ticket = await client.tickets.get(ticketId);

      let actions;
      if (includeActions) {
        const actionsResponse = await client.actions.list({
          ticket_id: ticketId,
        });
        actions = actionsResponse.actions;
      }

      const payload: Record<string, unknown> = includeActions
        ? { ...ticket, actions }
        : { ...ticket };

      // MCP Apps: attach the normalized card payload the ui:// ticket card
      // renders from. Best-effort — a null card just means no UI surface.
      const card = await buildTicketCard(payload, client);
      if (card) payload._card = card;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(shape(payload, args), null, 2),
          },
        ],
      };
    }

    case "halopsa_tickets_create": {
      logTicket("create args", args);
      try {
        const haloAgentId = readHaloAgentId(args);
        // Logged separately from args: this is what actually goes over the
        // wire, after the tool arguments are mapped and the absent ones drop
        // out as undefined.
        const payload = {
          summary: args.summary as string,
          details: args.details as string | undefined,
          client_id: args.client_id as number,
          tickettype_id: args.tickettype_id as number,
          priority_id: args.priority_id as number | undefined,
          agent_id: haloAgentId,
          site_id: args.site_id as number | undefined,
          ...readCategories(args),
        };
        logTicket("create payload", payload);

        const ticket = await client.tickets.create(payload);
        logTicket("create response", ticket);

        return {
          content: [
            { type: "text", text: JSON.stringify(shape(ticket, args), null, 2) },
          ],
        };
      } catch (error) {
        logTicketError("create", error);
        throw error;
      }
    }

    case "halopsa_tickets_update": {
      const ticketId = args.ticket_id as number;
      // Before parseCustomFields, so a rejected custom_fields argument is still
      // traced alongside the input that caused it.
      logTicket("update args", args);
      try {
        const haloAgentId = readHaloAgentId(args);
        const payload = {
          summary: args.summary as string | undefined,
          details: args.details as string | undefined,
          status_id: args.status_id as number | undefined,
          priority_id: args.priority_id as number | undefined,
          agent_id: haloAgentId,
          team_id: args.team_id as number | undefined,
          ...readCategories(args),
          customfields: parseCustomFields(args.custom_fields),
        };
        logTicket("update payload", { id: ticketId, ...payload });

        const ticket = await client.tickets.update(ticketId, payload);
        logTicket("update response", ticket);

        return {
          content: [
            { type: "text", text: JSON.stringify(shape(ticket, args), null, 2) },
          ],
        };
      } catch (error) {
        logTicketError("update", error);
        throw error;
      }
    }

    case "halopsa_tickets_add_action": {
      const ticketId = args.ticket_id as number;
      const action = await client.actions.create({
        ticket_id: ticketId,
        note: args.note as string,
        outcome: args.outcome as string | undefined,
        timetaken: args.timetaken as number | undefined,
        hiddenfromuser: args.hidden_from_user as boolean | undefined,
      });

      return {
        content: [{ type: "text", text: JSON.stringify(action, null, 2) }],
      };
    }

    default:
      return {
        content: [{ type: "text", text: `Unknown ticket tool: ${toolName}` }],
        isError: true,
      };
  }
}

export const ticketsHandler: DomainHandler = {
  getTools,
  handleCall,
};
