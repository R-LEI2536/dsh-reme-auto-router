# reme-memory group `isolate` 隔离服务 —— 已修复（dsh-reme-support `f13937d`）

- **仓库**：`dsh-reme-support`（官方 reme-memory 插件，`name = "reme-memory"`）
- **提出方**：`dsh-reme-auto-router` v0.3.1（DSH 0.1.7 适配版）
- **日期**：2026-09-30 提出；2026-09-30 由 dsh-reme-support 修复
- **状态**：✅ 已修复（对方 commit `f13937d fix: drop group isolate on remeMemory so external plugins resolve it`，`cordis.patch.yml` 已删除 `isolate: { remeMemory: true }`）
- **性质**：跨插件契约的**阻断 bug**（不是待办/增强）——`remeMemory.setEndpoint` 已实现，但服务被 group `isolate` 隔离，外部插件永远拿不到

---

## 1. 现象

宿主（web profile）同时挂载 `dsh-reme-auto-router` v0.3.1 与 dsh-reme-support 0.2.2 后，DSH 日志持续出现（出现于 2026-09-29 16:56，对方 `8beca4b`/`43fbdf2` 已合并之后）：

```
[W] reme-auto-router reme-auto-router: remeMemory service is unavailable; the official reme-memory plugin may not be mounted
```

- 这条 warn 是 auto-router v0.3.x 的**一次性降级告警**（`src/endpoint-coordinator.ts` 的 `warnedNoSink` 守卫），触发条件：`ctx.get('remeMemory')` 返回 `undefined`，或返回的对象没有 `setEndpoint` 函数。
- **已排除「对方没实现」**：`dsh-reme-support/dist/index.js:37` 有 `runtime.setEndpoint = (url) => …`，`dist/endpoint-override.js` 有 `setEndpointOverride`，实现符合 `reme-memory-setEndpoint-contract.md` 契约。

结论：**服务存在，但 auto-router 在它的作用域里解析不到**。

## 2. 根因

`dsh-reme-support/cordis.patch.yml` 把 reme 包进 `@deepseek-ai/cordis-plugin-group`，并对 `remeMemory` 声明了 **entry-local 隔离**：

```yaml
- insert:
    - id: reme-memory
      name: "@deepseek-ai/cordis-plugin-group"
      group: true
      isolate:
        remeMemory: true          # ← 根因
      config:
        - id: reme-memory-runtime
          name: "dsh-reme-support"
```

cordis 4.0.x 的服务注册/解析机制（`@deepseek-ai/cordis/src/reflect.ts`）：

- `ctx.provide(name, value)` 以 `ctx[isolate][name]` 解析出的 **symbol 为 key** 存入全局 store（`reflect.ts:286-292`）；
- `ctx.get(name)` 用同一符号链查 store（`reflect.ts:237-243`）；
- `isolate: true` 时（`cordis-plugin-loader/src/config/isolate.ts:81-82`），该名字的 symbol 变成 **entry-local** 的 `Symbol('remeMemory#<entry-id>')`；无 isolate 的调用方沿用 root 兜底的默认符号 `Symbol('remeMemory')`（`reflect.ts:286`）。

于是：

| 事件 | isolate symbol | 结果 |
| --- | --- | --- |
| reme-support 在 group 内 `provide('remeMemory', runtime)` | `Symbol('remeMemory#reme-memory')` | 实现只注册在**这个** key 下 |
| auto-router（group 外普通 entry）`ctx.get('remeMemory')` | `Symbol('remeMemory')`（默认） | store 里查不到 → `undefined` → warn |

**服务被 group `isolate` 隔离在 entry-local realm 内，group 外任何插件（包括官方 reme-memory 的另一消费者）都拿不到。**

## 3. 为什么 0.1.5 没这个问题

0.1.5 的跨插件路由通道是 settings namespace 写入（`ctx.settings['reme-memory'].endpoint`）。settings 服务是全局的，**不经过服务 symbol 隔离**，所以 group/isolate 对它零影响。DSH 0.1.7 移除 namespace 写入后改为 `remeMemory.setEndpoint()` **服务方法调用**，恰好撞上这个 isolate。

## 4. 修复建议

**方案 A（推荐，一行配置）**：在 `cordis.patch.yml` 中去掉 `isolate.remeMemory`：

```yaml
- insert:
    - id: reme-memory
      name: "@deepseek-ai/cordis-plugin-group"
      group: true
      config:
        - id: reme-memory-runtime
          name: "dsh-reme-support"
```

去掉后 `provide`/`get` 统一走默认符号 `Symbol('remeMemory')`，group 内外的消费者都能拿到。dsh-reme-support 内部依赖方（`ReMeStatusGateway`，`inject: ["remeMemory"]`，`src/index.ts:38`）在 group 内使用同一符号，**不受影响**。

**方案 B（共享 label）**：若 reme-support 有意保留隔离（例如防同名服务冲突），可将 `isolate: { remeMemory: true }` 改为共享命名 realm：`isolate: { remeMemory: 'reme' }`，并让契约消费者（auto-router）的 entry 也声明相同 label——但这需要跨仓对齐，且 auto-router 的 patch 需同样改动，比方案 A 复杂。

> 备注：cordis 的 `isolate` 设计意图是**多实例/命名冲突隔离**（每个 entry/group 持有独立实现 realm）。`remeMemory` 现在是跨插件契约服务（见 `reme-memory-setEndpoint-contract.md`），要求对外可见，不应 entry-local 隔离。

## 5. 验收标准（在 auto-router 侧可观测）

1. **告警消失**：宿主日志不再出现 `remeMemory service is unavailable`；
2. **路由日志出现**：auto-router 的 `routed <cwd> → http://127.0.0.1:<port>` info 日志正常打印（`src/endpoint-coordinator.ts`）；
3. **真实切换**：切换 workspace 后 `reme_search` / `auto_memory` / `auto_dream` 打到新 workspace 的 reme 端口；
4. **不影响 reme-support 内部**：状态页、`/reme-dream`、auto-memory/auto-dream 照常工作。

## 6. 相关文件

**dsh-reme-support 侧（需改动）：**

- `cordis.patch.yml` — group + `isolate.remeMemory`（根因所在）
- `src/index.ts:37` — `ctx.provide("remeMemory", runtime)`（实现正确，无需改）

**依赖的框架机制（只读参考）：**

- `@deepseek-ai/cordis/src/reflect.ts`（4.0.4）— `provide`/`get` 的 isolate 符号解析
- `@deepseek-ai/cordis-plugin-loader/src/config/isolate.ts`（1.0.5）— `isolate.remeMemory: true` 生成 entry-local symbol

**auto-router 侧（消费者契约，只读参考）：**

- `src/endpoint-coordinator.ts` — `RemeMemoryEndpointSink` 与降级 warn
- `docs/reme-memory-setEndpoint-contract.md` — 契约定义（已实现，本 bug 不在契约内容而是 patch 配置）

## 7. 相关历史

- `reme-memory-setEndpoint-contract.md` — 前一契约（`remeMemory.setEndpoint`）已在 dsh-reme-support 0.2.2 实现；本文档是它的**运行时可达性**补丁。