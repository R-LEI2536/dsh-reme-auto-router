# reme-auto-router — 设计与需求文档

> 写在前面：本文件不是规格说明书，是经过多轮批注收敛后的**设计记录**。代码真相以 `src/` 下的 .ts 源为准。本文件解决"为什么这样做"的问题，源文件解决"具体怎么做"。

---

## 1. 起源（用户的原话）

> 一个服务实例同一时间只能绑定一个工作目录。你可以通过 `workspace_dir` 参数灵活切换，也可以启动多个服务（用不同端口区分）来同时管理多个目录。这个操作对于用户来说还是太繁杂了，尤其是用户在几个工作区切来切去的。我们写插件解决一下。

**核心痛点**：用户频繁切换工作区时，每次都要 `reme start workspace_dir=X service.port=Y` 或 `reme start workspace_dir=X`（切换）。想要"切工作区 = 自动切换 reme"。

---

## 2. 一句话目标

**用户在 WebUI 切工作区 → agent 的 `reme_search` 自动连到新工作区绑定的 reme 实例**，无需手动启停或记端口。

---

## 3. 边界（明确不做什么）

| 不做 | 理由 |
|---|---|
| 自己实现 reme HTTP 客户端 | 官方 `@agentscope-ai/reme`（`dsh-reme-support`）已经实现，注册了 `reme_search` 工具 |
| 自己注册 `reme_search` 工具 | 同上 |
| 自己写状态页 UI | 官方 `ReMeStatusPage` 已经存在 |
| 主动健康检查（probe port） | reme 自己报错接住；状态行只反映"我们最后知道的事实"，不撒谎 |
| 在状态行暴露端口号给用户 | 用户不需要；模型端口透传走 settings.endpoint |
| 模型工具 `reme_pin` / workspace 行右键 Pin | 暂缓；v1 走插件 Config（设置页 / 组合配置） |
| 修改 `bash-local`、改官方 reme 插件源码 | 零侵入，跨版本升级不受影响 |

---

## 4. 关键决策（已对齐）

| # | 决策 | 落点 |
|---|---|---|
| 1 | 检测源：`api-session/status` running ⇄ idle 事件 | `WorkspaceDetector` 订阅 `ctx.on('api-session/status', ...)` |
| 2 | 进程生命周期：惰性启动 + idle 15min | `ProcessManager` + `ctx.timer.timeout` |
| 3 | 端口范围：2333..2400 顺序分配 | `StateStore.allocatePort(base, range)` |
| 4 | Pinned 永停、killOnExit 默认 true | 插件 `Config` 的 `pinnedDirs` + `killOnExit`（设置页 / 组合配置） |
| 5 | 用户手动实例：检测 + 认领不接管 | `ManualInstanceAdopter` 扫端口 + 读 cmdline |
| 6 | 状态行：3 状态、英文、`reme:` 前缀 | `StatusSection.text()` lazy 求值 |
| 7 | 健康检查：依赖 `reme_search` 自然失败 | 不做主动 probe |
| 8 | 配置模型：插件 Config schema + `.volatile()` 字段（DSH 0.1.7）；设置页由 settings 服务自动生成 | `Config` 导出 + `settings-schema.ts` |
| 9 | Shutdown：SIGTERM → grace → SIGKILL | `waitForIdleBeforeShutdown` 默认 false，可选 true |
| 10 | 不注册 Tool | `reme_search` 由官方提供 |

---

## 5. 用户旅程（落地形态）

### 5.1 用户旅程 1：第一次打开

> 用户装好插件，打开 DSH，WebUI 侧栏已经有几个 workspace（每个绑定一个项目目录）。他点了 project-a。

**用户体验**：零操作。插件默默启动一个 reme 进程绑到 project-a 的目录（默认端口 2333）。Agent 的 `reme_search` 自动连到 2333。

**系统提示里的状态行**：

```
reme: starting… (project-a)   ← 启动期间约 500ms
reme: ready (project-a)        ← 端口 bind 之后
```

### 5.2 用户旅程 2：来回切工作区

> 用户切到 project-b 写了一会，又切回 project-a。

**行为**：
- 切到 project-b → `api-session/status` 触发 → `WorkspaceDetector` 更新 active cwd → `ProcessManager.ensure('/path/b')` → spawn b 的 reme → 写 endpoint → 状态行变 `reme: ready (project-b)`
- 切回 project-a → 同上 → a 的 reme idle timer 被 touch 重置（不会被停止）
- b 的 idle timer 启动（默认 15 min 后会停止）

