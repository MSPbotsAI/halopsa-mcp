/**
 * Lookups domain handler
 *
 * The reference tables an agent has to read before it can write a ticket:
 * statuses, priorities, ticket types and the four categorisation trees.
 *
 * halopsa_tickets_create requires a tickettype_id and halopsa_tickets_update
 * takes status_id and priority_id, but until this domain existed nothing in the
 * server could turn "Closed" or "Hardware > Laptop" into the id or the string
 * Halo wants. Callers hardcoded the numbers from whichever tenant they happened
 * to be looking at, which quietly breaks on the next tenant.
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { DomainHandler, CallToolResult } from "../utils/types.js";
import { getClient } from "../utils/client.js";
import { unwrapList, pickFields } from "../utils/list-shape.js";

/**
 * The reference tables this domain can read.
 */
const LOOKUP_KINDS = [
  "statuses",
  "priorities",
  "ticket_types",
  "categories",
] as const;

type LookupKind = (typeof LOOKUP_KINDS)[number];

/**
 * Default cap on rows returned per kind.
 *
 * Statuses and priorities are small on any tenant. Categories are not: they are
 * four independent trees of up to three levels each, and a mature tenant runs
 * to thousands of leaves. The cap keeps a default call bounded; narrow with
 * category_type_id or tickettype_id rather than raising it.
 */
const DEFAULT_LIMIT = 200;

/**
 * Fields kept per kind.
 *
 * Deliberately short. Halo's ticket-type rows carry 445 properties, nearly all
 * of it workflow configuration that has nothing to do with resolving a name to
 * an id, and returning them whole would cost more context than the answer is
 * worth. Set full_response to get the rows as Halo sent them.
 */
const FIELDS: Record<LookupKind, readonly string[]> = {
  // `type` groups Halo's statuses by what they attach to (tickets vs
  // opportunities vs projects); `tickettypes` lists the ticket types a status
  // is restricted to, which is why an id valid on one type rejects on another.
  statuses: [
    "id",
    "name",
    "shortname",
    "type",
    "sequence",
    "colour",
    "isopen",
    "isdefault",
    "ticket_count",
  ],
  // Halo models priorities as SLA policies, so a priority row carries the
  // response/fix targets and the SLA it belongs to alongside its name.
  priorities: [
    "id",
    "name",
    "priorityid",
    "slaid",
    "sla_id",
    "colour",
    "sortorder",
    "fixtime",
    "responsetime",
  ],
  // default_category_1..4 are included because they tell the caller what a
  // ticket of this type will be categorised as if it says nothing.
  ticket_types: [
    "id",
    "name",
    "use",
    "sequence",
    "group_id",
    "group_name",
    "inactive",
    "cancreate",
    "agentscanselect",
    "default_category_1",
    "default_category_2",
    "default_category_3",
    "default_category_4",
  ],
  // `value` is the field that matters: it is the full path string
  // ("Hardware>Laptop") that a ticket write expects, not the id.
  categories: [
    "id",
    "value",
    "category_name",
    "type_id",
    "sla_id",
    "priority_id",
    "category_group_id",
  ],
};

/**
 * Notes attached to a kind's result, for facts a bare row list does not carry.
 */
const NOTES: Partial<Record<LookupKind, string>> = {
  categories:
    "type_id selects which of Halo's four categorisation trees a row belongs to: 1 = Category 1, 2 = Category 2, 3 = Category 3, 4 = Category 4. Write a category onto a ticket with the row's `value` string (e.g. \"Hardware>Laptop\"), not its id, via the category_1..category_4 arguments of halopsa_tickets_create / halopsa_tickets_update.",
  statuses:
    "A status can be restricted to particular ticket types. Pass tickettype_id to see only the statuses that ticket type accepts.",
};

/**
 * Halo's reference endpoints take filters the SDK's ReferenceListParams type
 * does not name (type_id and tickettype_id among them). The SDK forwards every
 * property it is handed, converting camelCase to snake_case and leaving
 * already-snake keys alone, so the filters do reach Halo -- only the typing is
 * missing. This is the cast that says so.
 */
type ListParams = Record<string, unknown>;

interface LookupOptions {
  categoryTypeId?: number;
  ticketTypeId?: number;
  includeInactive?: boolean;
}

/**
 * Ask Halo for one reference table.
 */
async function fetchKind(
  client: Awaited<ReturnType<typeof getClient>>,
  kind: LookupKind,
  limit: number,
  opts: LookupOptions
): Promise<unknown> {
  const params: ListParams = { pageSize: limit };

  switch (kind) {
    case "statuses":
      if (opts.ticketTypeId !== undefined) params.tickettype_id = opts.ticketTypeId;
      // /Status has no inactive flag; showall is Halo's documented override for
      // the filtering it applies by default.
      if (opts.includeInactive) params.showall = true;
      return client.statuses.list(params as never);

    case "priorities":
      return client.priorities.list(params as never);

    case "ticket_types":
      if (opts.includeInactive) params.showinactive = true;
      return client.ticketTypes.list(params as never);

    case "categories":
      if (opts.categoryTypeId !== undefined) params.type_id = opts.categoryTypeId;
      if (opts.ticketTypeId !== undefined) params.tickettype_id = opts.ticketTypeId;
      return client.categories.list(params as never);
  }
}

