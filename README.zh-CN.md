# Context Forecast（上下文天气预报）

[English](README.md) | 简体中文

**给 Claude 的"记忆"做天气预报。** 一眼就能看出这段对话里 Claude 还剩多少空间，并在 Claude 不得不压缩对话*之前*提醒你。

## 30 秒看懂

- Claude 一次能记住的对话内容是有限的，这块空间叫做**上下文窗口**（context window）。你发的每条消息、它读的每个文件、每次工具调用的结果，都会占掉一点空间。
- 快满的时候，Claude Code 会**自动压缩**（auto-compact）：把较早的对话换成一段简短的摘要来腾出空间。这样能继续工作，但一些细节可能会丢失，而且时机通常不是你选的。
- Context Forecast 把"满了多少"变成**天气**，并估算**还能聊几轮**才会自动压缩。天色变暗时，它帮你**按自己的方式**压缩，留下真正重要的内容。

| 天气 | 满了多少（距离自动压缩） | 对你意味着什么 |
| --- | --- | --- |
| ☀️ Clear 晴 | 不到 30% | 空间充足，继续干活。 |
| ☁️ Cloudy 多云 | 30–60% | 在慢慢变满，暂时不用管。 |
| 🌧️ Rain 雨 | 60–85% | 自动压缩快来了，适合自己规划一次压缩。 |
| ⛈️ Storm 暴风雨 | 85% 以上 | 马上就要自动压缩。在意保留什么的话，现在就压缩。 |
| 🌈 Clearing 转晴 | 刚压缩完 | 又有了充足的空间。 |

## 安装

在 Claude Code 里输入这两行：

```
/plugin marketplace add FeidaWang/context-forecast
/plugin install context-forecast@context-forecast
```

然后重启 Claude Code。就这样：Claude 第一次回复之后，天气会自己出现。

支持 Claude Code 终端版和 Claude 桌面应用（Code 标签页）。在普通聊天和 Cowork 里不起作用。

## 怎么用

### 1. 看一眼天气

平静的时候，天气安静地待在输入框底部、模型名旁边，比如 `☀ 17%`。点它可以看更多。

值得留意的时候（从多云开始、剩下不到 100 轮时；或者某项用量额度超过 75%），输入框上方会自动出现**一行横幅**，大致是这样：

> 🌧️ Rain · ~12 turns until auto-compact › &nbsp; ▬▬▬▬▬▬▭ 610k / 1M

- **~12 turns** 是预报：大约还能来回聊 12 轮才会自动压缩。
- 进度条和 `610k / 1M` 表示满了多少（k = 千个 token，一个 token 大约是半个汉字到一个汉字）。
- 点这一行打开完整预报。**Minimize** 把它收回底部；**Hide** 把它藏起来。
- 下雨和暴风雨时，横幅上还会出现 **Plan compact**（规划压缩）按钮。

### 2. 打开预报面板

点横幅，或者输入 `/weather forecast`。侧边会打开一个面板，从上到下是：

- **概览**：当前天气、模型、已用多少，以及「~N turns left」（还剩约 N 轮；空间很多时显示「17% to auto-compact」，即走到自动压缩的 17%）。
- **What's in context（空间被什么占着）**：你的对话、工具、CLAUDE.md、MCP 服务器……每项都有一根小进度条。如果某个 MCP 服务器占了很多空间却从没用过，会被指出来，旁边的 **Disable…** 按钮会帮你复制 `/mcp` 命令。
- **Prompt cache（提示缓存）**：Claude Code 会在一小段时间内（5 分钟或 1 小时）便宜地复用最近的内容。这里显示缓存是否还"热"、还有多久变"冷"。趁热回复更便宜也更快。
- **Subagents（子代理）**：Claude 派出去干活的帮手（比如去搜索代码）。每一项显示它读了多少、只带回了多少，差额就是替你主对话省下的空间。**View** 可以查看它做了什么。
- **Usage（用量）**：你的套餐 5 小时和每周额度，以及重置时间；**API cost** 是这个会话如果按 API 价格计费大约要多少钱。
- **Plan compact**：打开压缩规划页。

### 3. 按你的方式压缩

**Plan compact** 打开**压缩规划页**：