**关键**：
- 不"切走即停"——避免快速切回时冷启动几百毫秒体感差
- pinned 的永不停止
- 两套 reme 可同时存活（A 还在 idle 等待 + B 在跑）

### 5.3 用户旅程 3：用户自己起了 reme

> 用户老手，自己 `reme start workspace_dir=/X service.port=9999` 起来了。

**行为**：
- `ManualInstanceAdopter` 周期扫描端口 2333..2400
- 探测到 9999 端口的 reme 不带 `--reme-managed-by=reme-auto-router` 标记 → 标 `ownership: 'adopted'`
- 加入 `Map<cwd, RemeInstance>` 但**不挂 idle timer、shutdown 不杀**
- 如果用户 cwd 切到这个 X → active cwd 检测到 → 但我们优先用本插件自己起的实例（如有）；否则让用户手起的那个继续服务

**绝不杀用户手起的实例**——这是"安全停止"最关键的一条。

### 5.4 用户旅程 4：DSH 退出

> 用户关掉 WebUI / Ctrl+C。

**行为（`killOnExit: true` 默认）**：
- plugin Fiber dispose → `Shutdown.run()`
- 遍历 `Map<cwd, RemeInstance>`：
  - pinned 的 cwd → 跳过
  - `ownership: 'adopted'` → 跳过
  - 其它 `managed` → 走 SIGTERM → grace → SIGKILL
- 并发 `Promise.allSettled`，最坏情况等 `maxShutdownWaitMs + shutdownGraceMs`

**行为（`killOnExit: false`）**：
- 全部跳过，用户下次启动 DSH 时 StateStore + ManualAdopter 会扫描回这些进程

**崩溃退出（SIGKILL / OOM / 断电）**：
- 我们的清理代码不跑
- 下次启动 StateStore + ManualAdopter recover：
  - managed 还活着 → 认领回来
  - 不在了 → 清掉 state 条目，下次激活时冷启动

### 5.5 用户旅程 5：pin 一个工作区

> 用户在 WebUI 设置页（volatile Config 自动生成）把 cwd 加入 pinnedDirs，或部署方在
> 组合配置里写：
> ```yaml
> pinnedDirs:
>   - /Users/x/projects/never-stop-this
> ```

**行为**：
- `pinnedDirs` 里的 cwd 永远不被 idle stop
- DSH 退出时也不被 kill
- 用户切到这个 cwd 时启动 reme（首次激活触发 spawn），启动后永不停止
- 注意：**不预先启动**——pin 的语义是"保活不被停"，不是"预先加载"

### 5.6 失败场景

| 场景 | 行为 |
|---|---|
| 新 cwd 无 `.reme` 目录 | reme start 自动创建，正常 ready |
| reme start 失败（端口被占、Python 缺包） | spawn 进程快速 exit → `unavailable`，agent `reme_search` 报错由 reme 接住 |
| 用户删了 pinned 目录 | 下次启动 cwd realpath 失败 → log warn，pin 列表灰显 |
| 官方 reme 插件未装 | `ctx.settings.get('reme-memory')` undefined → EndpointCoordinator 跳过写入 |
| workspaceController 流断连 | AsyncIterable done() 后 `ctx.timer.timeout(..., 5000)` 重启监听 |
| 端口范围耗尽（> 67 个并发 reme） | fallback 随机高端口（30000..65000）log warn |

---

## 6. 架构

```
[User clicks workspace in WebUI]
        │
        ▼ (api-session/status running ⇄ idle)
[WorkspaceDetector]
        │
        ├── Map<activeCwd> 更新
        │
        ▼
[ProcessManager.ensure(cwd)]
        │
        ├── 已有 instance? ── 是 ── touch() 重置 idle timer
        │                       │
        │                       ▼
        │              [EndpointCoordinator.route(cwd)]
        │                       │
        └── 没有?        ──────┤
              │                │
              ▼                │
       spawn reme start       │
       workspace_dir=<cwd>    │
       service.port=<next>    │
              │                │
              ▼                ▼
       探测 port bind        ctx.settings.update('reme-memory', {endpoint})
              │                │
              ▼                ▼
       state='ready'     [官方 reme-memory 插件的 ReMeClient 重配]
              │                │
              ▼                ▼
       触发 state change  [Agent 调 reme_search → http://127.0.0.1:<port>]
       │
       ▼
   [StatusSection.text()] lazy 求值
       │
       ▼
   系统提示显示：`reme: ready (project-a)`
```

