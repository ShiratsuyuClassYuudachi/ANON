# ANON API 接口文档

基址：开发环境 `http://localhost:4000`，前端经 Vite 代理 `/api`。
除标注「公开」的接口外，均需请求头 `Authorization: Bearer <token>`。

## 通用约定

- 请求/响应均为 JSON（文件上传/下载除外），`Content-Type: application/json`
- 错误响应统一格式，HTTP 状态码 +  body：

```json
{ "error": { "code": "bad_request", "message": "人类可读信息" } }
```

- 常见 code：`bad_request`(400)、`unauthorized`(401)、`forbidden`(403)、`not_found`(404)、`email_taken`/`role_exists`/`role_in_use`/`already_done`(409)、`invite_gone`(410)、`internal`(500)
- 时间字段均为 ISO 8601 字符串（如 `2026-08-01T10:00:00.000Z`），可空字段返回 `null`

## 数据类型

```ts
interface User { id: string; email: string; name: string; isSuperAdmin: boolean; contacts: { platform: string; value: string }[]; onboardedAt: string|null }
interface Role { name: string; permissions: string[] }  // 权限点见下
interface Member { userId: string; name: string; email: string; roleName: string }
interface ProjectSummary { id: string; name: string; description: string; startDate: string|null; endDate: string|null; myRole: string|null }
interface ProjectDetail { id: string; name: string; description: string; startDate: string|null; endDate: string|null; roles: Role[]; createdBy: string }
interface TodoItem {
  id: string; title: string; category: string;
  assignees: { userId: string; name: string }[];
  nodeAt: string|null; dueAt: string|null; remindAt: string|null;
  status: 'open'|'done'; note: string; createdBy: string; createdAt: string;
  completedAt: string|null; completedBy: string|null; completionNote: string|null;
  attachments: { id: string; filename: string }[];
  updates: { note: string; createdBy: string; createdByName: string; createdAt: string; attachments: { id: string; filename: string }[] }[];
}
interface FileMeta { id: string; filename: string; mime: string; size: number }
```

权限点全集：`project:manage`、`member:manage`、`role:manage`、`todo:create`、`todo:manage`、`todo:complete`、`file:upload`、`finance:manage`、`finance:add`、`materials:manage`、`accounts:manage`、`work:manage`、`announcement:manage`、`tools:manage`（`finance:manage` 起为第二阶段新增，`finance:add` 为财务权限拆分新增，`work:manage` 为现场任务单新增，`todo:create` 为待办流程优化新增，`announcement:manage` 为公告管理新增，`tools:manage` 为实用工具新增）。
`project:manage` 等价于拥有全部权限；超级管理员在所有项目中视为拥有全部权限。

预置角色：主办=全部权限；美工/宣发=`file:upload, todo:create, todo:complete, finance:add`；一般staff=`todo:create, todo:complete, finance:add`。既有项目的角色是创建时快照，不含新权限点；可经 `project:manage` 放行或在角色 Tab 勾选补全。

---

## 认证

### POST /api/auth/register（公开）

注册。普通用户必须带有效邀请码；当数据库无任何用户且配置了 `SUPER_ADMIN_EMAIL` 且邮箱匹配时，可不带邀请码注册并自动成为超级管理员。

请求：`{ inviteCode?: string, email: string, name: string, password: string }`（password ≥ 8 位）
响应 201：`{ token: string, refreshToken: string, user: User }`
错误：400 `invalid_invite` / `bad_request`；409 `email_taken` / `email_reserved`（试用账号邮箱保留，见登录）

### POST /api/auth/login（公开）

请求：`{ email: string, password: string }`
响应 200：`{ token: string, refreshToken: string, user: User, trialExpiresAt?: string }`
错误：401 `bad_credentials`；400 `bad_request`（试用密码 < 8 位）；429 `trial_limit`

**试用模式**：邮箱等于 `TRIAL_EMAIL`（默认 `admin@test.com`，置空禁用）且未被真实用户占用时，按 `sha256(trial:<JWT_SECRET>:<password>)` 为 key 进入独立演示环境：首次登录即时播种一套演示数据（试用管理员 + 4 虚拟成员 + 项目「2026 秋季同人展」全模块数据），同密码 24h 内复用同一环境，到期由进程内清扫器（每 10 分钟）级联销毁；响应带 `trialExpiresAt`（ISO 时间）。试用密码要求 ≥ 8 位；活跃试用环境上限 50 个，超出返回 429。

### POST /api/auth/refresh（公开）

用 refresh token 换取新凭证对。refresh token 本身是凭证，无需 Authorization 头。每次刷新轮换：旧 refresh token 立即作废，返回新对；access token 有效期 15 分钟。

请求：`{ refreshToken: string }`
响应 200：`{ token: string, refreshToken: string, user: User }`
错误：400 `bad_request`（缺少 refreshToken）；401 `invalid_refresh`（无效/已过期/已轮换/已吊销）

### POST /api/auth/logout（公开）

吊销 refresh token（登出后该 token 不可再刷新）。无 token 时也返回成功。

请求：`{ refreshToken?: string }`
响应 200：`{ ok: true }`

> 限流：`/api/auth/*`（注册/登录/refresh/logout）每 IP 15 分钟最多 50 次，超出返回 429 `rate_limited`。

---

## 个人资料

### GET /api/me

