/**
 * Agents domain handler
 *
 * Provides tools for agent (technician/user) operations in HaloPSA.
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { DomainHandler, CallToolResult } from "../utils/types.js";
import { getClient } from "../utils/client.js";
import { readHaloAgentId } from "../utils/agent-id.js";

/**
 * Normalise a Halo list response into a record count plus its rows.
 *
 * Halo is not consistent about how it wraps list endpoints. /Tickets and
 * /Client answer with `{ record_count, tickets | clients }`, which is the shape
 * the SDK's typings describe and the shape the callers below used to assume.
 * /Team and /Agent do not: against a live tenant halopsa_teams_list returned
 * `{}` and halopsa_agents_list returned `{ record_count: 21 }` with no rows,
 * because reading a fixed key off the response found `undefined` and
 * JSON.stringify then dropped the key entirely. The tool reported success while
 * handing back nothing, which is the worst way for this to fail -- an agent
 * cannot resolve a team or technician name to an id, and has no clue why.
 *
 * So take the rows from wherever they actually are: the named key, the response
 * itself when the endpoint answers with a bare array, or the sole array-valued
 * property when Halo names it something else. Only a single candidate is
 * accepted; guessing between several arrays would trade a visible failure for a
 * silent wrong answer.
 *
 * When no rows can be found the raw response is passed through rather than
 * discarded, so the caller sees what Halo actually sent instead of an empty
 * object. record_count prefers the value Halo reported and falls back to the
 * row count, which keeps "there are genuinely no rows" distinguishable from
 * "there are rows and we failed to locate them".
 */
function unwrapList(
  response: unknown,
  key: string
): { record_count: number; rows: unknown[]; unrecognised?: unknown } {
  if (Array.isArray(response)) {
    return { record_count: response.length, rows: response };
  }
  if (!response || typeof response !== "object") {
    return { record_count: 0, rows: [], unrecognised: response };
  }

  const obj = response as Record<string, unknown>;
  const reported = typeof obj.record_count === "number" ? obj.record_count : undefined;

  let rows = obj[key];
  if (!Array.isArray(rows)) {
    const arrays = Object.values(obj).filter(Array.isArray);
    rows = arrays.length === 1 ? arrays[0] : undefined;
  }

  if (!Array.isArray(rows)) {
    return { record_count: reported ?? 0, rows: [], unrecognised: response };
  }
  return { record_count: reported ?? rows.length, rows };
}

/**
 * Render an unwrapped list as the tool's text payload.
 */
function listResult(response: unknown, key: string): CallToolResult {
  const { record_count, rows, unrecognised } = unwrapList(response, key);
  const payload: Record<string, unknown> = { record_count, [key]: rows };
  if (unrecognised !== undefined) {
    payload.unrecognised_response = unrecognised;
  }
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
  };
}

/**
 * Get agent domain tools
 */
function getTools(): Tool[] {
  return [
    {
      name: "halopsa_agents_list",
      description: "List technicians",
      inputSchema: {
        type: "object" as const,
        properties: {
          team_id: {
            type: "number",
          },
          inactive: {
            type: "boolean",
            description: "Include inactive",
          },
          limit: {
            type: "number",
            description: "Maximum number of results (default: 50)",
          },
        },
      },
    },
    {
      name: "halopsa_agents_get",
      description: "Get technician details by HaloPSA agent ID",
      inputSchema: {
        type: "object" as const,
        properties: {
          halo_agent_id: {
            type: "number",
            description:
              "ID of an agent in HaloPSA, as returned by halopsa_agents_list. Not an agent ID from the calling platform.",
          },
        },
        required: ["halo_agent_id"],
      },
    },
    {
      name: "halopsa_teams_list",
      description: "List teams",
      inputSchema: {
        type: "object" as const,
        properties: {
          limit: {
            type: "number",
            description: "Maximum number of results (default: 50)",
          },
        },
      },
    },
  ];
}

/**
 * Handle an agent domain tool call
 */
async function handleCall(
  toolName: string,
  args: Record<string, unknown>
): Promise<CallToolResult> {
  const client = await getClient();

  switch (toolName) {
    case "halopsa_agents_list": {
      const limit = (args.limit as number) || 50;
      const response = await client.agents.list({
        team_id: args.team_id as number | undefined,
        inactive: args.inactive as boolean | undefined,
        pageSize: limit,
      });

      return listResult(response, "agents");
    }

    case "halopsa_agents_get": {
      const agentId = readHaloAgentId(args, { required: true }) as number;
      const agent = await client.agents.get(agentId);

      return {
        content: [{ type: "text", text: JSON.stringify(agent, null, 2) }],
      };
    }

    case "halopsa_teams_list": {
      const limit = (args.limit as number) || 50;
      const response = await client.teams.list({
        pageSize: limit,
      });

      return listResult(response, "teams");
    }

    default:
      return {
        content: [{ type: "text", text: `Unknown agent tool: ${toolName}` }],
        isError: true,
      };
  }
}

export const agentsHandler: DomainHandler = {
  getTools,
  handleCall,
};
