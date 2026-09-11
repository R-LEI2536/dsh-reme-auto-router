# reme-auto-router — DeepSeek Harness 插件

为每个活跃 workspace 自动管理一个独立的 reme 进程：用户在 WebUI 切工作区时，agent 的 `reme_search` 工具自动连到对应工作区绑定的 reme 实例，无需手动启停或记端口。

## 安装

本仓库带两份 cordis 配置：

- **`cordis.yml`** — 开发期覆盖：绝对路径指向 `src/index.ts`，方便直接改 .ts 后 reload。
- **`cordis.patch.yml` + `package.json#dsh.bundle.patch`** — 发布版入口：`dsh plugin --profile web add` 走 npm 包名装载，发布到 GitHub 后可装 release tarball。

本地开发快速装载（patch 走通后可用 `link:`）：

```sh
dsh plugin --profile web add "link:/path/to/dsh-reme-auto-router"
```

调试阶段也可直接把 `cordis.yml` 路径加入 `~/.dsh/settings.yaml` 的 `dsh.bundle.layers`，或在 `cordis.yml` 上手动调整 `name:` 后让 dsh 加载。

## 设计要点

- **检测源**：active workspace 通过 `api-session/status`（running ⇄ idle）事件推断——任何 session 变 running 时其 `session.header.cwd` 即为 active workspace。
- **进程生命周期**：惰性启动（首次切到该 workspace 时 spawn）+ idle timer（默认 15 min 后停止）+ pin 保护（永不 idle stop）+ DSH 退出时按 `killOnExit` 决定是否清理。
- **路由协调**：写 `ctx.settings['reme-memory'].endpoint`，让官方 reme-memory 插件的客户端自动切到正确端口。
- **reme 数据落点**：spawn 时不传 `workspace_dir`，由 reme 用默认的相对路径 `.reme/` + 我们 plugin 设的进程 cwd 解析为 `<workspace>/.reme/`。workspace 根目录不被 `daily/`、`metadata/`、`session/` 等目录污染，**所有 reme 数据落在一个隐藏目录 `.reme/` 下**。每个 workspace 一个独立的 reme 进程，cwd 锁死在 spawn 时刻，所以 `.reme/` 路径天然隔离。
- **用户手动起的 reme**：探测端口 + 读 cmdline 区分所有权，标记为 adopted（只读不接管生命周期）。
- **用户感知**：plugin 内部模拟 user 敲一次 `/reme` slash command，把 reme 状态以「命令结果卡片」形式推到 WebUI 聊天流——`command/done` 是 log-only event，**model 永远看不到**卡片文字，user 看到。同一 cwd 同一状态的卡片自动去重，状态变化时才冒新卡。

## 配置（settings.yaml）

更多设置落在 `~/.dsh/settings.yaml` 的 `reme-auto-router` namespace（v1 仅手编 yaml，WebUI 设置页后续）：

```yaml
reme-auto-router:
  killOnExit: true
  shutdownGraceMs: 3000
  waitForIdleBeforeShutdown: false
  maxShutdownWaitMs: 8000
  idleTimeoutMs: 900000
  adoptManual: true
  ports: { base: 2333, range: 67 }
  pinnedDirs: []                  # cwd realpath 列表，pin 的永不 idle stop
```

## 验证

```sh
pnpm run verify
```

跑全部 4 个测试（`import-check` / `detector-state` / `state-store-race` / `smoke-apply`）+ `tsc --noEmit`。

## 已知限制

- WebUI 设置页未实现（`reme-auto-router` namespace 在 settings.yaml 手编生效）
- 不做主动健康检查——reme 自身错误由 `reme_search` 工具报错接住
- 多 tab 同时活跃不同 workspace 时取最近一次活跃为 active cwd
- model-visible system prompt 不写 reme 状态——模型对 reme 的认知完全靠 `reme_search` 的成败反馈
- 自动推送的去重粒度是「同一 cwd 同一渲染文本」；快速切换 workspace 时每个目标 cwd 各推一次（不会重复推同一 cwd）
- Windows 不支持（manual-adopter 用 `lsof` + `/proc/<pid>/cmdline`，macOS/Linux only）
- 没有 user-launched WebUI chip——chat 卡片是唯一的 user 感知通道

详细设计见 [`docs/design.md`](docs/design.md)。