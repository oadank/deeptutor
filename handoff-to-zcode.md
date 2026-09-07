# DeepTutor 智能体 — 最终结论与交接（2026-09-05 zcode 收尾）

## 结论（TL;DR）
用户拍板：**不强行修跑不通的 agent，用「能稳定跑的」就够了。**

**最终启用（4 个实测 `backend.consult` 每次返回 ok）：**
- ✅ **Claude** (claude_code)
- ✅ **Codex**
- ✅ **Hermes**
- ✅ **OpenCode**

**已停用并从连接移除（不在网页里可选了）：**
- ⛔ **DeepSeek Harness** —— headless 静默退出、需 ACP 链路且依赖 DSH 工程目录，投入产出不划算
- ⛔ **MiMo Code** —— 依赖的可执行文件有权限/锁定问题
- ⛔ **OpenClaw** —— 网关与 tailscale serve 端口冲突且需迁移 legacy auth，属系统级历史包袱

全程已做的改动：
1. `data/user/settings/subagent.json`：openclaw/mimo/deepseek_harness → `enabled:false`（备份 `subagent.json.bak-20260905-zcode`）
2. `DELETE /api/subagents/connections/{DeepSeek Harness|MiMo Code|OpenClaw}` → 网页连接列表只剩 4 个
3. 修好的 `process.py`（8MB 行上限）仍保留——这是害 `consult` 报「No answer」的根因，4 个可用 agent 全靠它

## 关键根因复盘（避免后人重踩）
- **consult_subagent「No answer」**：`process.py` 用 `readline()` 撞 asyncio 64KB 单行上限，stdout 静默丢弃 → 已修
- **此前误判方向**：交接里「运行时 env ≠ PEB」「USERNAME=Administrator」是本机不成立的理论，实际 os.environ 写入同步 PEB
- **zsh 沙箱会误报**：spawn npm 包装的 exe 常有 EACCES 假象（MISC 需用生产 `/api/subagents/backends/options` 或真实 shell 复核）

## 待办（可选，非必须）
- `nssm restart deeptutor` 让 process.py 修复在生产生效（用户可能已做，重启用确认页面可用即可）

## 调试资产
- `C:\opt\scripts\deeptutor-claude.mjs`（DEEPTUNER_CLAUDE_DEBUG=1 开关）
- `%TEMP%\zt_7agents.py` / `zt_ws_turn.py`
- 日志 `C:\opt\scripts\dt-claude-debug.log`、`~/.openclaw/logs/`

## 2026-09-05 补充：OpenClaw 全面修复 + tailscale 访问恢复
- **DeepSeek Harness 恢复启用**：zcode 曾误判——它走 ACP 一直能通（`zt_7agents.py` PASS），已恢复 config+连接并复测 OK
- **OpenClaw 根因（真）**：`~/.openclaw/identity/device-auth.json` 是迁移完成后的**残留文件**，
  ACP 桥的 `assertNoLegacyDeviceAuth` 检查文件存在即拒绝（数据早已迁入 state/openclaw.sqlite 的
  device_auth_tokens/device_identities，字段逐一比对一致）。doctor 的"先停网关再修"在本机死循环
  （所有权验证永远不通过）。**修复 = 把残留文件改名封存**（device-auth.json.migrated-bak-20260905）
- **openclaw 网关所有权归一**：网关由「Scheduled Task」承载（正在运行，127.0.0.1:18789）；
  nssm 的 openclaw-gateway 服务改为 Manual 启动（此前 nssm/task 双实例抢 lifecycle 锁是数日抽风根源）
- **tailscale serve 已恢复**（--bg 持久）：18789→127.0.0.1:18789（OpenClaw chat）；
  3782→3782（DeepTutor）；443→3080（dsh-web）。实测带 token 的 /chat URL = 200
- **OpenClaw consult 实测**：success=True "ok"（ACP，经网关）
- **MiMo**：传输通但模型只会回显 prompt（问 13*17 原样复读）→ 保持禁用、连接移除
- **最终可用 6 个**：Claude / Codex / Hermes / OpenCode / DeepSeek Harness / OpenClaw

## 2026-09-05 终验：生产对话 6/6 全通过
`nssm restart deeptutor` 后（后端 PID 29132 加载全部修复），经与网页完全相同的
WS turn 协议逐个实测（每 agent 问 13*17，防回显）：
Claude/Codex/Hermes/OpenCode/DeepSeek Harness/OpenClaw —— **6/6 PASS**，
每个恰好 consult 1 次、工具结果均返回 221、模型转述正确，无重试循环。
网页 UI 实测（浏览器实际操作）：挂 OpenClaw → 提问 → 界面显示"咨询子代理 OpenClaw"
→ 回答 221，侧边栏有 OpenClaw 实时运行流。
另修复 ACP 客户端三个隐患：agent 反向请求（fs/* 等）超时挂死（现回 JSON-RPC 错误）、
看门狗中断后不发 session/cancel（下回合会被拒）、空凭证覆盖真实 env。
