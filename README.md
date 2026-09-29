# reme-auto-router — DeepSeek Harness 插件

为每个活跃 workspace 自动管理一个独立的 reme 进程：用户在 WebUI 切工作区时，agent 的 `reme_search` 工具自动连到对应工作区绑定的 reme 实例，无需手动启停或记端口。

## 安装

### 生产安装（推荐）

```sh
dsh plugin --profile web add github:R-LEI2536/dsh-reme-auto-router
```

DSH 从 GitHub 拉取 release 仓库，载入 `lib/index.js`。

**不要** 在用户目录或插件目录下手动执行 `npm install` / `pnpm install`：

- `lib/` 已入仓，运行时不需要 node_modules
- 本仓库 `package.json` 已删除 `prepare` 脚本，避免任何 npm 生命周期钩子（`preinstall` / `install` / `postinstall` / `prepare`）在用户侧自动执行
- 如需升级：在用户目录重新跑一次 `dsh plugin add ...` 命令即可

卸载：`dsh plugin --profile web remove dsh-reme-auto-router`

### 开发者安装

```sh
git clone git@github.com:R-LEI2536/dsh-reme-auto-router.git
cd dsh-reme-auto-router
pnpm install
pnpm run build
pnpm run verify
dsh plugin --profile web add "link:/absolute/path/to/dsh-reme-auto-router"
```

开发模式用 `cordis.yml`（绝对路径指向 `src/index.ts`），改 .ts 后 DSH 热重载生效。`cordis.patch.yml` 是发布版入口（被 `package.json#dsh.bundle.patch` 引用）。

### 手动调试

把 `cordis.yml` 路径加入 profile 的 bundle 层（旧 `~/.dsh/settings.yaml` 的 `dsh.bundle.layers` 写法在 DSH 0.1.7 已移除——profile 配置走 `<profile>/cordis.patch.yml`），或在 `cordis.yml` 上手动调整 `name:` 后让 dsh 加载。

## 设计要点

- **检测源**：active workspace 通过 `api-session/status`（running ⇄ idle）事件推断——任何 session 变 running 时其 `session.header.cwd` 即为 active workspace。
- **进程生命周期**：惰性启动（首次切到该 workspace 时 spawn）+ idle timer（默认 15 min 后停止）+ pin 保护（永不 idle stop）+ DSH 退出时按 `killOnExit` 决定是否清理。
- **路由协调**：通过官方 reme-memory 插件提供的 `remeMemory` 服务调用 `setEndpoint(url)`，让它的客户端 live 切到正确端口（DSH 0.1.7 起 replaced 旧的 `ctx.settings['reme-memory'].endpoint` 写入；不落盘、不覆盖用户配置）。官方侧已在 dsh-reme-support 0.2.2 实现 `remeMemory.setEndpoint`——路由需要 `dsh-reme-support ≥ 0.2.2` 挂载。
- **reme 数据落点**：spawn 时不传 `workspace_dir`，由 reme 用默认的相对路径 `.reme/` + 我们 plugin 设的进程 cwd 解析为 `<workspace>/.reme/`。workspace 根目录不被 `daily/`、`metadata/`、`session/` 等目录污染，**所有 reme 数据落在一个隐藏目录 `.reme/` 下**。每个 workspace 一个独立的 reme 进程，cwd 锁死在 spawn 时刻，所以 `.reme/` 路径天然隔离。
- **用户手动起的 reme**：探测端口 + 读 cmdline 区分所有权，标记为 adopted（只读不接管生命周期）。
- **用户感知**：plugin 内部模拟 user 敲一次 `/reme` slash command，把 reme 状态以「命令结果卡片」形式推到 WebUI 聊天流——`command/done` 是 log-only event，**model 永远看不到**卡片文字，user 看到。同一 cwd 同一状态的卡片自动去重，状态变化时才冒新卡。

## 配置（插件 Config，DSH 0.1.7 模型）

所有可编辑字段在插件 `Config` schema 上声明 `.volatile()`。DSH 0.1.7 起设置页由 settings 服务**根据 volatile 字段自动生成**，编辑后 live 生效并持久化到当前 profile 的 `cordis.patch.yml`（entry id `dsh-reme-auto-router` 的 `config` 层）——无需手编 yaml、无需重启。

字段（默认值）：

```yaml
killOnExit: true                      # DSH 退出时是否停止未 pin 的 managed reme
shutdownGraceMs: 3000                 # SIGTERM → SIGKILL 间隔（毫秒）
waitForIdleBeforeShutdown: false      # 退出前是否先轮询 reme /status 等任务清空
maxShutdownWaitMs: 8000               # waitForIdleBeforeShutdown 总预算（毫秒）
idleTimeoutMs: 900000                 # 未 pin 实例的空闲停止窗口（默认 15 分钟）
adoptManual: true                     # 是否探测并认领用户手动启动的 reme
ports: { base: 2333, range: 67 }      # 顺序分配的端口范围
pinnedDirs: []                        # cwd realpath 列表，pin 的永不 idle stop
```

部署方也可在组合配置（cordis.yml / bundle patch）里覆盖这些字段。

## 验证

```sh
pnpm run verify
```

跑全部 5 个测试（`import-check` / `detector-state` / `state-store-race` / `smoke-apply` / `endpoint-coordinator`）+ `tsc --noEmit`。

## 已知限制

- 不做主动健康检查——reme 自身错误由 `reme_search` 工具报错接住
- 多 tab 同时活跃不同 workspace 时取最近一次活跃为 active cwd
- model-visible system prompt 不写 reme 状态——模型对 reme 的认知完全靠 `reme_search` 的成败反馈
- 自动推送的去重粒度是「同一 cwd 同一渲染文本」；快速切换 workspace 时每个目标 cwd 各推一次（不会重复推同一 cwd）
- Windows 不支持（manual-adopter 用 `lsof` + `/proc/<pid>/cmdline`，macOS/Linux only）
- 没有 user-launched WebUI chip——chat 卡片是唯一的 user 感知通道
- 路由协调依赖官方 reme-memory 插件暴露 `remeMemory.setEndpoint`——dsh-reme-support ≥ 0.2.2 已提供；未挂载或旧版本时跳过路由写入并 warn 一次（`remeMemory service is unavailable`）
- **stale endpoint（定性，P2）**：实例 idle stop / 异常退出 / DSH 重启未 respawn 期间，最后一次 endpoint 保留指向已停端口，直到下次实例 `ready` 重新路由或 DSH 重启。窗口内 `reme_search` 报错（用户可见）、`auto_memory`/`auto_dream` `fetch failed`（数据不丢，下批重投成功）。与 0.1.5 时代行为一致，本期不改；撤销需契约扩展（`setEndpoint(undefined)` 或独立 clear），记录为后续项

详细设计见 [`docs/design.md`](docs/design.md)。