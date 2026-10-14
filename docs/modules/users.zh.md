# 模块：users（`src/domains/users.ts`）

累积事实，每张单交付后追加，不改写既有小节。

## PRD-20396 · 2026-10-13

- 新增 `halopsa_users_search` / `_get` / `_create` / `_update`（`src/domains/users.ts`；sha 为本单工作分支 HEAD，具体值见 `docs/tickets/PRD-20396.md` 的 Handoff 小节——截至本条记录尚未合入 `main`）。该域按 `halopsa_users_*` 工具命名约定暴露 HaloPSA 联系人（contact），但**已安装 SDK 的资源属性是 `client.contacts`，不是 `client.users`**（`src/utils/client.ts` 的 `getClient()` 返回的 `HaloPsaClient` 上字段是 `readonly contacts: ContactsResource`，已核实 `@wyre-ai/node-halopsa@1.1.0` 源码，tag `v1.1.0`，commit `b0622b1f7b789a28f543424b9c39fc8978254fda`，克隆自公开仓库 `github.com/WYRE-AI/node-halopsa`——见下方「依赖绕过」）。SDK 的 HTTP 路径是 `/Users`，列表响应键是 `users`，所以工具对外形状（`{record_count, users: [...]}`）和设计当时的假设一致；**只有客户端访问器名字不同**（是 `.contacts`，不是 `.users`）。未来任何涉及这个实体的域都应调用 `client.contacts.*`，不是 `client.users.*`（后者不存在，会抛 `Cannot read properties of undefined`）。
- SDK 的 `Contact` 类型里邮箱字段是 **`emailaddress`，不是 `email`**（`node-halopsa` 的 `src/types/contacts.ts`）。`users.ts` 保留了工具对外的属性名 `email`（与 `clients.ts` 的 `halopsa_clients_create` 保持一致，它也用 `email`），只在调用 `client.contacts.create`/`.update` 的边界处转换成 `emailaddress`；读取时原样透传 SDK 的原始响应（里面是 `emailaddress`）。
- **`ContactCreateData` 要求 `client_id: number`**（HaloPSA 的联系人总是某个 client/公司的子项）——设计阶段未能核实（设计文档技术设计 §11 已标注 SDK 实际形状待核实），结果比工单原话（「name + email」）多出一个必填项。`halopsa_users_create` 的 `inputSchema.required` 是 `["name", "email", "client_id"]`。
- **创建时的防重复**（AC6/AC7）：实现为 `client.contacts.list({search: email})`，然后在客户端对每一行的 `emailaddress` 与请求邮箱做精确、大小写不敏感的比较——不依赖 HaloPSA 自己的 `search` 语义是精确匹配（服务端的模糊匹配可能导致误报或漏报）。这是一次读后写、没有事务保证；按工单原话（「prevent duplicates」描述的是一次检查，不是加锁）照单全收，HaloPSA 自己对邮箱也没有唯一约束可以兜底。
- **局部更新机制**（AC7/AC8，`halopsa_users_update`）：原样复用 `tickets.ts` 既有的「把每个可选字段设成 `args.<field> as T | undefined`」模式。已核实（不是假设）这个机制对 Contacts 接口确实有效——读了 SDK 自己的 `src/http.ts:109`（`body: body ? JSON.stringify(body) : undefined`）：`JSON.stringify` 会丢弃值为 `undefined` 的键，所以调用方没传的字段永远不会发到 HaloPSA，让 `inactive` 一个字段就能同时承担激活/停用，不需要单独的工具。

### `mcp-server.ts` 里的第五个枚举点，本单设计阶段漏掉了

设计文档（技术设计、改动清单）数出了四处手工枚举域列表的地方：`utils/types.ts` 的 `DomainName` 联合类型、`domains/index.ts` 的 switch + `getAvailableDomains()` 数组，以及 `mcp-server.ts` 里的三处（本地 `Domain` 类型、`domainDescriptions`、`halopsa_navigate` 工具的内联描述字符串）。**实际还有第五处，而且是真正决定工具能不能用的那一处**：`createMcpServer()` 的 `CallToolRequestSchema` 处理器会把每个进来的 `tools/call` 请求依次匹配一串 `if (name.startsWith("halopsa_<domain>_"))`，匹配不到才落到「Unknown tool」。漏掉 `halopsa_users_` / `halopsa_sites_` 这两个分支，会导致新工具在 `tools/list` 里正常出现（所以 `getAvailableDomains()`/navigate 工具看起来都没问题），但实际调用全部返回 `Unknown tool: halopsa_users_search. Use halopsa_navigate to discover available tools by domain.`——而直接调用域处理器的单元测试（`usersHandler.handleCall(...)`）**抓不到**这个失败，因为它们完全绕过了 `mcp-server.ts`。本单是靠自测阶段一次端到端的 stdio 冒烟测试（`node dist/index.js` + 一条原始 `tools/call` JSON-RPC 请求）才抓到的，不是单元测试套件。**以后任何新增域都要在 `mcp-server.ts` 里 grep `name.startsWith("halopsa_`，找出全部五处，不能只数改动清单模板列出的那四处。**