---

## 7. 文件结构

```
dsh-reme-auto-router/
├── cordis.yml                                       # 开发期绝对路径覆盖
├── cordis.patch.yml                                 # 发布版 bundle patch (走 package.json#dsh.bundle.patch)
├── package.json                                     # name + bundle.patch 入口
├── tsconfig.json                                    # extends ../tsconfig.base.json
├── README.md                                        # 用户使用文档
├── docs/
│   └── design.md                                    # 本文件
├── src/
│   ├── index.ts                                     # apply() 主入口
│   ├── settings-schema.ts                           # 插件 Config schema（volatile 字段）
│   ├── state-store.ts                               # ~/.dsh/plugin-data/reme-auto-router/state.json
│   ├── process-manager.ts                           # spawn / kill / idle timer
│   ├── workspace-detector.ts                        # api-session/status 订阅 + activeSessionId
│   ├── endpoint-coordinator.ts                      # 写 ctx.settings['reme-memory'].endpoint
│   ├── manual-adopter.ts                            # 端口扫描 + cmdline 解析
│   ├── shutdown.ts                                  # SIGTERM/grace/SIGKILL + waitForIdle
│   ├── slash-command.ts                             # /reme 注册 + handler
│   └── push-notifier.ts                             # commands.execute 推卡片 + dedup
└── tests/
    ├── import-check.mts                             # 18 个模块存在性 assertion
    ├── smoke-apply.mts                              # 4 个 plugin 行为 assertion
    └── memory-settings.ts                           # vendored settings 测试 helper
```

---

## 8. 配置模型（DSH 0.1.7：volatile Config）

插件 `Config` schema（`src/settings-schema.ts`）的全部字段标 `.volatile()`；DSH 0.1.7 的
settings 服务据此在 WebUI 自动生成设置表单，编辑 live 生效并持久化到当前
profile 的 `cordis.patch.yml`（entry `dsh-reme-auto-router` 的 `config` 层）。
`apply` 从 `config` 参数的 volatile 引用（`.get()`）装配配置快照，无需重启。

```yaml
# 有效配置快照（默认值；webui 设置页编辑后写 cordis.patch.yml）
killOnExit: true              # bool, 默认 true
shutdownGraceMs: 3000         # number, SIGTERM→SIGKILL 间隔
waitForIdleBeforeShutdown: false  # bool, 是否先等 reme idle
maxShutdownWaitMs: 8000       # number, waitForIdle 总上限
idleTimeoutMs: 900000         # number, 默认 15 分钟
adoptManual: true             # bool, 是否认领用户手起实例
ports:
  base: 2333                  # number
  range: 67                   # number (2333..2400)
pinnedDirs: []                # string[], cwd realpath
```

（0.1.5 的 `reme-auto-router` settings namespace 与 `settings.yaml` 一次性导入机制已随 DSH 0.1.7 移除。）

---

## 9. 用户感知通道（已修订，不再写 system prompt）

最初规划把状态行注册成 `ctx.systemPrompt.section`（design §9 早期版本），但模型不需要这条信息——它对 reme 的认知靠 `reme_search` 工具的成败反馈（reme_search 走 official `reme-memory` 插件，读我们写的 `reme-memory.endpoint`，endpoint 错就直接报错，模型自然知道不可用）。

改为**用户感知通道 = WebUI 聊天流里的命令结果卡片**：

- plugin 内部对 `ctx.commands.execute(agent, '/reme', [], signal)` 的 host-side 调用，模拟 user 敲了一次 `/reme`
- DSH 把 `command/run` + `command/done` 写到 session log，chat assembler 把 `command/done` 渲染成**命令结果卡片**
- `command/done` 是 log-only（per `SessionEventMap` JSDoc），**model 永远看不到卡片文字**
- 用户也可以自己在 composer 敲 `/reme`，handler 返回同样的文本（auto-push 和 manual 路径走同一个 `renderStatusLine`）

### 卡片文案（按事件类型）

