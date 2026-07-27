# ANON

ANON 是一个「活动全流程追踪」协作系统，面向展会/同人活动/演出等组织团队。功能：

- **账号与权限**：邀请码注册制（首超管引导）、项目内预置/自定义角色与权限点、成员邀请链接；资源可见范围优先于权限点
- **待办**：CRUD / 筛选 / 排序 / 完成带附件 / 模板导入导出 / 到期与节点邮件提醒（cron + SMTP）
- **财务**：收支记账、多票种门票盈亏、按人净额与转账建议、CSV 导出
- **物料**：类型 / 多版本 / WebP 预览 / 可见范围
- **账号**：三模式平台账号（完整 / OTP 辅助 / 联系人），浏览器端或服务端加密
- **现场**：任务模块分工（名称/时间/地点/所需人力/分配成员）、成员确认、可打印任务单（含签字栏，浏览器另存 PDF）
- **新手引导 / 内置帮助文档（/help）**：首登欢迎幻灯 + 界面高亮导览（按账号跨设备只弹一次，可重看）；/help 为 7 章图文手册（配真实截图，点击放大）

界面：移动端优先，双风格主题（简洁/明快 × 日/夜），工作台 Tab 与按钮按项目内权限点过滤可见性。

完整接口契约见 [`docs/api.md`](./api.md)；功能使用指南见 [`docs/features.md`](./features.md)；设计说明见 [`docs/design.md`](./design.md)。

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

局域网内其他设备访问：`cd frontend && npm run dev -- --host 0.0.0.0`，然后访问 `http://<本机局域网 IP>:5173`（API 由 Vite 代理转发，无需额外开放后端端口）。

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
| `PLATFORM_CRYPTO_KEY` | 否 | 平台账号「服务端加密」模式的密钥源（SHA-256 派生 AES-256-GCM 密钥）；缺省回退 `JWT_SECRET`。浏览器端 ANONv1 加密（默认）不依赖此项 |

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
cd frontend && npm run build     # vite build（含 tsc --noEmit）
```

生产部署：`npm run build` 后，后端 `node dist/index.js`，前端 `dist/` 为静态文件（任意静态托管或 `npx vite preview`）。

## 端到端冒烟

核心 curl 流程（后端已启动时）：

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
# 10. POST /api/cron/reminders -H "Authorization: Bearer $CRON_SECRET" → {"sent":0}
# 11. GET /api/files/:id -H "Authorization: Bearer $TOKEN" → 200 文件流
```

## 备注

- 「可见范围」（物料类型/资源、平台账号）优先于权限点；File 模型的预留字段仍未启用。
- 前端技术栈：Vite + React + TypeScript + Tailwind CSS v4（`@tailwindcss/vite`）+ shadcn/ui（`frontend/components.json`，new-york / neutral）+ lucide-react + sonner；主题双风格（简洁/明快 × 日/夜）保存在本机 localStorage（`anon-theme` / `anon-style`）。
- 运维约束：新增 shadcn 组件必须使用 `npx shadcn@3`（v4 CLI 移除了 `--base-color` 参数，与当前 `components.json` 不兼容）。
- `backend/uploads/` 与 `backend/.env` 均已 gitignore，勿提交。
- `/help` 帮助文档的界面截图存于 `frontend/public/help/`；界面变动后用 Playwright 重生成：`PLAYWRIGHT_BROWSERS_PATH=<浏览器目录> node frontend/scripts/capture-help-screenshots.mjs`（需前端 dev 服务器运行中）。