响应 200：`{ user: User, trialExpiresAt: string | null }`（试用会话返回销毁时间，非试用恒为 `null`）

### PATCH /api/me

请求（均可选）：`{ name?: string, contacts?: { platform: string, value: string }[] }`
响应 200：`{ user: User }`

### POST /api/me/onboarded

标记当前用户已完成新手引导。幂等：仅首次调用写入 `onboardedAt`（当前时间），重复调用不刷新时间戳。
响应 200：`{ user: User }`

---

## 超管后台（需 isSuperAdmin）

### POST /api/admin/invite-codes

请求：`{ code?: string }`（不传则自动生成 `ANON-XXXXXXXX`；自定义 code 最少 6 位）
响应 201：`{ id: string, code: string }`

### GET /api/admin/invite-codes

响应 200：`{ inviteCodes: { id: string, code: string, used: boolean, usedAt: string|null, createdAt: string|null }[] }`

---

## 项目

### POST /api/projects

请求：`{ name: string, description?: string, startDate?: string, endDate?: string }`
响应 201：`{ project: ProjectDetail }`
创建者自动成为成员，角色为「主办」。

### GET /api/projects

响应 200：`{ projects: ProjectSummary[] }`（仅自己参与的）

### GET /api/projects/:id

成员或超管可访问。
响应 200：`{ project: ProjectDetail, members: Member[], myRole: string, myPermissions: string[] }`

### PATCH /api/projects/:id

需 `project:manage`。
请求（均可选）：`{ name?, description?, startDate?, endDate? }`
响应 200：`{ project: ProjectDetail }`

### 角色

- **POST /api/projects/:id/roles**（需 `role:manage`）
  请求 `{ name: string, permissions: string[] }` → 201 `{ roles: Role[] }`；409 `role_exists`；400 未知权限点
- **PATCH /api/projects/:id/roles/:roleName**（需 `role:manage`；roleName 需 URL 编码）
  请求 `{ permissions: string[] }` → 200 `{ roles: Role[] }`
- **DELETE /api/projects/:id/roles/:roleName**（需 `role:manage`）
  → 200 `{ roles: Role[] }`；409 `role_in_use`（仍有成员使用）

### 成员

- **PATCH /api/projects/:id/members/:userId**（需 `member:manage`）
  请求 `{ roleName: string }` → 200 `{ members: Member[] }`；404 成员不存在
- **DELETE /api/projects/:id/members/:userId**（需 `member:manage`）
  → 200 `{ members: Member[] }`；400 不能移除自己

### 邀请

- **POST /api/projects/:id/invites**（需 `member:manage`）
  请求 `{ roleName: string, targetUserId?: string, expiresInHours?: number }`（默认 72 小时，合法范围 1~720）
  响应 201：`{ token: string, url: "/invite/<token>" }`（前端拼 `location.origin + url` 发给对方）
  - 不传 `targetUserId`：开放链接，任何登录用户可接受（一次性）
  - 传 `targetUserId`：仅该用户可接受

### 项目阶段

挂载于 `/api/projects/:id/stages`。变更类端点均需 `project:manage`，统一返回 `{ stages: StageItem[], currentStageIndex }`（stages 按 order 升序；`currentStageIndex` = 第一个未完成阶段的下标，全部完成为 -1）。「当前阶段」由完成态推导，无独立切换端点：标记完成即推进。

```ts
interface StageItem { id: string; name: string; order: number; completedAt: string|null; note: string }
```

- **GET /api/projects/:id/stages**（成员）
  响应 200：`{ stages: StageItem[], currentStageIndex: number }`
- **POST /api/projects/:id/stages**（需 `project:manage`）
  请求 `{ name: string, order?: number }`（不传 order 追加到末尾）。400 名称为空
- **PATCH /api/projects/:id/stages/reorder**（需 `project:manage`）
  请求 `{ orderedIds: string[] }`（全量 id，按新顺序）。400 orderedIds 须为非空数组
- **PATCH /api/projects/:id/stages/:stageId**（需 `project:manage`）
  请求 `{ completedAt?: string|null, note?: string }`（`completedAt: null` 取消完成）。404 阶段不存在
- **DELETE /api/projects/:id/stages/:stageId**（需 `project:manage`）
  删除后关联里程碑自动改为不关联阶段。409 `conflict`（至少需要保留一个阶段）；404 阶段不存在

---

## 邀请接受

### GET /api/invites/:token

响应 200：`{ invite: { projectName: string, roleName: string, expiresAt: string, targeted: boolean } }`
错误：403 指定他人；404 不存在；410 `invite_gone`（已用/过期）

### POST /api/invites/:token/accept

响应 200：`{ ok: true, projectId: string }`（已加入则更新角色）
错误：同 GET

---

## 文件

### POST /api/projects/:id/files

需 `file:upload`。`multipart/form-data`，字段名 `file`（单文件，≤20MB）。
响应 201：`{ file: FileMeta }`

### GET /api/files/:id

该项目成员或超管可下载。响应为文件流（`Content-Disposition: attachment`）。
错误：403 非项目成员；404 不存在

---

## 待办

均挂载在 `/api/projects/:id/todos`，需项目成员身份。

### GET /api/projects/:id/todos

Query（均可选）：
- `category=字符串`、`assignee=<userId>`、`status=open|done`
- `sort=createdAt|dueAt|nodeAt`（默认 createdAt）、`order=asc|desc`（默认 desc）

