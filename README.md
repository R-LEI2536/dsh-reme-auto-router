# reme-auto-router — DeepSeek Harness 插件

为每个活跃 workspace 自动管理一个独立的 reme 进程：用户在 WebUI 切工作区时，agent 的 `reme_search` 工具自动连到对应工作区绑定的 reme 实例，无需手动启停或记端口。

## 安装

### 生产安装（推荐）

```sh
dsh plugin --profile web add github:R-LEI2536/dsh-reme-auto-router
```

DSH 从 GitHub 拉取 release 仓库，载入 `lib/index.js`（服务端）与 `lib/client.js`（Web UI 插件页卡片）。

> **宿主要求**：0.4.0 起要求宿主 DSH `0.2.0-rc.1` 或更高（消费的 `@deepseek-ai/dsh-*` peer 走 `^0.2.0-rc.1`）。0.3.x 及更早的插件版本面向 DSH 0.1.7 宿主；0.1.x 宿主会被插件的兼容门拦下（bundle 形态是整包跳过，不是禁用某一行）。

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

## 配置（插件 Config，DSH 0.1.7+ / 0.2.0-rc.1+ 模型）

所有可编辑字段在插件 `Config` schema 上声明 `.volatile()`，编辑后 live 生效并持久化到当前 profile 的 `cordis.patch.yml`（entry id `dsh-reme-auto-router` 的 `config` 层）——无需手编 yaml、无需重启。

**但 volatile 只是服务端契约**：Web UI 里的渲染位全是客户端 slot，所以插件必须自带浏览器半区（v0.4.1 起：`lib/client.js` + `package.json#dsh.client`）。本插件的入口是**插件管理页**里的一张卡片，而不是设置页侧边栏——配置项少，不单开 `settings.section`，避免污染设置页。

### 在 Web UI 里改配置（插件管理页卡片）

1. Web UI → **插件**
2. **Official** 组里点 **ReMe Auto Router** 卡片
3. 改 Provider / Model / API key 引用 / Base URL → **保存**

保存写入当前 profile `cordis.patch.yml` 的用户层（`dsh-reme-auto-router` 的 `config.llm`），live 生效、无需重启；留空 = 继承/不注入（见下节语义）。

> 卡片若显示「宿主当前没有提供本插件的设置命名空间」，说明该 profile 没有组合本插件的 entry（未启用 / bundle 未加载）：`dsh plugin --profile web add …` 后重启 DSH，入口就会出现。

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
llm:                                  # spawn reme 时从 DSH 注入的 LLM 配置（见下）
  provider: null                      # DSH provider route 名；null = 继承 DSH 默认
  model: null                         # 模型 id；null = 继承 DSH 默认
  apiKeyRef: null                     # credential ref；null = DEEPSEEK_API_KEY → LLM_API_KEY → OPENAI_API_KEY
  baseUrl: null                       # OpenAI 兼容端点；null = 不注入（deepseek 官方自动给 https://api.deepseek.com）
```

### `llm` 小节:让 reme 用上你 DSH 里配好的 provider(照 DSH User Approval 的设置形态)

启动 reme 时,插件从 DSH 运行时取 LLM 配置注入子进程 env(`LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL_NAME`),**不读、不写任何密钥文件**:

- `provider` / `model`:与 dsh-user-approval 的 `smartProvider`/`smartModel` 同款语义——留空(`null`)继承 DSH 默认(`agentDefaultModel.currentSelection()`,即设置页里选的 provider/model),填了就用你自己在 DSH 里配置的那个名字;两者相互独立。
- `apiKeyRef`:API key 从 DSH credentials seam 解析(`env → $DSH_HOME/.credentials.yaml → DSH 自己的 .env`,与 DSH 自身 LLM 同源)。留空按探测链 `DEEPSEEK_API_KEY` → `LLM_API_KEY` → `OPENAI_API_KEY` 依次尝试;自定义 ref 时填一个即可。
- `baseUrl`:OpenAI 兼容端点。`deepseek` 系 provider 会自动给官方端点;自定义代理(如第三方中转)填一次你的地址。
- **coherence 门控**:只有当 key 能解析到时才会注入整组配置;解析不到则完全不注入,reme 保持其自身 env / `.env` 行为(不注入空值,避免 reme 的 `${LLM_BASE_URL:-}` 默认失效)。

限制(两个条件规则,本期只解决「key 来源」半边):① 若工作区 cwd 往上 5 层内存在含 `LLM_*` 的 `.env`,reme 的 `load_env(override=True)` 仍会**无条件覆盖**注入值;② key 只活在子进程 env 与内存里,同用户可经 `/proc/<pid>/environ` 读取(任何进程 env 的标准暴露面)。日志只记录来源(`key=DEEPSEEK_API_KEY@file`)与 provider/model 名字,从不记录 key 值。

部署方也可在组合配置（cordis.yml / bundle patch）里覆盖这些字段。

## 验证

```sh
pnpm run verify
```

跑全部 8 个测试（`import-check` / `detector-state` / `state-store-race` / `smoke-apply` / `endpoint-coordinator` / `push-notifier` / `llm-source` / `client-card`）+ `tsc --noEmit`。`client-card` 里的 `lib/client.js` 产物断言需要先 `pnpm run build`（未构建时自动跳过）。

## 已知限制

- 不做主动健康检查——reme 自身错误由 `reme_search` 工具报错接住
- 多 tab 同时活跃不同 workspace 时取最近一次活跃为 active cwd
- model-visible system prompt 不写 reme 状态——模型对 reme 的认知完全靠 `reme_search` 的成败反馈
- 自动推送的去重粒度是「同一 cwd 同一渲染文本」；快速切换 workspace 时每个目标 cwd 各推一次（不会重复推同一 cwd）
- Windows 不支持（manual-adopter 用 `lsof` + `/proc/<pid>/cmdline`，macOS/Linux only）
- 没有 user-launched WebUI chip——chat 卡片是唯一的 user 感知通道
- 配置入口依赖插件 entry 被当前 profile 组合：浏览器半区只在宿主 serve 该 settings 命名空间时才渲染卡片内容（卡片本身始终在，未 serve 时显示 unavailable 行）
- 路由协调依赖官方 reme-memory 插件暴露 `remeMemory.setEndpoint`——dsh-reme-support ≥ 0.2.2 已提供；未挂载或旧版本时跳过路由写入并 warn 一次（`remeMemory service is unavailable`）
- **stale endpoint（定性，P2）**：实例 idle stop / 异常退出 / DSH 重启未 respawn 期间，最后一次 endpoint 保留指向已停端口，直到下次实例 `ready` 重新路由或 DSH 重启。窗口内 `reme_search` 报错（用户可见）、`auto_memory`/`auto_dream` `fetch failed`（数据不丢，下批重投成功）。与 0.1.5 时代行为一致，本期不改；撤销需契约扩展（`setEndpoint(undefined)` 或独立 clear），记录为后续项

详细设计见 [`docs/design.md`](docs/design.md)。