1. **Keep（保留）**和 **Drop（丢弃）**：勾选摘要里必须保留的内容（当前任务和计划、改过的文件、做过的决定、你的偏好……），以及可以扔掉的内容（旧的搜索结果、大段文件内容……）。这些选项是根据你自己的会话推荐的。
2. 框里显示的就是将要使用的 `/compact` 指令原文。标题旁边的 **Copy** 会把它复制到剪贴板。你也可以在输入框里**加一条自己的指令**。
3. **Estimated after compact** 显示压缩前 → 压缩后的大小。**Best moment** 告诉你现在是不是好时机（比如 Claude 没在忙、缓存还热）。
4. **Compact now** 会先确认一次（按钮变成「Confirm compact」），然后按你的指令压缩。如果 Claude 正在回复，它会等回复结束。**‹ Back** 返回预报。

下面的 **Next move（下一步建议）**最多给出三条节省空间的小习惯，只在适用时出现。例如：把大范围的代码搜索交给 Explore 子代理；把过长的 CLAUDE.md 挪进一个 skill；换话题时开一个新会话。

## 命令

| 输入 | 效果 |
| --- | --- |
| `/weather` | 在输入框上方显示横幅 |
| `/weather forecast` | 打开或关闭预报面板 |
| `/weather auto` | 默认模式：平静时天气在底部，需要留意时出现横幅 |
| `/weather mini` | 天气一直以小字留在底部 |
| `/weather hide` | 隐藏；输入 `/weather` 恢复 |

如果 `/weather` 已经被别的插件占用，命令会变成 `/context-forecast`（比如 `/context-forecast forecast`）。

在终端里，横幅或面板获得焦点时可以用快捷键：`f` 预报、`m` 最小化、`c` 规划压缩、`b` 返回。

## 小贴士

- 带 `~` 的数字是估算。
- 轮数预报依据最近每一轮增加了多少（取最近 8 轮的中位数，所以偶尔读一个大文件不会把预报带偏）。前几轮还在观察时，会显示「Measuring growth」。
- 没有内容可显示的部分（没有子代理、没有套餐额度、缓存时长未知）会自动隐藏。

## 隐私：它读什么、运行什么、发送什么

一切都在你自己的电脑上运行。Context Forecast **不向任何地方发送任何数据**：不联网，不附带 MCP 服务器，不调用模型。

- **读取会话用量**：Claude Code 报告的当前会话上下文大小、窗口大小、额度百分比和会话费用（`$.session.usage`）。
- **不读取任何环境变量或凭据。** 记录文件的位置来自 Claude Code 自己交给 hooks 的 `transcript_path`；插件的 `classic.SessionStart`、`classic.UserPromptSubmit` 和 `classic.Stop` 三个 hook 只记下这个路径，事件原样放行。
- **读取当前会话的记录文件**（`$.fs.read`）：在会话开始时和每轮结束后读取，用于 token 历史和缓存时长（超过 4 MiB 的文件会跳过）。只用到 token 数、缓存数据、请求 id 和时间戳。还会读取会话 `subagents/` 文件夹里的子代理记录，获取子代理类型和 token 数。
- **读取对话**（`$.session.messages()`）：每轮结束后读取，用来统计工具调用、改过的文件、搜索、大段结果和测试失败的次数，并判断是否换了话题。只保留次数和大小；消息原文和文件路径从不保存或显示。
- **只会执行一个斜杠命令 `/compact`，而且只在你按下 Compact now 时。** 它先请 Claude Code 直接压缩（`$.session.compact`）；这个接口不可用时（桌面应用和其他 SDK 环境），就通过 `$.command.run` 执行 `/compact <规划页里显示的指令>`，和你亲手输入完全一样。不执行任何其他命令。
- **只在你按按钮时写剪贴板**：**Copy**（`/compact` 命令）和 **Disable…**（`/mcp`）。剪贴板内容留在你的电脑上。
- **按 View 时，在 Claude Code 自带的查看器里打开子代理的记录**（`$.ui.view({ agentId })`）。只是在应用里显示本地记录，不发送任何东西。
- **用 `session.compact` hook 观察压缩**：每次压缩（你发起的、Claude Code 自动的、或它替你发起的）都原样执行，结束后从新的大小重新开始预报。
- **不运行任何程序**：不启动进程，不执行 shell 命令。
- **只注册自己的 `/weather` 命令**（如果 `/weather` 被占用则是 `/context-forecast`），不碰权限、代理、设置或远程控制。
- **保存少量状态**（最近的 token 采样、上次读数、缓存和子代理统计、规划选项、显示模式），存在 Claude Code 自己的插件状态里。

