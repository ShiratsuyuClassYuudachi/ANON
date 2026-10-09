# QQ 聊天记录合并转发 → Markdown（主站鉴权下载）

## 背景与已验证事实

用户痛点：把 QQ 聊天记录批量导出为 markdown 供 AI 分析；开始/结束标记 = 转发时多选的消息范围；被引用的消息内容也要包含；结果存为**主站文件**，回复链接，下载走主站登录态。

已查证（官方文档 + 现有代码）：

- 机器人走 **QQ 官方 Bot API v2 webhook**（`backend/src/routes/qqWebhook.ts` → `services/qqEvents.ts`），无历史消息拉取接口。
- QQ 事件体定义了 `message_type`：**102=聊天记录（合并转发）、103=引用消息**，`msg_elements` 递归（[群消息全量事件](https://bot.q.qq.com/wiki/develop/api-v2/autogen/event/group_message_create.html)、[单聊消息事件](https://bot.q.qq.com/wiki/develop/api-v2/autogen/event/c2c_message_create.html)）。官方示例：引用回复一条合并转发时，`msg_elements[].content` 携带被引用内容（结构化 elements 或 `=== 消息 N ===\n[消息内容] ...` 扁平文本）。
- 图片在 `attachments[].url`（QQ CDN，带时效 rkey）；语音带 `asr_refer_text`；卡片在 `ark_data`。
- **2026-10-08 实测修正**：C2C 的 102 事件**没有 `msg_elements`/`attachments`**，整段拍平在顶层 `content`（`=== 消息 N ===` 分块 + 缩进递归的 `--- 第N条 ---` 子块）；`message_scene.ext` 只有 `msg_idx`（无 `auth_token`）。扁平文本中的图片 URL 是 **QQ 客户端上下文签名**（appid=1406），机器人服务器抓取即 400 `appid is not match`（事件到达瞬间亦如此，换 CDN 域名/UA/Referer 均无效）；**视频/文件只有文件名与大小、无 URL**。官方 v2 API 无任何按消息拉取附件的接口（仅富媒体上传），[bot-docs#275](https://github.com/tencent-connect/bot-docs/issues/275) 亦无人应答。
- 现有下载链路：`GET /api/files/:id`（`backend/src/routes/files.ts`）已做鉴权：超管或项目成员（+资源版本可见性）。`File` 模型 `projectId` 目前 required。前端 `api/client.ts` 的 `downloadFile(id, filename)` 用 `authorizedFetch` 带 JWT 下载——即「复用主站 token」。
- 归属解析素材：`Project.qqGroups[].groupOpenId`（群→项目）、`User.qqMemberIds`（群+member→用户）、`User.qqOpenId`（C2C→用户）、`Project.createdBy`（兜底 uploadedBy）。
- **风险**：QQ 102/103 事件实际推送完整性未经实测，第一步先 spike。

已与用户确认的决策：

| 决策点 | 结论 |
|---|---|
| 实现路径 | 合并转发解析（零落库聊天原文），先 spike 实测 102/103 |
| 使用场景 | 单聊直接转发 + 群内「引用回复转发 + @机器人 说导出」 |
| 交付方式 | 存为 File + 回复主站链接；**群导出按群绑定项目归属（项目成员可下载）；单聊导出只核验 QQ 已绑定 ANON 账号（仅本人可下载）** |
| 上下文需求 | 信息整理为目的，线性转录格式；引用内容仍要 |

## 数据流

```
C2C message_type=102（校验 qqOpenId 已绑定）
群  103 引用 + @bot +「导出」（群→项目，member→用户）
        ──▶ qqChatExport 解析 ──▶ markdown
        ──▶ storeBuffer(qq-exports/<rand>.md) + File 文档
        ──▶ 被动回复：${publicBaseUrl}/dl/<fileId>?name=<filename>
用户浏览器 ──▶ /dl/:id（RequireAuth，复用主站登录态）
             ──▶ downloadFile → GET /api/files/:id（JWT 鉴权，现有路由）
```

## 实施步骤

### Step 0 — Spike：验证 102/103 事件实际形状

1. `backend/src/services/qqEvents.ts`：消息类分支对 `message_type >= 100` 的事件打印完整 payload（gated：`process.env.QQ_DEBUG_EVENTS === '1'`，截断 8KB）。
2. 部署后用户实测：① 单聊发合并转发（含图片、含一条引用消息）；② 群里发合并转发；③ 群里引用回复该转发并 @机器人 发「导出」。
3. 从 `backend/backend.log` 确认真实字段形状。
4. **Go/No-Go**：C2C 收不到 102 → 停止，重议（回落：全程落库 + 打标导出，另立计划）。

### Step 1 — 解析与渲染模块 `backend/src/services/qqChatExport.ts`

纯函数、无 IO：

- `parseForwardPayload(d: unknown): ExportMessage[]`：
  - `ExportMessage = { author: string; text: string; images: { url: string; name?: string }[]; voiceText?: string; quote?: { author: string; text: string }; card?: { title: string; desc?: string; url?: string } }`
  - 递归展开嵌套 102（深度 ≤3）；结构化 elements 与扁平 `=== 消息 N ===` 文本双形态兼容（正则兜底）。
  - 103 引用 → `quote`（仅直接引用一层，文本截断 200 字符）。
  - 上限：总条数 ≤500（截断并文末标注）、单条文本 ≤4000 字符。
  - `author.username` 为空 → openid 前 6 位 → 「未知」。
- `renderMarkdown(msgs, truncated, notes?): string`：线性转录（标题含导出时间与条数；引用块置于引用者消息之前；图片 `![name](url)`；语音 `[语音] 转写`；卡片 `[链接卡片] 标题 — 描述 (url)`；notes 追加为文末引用块）。
- 扁平格式按缩进递归解析（`parseFlatScope`/`parseFlatBlock`）：`[消息类型] 合并转发消息` → 先发 `📁 [xxx的聊天记录]` 标题消息再递归展开子块（深度 ≥3 折叠占位）；其余消息的 `[关联消息]` 子块作引用；`[附件N] 类型:X 文件名:Y 大小:Z [URL:..]` 行——图片带 URL → images，否则渲染为 `[视频] 文件名（大小）` 等文本；仅含发送者的空消息丢弃。
- 媒体落地（`exportMessagesToFile` 内 `embedRemoteImages`）：导出时对远程图片立即抓取并替换为 base64 data URI（上限单张 8MB / 总计 30MB / 50 张，并发 4，单张 10s 超时）；抓取失败（实测必死于 C2C 转发）则转为 `[图片] 文件名（临时链接已失效）` 文本、不留死链，文末附注说明；含视频/文件附件时附注「QQ 合并转发不提供下载链接」。
- 编排函数 `exportMessagesToFile(msgs, attribution: { projectId?; uploadedBy }): Promise<FileDoc>`：`storeBuffer(Buffer.from(md,'utf8'), \`qq-exports/${rand}.md\`, 'text/markdown; charset=utf-8')` + 创建 File（filename `聊天记录导出-YYYYMMDD-HHmm.md`）。

### Step 2 — File 模型与下载权限扩展

- `backend/src/models/File.ts`：`projectId` 改为可选（`required: false`）；现有 `persistUploads` 调用不受影响。
- `backend/src/routes/files.ts` `GET /:id` 权限分支：
  - `doc.projectId` 为空 → 仅 `uploadedBy` 本人或超管可下载，其余 403；
  - 否则维持现有成员 + 资源版本可见性校验。
- 不新增后端路由，openapi coverage 表无需动。

### Step 3 — 前端下载页

- 新增 `frontend/src/pages/DownloadFile.tsx`：挂载后从 `?name=` 取文件名调 `downloadFile(id, name)`；成功显示「已开始下载」，失败显示错误（401 由 RequireAuth 兜底跳登录，即复用主站 token）。
- `frontend/src/App.tsx`：仿 `/p/:id/work-sheet/print` 加独立路由 `<Route path="/dl/:id" element={<RequireAuth><DownloadFile /></RequireAuth>} />`。

### Step 4 — 事件接入 `backend/src/services/qqEvents.ts`

- 扩展 payload 接口（`message_type?`、`message_scene?`、`msg_elements?`、`attachments?`，沿用全可选 + 运行时校验风格）。
- `handleC2CMessage` **最前**判断 `message_type === 102`：
  - `User.findOne({ qqOpenId: author.user_openid })` 不存在 → 回复「请先在 ANON 个人中心绑定 QQ 后再导出」；
  - 存在 → 解析导出，`File { projectId: 空, uploadedBy: 该用户 }`，回复 `已导出 N 条消息：<link>\n需登录 ANON 下载，仅本人可见。`
- `handleGroupAtMessage` 在绑定码判断之后、AI 录单之前插入：`message_type === 103 && 文本含「导出」`：
  - 群未绑定项目 → 回复提示先绑定项目；
  - `uploadedBy` = `qqMemberIds` 命中用户，未命中 → `project.createdBy`；
  - 回复 `已导出 N 条消息：<link>\n需登录 ANON 下载，项目成员可见。`
- 群裸发 102 不触发；解析为空回复「未能解析」；`config.publicBaseUrl` 为空回复配置缺失提示并记日志；异常 catch 回复「导出失败，请稍后重试」。被动回复均带 `msgId`。

### Step 5 — 测试 `backend/tests/qqExport.test.ts`（+ files 路由补充用例）

沿用 `tests/qq.test.ts` 的 mock 模式：

- 解析单测：官方文档示例 fixture + 自构 102 嵌套（图片/语音/卡片/引用/扁平文本/深度超限/条数超限/空内容）。
- 事件集成：C2C 102 已绑定 → sendC2CMessage 含 `/dl/` 链接且 File 归属该用户无 projectId；未绑定 → 绑定提示；群 103+@+「导出」→ File.projectId=绑定项目、回复含链接；群普通 @ 仍走 AI 录单（回归）。
- 下载权限：无 projectId 的 File——本人 200、他人 403、超管 200；有 projectId 维持原语义（已有用例不回归）。

### Step 6 — 全量验证与文档

- `npm run test`、`npm run typecheck`、`npm run build`、`npx tsx scripts/check-openapi-coverage.ts`、前端 `npm run build` 全绿。
- 部署后按 Step 0 三场景端到端实测：链接打开 →（未登录跳登录）→ 登录后自动下载 md，内容完整（文本/图片链接/引用/语音转写）。
- 文档同步：`docs/api.md`、`docs/features.md`、`docs/file-index.md`、（无新 API 路由，openapi.yaml 无需动）。
- 归档设计至 `docs/superpowers/specs/2026-10-08-qq-chat-export-design.md`。

## 错误处理摘要

| 场景 | 行为 |
|---|---|
| 解析为空 / 形状不认识 | 回复「未能解析」，记 debug 日志（payload 截断） |
| C2C 转发者未绑定 | 回复绑定引导 |
| 群未绑定项目 | 回复提示先绑定项目 |
| PUBLIC_BASE_URL 未配置 | 回复配置缺失提示，记日志 |
| 存储/DB 失败 | catch 回复「导出失败，请稍后重试」，记日志 |
| 无权限访问 /dl/:id | 401 跳登录；403/404 页面显示错误 |
| 超大转发 | 条数/体积截断并文末标注 |

## 明确的非目标（YAGNI）

- 不做 Blinko/第三方交付（已否决）；不自建公开下载路由（复用主站鉴权）。
- 不做全程落库/时间范围导出（除非 spike 证伪 102，另立计划）。
- 不做逐条转发合并、导出管理页、导出频率限制。
- 图片不转存第三方图床；导出时尝试抓取内嵌 data URI，失败按 `[图片] 文件名` 文本降级（C2C 转发的图片链接为 QQ 客户端签名，机器人实际无法下载）。

## 2026-10-08 追加：收集模式（开始/结束标识合并多条消息）

用户决策已确认：

- **仅单聊（C2C）**：群里机器人只能收到 @ 消息，标记法收集不到普通聊天；群场景保留「引用回复转发 + @机器人 说导出」。
- 标记（content trim 后精确匹配）：「开始导出」「结束导出」「取消导出」。
- 状态：内存 Map<userOpenid, session>（`qqCollectSession.ts`），30 分钟惰性过期，500 条上限；重启丢失进行中会话（可接受，结束时提示「没有正在进行的导出」）。
- 「开始导出」要求已绑定（否则回复绑定引导）；重复开始 = 重新开始（覆盖旧会话）。
- 收集期间（绑定码判断仍优先）：
  - 文本 → `{ author: 绑定 ANON 账号名, text }`；
  - **直发图片附件 → 事件到达时立即抓取转 base64 data URI**（实测直发附件 URL 为机器人上下文签名、可下载但短时效；抓失败降级 `[图片] 文件名（临时链接已失效）`）；语音 → ASR 转写；视频/文件 → `[视频] 文件名（xxMB）` 文本（不入文件正文出死链）；
  - 102/103 → 现有 parseForwardPayload 展开后追加，**不再即时导出**；
  - 每条收录后统一回复「已收录（本次共 N 条）」；超上限回复提示并不再追加（truncated）；无可收集内容时回复「该消息没有可收集的内容」；
  - 收集期间不进入 AI 录单。
- 「结束导出」：无会话 → 提示；空会话 → 提示不建档；有内容 → exportMessagesToFile（个人文件）+ 回复 /dl/ 链接。「取消导出」丢弃会话。