响应 200：`{ todos: TodoItem[] }`

### POST /api/projects/:id/todos

需 `todo:create`（或 `project:manage`）。
请求：`{ title: string, category?: string, assigneeIds?: string[], nodeAt?: string, dueAt?: string, remindAt?: string, note?: string }`
`assigneeIds` 必须全部为项目成员，否则 400。
响应 201：`{ todo: TodoItem }`；403 无 `todo:create`

### PATCH /api/projects/:id/todos/:todoId

需 `todo:manage`。请求字段同 POST，另可加 `status: 'open'|'done'`（置 open 会清除完成信息）。
响应 200：`{ todo: TodoItem }`

### DELETE /api/projects/:id/todos/:todoId

需 `todo:manage`。响应 200：`{ ok: true }`

### POST /api/projects/:id/todos/:todoId/complete

权限：`todo:manage`，或「当前用户是指派人且有 `todo:complete`」。
`multipart/form-data`：`completionNote?`（文本）、`files`（可多文件，每个 ≤20MB）。
效果：`status=done`，记录完成人/时间/备注，文件入附件。
响应 200：`{ todo: TodoItem }`；409 `already_done`

### POST /api/projects/:id/todos/:todoId/updates

权限与完成相同：`todo:manage`，或「当前用户是指派人且有 `todo:complete`」。
`multipart/form-data`：`note?`（文本）、`files`（可多文件，每个 ≤20MB）。备注与附件至少其一非空，否则 400。
效果：向待办追加一条进度（不可编辑/删除），形成进度时间线；已完成待办返回 409（完成备注承载最终说明）。
响应 201：`{ todo: TodoItem }`；400 空内容 / 403 / 409 `already_done`

### 模板

- **GET /api/projects/:id/todos/template/export**（成员）
  响应 200：

```json
{
  "name": "项目名 待办模板",
  "exportedAt": "…",
  "anchorField": "start|end|export",
  "anchorDate": "…",
  "todos": [{ "title": "…", "category": "…", "note": "…", "nodeOffsetMs": -86400000, "dueOffsetMs": null, "remindOffsetMs": null }]
}
```

  offset = 原时间字段 − 项目锚点时间（毫秒，可为负）。

- **POST /api/projects/:id/todos/template/import**（需 `todo:manage`）
  请求：`{ template: <导出的 JSON>, anchor: "start"|"end", date: "2026-10-01" }`
  以 `date` 为新锚点批量生成待办（无指派人）。
  响应 201：`{ created: number }`

---

## 公告

挂载于 `/api/projects/:id/announcements`，需项目成员身份。管理类端点需 `announcement:manage`（`project:manage` 等价放行）；列表与确认成员即可。
可见范围 `visibility: { userIds: [], roleNames: [] }`：两数组均空 = 全员可见；非空仅列出的用户/角色可见（对管理者同样生效；超管不受限）。

```ts
interface AnnouncementItem {
  id: string; title: string; content: string;
  type: 'normal'|'important'|'emergency';
  isPinned: boolean; requireConfirmation: boolean;
  publishedBy: { userId: string; name: string };
  publishedAt: string; expiresAt: string|null;
  confirmedByMe: boolean;
}
```

- **GET /api/projects/:id/announcements**（成员）
  Query（均可选）：`page`（默认 1）、`limit`（默认 20，上限 50）、`includeExpired=true`（默认排除已过期）。
  排序：置顶优先，其后按发布时间倒序。按当前用户可见范围过滤（`total` 为当前用户可见总数，不泄露不可见公告数量）。
  响应 200：`{ announcements: AnnouncementItem[], total: number, page: number }`
- **POST /api/projects/:id/announcements**（需 `announcement:manage`）
  请求 `{ title: string, content?: string, type?: 'normal'|'important'|'emergency', isPinned?: boolean, requireConfirmation?: boolean, visibility?: Visibility, expiresAt?: string|null }`。
  重要/紧急公告发布时向可见范围内成员发通知。400 标题为空。
  响应 201：`{ announcement: { id: string, title: string } }`
- **PATCH /api/projects/:id/announcements/:announcementId**（需 `announcement:manage`）
  请求字段同 POST（均可选；`expiresAt: null` 清除过期时间）。404 公告不存在。
  响应 200：`{ ok: true }`
- **DELETE /api/projects/:id/announcements/:announcementId**（需 `announcement:manage`）
  同时删除全部确认记录。404 公告不存在。
  响应 200：`{ ok: true }`
- **POST /api/projects/:id/announcements/:announcementId/confirm**（成员，且在可见范围内）
  「我已知悉」确认，幂等不刷新时间戳。403 无权查看；404 公告不存在。
  响应 200：`{ ok: true, confirmedAt: string }`
- **GET /api/projects/:id/announcements/:announcementId/confirmations**（需 `announcement:manage`）
  按项目全体成员拆分为已确认/未确认两组。404 公告不存在。
  响应 200：`{ confirmed: { userId, name }[], unconfirmed: { userId, name }[] }`

---

## 定时提醒（运维）

提醒统一走通知管线（`services/notifications.ts`）：向收件人投递邮件 + Web Push 两个渠道，单渠道失败仅记日志；仅在投递成功后写去重标记，失败下次扫描自动重试。

### POST /api/cron/reminders（公开路径，密钥保护）

