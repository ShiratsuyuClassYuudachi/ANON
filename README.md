# ANON

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

面向活动（展会、同人活动、演出等）组织团队的全流程追踪与协作工具。以「项目」为单位组织协作，覆盖任务进度、财务收支、物料文件、平台账号与现场分工五大场景，移动端优先。

> **名字由来**：**A**ctivities, **N**eatly **O**rganized & **N**oted——「活动，被井然地组织与记录」。也呼应 *anonymous*：平台账号密码默认在浏览器端加密，服务端零明文。

## 功能亮点

- **待办**：筛选/排序/完成带附件/模板导入导出/到期邮件提醒
- **财务**：收支记账、多票种门票盈亏、按人净额与转账建议、CSV 导出
- **物料**：类型/多版本/WebP 预览/可见范围
- **账号**：三模式平台账号（完整/OTP 辅助/联系人），浏览器端或服务端加密
- **现场**：任务模块分工、成员确认、可打印任务单（含签字栏，另存 PDF）
- **协作与权限**：邀请码注册、项目角色与权限点、可见范围优先、按权限过滤界面
- **体验**：双风格主题（简洁/明快 × 日/夜）、新手引导、内置图文帮助文档（/help）

## 技术栈

- **后端**：Express 4 + TypeScript + MongoDB（Mongoose 8），JWT 鉴权，vitest + mongodb-memory-server
- **前端**：Vite 5 + React 18 + TypeScript + Tailwind CSS v4 + shadcn/ui（Radix）+ lucide-react + sonner

## 快速开始

```bash
docker compose up -d                                  # 启动 MongoDB（或用自有 MongoDB）
cp backend/.env.example backend/.env                  # 配置 JWT_SECRET / SUPER_ADMIN_EMAIL
cd backend && npm install && npm run dev              # 后端 :4000
cd frontend && npm install && npm run dev             # 前端 :5173（/api 代理到 4000）
```

浏览器打开 http://localhost:5173 ，用 `SUPER_ADMIN_EMAIL` 注册首个账号（自动成为超管）→「管理」页创建邀请码 → 成员凭码注册。

详细部署与环境变量说明见 [docs/readme.md](docs/readme.md)。

## 文档

- [docs/readme.md](docs/readme.md) — 部署、环境变量、cron 提醒、测试与冒烟
- [docs/features.md](docs/features.md) — 功能使用指南
- [docs/api.md](docs/api.md) — 接口契约
- [docs/design.md](docs/design.md) — 设计说明与变更记录

## 贡献

欢迎 Issue 与 PR。开发约定：后端改动需 `npm test`（vitest）与 `npm run typecheck` 全绿；前端需 `npm run build` 通过；提交信息使用 Conventional Commits 风格。

## 许可证

[MIT](LICENSE) © 2026 ShiratsuyuClassYuudachi
