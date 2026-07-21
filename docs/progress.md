# 迭代日志

## 2026-07-21 第一阶段：地基 + 待办模块

依据 `docs/superpowers/plans/2026-07-21-anon-phase1.md`（15 个任务）落地。后端 33 个 vitest 用例全绿（mongodb-memory-server），前端 `vite build` 通过。

### Task 1：后端脚手架
- `backend/src/{config,app,index}.ts`：Express + TypeScript + Mongoose，dotenv 配置，健康检查 `GET /api/health`
- `backend/src/utils/{async,errors,jwt}.ts`、`backend/src/middleware/errorHandler.ts`：统一异步包装与错误格式
- `backend/vitest.config.ts`、`backend/tests/{setup,helpers}.ts`：vitest + mongodb-memory-server 测试基座

### Task 2：认证与用户
- `backend/src/models/User.ts`：bcrypt（cost 12）哈希密码、contacts、isSuperAdmin
- `backend/src/models/InviteCode.ts`、`backend/src/routes/auth.ts`：注册（邀请码校验 / 首超管引导：`SUPER_ADMIN_EMAIL` 匹配且库内无用户时免邀请码并自动超管）与登录
- `backend/src/middleware/auth.ts`：JWT 认证中间件

### Task 3：个人资料与超管后台
- `backend/src/routes/me.ts`：`GET/PATCH /api/me`（姓名、联系方式）
- `backend/src/routes/admin.ts`：邀请码创建/列表（需超管）

### Task 4：项目与权限
- `backend/src/models/{Project,Membership}.ts`
- `backend/src/services/permissions.ts`：预置角色（主办/美工/宣发/staff）与权限点
- `backend/src/middleware/projectAccess.ts`：成员/权限校验中间件
- `backend/src/routes/projects.ts`：项目 CRUD、自定义角色、成员改角色/移除

### Task 5：项目邀请链接
- `backend/src/models/ProjectInvite.ts`、`backend/src/routes/invites.ts`：指定/开放邀请（token、72h 默认过期、一次性）、查看与接受

### Task 6：文件上传与鉴权下载
- `backend/src/models/File.ts`（可见范围字段预留，暂不启用）、`backend/src/middleware/upload.ts`（multer，≤20MB）
- `backend/src/routes/files.ts`：项目内上传、成员/超管鉴权下载

### Task 7：待办 CRUD
- `backend/src/models/Todo.ts`、`backend/src/routes/todos.ts`：CRUD、assigneeIds 成员校验、筛选（category/assignee/status）、排序（createdAt/dueAt/nodeAt）

### Task 8：完成流程
- `POST /api/projects/:id/todos/:todoId/complete`（todos.ts）：multipart 备注 + 多附件，记录完成人/时间，重复完成 409

### Task 9：模板导入导出
- `backend/src/services/template.ts`：导出 offset 化 JSON；导入按锚点（项目开始/结束日期）批量重算生成

### Task 10：提醒
- `backend/src/models/ReminderLog.ts`（每条待办每类提醒只发一次）
- `backend/src/services/mailer.ts`：SMTP 存根（未配置 `SMTP_HOST` 时打日志）
- `backend/src/routes/cron.ts`：`POST /api/cron/reminders`（`CRON_SECRET` Bearer 保护）

### Task 11–14：前端
- 脚手架与主题：`frontend/src/{main,App,theme}.tsx`、`index.css`（日/夜切换）、`api/client.ts`（JWT 封装）、`components/Layout.tsx`
- 页面：`pages/{Login,Register,Projects,ProjectHome,InviteAccept,Me,Admin}.tsx` + `components/project/`（项目工作台四 Tab：概览/待办/成员/文件）
- 超管后台邀请码管理、邀请接受页、个人资料维护

### Task 15：文档与收尾
- `docs/readme.md`（快速开始 / 环境变量表 / cron / 冒烟）、本文件、`docs/design.md` 追加「2026-07-21 第一阶段落地」
- 端到端冒烟（mongodb-memory-server，无 Docker）：全流程 11 步通过，详见 `.superpowers/sdd/task-15-report.md`

### 工程
- `docker-compose.yml`（mongo:7，可选）、`.gitignore`（含 `backend/.env`、`backend/uploads/`）、`docs/api.md`（全量接口契约）
