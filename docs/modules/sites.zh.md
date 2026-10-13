# 模块：sites（`src/domains/sites.ts`）

累积事实，每张单交付后追加，不改写既有小节。

## PRD-20396 · 2026-10-13

- 新增 `halopsa_sites_list`（`src/domains/sites.ts`；sha 为本单工作分支 HEAD，具体值见 `docs/tickets/PRD-20396.md` 的 Handoff 小节——截至本条记录尚未合入 `main`）。只做 list，范围按本单自己声明的 Minimal Viable Slice 收窄：没有 `halopsa_sites_create`/`_update`/`_delete`，尽管已安装 SDK 的 `SitesResource` 本身已经支持全套 CRUD（`@wyre-ai/node-halopsa@1.1.0` 的 `src/resources/sites.ts` 里 `get`/`create`/`update`/`delete` 都在）。未来哪张单想要这些，不需要新的 SDK 能力，只需要新增工具接线。
- 响应形状和设计阶段的假设完全一致：`client.sites.list(...)` 返回 `{record_count, sites: [...]}`，客户端访问器就是 `client.sites`（不像 `users` 域的 `client.contacts` 那个意外——见 `docs/modules/users.md` 的 PRD-20396 条目）。走的是共享的 `listResult()` 辅助函数（`src/utils/list-shape.ts`），这是本单自己的技术设计决定，不重复 `clients.ts` 那种遗留的直接读固定键模式。
- 可选的 `client_id` 过滤器是本单自己加的（工单原话没提），原样转发给 `client.sites.list({client_id, pageSize})`；**单元测试只证明了这个参数被正确转发，没有证明 HaloPSA 的 API 真的会按它收窄结果**——这一半是 `docs/tickets/PRD-20396.ac.json` 的 TC-HALO-013，记为「未执行」/手工，待有真实或沙箱 HaloPSA 租户后再验（本次开发会话里没有）。
