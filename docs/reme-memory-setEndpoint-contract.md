# reme-memory `setEndpoint` 契约 —— 已实现（dsh-reme-support 0.2.2）

- **仓库**：`dsh-reme-support`（官方 reme-memory 插件，`name = "reme-memory"`）
- **提出方**：`dsh-reme-auto-router` v0.3.0（DSH 0.1.7 适配版）
- **日期**：2026-09-29 提出；2026-09-29 由 dsh-reme-support 实现
- **状态**：✅ 已实现并核验（`8beca4b` + `43fbdf2`，归入 dsh-reme-support 0.2.2）
- **本文档作用**：契约定义 + 实现核对记录。dsh-reme-auto-router 侧以 `tests/endpoint-coordinator.mts` 锁定消费者行为。

---

## 1. 背景

`dsh-reme-auto-router` 为每个活跃 workspace 自动起/停一个独立 reme 进程，并把「当前活跃 workspace 的 reme 端口」实时告诉官方 reme-memory 插件，让它的 HTTP 客户端（`reme_search` / `auto_memory` / `auto_dream`）自动跟着 workspace 切换。

DSH 0.1.5 时代，这个通道是 **settings namespace 写入**：

- reme-memory 用 `ctx.settings.installSection(...)` 注册 `reme-memory` section，`setSource` 回调把有效配置喂给它的 `current()`；
- auto-router 直接写 `ctx.settings['reme-memory'].endpoint`。

**DSH 0.1.7 移除了这个机制**（`installSection` / `SettingsProvider` / `ctx.settings.get` 全部下线，J1-04）。每个插件只能读自己的 entry `Config`（volatile 字段），跨插件路由必须走 **cordis 服务方法**。

因此 auto-router v0.3.0 将契约改为：调用 reme-memory 插件提供的 `remeMemory` 服务上的 `setEndpoint(url)` 方法，live 切换端点，**不落盘、不写任何持久配置**。

## 2. 现状问题

宿主部署了 auto-router v0.3.0 + reme-memory（0.1.7 迁移版）后，DSH 日志出现：

```
[W] reme-auto-router reme-auto-router: remeMemory service is unavailable; the official reme-memory plugin may not be mounted
```

排查结论（`dsh-reme-support` main @ `832d320` 实测）：

- `src/index.ts:37` **有** `ctx.provide("remeMemory", runtime)`，服务名正确；
- 但 `ReMeRuntime`（`src/runtime.ts:33`）**没有 `setEndpoint` 方法**——公开方法只有 `start()`、`reconfigure()`、`runDream()`、`snapshot()`、`disposeAll()` 等；
- auto-router 侧判定 `typeof remeMemory.setEndpoint !== 'function'` 成立 → 触发一次性告警并**跳过路由**。

后果：`reme_search` / `auto_memory` / `auto_dream` 继续打 reme-memory 自己解析的 endpoint（默认 `http://127.0.0.1:2333` 或 `REME_URL` env），**不会自动切到 auto-router 按 workspace spawn 的端口**，多 workspace 自动路由实际断开。

## 3. 期望契约

在 `remeMemory` 服务上新增一个方法：

```ts
setEndpoint(url: string): void
```

语义要求：

1. **live 覆盖**：调用后，reme-memory 的 HTTP 客户端（`ReMeClient`）**后续所有请求**立即使用新 `url`，无需重启、无需用户手动改设置；
2. **不持久化**：只改内存态，不写 `<profile>/cordis.patch.yml`、不落 settings、不改用户的持久配置；DSH 重启后自然回到正常解析路径（env / 用户设置 / 默认值）；
3. **联动 runtime**：更新后应让 `ReMeRuntime` 的调度感知新端点（调用 `reconfigure()` 或等价机制重新评估 dream / auto-memory 调度，至少不要保留旧端点语义；`endpointSource` 若可标记为 `"auto"` 更佳，避免 `/reme-dream` 误报 "No ReMe is serving this workspace"）；
4. **幂等**：重复调用只覆盖端点，不叠加副作用；不抛异常（或在调用方可控的情况下失败）。

返回类型用 `void` 即可，无需异步。

## 4. 建议实现（dsh-reme-support 侧）

关键点：`ReMeClient` 与 `ReMeRuntime` 共享同一个 `current()` thunk（`src/index.ts:25-27`：`const current = () => resolveConfig(input)`；`new ReMeClient(current)`；`new ReMeRuntime(client, current, ...)`），且 `ReMeClient` 每个请求都调 `this.configSource()` 取最新 config（`src/reme/client.ts` 各方法）。所以 override 必须挂在**共享的 `current` thunk** 上，而不是 `ReMeRuntime` 私有字段。

最小实现示意（方向，可直接按仓库风格调整）：

```ts
// src/index.ts
let endpointOverride: string | undefined  // 内存态，不落盘

const current = () => {
  const base = resolveConfig(input)
  if (endpointOverride === undefined) return base
  return {
    ...base,
    endpoint: endpointOverride,
    endpointSource: "auto",   // 让状态页/错误提示反映「来自路由」
  }
}

const client = new ReMeClient(current)
const runtime = new ReMeRuntime(client, current, ctx.logger)

ctx.provide("remeMemory", {
  ...runtime,   // 保留既有公开方法，避免破坏 reme-support 自己的消费者
  setEndpoint(url: string): void {
    endpointOverride = url
    runtime.reconfigure()
  },
})
```