详见 [PRIVACY.md](PRIVACY.md)。

## 想深入了解：每个数字从哪来

| 数字 | 来源 |
| --- | --- |
| 已用 / 窗口 | `$.session.usage()` → `context.tokens`、`context.window`（和状态栏是同一组数字） |
| 模型、自动压缩阈值、进度条长度、预留空间 | `$.session.usage({ breakdown: 'summary' })` → `breakdown.model`、`autoCompactThreshold`、`rawMaxTokens`、`buffer` 分类 |
| 空间被什么占着 | `breakdown.categories`，合并成几组 |
| 每个 MCP 服务器占用 | `breakdown.mcpTools`，按 `serverName` 汇总 |
| MCP 调用次数 | `mcp__<server>__*` 工具调用：实时计数（`tool.call`）加上 `$.session.messages()` 里的记录 |
| CLAUDE.md 大小 | `breakdown.memoryFiles` 中名为 `CLAUDE.md` 的文件 |
| 每轮增长、剩余轮数 | 主线程每次请求的用量（`turn.step`）和每轮结束（`session.measure`）；历史从记录文件重建 |
| 缓存读取率、上一轮写入 | 最近一次请求的 `cache_read/creation_input_tokens`（`turn.step`、`turn.complete`） |
| 缓存时长 | 记录文件里的 `usage.cache_creation.ephemeral_1h/5m_input_tokens`；记录文件超过 4 MiB 时，根据空闲之后缓存的表现推断（空闲超过 5 分钟仍能读到 → 1 小时；一小时内被重写 → 5 分钟） |
| 缓存倒计时 | 主线程最后一次回复的时间 + 缓存时长 |
| 子代理 | `$.agent.list()`（类型、说明）；每个子代理 `turn.step` 的用量（取最大上下文）；它 `turn.complete` 的回复（≈ 字符数 ÷ 4）；更早的运行来自会话的 `subagents/agent-*.meta.json` 和 `.jsonl` |
| 用量额度 | `usage.rateLimits`（`five_hour`、`seven_day`：`percentUsed`、`resetsAt`） |
| API cost | `usage.cost.usd` |
| 规划选项、下一步建议 | 上次压缩以来的 `$.session.messages()`：工具名、输入和结果大小 |
| 压缩后估算 | ≈ 非对话部分的上下文 + 约十分之一对话长度的摘要（3k–20k）+ 原样保留的内容 |

## 开发

```
claude plugin validate .      # 检查清单文件和 hooks
claude plugin test .          # 单元测试和界面测试
./scripts/preflight.sh        # 插件目录审核会检查的所有项目
```

源码：`hooks/forecast.ts`（天气、增长、剩余轮数）、`hooks/band.ts`（输入框上方的横幅）、`hooks/insights.ts`（上下文分组、MCP、规划页、下一步建议）、`hooks/panel.ts`（面板上的数字）、`hooks/pane.tsx`（绘制面板和规划页）、`hooks/icons.ts`（区块图标）、`hooks/sky.ts`（天气动画）、`hooks/history.ts`（读取记录文件）、`hooks/fixtures.ts`（预览数据）、`hooks/register.tsx`（事件、横幅、底部天气和 `/weather` 命令）。

## 许可证

Apache-2.0，见 [LICENSE](LICENSE) 和 [NOTICE](NOTICE)。区块图标来自 [Lucide](https://lucide.dev)（ISC 许可）。

Context Forecast 源自 [anthropics/claude-code-playground](https://github.com/anthropics/claude-code-playground/tree/main/claude-code/mods/token-weather) 中的 `token-weather` 示例 mod（Apache-2.0）。这是一个独立项目，不是 Anthropic 的产品。
