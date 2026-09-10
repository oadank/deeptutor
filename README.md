<div align="center">

# DeepTutor · 本机定制版（oadank fork）

**上游**：[HKUDS/DeepTutor](https://github.com/HKUDS/DeepTutor)（v1.6.6 已合入）· 本 fork 在其之上持续叠加本地定制补丁

</div>

这是 DeepTutor 的**个人生产部署** fork，跑在 Windows 本机（nssm 服务 + LiteLLM 网关 + 6 个本地 CLI 智能体）。所有定制都围绕一个目标：让 DeepTutor 在这台机器上把「调本地智能体干活」这件事做到稳定可用。

## 本 fork 的定制内容

### 1. 子代理（consult_subagent）管线修复与 ACP 路线 ⭐

上游的 consult 在本机环境下有两个致命问题，本 fork 全部修复并扩展：

- **stdout 行上限 8MB**（`services/subagent/process.py`）：asyncio `StreamReader` 默认 64KB 单行上限，当 CLI 启动钩子往 stream-json 里灌大块初始化事件时（本机 claude 配了全局 SessionStart 钩子，一次 21KB+），泵静默死亡 → 工具层以为“agent 没回答” → 模型反复重试烧预算。上游 v1.6.5 的 `truncate_field` 只截断渲染层，**没修泵层**，此修复仍是必需的。
- **ACP 路线**（新增 `services/subagent/acp_client.py`）：OpenClaw 与 DeepSeek Harness 改走 Agent Client Protocol（stdio JSON-RPC：initialize → session/new → session/prompt），照搬生产桥的实现要点——权限自动批准、首输出 75s / 空闲 300s 看门狗、超时发 `session/cancel`、agent 反向请求回 JSON-RPC 错误防挂死。OpenClaw 由此摆脱网关守护进程依赖，dsh 摆脱 headless 静默退出问题。
- **共享凭证**（新增 `services/subagent/credentials.py`）：LiteLLM / DeepSeek / Ark 三把 key 统一「env 优先 → `~/.dsh/.credentials.yaml` 配置中心」，codex consult 自动注入网关 key。
- **hermes 兜底**：nssm 服务 PATH 是静态快照，找不到 hermes venv 里的 CLI → `HERMES_HOME` 绝对路径兜底。
- **claude 信任预注册**：Claude Code 2.x 的目录信任门（无 TTY 时永远 Not logged in）→ spawn 前自动把 turn 工作目录写进 `~/.claude.json`。

本机实测：**6/6 智能体**（Claude / Codex / Hermes / OpenCode / DeepSeek Harness / OpenClaw）经生产 WebSocket 链路咨询全部通过，恰好 1 次调用、无重试循环。

### 2. 沙箱 exec 环境白名单扩展（`services/sandbox/backends.py`）

`RestrictedSubprocessBackend` 的 `_SAFE_ENV_KEYS` 增加 `USERPROFILE` / `APPDATA` / `ANTHROPIC_BASE_URL` / `ANTHROPIC_MODEL` / `ANTHROPIC_AUTH_TOKEN`——否则 Windows 服务账号下跑 `claude -p` 找不到用户配置与网关凭证，报 Not logged in。

### 3. 教材下载页（学习空间新菜单，`/space/textbook-downloads`）

三层结构的教材下载指南，内容**内置在后端常量里，与本地文件系统零依赖**：

- **全国通用层**：三个官方下载渠道（智慧教育平台/人教社/电子课本网）+ 下载方法 + 「怎么查自己地区用什么版本」指引；
- **分省速查层**：31 省主科教材版本速查，支持搜索与点选（页面明确标注“以学校为准”，非权威对照）；
- **已核实样例**：山西运城高中 9 科 + 小学主科的完整册次明细（可折叠）。

### 3.5 文档解析新增 anydoc 引擎

集成 [firecrawl/anydoc](https://github.com/firecrawl/anydoc)（v0.2.x，MIT）作为可切换的解析引擎（`parse-anydoc` extra）：纯本地 Rust 转换，Office 全家桶（含老格式 .doc/.ppt/.xls 二进制）、ODF、RTF、EPUB、CSV、文本层 PDF 一站转 Markdown，表格与公式保留，不依赖模型、不联网。扫描版 PDF 本地直接拒绝（无内置 OCR；云端 OCR 默认关闭需显式开启，扫描件请走 MinerU/Docling）。设置 → 知识库 → 文档解析 里选择；PyPI 认准 `firecrawl-anydoc`（裸名 `anydoc` 是无关包）。

### 4. 语音对话链路（系列补丁）

语音消息端到端修复：空 ASR 不再显示裸标记、横幅一次点击即播、AI 口语稿（transcript）存库并在横幅展示/复制、`tts_speak` 工具强制挂载（防旧前端工具清单漏传）、无真实语音产出时禁止模型嘴硬“语音发你了”、语音附件 mp3 播放副本落盘。

### 5. 会话稳定性（系列补丁）

- 启动孤儿清扫：上一进程遗留的非终态 turn 自动取消，会话不再永远“进行中”；
- 前端流式看门狗：对照后端 active-turn 真实状态收敛僵死的“正在输入”UI（配套 `/active-turn` 看门狗端点）；
- 中断式注入：turn 运行中再发消息注入当前回合而非拒绝。

### 6. 上游合并说明

- **v1.6.5**：上游把 chat 管线重构成薄壳（逻辑上移 `agents/loop/`）。本 fork 的迁移：`_drain_user_injections`（注入式中断）挂回 `AgenticChatPipeline`；`tts_speak` 强制挂载迁入新共享模块 `_shared/tool_runtime.py`；`voice_policy` 提示块追加到上游 `foundation_blocks()` 之后；locale 文件语义化合并（本地 keys ∪ 上游 keys）。
- **v1.6.6**：已合入。冲突主要在 README / locale JSON；chat 管线与 llm 层自动合并后逐项核对保活补丁。

## 部署形态（本机）

- Windows 11 + nssm 服务（`deeptutor`，源码可编辑安装，后端 :8001 / 前端 :3782）
- 模型走本机 LiteLLM 网关（:4000，`claude-model` / `codex-model` 等）
- 6 个本地 CLI 智能体经 nssm/计划任务常驻，DeepTutor 对话内经 `consult_subagent` 调用

## 同步上游

```bash
git fetch origin --tags
git merge v1.6.6   # 下一个版本
# 冲突原则：process.py 的 8MB 上限、trust 预注册、credentials 注入必须保留
```

---

> 完整英文原版 README 见 [HKUDS/DeepTutor](https://github.com/HKUDS/DeepTutor#readme)。本 fork 不维护多语言版与上游徽章。Licensed under the [Apache License 2.0](LICENSE).

