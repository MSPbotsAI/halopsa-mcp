/**
 * Helpers for reading HaloPSA list responses.
 *
 * Extracted from domains/agents.ts so every domain that calls a list endpoint
 * reads rows the same way. The lookup domain needs it for exactly the reason
 * the agents domain did: Halo's reference endpoints do not wrap their rows.
 */

import type { CallToolResult } from "./types.js";

/**
 * Normalise a Halo list response into a record count plus its rows.
 *
 * Halo is not consistent about how it wraps list endpoints. /Tickets and
 * /Client answer with `{ record_count, tickets | clients }`, which is the shape
 * the SDK's typings describe and the shape the callers used to assume.
 * /Team and /Agent do not: against a live tenant halopsa_teams_list returned
 * `{}` and halopsa_agents_list returned `{ record_count: 21 }` with no rows,
 * because reading a fixed key off the response found `undefined` and
 * JSON.stringify then dropped the key entirely. The tool reported success while
 * handing back nothing, which is the worst way for this to fail -- an agent
 * cannot resolve a team or technician name to an id, and has no clue why.
 *
 * The reference endpoints (/Status, /Priority, /TicketType, /Category) are in
 * the second camp: Halo's own OpenAPI document describes their 200 response as
 * bare "OK" with no schema at all, and the SDK returns whatever arrives without
 * normalising it, so the declared `{ record_count, statuses }` return type is a
 * guess rather than a promise.
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
export function unwrapList(
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
export function listResult(response: unknown, key: string): CallToolResult {
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
 * Keep only the listed fields of a row, dropping the ones Halo did not send.
 *
 * Reference rows are wide -- Halo's RequestType schema alone carries 445
 * properties -- and almost all of that is configuration an agent resolving a
 * name to an id has no use for. Passing the rows through untouched would spend
 * most of a context window on fields nobody reads, so each lookup declares the
 * handful it wants and everything else is dropped.
 *
 * Absent keys are skipped rather than emitted as null: which optional fields a
 * tenant populates varies, and a row of nulls reads as "Halo has no value here"
 * when it usually means "this build of Halo does not have this field".
 */
export function pickFields(
  row: unknown,
  fields: readonly string[]
): Record<string, unknown> {
  if (!row || typeof row !== "object") return { value: row };
  const source = row as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    if (source[field] !== undefined) out[field] = source[field];
  }
  return out;
}