| 状态 | ownership | 卡片文本 |
|---|---|---|
| `ready` | `managed` | `🔄 reme ready (project-a)\nport 2334` |
| `ready` | `adopted` | `👀 adopted reme ready (project-a)\nport 2334 · pid 316741` |
| `starting` | any | `🔄 reme starting… (project-a)` |
| `unavailable` | `managed` | `⚠ reme unavailable (project-a)\nport 2334 — port did not bind within 5s` |
| `unavailable` | `adopted` | `⚠ reme unavailable (project-a)\nport 2334 · pid 316741 — port did not bind within 5s` |

> 0.1.5 起普通 SubprocessHandle 不再暴露 `pid`，所以 managed 实例的卡片只显示端口；adopted 仍由 ManualAdopter 经 `lsof` 反查到 OS pid，显示完整 `port · pid`。

### 去重语义

`PushNotifier` 内部 `Map<cwd, lastText>`：同一 cwd 同一渲染文本不重复推。保证：
- idle timer touch（设计 §5.2）只重置 lastUsedAt、不触发 push
- 切 A→B→A 各推两次（A→B 时推 B 的 ready，B→A 时推 A 的 ready），不重复推同一 cwd 的同一文本

### 砍掉的候选（奥卡姆剃刀）

- ~~`pinned` 状态显示~~ → 配置项，不属于运行时状态
- ~~`idle` 状态显示~~ → 隐式状态，让它静默就行
- ~~中文版本~~ → 用户确认只保留英文
- ~~`Memory:` 前缀~~ → 改为 `reme:`
- ~~WebUI chip / 常驻 chip~~ → 跟 dsh-user-approval 的 chip 思路一致但 chat 卡片语义更符合用户需求；chip 是常驻 chrome，message 是流式气泡
- ~~system prompt 状态行~~ → 已经被替代（plugin 通过 `reme_search` 工具反馈自然告知模型；卡片推给 user）

**不做主动健康检查**——卡片反映"我们最后知道的事实"。reme 自己错误由 `reme_search` 报错接住。

---

## 10. 公共 API / 数据流变化

| 变化点 | 影响范围 | 兼容性 |
|---|---|---|
| 配置迁入插件 `Config`（volatile 字段） | WebUI 设置页自动生成表单；值写 `<profile>/cordis.patch.yml` | DSH 0.1.7 起；0.1.5 的 `settings.yaml` 不再读取 |
| 经 `remeMemory.setEndpoint(url)` 下发 endpoint | 官方 reme 插件客户端 live 重配 | live 不落盘；官方插件未暴露该方法时跳过 + warn 一次 |
| `~/.dsh/plugin-data/reme-auto-router/state.json` | 新文件 | 完全新增 |
| **不**注册 system prompt section | model-visible prompt 不变 | 不污染 model 上下文 |
| 注册 `commands.register({ name: 'reme', ... })` + `ctx.commands.execute(agent, '/reme', ...)` 推卡片 | 用户 chat 流出现「命令结果卡片」 | log-only 事件，model 看不到 |
| `~/.dsh/cordis.patch.yml` 新增 include | 加载 reme-auto-router bundle | 完全新增 |

---

## 11. 边界检查与失败模式（汇总）

| 场景 | 行为 |
|---|---|
| 新 cwd 无 `.reme` 目录 | reme start 自动创建 |
| reme start 失败 | state=`unavailable`，agent reme_search 报错由 reme 接住 |
| 用户快速来回切（A→B→A < 5s） | 都不 idle stop；timer 持续重置 |
| 多个 browser tab 切到不同 workspace | 取最近一次 active cwd；Map 里多个 cwd 各自有 reme |
| DSH 退出时 reme 正在写 | SIGTERM 给 reme 处理机会；graceMs 内未退则 SIGKILL |
| 用户删了 pinned 目录 | 下次启动 cwd realpath 失败 → log warn |
| 官方 reme 插件未装 | EndpointCoordinator 跳过写入 |
| workspaceController 流断连 | `ctx.timer.timeout(..., 5000)` 重启监听 |
| 端口范围耗尽（> 67 个并发 reme） | fallback 随机高端口 + log warn |
| 用户开两个 reme 同 cwd 不同端口 | 我们两个都登记；优先用 port 小的作为 active endpoint |

---

## 12. 已知限制