请求头：`Authorization: Bearer <CRON_SECRET>`（环境变量配置；未配置返回 503 `cron_disabled`，不匹配 401）。
扫描所有 `status=open` 且 `remindAt <= now`（节点提醒）或 `dueAt <= now`（到期提醒）的待办，通知指派人；同时扫描 3 天内到期的未完成里程碑，通知项目管理者；每条待办每类提醒、每个里程碑只发一次（`ReminderLog` 去重）。
响应 200：`{ sent: number }`
用法示例：`curl -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:4000/api/cron/reminders`（可挂系统 crontab 每分钟执行）

### POST /api/cron/weekly-report（公开路径，密钥保护）

鉴权同上。向活跃项目的管理者发送周报：本周完成待办数、新增风险数、当前阶段进度、下周里程碑；每项目每周只发一次（`WeeklyReportLog` 去重）。
响应 200：`{ sent: number }`

---

## 推送订阅（Web Push）

均挂载在 `/api/push`，需登录。配置 `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`（及可选 `VAPID_SUBJECT`）后，通知事件除邮件外同时向用户已订阅设备推送；未配置时推送渠道静默禁用。设备离线超过 1 天（TTL 86400s）的推送放弃投递，返回 404/410 的失效订阅自动清除。

### GET /api/push/config

响应 200：`{ publicKey: string | null }`（VAPID 公钥；未配置为 `null`，前端据此隐藏订阅入口）

### POST /api/push/subscription

请求：`{ endpoint: string, p256dh: string, auth: string, userAgent?: string（≤300 字） }`
`endpoint` 必须是 https（或 localhost http）；`p256dh`/`auth` 须为 URL-safe base64。同一用户同一 endpoint 幂等 upsert（浏览器重订阅时更新密钥）；每用户最多保留 20 条订阅，超出淘汰最旧。
响应 200：`{ ok: true }`
错误：400 `bad_request`（endpoint 非法 / 密钥格式不符）

### DELETE /api/push/subscription

请求：`{ endpoint: string }`（仅删当前用户名下的该订阅）
响应 200：`{ ok: true, removed: number }`

---

## 财务（第二阶段）

均挂载在 `/api/projects/:id/finance`，需项目成员身份（超管不受限）。
金额在接口内部一律为**整数分**（`amountCents` / `ticketPriceCents`）；创建/编辑时以元（最多两位小数）提交，服务端转换为分。

权限分两级：

- **财务管理者**（`finance:manage` 或 `project:manage`）：可查看/导出/修改全部账目与项目级汇总（盈亏、按人净额、建议转账），可设置门票。
- **记账者**（`finance:add`）：仅可添加账目，且只能看到、修改、删除**自己添加**的账目（`createdBy` = 本人）；看不到项目级汇总（`summary` 为 `null`）；无导出权限。

### 数据类型

```ts
interface TxUser { userId: string; name: string }
interface TransactionItem {
  id: string; type: 'income' | 'expense'; amountCents: number; note: string;
  payer: TxUser;                 // 支出=付款人；收入=收款人
  splitAmong: TxUser[];          // 参与平摊人，空数组 = 全体成员
  createdBy: string; createdByName: string; createdAt: string;
  attachments: { id: string; filename: string }[];
}
interface FinanceSummary {
  ticketPriceCents: number; ticketCount: number;
  ticketIncomeCents: number;     // = ticketPriceCents × ticketCount
  incomeCents: number;           // 记账收入（不含门票）
  expenseCents: number;          // 全部记账支出
  profitCents: number;           // = ticketIncomeCents + incomeCents − expenseCents
  perUser: { userId: string; name: string; netCents: number }[];   // 覆盖全体项目成员
  settlement: { from: TxUser; to: TxUser; amountCents: number }[];
}
```

### 净额与建议转账口径

- 门票收入视为项目公款，不挂在任何成员名下
- expense 由付款人垫付（净额 +金额）；`splitAmong` 非空时仅在平摊人之间均摊（净额 −份额）
- income 视为付款人代收款（净额 −金额）
- 公款池盈余 = 门票收入 + 记账收入 − 全员支出（`splitAmong` 为空的支出），按全体成员均摊并入净额
- 除不尽的余数按成员 userId 排序每人多摊 1 分，保证合计精确
- 建议转账为净额为负者向为正者转账的贪心结算列表；成员净额合计与公款（门票等）的差额由项目公款补齐/回收

### GET /api/projects/:id/finance

账目列表 + 汇总（任一项目成员）。财务管理者见全部账目与完整汇总；`finance:add` 记账者仅见自己添加的账目，且 `summary` 为 `null`。
响应 200：`{ transactions: TransactionItem[], summary: FinanceSummary | null }`（transactions 按创建时间倒序）

### POST /api/projects/:id/finance（finance:manage 或 finance:add）

新建账目。支持两种请求体：

- `application/json`：`{ type: 'income'|'expense', amount: number|string（元，最多两位小数）, note?: string, payerUserId: string, splitAmong?: string[] }`
- `multipart/form-data`：同名字段（`splitAmong` 为 JSON 字符串或逗号分隔）+ `files`（凭证附件，最多 10 个，单个 ≤ 20MB）

校验：`amount` 必须为正且最多两位小数；`payerUserId`、`splitAmong` 必须是项目成员。
响应 201：`{ transaction: TransactionItem }`
错误：400 `bad_request`；403 `forbidden`

