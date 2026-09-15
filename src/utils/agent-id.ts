/**
 * The HaloPSA agent id argument, and the guard against the id it gets confused
 * with.
 *
 * The parameter is deliberately not called `agent_id`. Callers embedding this
 * server usually have an "agent" of their own -- an AI agent, a platform user --
 * carrying an id from a different namespace, and a parameter named `agent_id`
 * invites passing that one. Observed in production: a caller sent
 * `agent_id: "5032310761632013429"`, a 19-digit platform id, where HaloPSA
 * wanted one of its own agents (this tenant numbers them 1-35). HaloPSA
 * answered with a 400 that named a byte offset:
 *
 *   {"[0].agent_id":["Could not convert string to integer: 5032310761632013429.
 *     Path '[0].agent_id', line 1, position 188."]}
 *
 * `halo_agent_id` names the namespace at the call site, where the mistake is
 * made.
 */

/** Tool-argument name for a HaloPSA agent id. */
export const HALO_AGENT_ID = "halo_agent_id";

/** Largest value HaloPSA accepts for an agent id (its columns are 32-bit). */
const INT32_MAX = 2147483647;

/**
 * Read `halo_agent_id` out of a tool call's arguments.
 *
 * Rejects a leftover `agent_id`, rather than ignoring it: an ignored argument
 * would make the call silently do nothing about the agent, which is harder to
 * notice than an error. Also rejects values HaloPSA cannot store, so the
 * caller is told which argument is wrong instead of receiving a 400 that only
 * quotes a byte offset.
 */
export function readHaloAgentId(
  args: Record<string, unknown>,
  { required = false }: { required?: boolean } = {}
): number | undefined {
  if (args.agent_id !== undefined && args[HALO_AGENT_ID] === undefined) {
    throw new Error(
      `agent_id is not a parameter of this tool — use ${HALO_AGENT_ID}, the ID of an agent in HaloPSA (resolve one with halopsa_agents_list). ` +
        `An agent ID from the calling platform will not match.`
    );
  }

  const raw = args[HALO_AGENT_ID];
  if (raw === undefined || raw === null) {
    if (required) {
      throw new Error(`${HALO_AGENT_ID} is required`);
    }
    return undefined;
  }

  // A JSON number or a string of digits both arrive here; the tool schema says
  // number, but nothing enforces that at runtime.
  const value = typeof raw === "string" ? Number(raw.trim()) : raw;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value <= 0 ||
    value > INT32_MAX
  ) {
    throw new Error(
      `${HALO_AGENT_ID} must be the ID of an agent in HaloPSA (a positive integer up to ${INT32_MAX}); got ${JSON.stringify(raw)}. ` +
        `Resolve an agent with halopsa_agents_list — an ID from the calling platform will not match.`
    );
  }
  return value;
}