- **WebUI 设置页**：DSH 0.1.7 起由 settings 服务按 volatile Config 自动生成（v0.3.0 落地）
- **不做主动健康检查**：reme 自身错误由 `reme_search` 工具报错接住
- **多 tab 同时活跃不同 workspace**：取最近一次活跃为 active cwd
- **不预先启动 pinned**：pin 的语义是"保活"，不是"预加载"
- **pin 按 cwd，不按 workspace id**：reme 进程是物理事实，pin 落在物理层
- **没有 model-visible 状态行（用户决策）**：model 对 reme 的认知完全靠 `reme_search` 工具反馈；plugin 推送的卡片只给 user 看，不进 system prompt
- **推送去重粒度是 cwd+文本**：同一 cwd 同一渲染文本不重复推；快速切换 workspace 时每个目标 cwd 各推一次
- **没有 user-launched chip / 常驻 chip**：v1 没做 Client 插件，等以后
- **Windows 不支持**：manual-adopter 用 `lsof` + `/proc/<pid>/cmdline`（macOS/Linux）；Windows 路径未实现
- **切 workspace 期间 endpoint 数据错位**（v0.1.0 bug）：切 workspace 后到新 reme ready 之间（<500ms~5s），reme 调用仍打到老 reme。详见 §16.1

---

## 13. 决策回顾（按对话顺序）

| Round | 决策 | 来源 |
|---|---|---|
| 1 | 检测源：WebUI active workspace 变化（用户批注："这个是指用户在webui里面点击了别的工作区"） | 用户批注 |
| 2 | 三个 pin UI 选项暂缓（d/c）；预先启动不做 | 用户批注 |
| 3 | 状态行不带端口、用户能看懂、不做 `reme_workspace_status` 工具 | 用户批注 |
| 4 | Pin 要做、详细讨论；status 报错由 reme_search 接住 | 用户批注 |
| 5 | c/d 模型工具暂缓；不预先启动；端口路由 defer；状态砍到 3 个 | 用户批注 |
| 6 | killOnExit 设 UI 页加；端口路由我们不管；优先验证 reme CLI 端口发现；状态只英文、`reme:` 前缀 | 用户批注 |
| 7 | SIGTERM 方案 A + 可选 waitForIdle；工作目录名确认（scratch-plugin2，后改 reme-auto-router） | 用户批注 |

---

## 14. 实施状态

**v0.1.0 已发布**（GitHub `R-LEI2536/dsh-reme-auto-router` main 分支，commit `29e7963`，2026-09-06）。

每个 .ts 文件对应本设计的一个子系统：

**已完成（v0.1.0）**：
- settings-schema.ts — 插件 Config schema（volatile 字段）
- state-store.ts — atomic JSON write + port 分配
- process-manager.ts — spawn / idle / kill / 三态切换；**v0.1.0 起 spawn argv 不传 `workspace_dir=`，由 reme 默认值 `.reme/` + plugin 设的 cwd 解析到 `<workspace>/.reme/`**
- endpoint-coordinator.ts — 写 `reme-memory.endpoint`
- workspace-detector.ts — 订阅 `api-session/status` + realpath cwd
- manual-adopter.ts — 端口扫描 + cmdline 解析
- shutdown.ts — SIGTERM/grace/SIGKILL + waitForIdle + pin
- slash-command.ts — `/reme` 注册 + handler 渲染
- push-notifier.ts — host-side `commands.execute` 推卡片 + 去重
- index.ts — apply() 主入口
- tests/ — import-check + smoke-apply
- cordis-augment.d.ts — cordis Context/Events ambient augmentation（独立 package 装出来的 cordis 类型已知在 monorepo 内 augment，本地 vendoring）
- tsconfig.build.json — 独立 build 配置，emit 到 `lib/`
- README.md — 用户使用文档 + 「reme 数据落点」段落

**v0.1.0 已知问题**（详见 §16）：
- 切 workspace 期间 endpoint 数据错位（§16.1，P0 优先）

**已废弃**（不再使用，源文件已删除）：
- status-section.ts — systemPrompt 注册路径已删除；用户感知改走 slash-command + push-notifier 的卡片通道

---

## 15. 验证项（plan-mode 已确认）