### PATCH /api/projects/:id/finance/:txId（finance:manage 或 finance:add）

编辑账目（JSON，字段均可选）：`{ type?, amount?, note?, payerUserId?, splitAmong? }`。不修改附件。
财务管理者可改任意账目；`finance:add` 记账者仅能改自己添加的账目，改他人账目返回 403。
响应 200：`{ transaction: TransactionItem }`
错误：400 `bad_request`；403 `forbidden`；404 `not_found`

### DELETE /api/projects/:id/finance/:txId（finance:manage 或 finance:add）

财务管理者可删任意账目；`finance:add` 记账者仅能删自己添加的账目，删他人账目返回 403。
响应 200：`{ ok: true }`
错误：403 `forbidden`；404 `not_found`

### PATCH /api/projects/:id/finance/ticket（finance:manage）

设置门票价与售票数（存于 Project，实时计入汇总）。
请求：`{ ticketPrice: number|string（元，≥0，最多两位小数）, ticketCount: number（整数，≥0） }`
响应 200：`{ ticketPriceCents: number, ticketCount: number }`
错误：400 `bad_request`；403 `forbidden`

### GET /api/projects/:id/finance/export?userId=（需 `finance:manage`）

导出某成员相关账目（其为付款人、或 `splitAmong` 为空、或其在 `splitAmong` 中）的 CSV。
`userId` 缺省为当前用户；必须是项目成员。仅财务管理者可用，其他身份返回 403。
响应 200：`text/csv; charset=utf-8`，UTF-8 **带 BOM**，`Content-Disposition: attachment`。
列：`日期,类型,金额(元),付款人,参与平摊,备注,添加人`（`参与平摊` 为「全员」或成员名以「、」连接；按创建时间升序）。
错误：400 `bad_request`（userId 非项目成员）

---

## 物料管理（第二阶段）

均挂载在 `/api/projects/:id/materials`，需项目成员身份。查看类操作项目成员即可，增删改需 `materials:manage` 权限。

### 可见范围（visibility）

```ts
interface Visibility { userIds: string[]; roleNames: string[] }
```

- 空（两个数组均为空）= 不限制，走权限点判定。
- 非空 = 仅列出的用户或角色可见；**可见范围优先于权限点**；超级管理员不受限。
- 资源的 visibility 优先于所属类型的 visibility（资源非空用资源的，否则用类型的）。
- 列表接口直接过滤不可见项；单项获取/下载不可见资源返回 403 `forbidden`。

### 数据类型

```ts
interface ResourceTypeItem { id: string; name: string; visibility: Visibility }
interface ResourceItem {
  id: string; typeId: string; name: string; description: string;
  visibility: Visibility; latestVersion: number; hasPreview: boolean; createdAt: string;
}
interface ResourceVersionItem {
  version: number; note: string; hasPreview: boolean;
  createdBy: string; createdAt: string;
  file: { id: string; filename: string; mime: string; size: number } | null;
}
```

### 资源类型

- **GET /api/projects/:id/materials/types**（成员）
  列出可见类型。响应 200：`{ types: ResourceTypeItem[] }`
- **POST /api/projects/:id/materials/types**（materials:manage）
  请求 `{ name: string, visibility?: Visibility }` → 201 `{ type: ResourceTypeItem }`
- **PATCH /api/projects/:id/materials/types/:typeId**（materials:manage）
  请求（均可选）`{ name?: string, visibility?: Visibility }` → 200 `{ type: ResourceTypeItem }`
- **DELETE /api/projects/:id/materials/types/:typeId**（materials:manage）
  → 200 `{ ok: true }`；400 类型下仍有资源

### 资源

- **GET /api/projects/:id/materials**（成员）
  列出可见资源。查询参数：`typeId`（可选，按类型筛选）。响应 200：`{ resources: ResourceItem[] }`
- **POST /api/projects/:id/materials**（materials:manage）
  请求 `{ typeId: string, name: string, description?: string, visibility?: Visibility }` → 201 `{ resource: ResourceItem }`
- **GET /api/projects/:id/materials/:resourceId**
  响应 200：`{ resource: ResourceItem }`；不可见返回 403
- **PATCH /api/projects/:id/materials/:resourceId**（materials:manage）
  请求（均可选）`{ name?, description?, typeId?, visibility? }` → 200 `{ resource: ResourceItem }`
- **DELETE /api/projects/:id/materials/:resourceId**（materials:manage）
  删除资源及其全部版本与文件。响应 200：`{ ok: true }`

### 版本

- **POST /api/projects/:id/materials/:resourceId/versions**（materials:manage）
  multipart 上传新版本，字段：`file`（必填，≤20MB）、`note`（可选）。版本号自动递增并成为当前版。
  mime 为 `image/*` 时自动生成 WebP 预览（宽 ≤800px，体积 ≤100KB，存 `uploads/previews/`）。
  响应 201：`{ version: ResourceVersionItem }`
- **GET /api/projects/:id/materials/:resourceId/versions**（成员 + 可见范围）
  按版本号倒序。响应 200：`{ versions: ResourceVersionItem[] }`
- **GET /api/projects/:id/materials/:resourceId/versions/:version/download**（成员 + 可见范围）
  下载指定版本原文件。响应 200：文件流（`Content-Disposition: attachment`）
