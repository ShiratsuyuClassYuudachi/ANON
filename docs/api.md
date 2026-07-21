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
interface User { id: string; email: string; name: string; isSuperAdmin: boolean; contacts: { platform: string; value: string }[] }
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
}
interface FileMeta { id: string; filename: string; mime: string; size: number }
```

权限点全集：`project:manage`、`member:manage`、`role:manage`、`todo:manage`、`todo:complete`、`file:upload`、`finance:manage`、`materials:manage`、`accounts:manage`（后三项为第二阶段新增）。
`project:manage` 等价于拥有全部权限；超级管理员在所有项目中视为拥有全部权限。

预置角色：主办=全部权限；美工/宣发=`file:upload, todo:complete`；一般staff=`todo:complete`。

---

## 认证

### POST /api/auth/register（公开）

注册。普通用户必须带有效邀请码；当数据库无任何用户且配置了 `SUPER_ADMIN_EMAIL` 且邮箱匹配时，可不带邀请码注册并自动成为超级管理员。

请求：`{ inviteCode?: string, email: string, name: string, password: string }`（password ≥ 8 位）
响应 201：`{ token: string, user: User }`
错误：400 `invalid_invite` / `bad_request`；409 `email_taken`

### POST /api/auth/login（公开）

请求：`{ email: string, password: string }`
响应 200：`{ token: string, user: User }`
错误：401 `bad_credentials`

---

## 个人资料

### GET /api/me

响应 200：`{ user: User }`

### PATCH /api/me

请求（均可选）：`{ name?: string, contacts?: { platform: string, value: string }[] }`
响应 200：`{ user: User }`

---

## 超管后台（需 isSuperAdmin）

### POST /api/admin/invite-codes

请求：`{ code?: string }`（不传则自动生成 `ANON-XXXXXXXX`）
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
  请求 `{ roleName: string, targetUserId?: string, expiresInHours?: number }`（默认 72 小时）
  响应 201：`{ token: string, url: "/invite/<token>" }`（前端拼 `location.origin + url` 发给对方）
  - 不传 `targetUserId`：开放链接，任何登录用户可接受（一次性）
  - 传 `targetUserId`：仅该用户可接受

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

任何成员可创建。
请求：`{ title: string, category?: string, assigneeIds?: string[], nodeAt?: string, dueAt?: string, remindAt?: string, note?: string }`
`assigneeIds` 必须全部为项目成员，否则 400。
响应 201：`{ todo: TodoItem }`

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

## 定时提醒（运维）

### POST /api/cron/reminders（公开路径，密钥保护）

请求头：`Authorization: Bearer <CRON_SECRET>`（环境变量配置；未配置返回 503 `cron_disabled`，不匹配 401）。
扫描所有 `status=open` 且 `remindAt <= now`（节点提醒）或 `dueAt <= now`（到期提醒）的待办，向指派人注册邮箱发信；每条待办每类提醒只发一次。
响应 200：`{ sent: number }`
用法示例：`curl -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:4000/api/cron/reminders`（可挂系统 crontab 每分钟执行）

---

## 财务（第二阶段）

均挂载在 `/api/projects/:id/finance`，需项目成员身份（超管不受限）。
金额在接口内部一律为**整数分**（`amountCents` / `ticketPriceCents`）；创建/编辑时以元（最多两位小数）提交，服务端转换为分。增删改需 `finance:manage` 权限；查看与导出任一项目成员即可。

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

账目列表 + 汇总（任一项目成员）。
响应 200：`{ transactions: TransactionItem[], summary: FinanceSummary }`（transactions 按创建时间倒序）

### POST /api/projects/:id/finance（finance:manage）

新建账目。支持两种请求体：

- `application/json`：`{ type: 'income'|'expense', amount: number|string（元，最多两位小数）, note?: string, payerUserId: string, splitAmong?: string[] }`
- `multipart/form-data`：同名字段（`splitAmong` 为 JSON 字符串或逗号分隔）+ `files`（凭证附件，最多 10 个，单个 ≤ 20MB）

校验：`amount` 必须为正且最多两位小数；`payerUserId`、`splitAmong` 必须是项目成员。
响应 201：`{ transaction: TransactionItem }`
错误：400 `bad_request`；403 `forbidden`

### PATCH /api/projects/:id/finance/:txId（finance:manage）

编辑账目（JSON，字段均可选）：`{ type?, amount?, note?, payerUserId?, splitAmong? }`。不修改附件。
响应 200：`{ transaction: TransactionItem }`
错误：400 `bad_request`；403 `forbidden`；404 `not_found`

### DELETE /api/projects/:id/finance/:txId（finance:manage）

响应 200：`{ ok: true }`
错误：403 `forbidden`；404 `not_found`

### PATCH /api/projects/:id/finance/ticket（finance:manage）

设置门票价与售票数（存于 Project，实时计入汇总）。
请求：`{ ticketPrice: number|string（元，≥0，最多两位小数）, ticketCount: number（整数，≥0） }`
响应 200：`{ ticketPriceCents: number, ticketCount: number }`
错误：400 `bad_request`；403 `forbidden`

### GET /api/projects/:id/finance/export?userId=（成员）

导出某成员相关账目（其为付款人、或 `splitAmong` 为空、或其在 `splitAmong` 中）的 CSV。
`userId` 缺省为当前用户；必须是项目成员。
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
