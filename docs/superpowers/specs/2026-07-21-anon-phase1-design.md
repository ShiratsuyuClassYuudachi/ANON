# ANON 第一阶段设计：地基 + 进度追踪/待办模块

日期：2026-07-21
状态：已与用户确认

## 背景与范围

`docs/design.md` 描述了完整系统（财务、进度追踪、物料管理、账号管理、权限）。本仓库目前仅有该设计文档，代码为零。经与用户确认采用**分阶段**策略，第一阶段交付：

- 地基：仓库结构、认证/用户、项目与权限、文件上传基础设施
- 第一个业务模块：**进度追踪/待办**

明确不做（后续阶段）：财务模块、物料/账号管理、门票盈亏、CSV 导出、WebP 预览图、保险库加密、除邮件外的推送。

## 方案

两个独立文件夹 + 根目录轻量编排（拒绝 npm workspaces / turborepo，保持简单并符合设计文档"两个独立文件夹"的要求）。

## 仓库结构

```
/
├── backend/            # Express + TypeScript + Mongoose
│   ├── src/
│   │   ├── index.ts        # 入口：连接 Mongo、启动 HTTP
│   │   ├── app.ts          # express 应用装配（便于测试）
│   │   ├── config.ts       # 环境变量解析与校验
│   │   ├── models/         # Mongoose 模型
│   │   ├── routes/         # 路由层（按资源分文件）
│   │   ├── services/       # 业务逻辑（邀请、结算、提醒等）
│   │   ├── middleware/     # auth、错误处理、上传
│   │   └── utils/
│   ├── tests/              # vitest + supertest
│   └── uploads/            # 上传文件（gitignore）
├── frontend/           # Vite + React + TypeScript
│   └── src/
│       ├── main.tsx / App.tsx
│       ├── api/            # fetch 封装
│       ├── pages/          # 登录/注册、项目列表、项目工作台、个人资料、管理后台
│       ├── components/
│       ├── theme.tsx       # 日/夜主题
│       └── index.css       # 移动端优先、CSS 变量
├── docker-compose.yml  # mongo:7（+ mongo-express 可选 profile）
├── docs/
└── .gitignore
```

## 后端设计

### 技术要点

- Express 4 + TypeScript（tsx 开发、 tsc 构建）
- Mongoose 连接 MongoDB（开发由 docker-compose 提供）
- JWT Bearer 鉴权，`JWT_SECRET` 必填；bcrypt cost 12 存 `passwordHash`
- 统一错误中间件：错误响应为 `{ error: { code, message } }`
- 文件上传：multer → `backend/uploads/`，静态访问走鉴权接口 `/api/files/:id`
- 分层：routes（参数校验、HTTP）→ services（业务）→ models（持久化）

### 数据模型

- **User**：`email`(唯一)、`name`、`passwordHash`、`isSuperAdmin`、`contacts: [{ platform, value }]`、`inviteCodeId`（注册所用邀请码）
- **InviteCode**：`code`(唯一)、`createdBy`、`usedBy`、`usedAt`
- **Project**：`name`、`description`、`startDate`、`endDate`、`createdBy`、`roles: [{ name, permissions: string[] }]`（含预置角色副本，可改）
- **Membership**：`projectId`、`userId`、`roleName`，唯一索引 (projectId, userId)
- **ProjectInvite**：`projectId`、`token`(唯一)、`targetUserId?`（指定账户）/ null（开放链接）、`roleName`、`expiresAt`、`acceptedBy`、`acceptedAt`
- **Todo**：`projectId`、`title`、`category`、`assigneeIds: []`、`nodeAt?`、`dueAt?`、`remindAt?`、`status`(open/done)、`note`、`createdBy`、`completedAt`、`completedBy`、`completionNote`、`attachments: [ObjectId→File]`
- **File**（独立 collection，供 `/api/files/:id` 鉴权解析）：`projectId`、`filename`、`path`、`mime`、`size`、`uploadedBy`
- **EmailOutbox / 提醒发送记录**：防止 cron 重复发送（`todoId + kind` 唯一）

权限点（字符串）：`project:manage`、`member:manage`、`role:manage`、`todo:manage`（增删改任意待办）、`todo:complete`（完成指派给自己的）、`file:upload` 等。预置角色：
- 主办（管理）：全部
- 美工：`file:upload`、`todo:complete`
- 宣发：`file:upload`、`todo:complete`
- 一般 staff：`todo:complete`