注意：

- **优先级语义**：`setEndpoint` 覆盖 > 用户设置页的 `endpoint` > `env.REME_URL` > 默认 `http://${REME_HOST}:${REME_PORT}`（`src/config.ts:131-139` 现有解析）。若 reme-support 希望「用户显式手动改设置后清掉 override」，可自行定义：比如手动编辑设置时重置 override——但这属于 reme-support 的产品决策，本文档只要求 `setEndpoint` 被调用后立刻生效。
- 不要改 `ReMeClient` 的请求路径，override 进 `current` 即可全链路生效。
- `reconfigure()` 目前只重排 dream 调度（`src/runtime.ts:196-211`），不会清 endpoint 缓存——所以 override 一旦设置会一直生效直到进程退出，符合「live 覆盖、不持久化」的语义。

## 4.1 实现核对（dsh-reme-support 0.2.2，2026-09-29）

对方在 `8beca4b` 落地、`43fbdf2` 记录契约解析。逐条对照 §3/§4：

| 契约要求 | 对方实现 | 结论 |
| --- | --- | --- |
| 服务名 `remeMemory`，方法 `setEndpoint(url): void` | `ctx.provide("remeMemory", runtime)`（`src/index.ts:37`）；`runtime.setEndpoint = (url) => ...`（`src/index.ts:45-49`） | ✅ |
| live 覆盖、后续所有请求立即生效 | override 走模块级 `endpoint-override.ts`（进程作用域）；`index.ts` 的 `current()` 按 `override > base` 合成，`ReMeClient` 与 `ReMeRuntime` 共用同一 thunk，下一次请求即生效 | ✅（实现位置与 §4 建议不同：模块级而非构造闭包，语义等价） |
| 不持久化 | 只写进程内变量，不碰 `cordis.patch.yml` / settings；DSH 重启自然复位 | ✅ |
| 优先级 override > 用户设置 > env > 默认 | `current()` 先 `resolveConfig(input)` 再叠 override，与 `endpoint-override.ts:11` 注释一致 | ✅ |
| 联动 runtime（`reconfigure()`） | `setEndpoint` 内调用 `runtime.reconfigure()` 重排 dream 调度 | ✅ |
| 非法 URL 不生效 | `normalizeEndpoint(url)` 先校验（抛 `TypeError` 不改 override），调方可控 | ✅ |
| `endpointSource` 标记 | override 生效时置 `endpointSource: "auto"`，状态页/`/reme-dream` 提示不再误报 | ✅（超出原要求，更佳） |

**遗留（双方共识，P2）**：实例 idle stop / 异常退出 / DSH 重启未 respawn 期间，最后一次 endpoint 保留指向死端口——这是 dsh-reme-support `docs/bugs/reme-auto-router-stale-endpoint.md` 记录的 router 侧缺口，由 auto-router 侧定性（见 auto-router `README.md` 已知限制），本期不改行为；撤销需契约扩展（如 `setEndpoint(undefined)` 或独立 clear），记作后续项。

## 5. 验收标准（在 auto-router 侧可观测）

1. **告警消失**：宿主日志不再出现 `remeMemory service is unavailable`；
2. **路由日志出现**：auto-router 的 `routed <cwd> → http://127.0.0.1:<port>` info 日志正常打印（`src/endpoint-coordinator.ts:133`）；
3. **真实切换**：切换 workspace 后，`reme_search` / `auto_memory` / `auto_dream` 打到新 workspace 的 reme 端口（而非固定 2333）；
4. **不落盘**：切换全程 `<profile>/cordis.patch.yml` 无新增 `reme-auto-router` 或 `reme-memory` 相关写入；
5. **重启回归**：DSH 重启后，未调用 `setEndpoint` 前，reme-memory 回到 env / 默认解析（`endpointSource: "default"`）。

## 6. 相关文件

**dsh-reme-support 侧：**

- `src/index.ts:25-37` — `current()` thunk、`ReMeClient` / `ReMeRuntime` 构造、`ctx.provide("remeMemory", runtime)`
- `src/runtime.ts:33-67, 190-211` — `ReMeRuntime`、`start()`、`reconfigure()`
- `src/config.ts:120-193` — `resolveConfig`：endpoint 解析（配置 > env > 默认）
- `src/reme/client.ts:23-27` — `ReMeClient.configSource`，每个请求实时读取

**auto-router 侧（消费者契约，只读参考）：**

- `src/endpoint-coordinator.ts:35-37, 122-141` — `RemeMemoryEndpointSink` 接口与调用/降级逻辑
- `docs/design.md` §4 决策、§10 数据流 — 路由通道决策记录（option A：服务方法，弃用 option B 持久化写入）

## 7. 相关历史

- `dsh-reme-support` `docs/bugs/reme-auto-router-stale-endpoint.md` — 0.1.5 时代同族问题的记录，其中 §"建议方案 A" 与本契约方向一致（服务化 + 只读 readiness），本次正是把它落到服务方法上。