- `workspaceController.follow()` 返回 `WorkspaceFollowFrame = {type:'baseline', value} | WorkspaceFollowIncrement`，但 `upsert` 不代表"切换"，仅代表 workspace 状态变化
- `workspaceRegistry.resolveByPath(path)` 返回 `Workspace` 对象（带 `path` / `title` / `sessionIds`）
- `ctx.settings.installSection(ctx, ns, schema, entry, hooks)` 是公开 API，可直接调用
- `SubprocessHandle` 暴露 `done` / `terminate()` / `waitForExit(signal?)` / stdio streams / collected；**0.1.5 起 `pid` 已从普通 SubprocessHandle 移除**（仅 `SubprocessTerminalHandle` 仍保留）。managed 实例不再记录 OS pid，文案退化为 "port N"；adopted 仍由 ManualAdopter 经 lsof 拿到 pid
- `ctx.systemPrompt.section({name, order, text})` 接受 `text: string | ((ctx) => string)`，lazy 求值免费
- `api-session/status(sessionId, running: boolean)` 是 active session 切换的真信号

---

## 16. v0.2 backlog（按优先级）

### 16.0 v0.2.0 changelog

`v0.2.0` 关闭 §16.1（修复 P0）+ §16.3（升版本号 + `private:false`）：

- **依赖区间升至 `^0.1.5-rc.1`**：原 `0.1.2-rc.1` 精确钉在 node-semver 下无法解析到 `0.1.5-rc.1`，导致本地 typecheck / test 都还跑在 0.1.2 上。详见 ADR-0001 与 `deepseek-harness/DSH-0.1.5-UPGRADE-AUDIT.md` §3.2、§四
- **managed 实例的 pid 字段退役**：DSH 0.1.5 普通 `SubprocessHandle` 不再暴露 `pid`；`RemeInstance.pid` / `InstanceRecord.pid` / `StatusSnapshot.pid` 改可选；`terminateTree` 去掉 `pid === -1` 哨兵；卡片文案对 managed 实例退化为 `port N`，adopted 仍显示 `port N · pid M`（adopter 路径不变）
- **`private: false` + `version: 0.2.0`**：允许走 GitHub release tarball 分发；npm 发布仍待 §16.3 后续决定

未做：§16.2 WebUI 设置页、§16.3 GitHub Actions、§16.4..§16.7 backlog 全部留到下个版本。

### 16.1 [P0] 切 workspace 期间 endpoint 数据错位 bug

**症状**：用户切 workspace 后到新 reme ready 之间（实测 <500ms，最坏 5s），`ctx.settings['reme-memory'].endpoint` 仍指**老 workspace** 的 reme。任何 reme 调用（`reme_search`、autoMemory cron、autoDream、health_check 等）在这窗口内打到**老** reme，导致：

1. `autoMemory` 后台写 daily → 老 workspace 的 daily 被污染（最隐蔽，用户无感）
3. Agent `reme_search` → 返回老 workspace 的记忆 → 答案错（用户可能误信）
4. WebUI status 卡片 → "starting (新 workspace)" + 老 endpoint URL，状态自相矛盾
5. 用户主动点"立即整理" → 整理错 workspace

**根因**：`src/index.ts:111` 在 `detector.onActiveCwdChanged` 里无条件调 `coordinator.route(cwd)`；`endpoint-coordinator.ts:114` 的 `runRoute` 在 instance 不是 `ready` 时直接 return，**不在更新 endpoint**——保留上一个 ready 实例的 endpoint。等 `manager.onStateChange` 在新 reme ready 时才 fire → `coordinator.route(activeCwd)` → endpoint 才切换。窗口期 = spawn + probe_ready 总时间。

**修法**（**修法二 / 延后 detector 发布 active cwd**，v0.2.0 已实现）：

`workspace-detector.ts` 增加 `preparing` 状态：
- `onStatus(running=true)` 收到时，把 (sessionId, cwd) 标记为 `preparing`，**不** publish 到 active cwd
- `process-manager` 的 `onStateChange` 在新 reme ready 时通知 detector → detector 把对应 preparing 项 promote 为 active
- detector 在 promote 之前**不**调 coordinator.route、**不**调 pushNotifier
- 用户 user 视角：点 workspace → "切换中..."卡片 → 几百ms~5s 后 ready 卡片出现

**v0.2.0 实现细节**（与计划一致）：

