# ANON

ANON 是一个「活动全流程追踪」协作系统。第一阶段已实现：用户认证（邀请码注册制 + 首超管引导）、项目与角色权限、成员邀请链接、文件上传与鉴权下载、待办模块（CRUD / 筛选 / 排序 / 完成带附件 / 模板导入导出）、到期与节点提醒（cron 接口 + SMTP 存根）。

完整接口契约见 [`docs/api.md`](./api.md)；设计说明见 [`docs/design.md`](./design.md)；迭代日志见 [`docs/progress.md`](./progress.md)。

## 环境要求

- Node.js 20+
- Docker（**可选**）：`docker compose up -d` 启动 mongo:7 是最省事的本地数据库方式；也可以用任意本地/远程 MongoDB（把 `MONGO_URI` 指过去即可）。后端单元测试使用 `mongodb-memory-server`（devDependency，自动下载内存版 mongod），不依赖 Docker。

## 快速开始

```bash
# 1. 启动 MongoDB（二选一）
docker compose up -d                                  # 方式 A：Docker
# 或者使用任何已有的 MongoDB，记下连接串              # 方式 B

# 2. 配置环境变量
cp backend/.env.example backend/.env
# 按需修改：JWT_SECRET 填随机串；SUPER_ADMIN_EMAIL 设为首个管理员邮箱；
# 如用方式 B，修改 MONGO_URI

# 3. 启动后端（默认 4000 端口）
cd backend && npm install && npm run dev

# 4. 另开终端，启动前端（默认 5173 端口，/api 代理到 4000）
cd frontend && npm install && npm run dev

# 5. 浏览器打开 http://localhost:5173
#    用 SUPER_ADMIN_EMAIL 注册首个账号（无需邀请码，自动成为超管）
#    → 在「管理」页创建邀请码 → 其他用户凭码注册
```

## 环境变量（backend/.env）

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `MONGO_URI` | 是（有默认值 `mongodb://localhost:27017/anon`） | MongoDB 连接串 |
| `JWT_SECRET` | 生产必填 | JWT 签名密钥；生产环境未配置会拒绝启动，开发环境用不安全的默认值 |
| `PORT` | 否 | 后端监听端口，默认 4000 |
| `UPLOAD_DIR` | 否 | 上传文件存储目录，默认 `uploads`（已 gitignore） |
| `CRON_SECRET` | 提醒功能必填 | cron 提醒接口的 Bearer 密钥；未配置时该接口返回 503 |
| `SUPER_ADMIN_EMAIL` | 否 | 首个超管邮箱：数据库无用户时，该邮箱注册无需邀请码并自动成为超管 |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | 否 | SMTP 发信配置；未配置 `SMTP_HOST` 时邮件退化为控制台日志（存根） |

## cron 提醒

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  http://localhost:4000/api/cron/reminders
# → {"sent": <本次发送条数>}
```

扫描所有 `status=open` 且 `remindAt <= now`（节点提醒）或 `dueAt <= now`（到期提醒）的待办，向指派人邮箱发信；每条待办每类提醒只发一次（`ReminderLog` 去重）。可挂系统 crontab 每分钟执行。

## 测试与构建

```bash
cd backend  && npm test          # vitest + mongodb-memory-server（无需 Docker/真实 Mongo）
cd backend  && npm run typecheck # tsc --noEmit
cd backend  && npm run build     # tsc 输出到 dist/
cd frontend && npm run build     # vite build（含 tsc）
```

## 端到端冒烟（无 Docker）

冒烟脚本（基于 `mongodb-memory-server`）已在 Task 15 验证过一遍完整流程：首超管注册 → 建邀请码 → 第二用户注册 → 建项目 → 建邀请 → 接受 → 建待办（指派 + 已过期 dueAt）→ 带附件完成 → 模板导出/导入 → cron 提醒 → 文件下载。步骤与实测输出见 `.superpowers/sdd/task-15-report.md`。核心 curl 流程（假设后端已用内存 Mongo 启动）：

```bash
# 1. 首超管注册（无邀请码）
curl -X POST localhost:4000/api/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"admin@test.com","name":"Admin","password":"password123"}'
# → 201 {"token":"...","user":{"email":"admin@test.com","isSuperAdmin":true,...}}

# 2. 建邀请码
curl -X POST localhost:4000/api/admin/invite-codes \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{}'
# → 201 {"id":"...","code":"ANON-XXXXXXXX"}

# 3. 第二用户凭码注册 → 4. 建项目 → 5. 建邀请 → 6. 第二用户接受
# 7. 建待办（assigneeIds=[第二用户], dueAt=过去时间）
# 8. POST /api/projects/:id/todos/:todoId/complete（curl -F completionNote=... -F files=@file）
# 9. GET /api/projects/:id/todos/template/export → POST .../template/import
# 10. POST /api/cron/reminders -H "Authorization: Bearer $CRON_SECRET" → {"sent":1}
# 11. GET /api/files/:id -H "Authorization: Bearer $TOKEN" → 200 文件流
```

## 备注

- 权限模型中的「可见范围」字段在 File 模型中已预留，第一阶段不启用。
- `backend/uploads/` 与 `backend/.env` 均已 gitignore，勿提交。
