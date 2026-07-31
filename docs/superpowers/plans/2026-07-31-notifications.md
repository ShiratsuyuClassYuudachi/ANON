# 通知与提醒中心（第一阶段：邮件渠道）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 ANON 建立统一的通知管线：定义**渠道接口**（`NotificationChannel`），第一版仅实现**邮件渠道**（复用现有 `mailer.ts`），后续站内中心、Web Push 等渠道只需实现接口并注册即可接入。同时把现有 cron 邮件提醒（待办 remind/due、里程碑临近、周报）重构到该管线，消除直发 `sendMail` 的并行路径。

**Architecture:** 设计文档见 `docs/superpowers/specs/2026-07-31-notifications-design.md`。新增 `backend/src/services/notifications.ts`（事件类型、`NotificationPayload`、渠道接口、邮件渠道、`notify()` 分发、`managerRoleNames`/`memberIdsByRole` 收件人辅助）；在既有路由的变更点 fire-and-forget 调用 `notify()`，cron 提醒改为 `await notify()` 并保持 `ReminderLog` 去重语义。无新 API 端点、无前端改动、无新环境变量。

## 事件清单（第一版）

| 事件 | 触发点 | 收件人 | 去重 |
|---|---|---|---|
| `todo:assigned` | 创建/改派待办时新增指派人 | 新指派人（排除操作者） | 事件触发，天然不重 |
| `todo:completed` | 待办完成 | 其他指派人（排除操作者） | 同上 |
| `work:assigned` | 创建/调整现场任务时新增分配 | 新分配成员（排除操作者） | 同上 |
| `announcement:published` | 发布 important/emergency 公告 | 可见范围内的成员 | 同上 |
| `incident:reported` | 现场异常上报 | 项目管理者（project:manage 角色） | 同上 |
| `risk:new` | 新检测到 warning/critical 风险 | 项目管理者 | 风险指纹天然去重（仅首次创建时通知） |
| `todo:remind` / `todo:due` | cron 扫描（原逻辑） | 指派人 | `ReminderLog`（保持现状） |
| `milestone:approaching` | cron 扫描（原逻辑） | 项目管理者 | `ReminderLog`（保持现状） |
| `weekly:report` | cron 周报（原逻辑） | 项目管理者 | `WeeklyReportLog`（保持现状） |

## Global Constraints

- 仓库根 `/home/yuu/projects/anon`，分支 `feat/notifications`；后端命令在 `backend/` 下执行。
- **node/npm 不在默认 PATH**：所有 npm/npx 命令前先 `export PATH="$HOME/.local/share/node/bin:$PATH"`。
- 后端测试：`cd backend && npm test`（vitest run，mongodb-memory-server，`pool:'forks', singleFork:true`）。
- 错误格式/中间件/权限点均沿用现有约定；`notify()` 必须**内部吞错**（单渠道失败不影响其他渠道、不产生 unhandled rejection），调用点一律 fire-and-forget（cron 内 `await` 除外）。
- 预置角色快照语义：管理者判定 = `project.roles` 中含 `project:manage` 权限的角色名 → `Membership.roleName` 匹配（与 cron.ts 现有逻辑一致，抽为共享辅助函数）。

## Tasks

- [x] Task 1：`backend/src/services/notifications.ts` — 类型（`NotificationType`/`NotificationPayload`/`NotificationRecipient`/`NotificationChannel`）、`EmailChannel`（id='email'，过滤无邮箱收件人后调 `sendMail`）、`notify()`（解析用户→排除 actorId→逐渠道投递，`Promise.all` + 每渠道 `.catch`）、`managerRoleNames(project)`、`memberIdsByRole(projectId, roleNames)`
- [x] Task 2：todos.ts — POST 指派 `todo:assigned`；PATCH 改派仅通知新增者；complete 通知其他指派人 `todo:completed`
- [x] Task 3：workModules.ts — POST/PATCH 分配新成员 `work:assigned`
- [x] Task 4：announcements.ts — POST 发布 important/emergency 时按 visibility（roleNames/userIds，空=全部成员）通知成员
- [x] Task 5：onsite.ts — POST /incidents 通知管理者 `incident:reported`
- [x] Task 6：risk.ts — `reconcileRisks` 新创建（非复活）且 level ∈ warning/critical 时通知管理者 `risk:new`
- [x] Task 7：cron.ts — reminders（remind/due/milestone）与 weekly-report 全部改走 `notify()`，复用辅助函数消除重复的管理者查找；`ReminderLog`/`WeeklyReportLog`/`sent` 语义不变
- [x] Task 8：`backend/tests/notifications.test.ts` — `vi.mock` mailer 断言邮件；覆盖：self-assign 排除、改派只通知新增、完成通知他人、work 分配、公告重要/紧急与普通区分、异常上报通知管理者、cron due/milestone 走管线且去重、risk:new 通知管理者、单渠道抛错不影响邮件渠道（注册假渠道验证接口可扩展性）
- [x] Task 9：文档 — `docs/features.md`（通知与提醒章节）、`docs/readme.md`（功能列表与 cron 描述）、`docs/progress.md`（迭代日志）
- [x] Task 10：验证 — `cd backend && npm test && npx tsc --noEmit`；提交分支