- `WorkspaceDetector` 新增 `manager` 依赖（构造时传入），订阅 `manager.onStateChange`，在 `status='ready'` 时 `tryPromote(cwd)`；promote 后才发 `onActiveCwdChanged` 事件
- 新增 `onPreparingCwdChanged` 事件，载荷 `{ cwd, sessionId }`，仅在 preparing 集合变化时发
- `activeCwd()` / `activeSessionId()` 现在返回 sessions 中**最近一个 mode='active'** 的——prepare 窗口期返回 OLD cwd，所以 coordinator 不会写 endpoint
- 新增 `preparingCwd()` / `preparingSessionId()` 镜像 API
- `index.ts` listener 拆两条：`onPreparingCwdChanged` 触发 `manager.ensure` + 推 "starting…" 卡（沿用 `renderStatusLine` 'starting' 分支）；`onActiveCwdChanged` 写 endpoint + 推 ready 卡；保留 `manager.onStateChange` 兜底 unavailable 状态
- `endpoint-coordinator.ts` / `process-manager.ts` / `push-notifier.ts` / `settings-schema.ts`：**零改动**
- 新增 `tests/detector-state.mts`（24 个 check 全过）：6 个用例覆盖 onStatus→preparing、promote、并发 preparing、ready 竞速、session 移除、重复 status no-op

**取舍**：切 workspace 期间 UX 短暂延迟（"切换中..."），但**数据正确性**——窗口期内 reme 调用仍走老 reme，**老 reme 是 ready 的、数据正确**。比 v0.1.0 的"数据错位"是质的改进。

### 16.2 [已由 DSH 0.1.7 免费关闭] WebUI 设置页

v1 只支持 `~/.dsh/settings.yaml` 手编。DSH 0.1.7 起 settings 服务根据插件
`Config` schema 的 `.volatile()` 字段**自动生成设置页**（无需 client 插件），
编辑 live 生效并写入 profile 的 `cordis.patch.yml`。本插件已随 v0.3.0 迁移到该模型。
（旧的 `settings.section` / `settings.plugin.item` client 席位方案不再需要。）

### 16.3 [P2] publish 链路 + GitHub Actions

- `package.json#private` 改 `false`、版本号升 0.2.0
- 是否发 npm（待定，看用户决定分发渠道）
- GitHub Actions：`pnpm run verify` 在 PR 上跑 + main push 时打 release tarball

### 16.4 [P3] 上游议题：reme 的 `workspace_dir` 设计

当前 reme 的 `schema/application_config.py:31` 把 `workspace_dir` 默认值硬编码为字面字符串 `".reme"`，且子目录 (`daily_dir`/`metadata_dir` 等) 也是裸字符串相对路径。这种设计依赖 reme 进程的 CWD，**不在 schema 里暴露绝对路径**导致外部 caller 无法优雅控制数据位置。

建议上游：
- `workspace_dir` 默认值改成可读 `$DSH_HOME/plugin-data/reme/<workspace-hash>/` 或类似
- 子目录保持相对 `workspace_dir` 解析（合理）

不动 plugin 代码，影响 plugin 上下游设计讨论。

### 16.5 [P3] README 增补手编示例 + 故障排查

- 加一段"配置字段完整释义"（v0.3.0 已由 README「配置（插件 Config）」节覆盖）
- 故障排查节："切 workspace 后立刻点立即整理 → 数据错位"（指向 §16.1）
- "reme 数据落 `<workspace>/.reme/`" + "`logs/` 是 reme 硬编码不在 `.reme/`"（指向 §11）

### 16.6 [P3] `logs/` 目录污染

reme 的 `utils/logger_utils.py:92` 把 `log_dir` 硬编码为 `"logs"`（不在 schema），`os.makedirs(log_dir)` 解析到 `<cwd>/logs/` 而非 `<workspace>/.reme/logs/`。`/logs/` 已 gitignore，**无实际危害**。上游修法依赖 §16.4。

### 16.7 [P4] defense-in-depth：port probe 在 ensure() 入口

运行期 reme 真死但 `handle.done` Promise 不触发（dsh-subprocess regression 防御）：
- `ensure(cwd)` 入口检查 port probe (TCP `127.0.0.1:port`)；**0.1.5 起 managed 实例不再有 OS pid**，pid liveness 检查退化为仅 adopted（adopter 路径有 pid 时用 `process.kill(pid, 0)`）
- 任一不通 → 丢弃 stale instance → 重新 spawn

非紧急，**不进 v0.2**。
