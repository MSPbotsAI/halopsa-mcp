/**
 * Sites domain handler
 *
 * Provides a tool to list sites in HaloPSA. Sites are children of Clients
 * (companies); this domain only exposes listing, per the ticket's Minimal
 * Viable Slice (no site create/update/delete — PRD-20396).
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { DomainHandler, CallToolResult } from "../utils/types.js";
import { getClient } from "../utils/client.js";
import { listResult } from "../utils/list-shape.js";

/**
 * Get site domain tools
 */
function getTools(): Tool[] {
  return [
    {
      name: "halopsa_sites_list",
      description: "List sites",
      inputSchema: {
        type: "object" as const,
        properties: {
          client_id: {
            type: "number",
            description: "Scope to one client's sites",
          },
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
 * Handle a site domain tool call
 */
async function handleCall(
  toolName: string,
  args: Record<string, unknown>
): Promise<CallToolResult> {
  const client = await getClient();

  switch (toolName) {
    case "halopsa_sites_list": {
      const limit = (args.limit as number) || 50;
      const response = await client.sites.list({
        client_id: args.client_id as number | undefined,
        pageSize: limit,
      });

      return listResult(response, "sites");
    }

    default:
      return {
        content: [{ type: "text", text: `Unknown site tool: ${toolName}` }],
        isError: true,
      };
  }
}

export const sitesHandler: DomainHandler = {
  getTools,
  handleCall,
};