/**
 * Read one reference table and reduce it to the shape the tool returns.
 *
 * Failures are caught per kind rather than thrown. Halo grants API scopes
 * separately per area, so one of these four can 403 while the rest answer
 * fine; failing the whole call for that would hide three working answers, and
 * the point of the tool is to report exactly which fields are readable.
 */
async function readKind(
  client: Awaited<ReturnType<typeof getClient>>,
  kind: LookupKind,
  limit: number,
  fullResponse: boolean,
  opts: LookupOptions
): Promise<Record<string, unknown>> {
  let response: unknown;
  try {
    response = await fetchKind(client, kind, limit, opts);
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const { record_count, rows, unrecognised } = unwrapList(response, kind);

  // Halo only honours page_size on endpoints that paginate, and the reference
  // endpoints do not, so the cap is applied here as well as asked for.
  const capped = rows.slice(0, limit);
  const result: Record<string, unknown> = {
    record_count,
    returned: capped.length,
    rows: fullResponse
      ? capped
      : capped.map((row) => pickFields(row, FIELDS[kind])),
  };

  if (capped.length < rows.length) {
    result.truncated = true;
  }
  if (unrecognised !== undefined) {
    result.unrecognised_response = unrecognised;
  }
  const note = NOTES[kind];
  if (note) {
    result.note = note;
  }

  return result;
}

/**
 * Get lookup domain tools
 */
function getTools(): Tool[] {
  return [
    {
      // Not halopsa_status: that name is already taken by the server's own
      // credential-status tool.
      name: "halopsa_lookups_get",
      description:
        "Read HaloPSA's reference tables — ticket statuses, priorities, ticket types and the four categorisation trees (Category 1-4) — so ids and category values come from the live tenant instead of being hardcoded. Returns every requested table in one call. Use it before halopsa_tickets_create or halopsa_tickets_update to resolve a name to the id or string those tools expect.",
      inputSchema: {
        type: "object" as const,
        properties: {
          kinds: {
            type: "array",
            description:
              "Which reference tables to read. Defaults to all four. Ask for only what you need — categories is by far the largest.",
            items: {
              type: "string",
              enum: [...LOOKUP_KINDS],
            },
          },
          category_type_id: {
            type: "number",
            description:
              "Restrict categories to one of Halo's four categorisation trees: 1 = Category 1, 2 = Category 2, 3 = Category 3, 4 = Category 4. Omit to read all four; every row carries its own type_id either way.",
            enum: [1, 2, 3, 4],
          },
          tickettype_id: {
            type: "number",
            description:
              "Restrict statuses and categories to those valid for this ticket type, as returned by the ticket_types kind. Strongly recommended before creating or updating a ticket: Halo rejects a status or category the ticket type does not allow.",
          },
          include_inactive: {
            type: "boolean",
            description:
              "Include inactive/hidden rows. Off by default, since an agent writing a ticket should only pick from what is currently selectable.",
          },
          limit: {
            type: "number",
            description: `Maximum rows per kind (default: ${DEFAULT_LIMIT}). Narrow with category_type_id or tickettype_id rather than raising this.`,
          },
          full_response: {
            type: "boolean",
            description:
              "Return rows exactly as HaloPSA sends them instead of the fields needed to identify a value. Off by default: a single ticket-type row carries 445 properties, almost all of it workflow configuration.",
          },
        },
      },
    },
  ];
}

/**
 * Handle a lookup domain tool call
 */
async function handleCall(
  toolName: string,
  args: Record<string, unknown>
): Promise<CallToolResult> {
  if (toolName !== "halopsa_lookups_get") {
    return {
      content: [{ type: "text", text: `Unknown lookup tool: ${toolName}` }],
      isError: true,
    };
  }

  const requested = Array.isArray(args.kinds)
    ? (args.kinds as unknown[]).filter((k): k is LookupKind =>
        LOOKUP_KINDS.includes(k as LookupKind)
      )
    : [];
  const kinds: LookupKind[] = requested.length ? requested : [...LOOKUP_KINDS];

  const limit = (args.limit as number) || DEFAULT_LIMIT;
  const fullResponse = args.full_response === true;
  const opts: LookupOptions = {
    categoryTypeId: args.category_type_id as number | undefined,
    ticketTypeId: args.tickettype_id as number | undefined,
    includeInactive: args.include_inactive as boolean | undefined,
  };

  const client = await getClient();

  // Sequential rather than parallel: the SDK shares one rate limiter per
  // client, and four reference reads are cheap enough that firing them at once
  // buys little beyond a burst against the tenant.
  const payload: Record<string, unknown> = {};
  for (const kind of kinds) {
    payload[kind] = await readKind(client, kind, limit, fullResponse, opts);
  }

  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
  };
}

export const lookupsHandler: DomainHandler = {
  getTools,
  handleCall,
};
