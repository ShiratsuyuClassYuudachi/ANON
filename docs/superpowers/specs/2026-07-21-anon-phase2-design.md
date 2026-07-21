# ANON 第二阶段设计：财务 + 物料管理 + 账号管理

日期：2026-07-21
状态：用户指示「并行完成其他功能」，三条 worktree 分支并行开发

## 范围与共同约定

实现 `docs/design.md` 中尚未落地的三个模块：财务模块、物料管理（文件管理）、账号管理（平台账号）。均遵循第一阶段既有约定：

- 后端 routes → services → models 分层；模型幂等注册（`mongoose.models.X ?? model(...)`）
- 错误统一 `AppError` + `{ error: { code, message } }`；`ah()` 包裹异步
- 权限中间件 `requirePermission(...)`；`project:manage` 等价全部权限（故「主办」及超管自动获得所有新权限点，无需数据迁移）
- 新增权限点（并入 `ALL_PERMISSIONS`）：`finance:manage`、`materials:manage`、`accounts:manage`。查看类操作默认项目成员即可，增删改需对应 manage 权限
- 前端：项目工作台新增 Tab（财务 / 物料 / 账号），沿用现有卡片风格与 `api()`/`downloadFile()`
- 可见范围（visibility）：`{ userIds: ObjectId[], roleNames: string[] }`，空 = 不限制（走权限点）；非空时仅列出的用户或角色可见，**可见范围优先于权限点**（超管不受限）
- 各分支不改 `docs/progress.md`、`docs/readme.md`、`docs/design.md`（合并后统一更新）；API 文档写在 `docs/api-<module>.md`，合并时并入 `docs/api.md`
- 金额一律用**整数分**（`amountCents`），前端输入元转换为分

## 财务模块（分支 feat/finance）

### 数据模型

- **Transaction**：`projectId`、`type: 'income'|'expense'`、`amountCents: number`、`note`、`createdBy`、`payerUserId`（实际付款人）、`splitAmong: ObjectId[]`（参与平摊人，空=全员）、`attachments: ObjectId[]→File`、timestamps
- **Project** 增加字段：`ticketPriceCents: number（默认0）`、`ticketCount: number（默认0）`（在项目设置/财务 Tab 维护）

### API

- `GET /api/projects/:id/finance`（成员）→ `{ transactions: [...], summary }`
- `POST /api/projects/:id/finance`（finance:manage）：body `{ type, amount（元，两位小数）, note?, payerUserId, splitAmong?, attachments? }`
- `PATCH/DELETE /api/projects/:id/finance/:txId`（finance:manage）
- `PATCH /api/projects/:id/finance/ticket`（finance:manage）：`{ ticketPrice（元）, ticketCount }`
- `GET /api/projects/:id/finance/export?userId=`（成员）→ `text/csv`（UTF-8 带 BOM），导出该用户相关账目
- **summary 计算**（`services/finance.ts`）：
  - `ticketIncome = ticketPriceCents × ticketCount`
  - `totalIncome/totalExpense`（含门票收入计入 income 侧）、`profit = ticketIncome + income − expense`
  - 按人净额：每条 expense 由 payer 垫付，splitAmong（空=全体成员）平摊；income 先入 payer 账（简化：income 视为 payer 收款）。净额 = 实付 − 应摊
  - 盈亏分配：profit 按全体成员均摊并入净额
  - **建议转账**：净额为负者向为正者转账的贪心结算列表 `[{ from, to, amountCents }]`

### 前端「财务」Tab

门票设置卡片、记账表单（类型/金额/付款人/平摊人/备注/凭证附件）、账目列表、汇总卡片（盈亏、按人净额、建议转账）、按人导出 CSV 按钮。

## 物料管理（分支 feat/materials）

### 数据模型

- **ResourceType**：`projectId`、`name`、`visibility`
- **Resource**：`projectId`、`typeId`、`name`、`description`、`visibility`
- **ResourceVersion**：`resourceId`、`version: number`（递增）、`fileId→File`、`previewPath: string|null`（图片时生成）、`note`、`createdBy`、timestamps

### 行为

- 类型/资源 CRUD（materials:manage）；资源多版本：上传新版本 version+1 且成为当前版；展示默认最新版，可选历史版本下载
- 图片（mime image/*）上传时用 **sharp** 生成 WebP 预览（宽 ≤800，质量使体积 ≤100KB，存 uploads/previews/）；列表加载预览，点击加载原图（前端 fetch+Blob，复用 downloadFile 思路做 AuthImg）
- 可见范围：类型或资源设置 visibility 后，仅可见成员能在列表/下载中看到；资源的 visibility 优先于类型，类型优先于权限点

### API

- `GET/POST /api/projects/:id/materials/types`、`PATCH/DELETE .../types/:typeId`
- `GET/POST /api/projects/:id/materials`、`GET/PATCH/DELETE .../materials/:resourceId`
- `POST .../materials/:resourceId/versions`（multipart 上传新版本）、`GET .../materials/:resourceId/versions`
- `GET /api/projects/:id/materials/:resourceId/preview`（当前版预览图，无预览则 404 或原图）

### 前端「物料」Tab

类型侧栏/筛选、资源卡片（预览图）、上传新版本、版本下拉、点击放大原图、可见范围设置（成员多选 + 角色多选）。

## 账号管理（分支 feat/accounts）

### 数据模型

- **PlatformAccount**：`projectId`、`platform: string`（QQ/小红书/B站/微博/其他）、`account: string`、`mode: 'full'|'otp'|'contact'`、`passwordCipher: string|null`、`cipherKeySource: 'user'|'server'|null`、`note`、`addedBy`、`visibility`、timestamps
  - `full`：完整账号（含密码）；`otp`：仅记录账号+添加人（便于索取二步验证码）；`contact`：仅联系人记录（无密码）
- 加密：
  - **user（默认）**：浏览器内用用户自设「保险库口令」PBKDF2(SHA-256, 100000 次) + AES-GCM 加密，密文格式 `ANONv1:<salt_b64>:<iv_b64>:<data_b64>`，服务端只存密文、不存口令；查看时前端取密文本地解密
  - **server（可选旧版兼容）**：服务端用 `PLATFORM_CRYPTO_KEY`（缺省回退 `JWT_SECRET`）SHA-256 派生密钥 AES-256-GCM 加解密；查看时调接口解密返回明文

### API

- `GET/POST /api/projects/:id/accounts`（查看=成员+visibility；增改删=accounts:manage）
- `PATCH/DELETE .../accounts/:accountId`
- `POST /api/projects/:id/accounts/:accountId/reveal` → server 模式返回 `{ password }`；user 模式返回 `{ cipher }`（前端本地解密）

### 前端「账号」Tab

平台筛选、三种模式新建表单（full 模式可选「服务端密钥加密」，默认浏览器加密+保险库口令）、查看密码（user 模式弹口令框用 WebCrypto 解密；server 模式调 reveal）、OTP 模式展示添加人联系方式、可见范围设置。

## 验收

1. 三个分支各自：后端测试全绿（含新模块测试）、前端 build 通过
2. 合并后：全量测试 + 前后端 build 通过
3. 冒烟：记账→汇总→建议转账；传图→预览→版本切换；建账号（两种加密）→查看密码
