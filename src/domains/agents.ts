/**
 * Agents domain handler
 *
 * Provides tools for agent (technician/user) operations in HaloPSA.
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { DomainHandler, CallToolResult } from "../utils/types.js";
import { getClient } from "../utils/client.js";
import { readHaloAgentId } from "../utils/agent-id.js";
import { listResult } from "../utils/list-shape.js";

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
