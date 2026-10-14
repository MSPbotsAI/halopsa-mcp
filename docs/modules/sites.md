# Module: sites (`src/domains/sites.ts`)

Accumulated facts, appended after each ticket ships. Do not rewrite existing sections.

## PRD-20396 · 2026-10-13

- `halopsa_sites_list` was added (`src/domains/sites.ts`; sha is this ticket's work-branch HEAD, see `docs/tickets/PRD-20396.md`'s Handoff section — not yet merged to `main` as of this entry). List-only, scoped by this ticket's own stated Minimal Viable Slice: no `halopsa_sites_create`/`_update`/`_delete`, even though the installed SDK's `SitesResource` already supports full CRUD (`get`/`create`/`update`/`delete` all exist in `@wyre-ai/node-halopsa@1.1.0`'s `src/resources/sites.ts`). A future ticket wanting those does not need a new SDK capability, only new tool wiring.
- Response shape matches the design's assumption exactly: `client.sites.list(...)` returns `{record_count, sites: [...]}`, and the client accessor is `client.sites` (unlike the `users` domain's `client.contacts` surprise — see `docs/modules/users.md`'s PRD-20396 entry). Routed through the shared `listResult()` helper (`src/utils/list-shape.ts`), per this ticket's own tech design decision to not repeat `clients.ts`'s legacy direct-key-read pattern.
- Optional `client_id` filter (this ticket's own addition, not requested by the ticket text) is forwarded as-is to `client.sites.list({client_id, pageSize})`; **only unit-tested that the parameter is forwarded correctly, not that HaloPSA's API actually narrows by it** — that half is `docs/tickets/PRD-20396.ac.json`'s TC-HALO-013, left `untested`/manual pending a live or sandbox HaloPSA tenant (none was available in this dev session).