### 依赖绕过（引用，非新增）

`@wyre-ai/node-halopsa` 托管在 GitHub Packages（`npm.pkg.github.com`），即使是这个公开源码的包，没有 `NODE_AUTH_TOKEN` 照样 401——完整绕过做法见 `docs/modules/tickets.md` 的 PRD-19482 条目（克隆公开源码仓库到匹配的版本 tag，本地 `npm install && npm run build`，临时把 `package.json` 的依赖指向 `file:<本地路径>` 来装一次种子、再把 `package.json`/`package-lock.json` 复原成 registry 版本号——复原不影响已装好的 `node_modules`）。本单 2026-10-13 在 tag `v1.1.0` 上重新验证过，仍然有效。

### 测试覆盖说明

`src/__tests__/domains/users.test.ts` 的「multi-tenant isolation」测试（AC10/TC-HALO-014）用一个直接的 `AsyncLocalStorage` 小工具替代了字面意义上的 `runWithCredentials()` + `credentialKey()` 缓存路径，为的是在一个整体 `vi.mock` 过的测试文件里不去真的调用 SDK/网络，保持确定性（曾经尝试用 `vi.doUnmock` + `vi.resetModules()` 去跑真实的 `utils/client.ts` + 真实 SDK 构造函数，但那个通过 `file:` 链接的外部化 SDK 包在测试中途 reset 模块之后没能可靠地吃到 `vi.doMock`，再深究下去不值得占用本单的时间）。这套通用的缓存/隔离机制本身不是本单改动的，本仓库自己的 `src/__tests__/client.test.ts` 已经覆盖过。

## PRD-20396 · 2026-10-14（返工，INT 发现 F1 + F3）

- **`halopsa_users_create` 的查重搜索现在带 `inactive: true`**（`src/domains/users.ts:157` 附近，本轮提交，工作分支 sha 见 `docs/tickets/PRD-20396.md`「返工轮次」交接条目）。不带这个参数时，HaloPSA 的 `/Users` 列表默认排除 inactive 联系人（`ContactListParams.inactive`，`@wyre-ai/node-halopsa@1.1.0` `src/types/contacts.ts:34-35`，已对照和上面「依赖绕过」同一份本地 SDK clone、tag `v1.1.0` 核实），所以对一个已停用联系人的邮箱做查重会静默返回 0 行，让第二个联系人被建出来——2026-10-14 由 Minnie Zhou 在 INT（租户 `mspbotstest`，联系人 125/126）发现，`[TEST · PRD-20396]`。**以后任何针对这个 SDK 的 list 接口做重复/唯一性校验，都要考虑是否需要把 `inactive` 类行也纳入**——本仓库的 `clients.ts`/`sites.ts` 目前都没有类似的查重逻辑，这是第一个先例。
- **命中为 inactive 时，`existing_contact` 现在带 `inactive: true`**，`reason` 指向用 `halopsa_users_update` 复活而不是新建。这是一次刻意的 AC6 修订（inactive 邮箱匹配现在也算重复，不再只有 active 才算）——Tom 在收到报告的当轮就批准了，没有再单独走一轮设计/groom 确认（见 `docs/tickets/PRD-20396.md` 的 AC6 说明）。
- **`halopsa_users_create` 省略 `site_id` 时现在默认取该 client 的 `main_site_id`**（`client.clients.get(client_id).main_site_id`，复用本仓库别处已经在用的 `clients.ts` 资源——没有引入新的 SDK 面）。根因：HaloPSA 的 `/Users` 端点要求必须有站点，不传时返回 400 `"A Site must be selected"`——同一轮在 INT 上发现。如果某个 client 根本没配 `main_site_id`，这里会落到 `undefined`，HaloPSA 仍会拒绝创建；这个剩余边界本轮没有进一步处理（超出本轮范围——工单原话「site_id, if known」本来就没预料到 HaloPSA 会把它变成强制项，一个连主站点都没有的 client 是比 INT 实测报告的场景更窄的边界）。
- **环境说明（重新确认，非新发现）**：GitHub Packages 401 的绕过做法（`docs/modules/tickets.md` 的 PRD-19482 条目）本轮原样复用——此前某次会话已经在 `/tmp/node-halopsa-build` 构建好了 `node-halopsa` tag `v1.1.0` 的本地 clone，本轮不需要重新 clone/构建，只需要做 `package.json` 依赖替换来跑 `npm install` 再复原。