- **GET /api/projects/:id/materials/:resourceId/preview**（成员 + 可见范围）
  当前（最新）版本的预览图。响应 200：`image/webp`；无预览但当前版本是图片时回退原图；否则 404 `not_found`

前端说明：项目工作台新增「物料」Tab（`MaterialsTab.tsx`）：类型筛选、资源卡片、预览图、版本下拉与下载、上传新版本、可见范围编辑（成员多选 + 角色多选）。预览图与原图均需鉴权，前端使用 `AuthImg` 组件（fetch + Blob → objectURL）；点击预览图全屏加载原图。

---

## 实物清单

挂载于 `/api/projects/:id/physical`，需登录且为项目成员。查看类操作成员即可；增删改分类与物资条目、数量变动日志均需 `materials:manage`（`project:manage` 等价放行，超管不受限）。实物清单与数字资源相互独立，在「物料」Tab 内通过视图切换访问。

### 数据类型

```ts
type PhysicalItemStatus = 'planned' | 'in_stock' | 'in_use' | 'returned' | 'disposed';
interface PhysicalCategoryItem { id: string; name: string; order: number }
interface PhysicalItemItem {
  id: string; categoryId: string; name: string; spec: string; unit: string;
  plannedQty: number; onHandQty: number; usedQty: number; lostQty: number;
  status: PhysicalItemStatus;
  responsible: { userId: string; name: string } | null;
  location: string; tags: string[]; note: string;
  createdBy: string; createdAt: string; updatedAt: string;
}
interface PhysicalLogItem { id: string; type: string; qty: number; status: PhysicalItemStatus | null; note: string; operator: { userId: string; name: string }; createdAt: string }
interface PhysicalSummary {
  total: { planned: number; onHand: number; used: number; lost: number; count: number };
  byCategory: { categoryId: string; planned: number; onHand: number; used: number; lost: number; count: number }[];
}
```

状态含义：`planned` 计划中、`in_stock` 已入库、`in_use` 使用中、`returned` 已归还、`disposed` 已处置。

### 分类

- **GET /api/projects/:id/physical/categories**（成员）
  列出分类，按 order 升序。首次访问若项目无分类，自动填充默认 6 类（印刷品/设备器材/装饰布置/耗材文具/证件票券/其他）。响应 200：`{ categories: PhysicalCategoryItem[] }`
- **POST /api/projects/:id/physical/categories**（materials:manage）
  请求 `{ name: string }` → 201 `{ category: PhysicalCategoryItem }`
- **PATCH /api/projects/:id/physical/categories/:catId**（materials:manage）
  请求 `{ name?: string }` → 200 `{ category: PhysicalCategoryItem }`
- **DELETE /api/projects/:id/physical/categories/:catId**（materials:manage）
  → 200 `{ ok: true }`；分类下仍有物资时 400 `bad_request`
- **PATCH /api/projects/:id/physical/categories/reorder**（materials:manage）
  请求 `{ order: string[] }`（分类 id 数组，按新顺序）→ 200 `{ categories: PhysicalCategoryItem[] }`

### 物资条目

- **GET /api/projects/:id/physical/items**（成员）
  Query（均可选）：`categoryId`、`status`、`responsibleId`、`tag`、`sort=name|status|plannedQty`、`order=asc|desc`。响应 200：`{ items: PhysicalItemItem[] }`
- **POST /api/projects/:id/physical/items**（materials:manage）
  请求 `{ name: string, categoryId: string, spec?, unit?, plannedQty?, onHandQty?, usedQty?, lostQty?, status?, responsibleId?, location?, tags?: string[], note? }`。数量字段须为非负整数；`responsibleId` 须为项目成员。响应 201：`{ item: PhysicalItemItem }`
- **GET /api/projects/:id/physical/items/:itemId**（成员）→ 200 `{ item: PhysicalItemItem }`；跨项目 404
- **PATCH /api/projects/:id/physical/items/:itemId**（materials:manage）
  字段同 POST（均可选）；`responsibleId` 传 `null`/`""` 清除负责人。响应 200：`{ item: PhysicalItemItem }`
- **DELETE /api/projects/:id/physical/items/:itemId**（materials:manage）
  级联删除该物资的变动日志。响应 200：`{ ok: true }`

### 数量变动与日志

- **POST /api/projects/:id/physical/items/:itemId/log**（需 `materials:manage`）
  请求 `{ type: 'adjust_on_hand'|'adjust_used'|'adjust_lost'|'status_change', delta?: number, status?: PhysicalItemStatus, note? }`。数量类 `delta` 须为整数，结果不能为负；`status_change` 须带合法 `status`。每次成功记录一条日志（`status_change` 日志的 `status` 字段记录目标状态）。响应 200：`{ item: PhysicalItemItem }`
- **GET /api/projects/:id/physical/items/:itemId/logs**（成员）
  按时间倒序，最多 100 条。响应 200：`{ logs: PhysicalLogItem[] }`

### 汇总

- **GET /api/projects/:id/physical/summary**（成员）
  响应 200：`PhysicalSummary`，含总计与按分类聚合的计划/在库/使用/损耗/条目数。


## 平台账号（第二阶段）

挂载于 `/api/projects/:id/accounts`，需登录且为项目成员。查看类操作要求成员身份且通过可见范围（visibility）校验；增删改需 `accounts:manage` 权限。

