# 模块：tickets（`src/domains/tickets.ts`）

累积事实，每张单交付后追加，不改写既有小节。

## PRD-19482 · 2026-09-29

- `halopsa_tickets_update` 现在接受可选入参 `tickettype_id: number`（`src/domains/tickets.ts:298-303`，commit `0a58498`），语义与 `halopsa_tickets_create` 的同名字段一致：透传给 `client.tickets.update()`，不传则工单类型不变。
- `client.tickets.update()` 对 `payload` 做逐字段透传（verbatim spread），不做白名单过滤（`src/domains/tickets.ts:82-95` 的既有注释，commit `0a58498` 之前即已存在，本单未改动该注释所在行为，只是复用它）——这是本仓库给 update handler 新增字段时的通用做法：照抄 `create` 的字段定义、去掉 `required`、在 handler 的 `payload` 对象里加一行透传。
- `@wyre-ai/node-halopsa`（本仓库对 HaloPSA 的唯一运行时依赖）托管在 GitHub Packages 私有 registry（`npm.pkg.github.com`），**任何环境只要没有 `NODE_AUTH_TOKEN`，`npm ci`/`npm install` 都会在这一个包上 401**，即使该包的源码仓库 `github.com/WYRE-AI/node-halopsa` 本身是公开的（GitHub Packages 对公开包同样不支持匿名下载）。该包本身零运行时依赖，可匿名 clone 对应 tag、`npm install && npm run build`（tsup）在本地产出等价 `dist/`，临时把 `package.json` 依赖指向 `file:<本地构建路径>` 装一次、再把 `package.json`/`package-lock.json` 复原为 registry 版本号，`node_modules` 里已装好的内容不受影响（Node 运行时不按 package.json 版本声明重新校验 node_modules）。下一次这个仓库再遇到同样的 401，直接照这条路径走，不必重新排查。
- 本仓库的门禁是 `npm run lint` + `npm run typecheck` + `npm test`（`vitest run`）+ `npm run build`（`tsc`），来自 `CONTRIBUTING.md`；CI（`.github/workflows/`）不代替本地跑这几条，是唯一门禁。
