/**
 * Tests for collapsing HaloPSA's inline-expanded reference records.
 */

import { describe, it, expect } from "vitest";
import { compactTicket } from "../utils/ticket-shape.js";

describe("compactTicket", () => {
  // Regression: one production ticket replied with 195,837 characters over
  // 6,135 lines, 85% of it the ticket type definition, and the calling agent
  // platform offloaded the result to a file instead of passing it through.
  it("collapses an expanded reference to id and name", () => {
    const bulky = { id: 3, name: "Service Request" } as Record<string, unknown>;
    for (let i = 0; i < 250; i++) bulky[`field_${i}`] = "x".repeat(50);

    const out = compactTicket({ id: 50444, tickettype_id: 3, tickettype: bulky });

    expect(out.tickettype).toEqual({ id: 3, name: "Service Request" });
    expect(JSON.stringify(out).length).toBeLessThan(200);
  });

  it("keeps every scalar", () => {
    const out = compactTicket({
      id: 50444,
      summary: "Test Agent",
      team_id: 17,
      closed: false,
      risklevel: 0,
    });
    expect(out).toEqual({
      id: 50444,
      summary: "Test Agent",
      team_id: 17,
      closed: false,
      risklevel: 0,
    });
  });

  it("keeps arrays, which hold the ticket's own data", () => {
    const customfields = [{ id: 291, name: "CFEscalated", value: true }];
    const actions = [{ id: 1, note: "hello" }];
    const out = compactTicket({ id: 1, customfields, actions });
    expect(out.customfields).toEqual(customfields);
    expect(out.actions).toEqual(actions);
  });

  // HaloPSA's address blocks carry an id but no name, and are six short lines
  // of the ticket's own data -- collapsing them would drop the address.
  it("leaves an object that has no name alone", () => {
    const address = { id: 0, line1: "1 High St", postcode: "AB1 2CD" };
    const out = compactTicket({ id: 1, delivery_address: address });
    expect(out.delivery_address).toEqual(address);
  });

  it("preserves the _card payload the UI renders from", () => {
    const card = { id: 1, name: "card", summary: "Test Agent", notes: [] };
    const out = compactTicket({ id: 1, _card: card });
    expect(out._card).toEqual(card);
  });

  it("does not modify its input", () => {
    const tickettype = { id: 3, name: "Service Request", extra: "x" };
    const input = { id: 1, tickettype };
    compactTicket(input);
    expect(input.tickettype).toEqual({ id: 3, name: "Service Request", extra: "x" });
  });

  it("ignores null and leaves it in place", () => {
    const out = compactTicket({ id: 1, thing: null });
    expect(out.thing).toBeNull();
  });
});