### 数据模型

- `platform`：平台（QQ/小红书/B站/微博/其他）
- `account`：账号或联系方式
- `mode`：`full`（账号+密码）/ `otp`（仅账号+添加人，便于索取二步验证码）/ `contact`（联系人，无密码）
- `passwordCipher`：仅 full 模式存在。`cipherKeySource: 'user'`（默认）为浏览器端加密密文，格式 `ANONv1:<salt_b64>:<iv_b64>:<data_b64>`（PBKDF2-SHA256 100000 次 + AES-GCM，口令仅存于用户浏览器）；`cipherKeySource: 'server'` 为服务端 AES-256-GCM 密文（密钥 = SHA-256(`PLATFORM_CRYPTO_KEY`，缺省回退 `JWT_SECRET`)）
- `visibility`：`{ userIds: [], roleNames: [] }`，空 = 不限制；非空时仅列出的用户/角色可见，优先于权限点；超管不受限

### GET /api/projects/:id/accounts

成员。查询参数：`platform`（可选筛选）。返回当前用户可见的账号列表（不含密文/明文）。
响应 200：`{ accounts: [{ id, platform, account, mode, cipherKeySource: "user"|"server"|null, hasPassword, note, addedBy: { userId, name, contacts }, visibility, createdAt }] }`

### POST /api/projects/:id/accounts（accounts:manage）

请求：`{ platform, account, mode, note?, visibility? }`。

- mode 为 `full` 时二选一：
  - 浏览器加密（默认）：`{ passwordCipher: "ANONv1:..." }`（前端用保险库口令加密后的密文，服务端原样存储）
  - 服务端加密：`{ cipherKeySource: "server", password: "明文" }`（服务端加密后存储）
- `otp`/`contact` 模式不传密码字段。

响应 201：`{ account }`

### PATCH /api/projects/:id/accounts/:accountId（accounts:manage，且在可见范围内）

可更新 `platform`、`account`、`mode`、`note`、`visibility`；改密码传 `password`（server）或 `passwordCipher`（user，仅 full 模式）；mode 改为非 full 时清除密码。
响应 200：`{ account }`

### DELETE /api/projects/:id/accounts/:accountId（accounts:manage，且在可见范围内）

响应 200：`{ ok: true }`

### POST /api/projects/:id/accounts/:accountId/reveal（成员，且在可见范围内）

仅 full 模式：

- server 模式：响应 200 `{ password: "明文" }`
- user 模式：响应 200 `{ cipher: "ANONv1:..." }`，前端提示输入保险库口令后用 WebCrypto 本地解密

非 full 模式或无密码返回 400 `bad_request`。

---

## 现场任务单

任务模块（现场分工）挂载在 `/api/projects/:id/work-modules`，任务单挂载在 `/api/projects/:id/work-sheet`。均需项目成员身份；模块增删改、代他人确认、查看他人任务单需 `work:manage`（`project:manage` 等价放行，超管不受限）。

### 数据类型

```ts
interface WorkAssignee { userId: string; name: string; confirmedAt: string|null; confirmedBy: string|null }
interface WorkModuleItem {
  id: string; name: string; description: string; location: string;
  startAt: string|null; endAt: string|null; requiredCount: number;
  assignees: WorkAssignee[]; createdBy: string; createdAt: string;
}
interface WorkSheetData {
  project: { id: string; name: string };
  user: { id: string; name: string };
  generatedAt: string;
  items: WorkModuleItem[];   // 分配给该成员的模块
}
```

### GET /api/projects/:id/work-modules

成员。响应 200：`{ modules: WorkModuleItem[] }`（按创建时间升序）

### POST /api/projects/:id/work-modules（work:manage）

请求：`{ name: string（≤100 字）, description?: string, location?: string, startAt?: string, endAt?: string, requiredCount?: number（≥1 整数，默认 1）, assigneeIds?: string[] }`
校验：`name` 必填；`startAt`/`endAt` 须为合法时间且 startAt 不晚于 endAt；`assigneeIds` 必须全部为项目成员。
响应 201：`{ module: WorkModuleItem }`
错误：400 `bad_request`；403 `forbidden`

### PATCH /api/projects/:id/work-modules/:mid（work:manage）

请求字段同 POST（均可选）。`startAt`/`endAt` 需成对提交：任一键出现时两值同时重建，单传其一将把另一清空。替换 `assigneeIds` 时留任成员保留确认记录，被移除者清除。
响应 200：`{ module: WorkModuleItem }`
错误：400 `bad_request`；403 `forbidden`；404 `not_found`（含跨项目 mid）

### DELETE /api/projects/:id/work-modules/:mid（work:manage）

响应 200：`{ ok: true }`
错误：403 `forbidden`；404 `not_found`

### POST /api/projects/:id/work-modules/:mid/confirm

确认成员与模块的分配关系。请求 `{ userId?: string }`：不传 = 确认本人（项目成员即可）；传 = 代他人确认（需 `work:manage` 或 `project:manage`）。记录确认时间与确认人；重复确认幂等，不刷新时间戳。
响应 200：`{ module: WorkModuleItem }`
错误：400 `bad_request`（目标未被分配到该模块）；403 `forbidden`（无权代他人确认）；404 `not_found`

### POST /api/projects/:id/work-modules/:mid/unconfirm