可见范围（visibility）字段在 FileRef/后续模型中预留 `{ users: [], roles: [] }`，本阶段不启用逻辑。

### API 概要

- `POST /api/auth/register`（inviteCode + email + name + password）
- `POST /api/auth/login` → `{ token, user }`
- `GET/PATCH /api/me`（含 contacts）
- `POST/GET /api/admin/invite-codes`（超管）
- `POST /api/projects`、`GET /api/projects`（我的）、`GET/PATCH /api/projects/:id`
- `GET/POST /api/projects/:id/invites`（生成链接，可指定用户）、`POST /api/invites/:token/accept`
- `GET/PATCH/DELETE /api/projects/:id/members/:userId`、`GET/POST/PATCH/DELETE /api/projects/:id/roles`
- `GET/POST /api/projects/:id/todos`（筛选 `category` `assignee`，排序 `sort=dueAt|nodeAt|createdAt`）、`PATCH /api/projects/:id/todos/:todoId`、`POST .../complete`（备注+附件）
- `GET /api/projects/:id/todos/template/export`、`POST /api/projects/:id/todos/template/import`（JSON；import 锚定 `anchor=start|end` + 目标日期，按相对偏移生成）
- `POST /api/cron/reminders`（`Authorization: Bearer $CRON_SECRET`）：扫描 `remindAt <= now` 未发送的待办，发邮件并记录
- `GET /api/files/:id`（鉴权 + 项目成员校验）

### 邮件

`services/mailer.ts`：读取 `SMTP_HOST/PORT/USER/PASS/FROM`。未配置时 `sendMail` 记日志并返回（不报错），保证功能可跑通。

### 配置

`.env`（gitignore）+ `.env.example`：`MONGO_URI`、`JWT_SECRET`、`PORT`、`UPLOAD_DIR`、`CRON_SECRET`、`SUPER_ADMIN_EMAIL`、SMTP 系列。启动时校验必填项。

## 前端设计

- Vite + React 18 + TS + React Router，不引入 UI 框架；自写 CSS 变量主题（`--surface`、`--input-bg` 等），日/夜切换按钮固定右上，`localStorage` 键 `anon-theme`，`index.html` 内联脚本防闪烁
- 移动端优先：单列卡片布局，底部留白；≥768px 才分栏
- `api/client.ts`：fetch 封装，自动带 token，401 清 token 跳登录，统一解包错误
- 页面：
  - `/login`、`/register`（邀请码）
  - `/projects`（列表 + 新建）
  - `/p/:id` 项目工作台：tab = 待办 / 成员 / 角色 / 设置；待办支持筛选排序、新建、完成（备注+附件）、模板导出/导入
  - `/invite/:token` 接受邀请
  - `/me` 个人资料（联系方式）
  - `/admin` 邀请码管理（仅超管可见入口）

## 错误处理

- 后端：业务错误抛 `AppError(code, httpStatus, message)`，错误中间件统一输出；未捕获错误 500 且不泄露堆栈
- 前端：api client 抛带 message 的 Error，页面级 toast/内联提示

## 测试

- 后端：vitest + supertest + `mongodb-memory-server`（与开发用 Docker Mongo 互不依赖）
- 覆盖：认证（邀请码校验、登录）、权限（非成员 403、角色权限点）、待办 CRUD/筛选/完成、模板导入偏移计算、邀请链接接受流程
- 前端：无单测，门槛为 `tsc --noEmit` + `vite build` 通过

## 文档与工程约束（来自 design.md，须遵守）

- 每次功能更新记录 `docs/progress.md`（含修改的文件与代码位置）
- 维护 `docs/readme.md`（环境变量、启动命令）
- `docs/design.md` 的「实现与变更记录」节同步摘要
- `.gitignore`：`node_modules`、`dist`、`uploads`、`.env`
- 本项目初始化 git 仓库（当前无 .git）

## 验收标准

1. `docker compose up -d` 起 Mongo 后，`backend` 可 `npm run dev` 启动并通过健康检查
2. 完整走通：超管建邀请码 → 注册用户 → 建项目 → 邀请成员（开放链接）→ 成员接受 → 建待办（类别/指派/节点/到期）→ 完成待办（备注+附件）→ 模板导出/导入
3. `npm test`（backend）全绿；`frontend` 构建通过
4. 移动端视口下主要页面可用
