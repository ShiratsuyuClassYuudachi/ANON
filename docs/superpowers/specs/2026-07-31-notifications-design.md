# 通知与提醒中心设计（第一阶段：邮件渠道）

> 对应实施计划 `docs/superpowers/plans/2026-07-31-notifications.md`，分支 `feat/notifications`。
> 背景：`designs/改进建议.md` 将「通知与提醒中心」列为最高优先级。当前仅有 cron→SMTP 直发邮件（待办 remind/due、里程碑临近、周报），无统一管线。本阶段只实现**邮件渠道**，但以渠道接口为边界，后续站内通知中心、Web Push 等只需新增实现并注册。

## 1. 核心抽象

### 1.1 事件与载荷

```ts
type NotificationType =
  | 'todo:assigned'          // 被指派/改派待办
  | 'todo:completed'         // 待办被他人完成
  | 'todo:remind'            // 待办节点提醒（cron）
  | 'todo:due'               // 待办到期提醒（cron）
  | 'milestone:approaching'  // 里程碑临近（cron）
  | 'risk:new'               // 新检测到 warning/critical 风险
  | 'announcement:published' // 重要/紧急公告发布
  | 'work:assigned'          // 被分配现场任务
  | 'incident:reported'      // 现场异常上报
  | 'weekly:report';         // 项目周报（cron 摘要）

interface NotificationPayload {
  projectId: Types.ObjectId | string;
  type: NotificationType;
  title: string;        // 邮件主题前缀后的主标题（站内通知的标题）
  body: string;         // 纯文本正文
  link?: string;        // 前端路由（如 /p/:id?tab=todos），供站内/推送渠道使用
  metadata?: Record<string, unknown>; // 事件上下文（sourceId 等），渠道可定制
  recipients: string[]; // 目标收件人 userIds
  actorId?: string;     // 触发者，自动从 recipients 中排除（防自通知）
}
```

### 1.2 渠道接口

```ts
interface NotificationRecipient {
  userId: string;
  name: string;
  email?: string;
}

interface NotificationChannel {
  readonly id: string;                    // 'email' | 'inapp' | 'webpush' ...
  deliver(payload: NotificationPayload, recipients: NotificationRecipient[]): Promise<void>;
}
```

- `notify()` 负责：解析 userIds → 用户（`User.find`）→ 排除 `actorId` → 对每个已注册渠道投递。
- **失败隔离**：逐渠道 `.catch` 记日志，单渠道失败不影响其他渠道；整体再包一层 try/catch，杜绝 unhandled rejection。
- 新增渠道 = 实现接口 + `notificationChannels.push(new XxxChannel())`，业务调用点零改动。

### 1.3 收件人辅助

- `managerRoleNames(project)`：`project.roles` 中含 `project:manage` 的角色名列表（与 cron.ts 现有判定一致）。
- `memberIdsByRole(projectId, roleNames)`：按 `Membership.roleName` 查成员 userIds。
- 消除 cron.ts 中两份重复的管理者查找逻辑。

## 2. 事件接入点

| 文件 | 变更点 | 事件 | 收件人 |
|---|---|---|---|
| `routes/todos.ts` | POST 创建；PATCH 改派（新旧差集）；POST complete | assigned / completed | 新指派人 / 其他指派人 |
| `routes/workModules.ts` | POST 创建；PATCH 调整（新旧差集） | work:assigned | 新分配成员 |
| `routes/announcements.ts` | POST 发布，type ∈ important/emergency | announcement:published | visibility 内成员（空=全部成员） |
| `routes/onsite.ts` | POST /incidents | incident:reported | 管理者 |
| `services/risk.ts` | `reconcileRisks` 创建新实例且 level ∈ warning/critical | risk:new | 管理者（指纹天然去重，仅首次创建触发） |
| `routes/cron.ts` | /reminders、/weekly-report | remind/due/milestone/weekly | 指派人 / 管理者 |

公告可见范围语义沿用 `services/visibility.ts` 的 `VisibilityLike`：`roleNames` 或 `userIds` 命中即收；两者皆空 = 全员。`canSee` 的超管放行不适用于邮件收件人（超管不一定在项目内）。

## 3. 邮件渠道行为

- 复用 `services/mailer.ts` 的 `sendMail`（未配置 SMTP 时为控制台存根）。
- 主题：`[ANON] ${payload.title}`；正文：`payload.body`。
- 无邮箱的收件人自动跳过。
- cron 内 `await notify()` 保持原有串行语义与 `ReminderLog`/`WeeklyReportLog`/`sent` 计数不变；其余调用点 fire-and-forget。

## 4. 明确不做（后续阶段）

- 站内通知中心（未读、铃铛、`/api/notifications`）——接入 `inapp` 渠道。
- Web Push——接入 `webpush` 渠道（PWA service worker 已就位）。
- 用户/项目级通知偏好（立即/摘要/免打扰）、邮件模板化、@提及、评论通知。

## 5. 测试策略

`backend/tests/notifications.test.ts`：`vi.mock('../src/services/mailer')` 拦截 `sendMail` 断言收件人/主题/正文；沿用 helpers（createSuperAdmin/registerUser/邀请入项目）。关键用例：

1. self-assign 不通知（actorId 排除）
2. 创建待办通知指派人；PATCH 改派只通知新增者
3. complete 通知其他指派人、排除完成者
4. 现场任务创建/调整分配通知新成员
5. 重要/紧急公告通知可见成员；普通公告不通知；visibility 过滤生效
6. 异常上报通知管理者（一般成员不收到）
7. cron due/milestone 走管线、ReminderLog 去重不变
8. 新 warning/critical 风险通知管理者（info 不通知）
9. 注册抛错假渠道：邮件渠道仍送达（接口可扩展性 + 失败隔离）