取消确认（清除 confirmedAt/confirmedBy）。请求体与权限同 confirm。
响应 200：`{ module: WorkModuleItem }`

### GET /api/projects/:id/work-sheet

本人的现场任务单（项目成员）。响应 200：`WorkSheetData`（items 按 startAt、createdAt 升序；无分配时为空数组）

### GET /api/projects/:id/work-sheet/:userId（work:manage）

查看指定成员的任务单。响应 200：`WorkSheetData`
错误：403 `forbidden`；404 `not_found`（该用户不是项目成员）

前端说明：项目工作台新增「现场」Tab（`WorkTab.tsx`）：模块列表/新建/编辑/删除、成员确认与代确认、打印入口。打印版式页 `/p/:id/work-sheet/print?user=me|<userId>|all`（`WorkSheetPrint.tsx`）：A4 表格（模块/时间/地点/工作内容/确认状态）+ 签字日期栏，`user=all` 时每人一页分页连排，浏览器打印或另存为 PDF。

## 舞台 Rundown（实用工具）

挂载于 `/api/projects/:id/stage-rundowns`，需登录且为项目成员。查看类操作成员即可；Rundown 与节目的增删改、排序均需 `tools:manage`（`project:manage` 等价放行，超管不受限）。每项目可建多份 Rundown（如 Day1/Day2、主/副舞台）。

### 数据类型

```ts
interface StageParticipant { cn: string; contact: string }
interface StageRundownAttachment { id: string; filename: string; mime: string; size: number }
interface StageRundownItem {
  id: string; name: string; durationMin: number;
  participants: StageParticipant[]; attachments: StageRundownAttachment[]; note: string;
}
interface StageRundown {
  id: string; name: string; startAt: string; note: string;
  items: StageRundownItem[]; createdBy: string; createdAt: string; updatedAt: string;
}
interface StageRundownSummary {
  id: string; name: string; startAt: string; note: string;
  itemCount: number; totalDurationMin: number; createdAt: string; updatedAt: string;
}
```

节目顺序即 `items` 数组下标（无独立 order 字段）；每个节目的起止时间由前端自 `startAt` 逐项累加 `durationMin` 推算。素材文件复用 File 模型与 `GET /api/files/:id` 下载。

### GET /api/projects/:id/stage-rundowns

成员。响应 200：`{ rundowns: StageRundownSummary[] }`（按 `startAt`、`createdAt` 升序；`totalDurationMin` 为全部节目时长之和）

### POST /api/projects/:id/stage-rundowns（tools:manage）

请求：`{ name: string, startAt: string, note?: string }`
校验：`name` trim 后非空；`startAt` 须为可解析时间。
响应 201：`{ rundown: StageRundown }`（items 为空数组）
错误：400 `bad_request`；403 `forbidden`

### GET /api/projects/:id/stage-rundowns/:rid

成员。响应 200：`{ rundown: StageRundown }`（附件已解析为 StageRundownAttachment；缺失文件 id 跳过）
错误：404 `not_found`（含跨项目 rid）

### PATCH /api/projects/:id/stage-rundowns/:rid（tools:manage）

请求字段同 POST（均可选）；`name` 提供但 trim 后为空、`startAt` 提供但不可解析 → 400。
响应 200：`{ rundown: StageRundown }`
错误：400 `bad_request`；403 `forbidden`；404 `not_found`

### DELETE /api/projects/:id/stage-rundowns/:rid（tools:manage）

级联删除全部节目的素材文件（存储对象 + File 文档）。
响应 200：`{ ok: true }`
错误：403 `forbidden`；404 `not_found`

### POST /api/projects/:id/stage-rundowns/:rid/items（tools:manage）

multipart/form-data（`files` 最多 10 个，单个 ≤ 20MB）。字段：
- `name`：必填，trim 后非空
- `durationMin`：必填，1–1440 的整数（否则 400「时长必须为 1–1440 分钟的整数」）
- `participants`：可选，JSON 字符串数组 `[{ cn, contact }]`；解析失败或非数组 400；仅保留 `cn` trim 非空项，`contact` 缺省 `''`
- `note`：可选

上传文件按顺序落库为 File 文档并记为节目附件。
响应 201：`{ item: StageRundownItem }`
错误：400 `bad_request`；403 `forbidden`；404 `not_found`

### PATCH /api/projects/:id/stage-rundowns/:rid/items/:itemId（tools:manage）

multipart/form-data，字段同 POST（均可选），另支持 `removeAttachmentIds`（JSON 字符串数组）：命中的附件从节目移除并级联删除存储对象与 File 文档；新上传文件追加在附件列表末尾。
响应 200：`{ item: StageRundownItem }`
错误：400 `bad_request`；403 `forbidden`；404 `not_found`

### DELETE /api/projects/:id/stage-rundowns/:rid/items/:itemId（tools:manage）

删除节目并级联清理其附件文件。
响应 200：`{ ok: true }`
错误：403 `forbidden`；404 `not_found`

### PATCH /api/projects/:id/stage-rundowns/:rid/items/reorder（tools:manage）

请求：`{ order: string[] }`：必须与现有节目一一对应（长度相等、id 集合完全相同），否则 400「order 必须与现有节目一一对应」。按 order 重排 items 数组。
响应 200：`{ rundown: StageRundown }`
错误：400 `bad_request`；403 `forbidden`；404 `not_found`
