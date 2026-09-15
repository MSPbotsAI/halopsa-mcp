/**
 * Collapse the reference records HaloPSA expands inline on a ticket.
 *
 * A ticket comes back with its related records embedded whole, not as ids:
 * the ticket *type* definition alone is 254 fields and ~102 KB, and it is
 * byte-identical on every ticket of that type. Measured on one production
 * ticket, the reply was 195,837 characters over 6,135 lines, of which 85% was
 * that one field -- large enough that the calling agent platform stopped
 * passing the result through and offloaded it to a file.
 *
 * None of that describes the ticket. What a caller needs from an expanded
 * record is which one it is, and HaloPSA does not always provide that as a
 * scalar: there is no `tickettype_name` or `priority_name` on the ticket, so
 * dropping the objects outright would lose the only human-readable name. Each
 * is therefore reduced to `{ id, name }` rather than removed.
 */

/** Fields whose value is the ticket's own data, never an expanded reference. */
const PRESERVED = new Set(["_card"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * An expanded reference identifies itself: it carries an `id` and a display
 * `name`. Objects without a name -- HaloPSA's address blocks, which are six
 * short lines and carry no name -- are the ticket's own data and are left
 * alone; collapsing those would drop the address and save nothing.
 */
function isExpandedReference(value: unknown): value is Record<string, unknown> {
  if (!isPlainObject(value)) return false;
  return (
    value.id !== undefined &&
    typeof value.name === "string" &&
    value.name !== ""
  );
}

/**
 * Reduce a ticket's expanded reference records to `{ id, name }`.
 *
 * Every scalar is kept, and so is every array (`customfields`, `actions` and
 * the ticket's other own collections). Returns a new object; the input is not
 * modified.
 */
export function compactTicket(
  ticket: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(ticket)) {
    if (!PRESERVED.has(key) && isExpandedReference(value)) {
      out[key] = { id: value.id, name: value.name };
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** Shared schema entry for the opt-out, so the three ticket tools agree. */
export const FULL_RESPONSE_SCHEMA = {
  type: "boolean" as const,
  description:
    "Return the ticket exactly as HaloPSA sends it, with related records (ticket type, priority, user) expanded in full. Off by default: that reply runs to ~200 KB, almost all of it the ticket type definition, which is the same on every ticket of that type.",
};
