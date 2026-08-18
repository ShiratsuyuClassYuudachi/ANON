# 文件功能索引（供 Agent 定位代码用）

> 修改代码前先用本文档定位相关文件，**禁止全库遍历找代码**。
> 维护规则（强制）：功能开发过程中可先不更新；**用户确认合并时必须同步更新本索引**——合并前更新对应条目（功能描述、功能域速查表、路由挂载表），新增补条目、删除/改名同步移除或修正（与 docs/features.md 等文档同批补齐，缺一不得合并）。
> 仅列功能定位所需的要点；接口细节见 `docs/api.md`，功能行为见 `docs/features.md`。

## 架构速览

- 请求链：浏览器 → Cloudflare Worker（`worker/src/index.js`，`/api/*` 反代源站、静态走 ASSETS）→ 源站 nginx（`frontend/nginx.conf`，`/api/` → backend:4000）→ Express（`backend/src/app.ts`）→ FerretDB(MongoDB 协议) / S3(MinIO)。
- 前端：React 18 + Vite 6 PWA，入口 `frontend/src/main.tsx` → `App.tsx` 路由表；全部请求经 `api/client.ts`（Bearer + 401 单飞刷新重放）；共享类型集中在 `types.ts`。
- 后端：Express + Mongoose；路由统一挂 `/api/projects/:id/*`（项目域）与 `/api/{auth,admin,me,open,push,invites,files,cron}` + `/api/public/lostfound`（顶级域，后者免登录）；权限经 `middleware/projectAccess.ts` 的 `loadMembership` + `requirePermission`；API 密钥（`anonk_` 前缀 Bearer）经 `middleware/auth.ts` 分流鉴权，项目域内由 loadMembership 按 key 绑项目 + scopes 收窄。
- 纯前端演示站：`frontend/src/demo/` 构建期拦截 `fetch('/api/*')`，内存库 mock 全部后端契约。

## 功能域速查表（改哪个功能 → 看哪些文件）

| 功能域 | 后端 | 前端 | 测试 |
|---|---|---|---|
| 认证/注册/会话 | routes/auth.ts、middleware/auth.ts、services/session.ts、utils/jwt.ts、models/{User,RefreshToken,InviteCode}.ts | pages/{Login,Register}.tsx、auth.tsx、api/client.ts | tests/auth.test.ts |
| 项目/成员/角色/邀请 | routes/projects.ts、routes/invites.ts、models/{Project,Membership,ProjectInvite}.ts、services/permissions.ts | pages/{Projects,ProjectHome,InviteAccept}.tsx、project/{MembersTab,RolesTab,SettingsTab}.tsx | tests/{projects,invites}.test.ts |
| 待办（含模板/进度） | routes/todos.ts、models/{Todo,ReminderLog}.ts、services/template.ts | project/{TodosTab,TodoFormDialog,TodoActionSheet}.tsx | tests/{todos,todo-complete,todo-updates,template}.test.ts |
| 财务 | routes/finance.ts、models/Transaction.ts、services/finance.ts | project/FinanceTab.tsx | tests/finance.test.ts |
| 物料/资料库/文件 | routes/{materials,files}.ts、models/{Resource,ResourceType,ResourceVersion,File}.ts、services/{preview,storage}.ts、middleware/upload.ts | project/MaterialsTab.tsx、components/{AuthImg,AuthMedia}.tsx | tests/{materials,files}.test.ts |
| 实物/物资台账 | routes/physical.ts、models/Physical{Category,Item,ItemLog}.ts | project/PhysicalTab.tsx | tests/physical.test.ts |
| 平台账号（加密） | routes/accounts.ts、models/PlatformAccount.ts、services/platformCrypto.ts | project/AccountsTab.tsx、crypto.ts（浏览器端加密） | tests/accounts.test.ts |
| 公告 | routes/announcements.ts、models/{Announcement,AnnouncementConfirmation}.ts | project/AnnouncementManager.tsx | tests/announcements.test.ts |
| 仪表盘/聚合 | routes/dashboard.ts、services/dashboard.ts、models/DashboardPreference.ts | project/DashboardTab.tsx | tests/dashboard.test.ts |
| 风险预警 | routes/risks.ts、models/RiskInstance.ts、services/risk.ts | DashboardTab.tsx（内嵌展示） | tests/dashboard.test.ts |
| 现场模式/工作模块/任务单 | routes/{onsite,workModules,workSheet}.ts、models/{WorkModule,Incident}.ts、services/workModules.ts | pages/{OnsitePage,WorkSheetPrint}.tsx、project/WorkTab.tsx、lib/offlineQueue.ts | tests/{onsite,workModules}.test.ts |
| 舞台工具（编排/报名/阶段/执行/大屏） | routes/{stageRundowns,stageSignups,stages}.ts、models/{StageRundown,StageScreenShare,StageSignup}.ts | project/tools/*.tsx、project/{ToolsTab,StageManager,StageStepper}.tsx、pages/RundownScreenPage.tsx（大屏公开页）、pages/OnsitePage.tsx（舞台执行卡） | tests/{stageRundowns,stageExecution,stageSignups}.test.ts |
| 失物招领/公开查找页 | routes/lostFound.ts、models/{LostFoundItem,LostFoundShare}.ts、services/permissions.ts（迁移） | project/tools/LostFound*.tsx、pages/PublicLostFound.tsx、pages/OnsitePage.tsx（现场录入入口） | tests/lostFound.test.ts |
| 自定义工具/OpenAPI（API 密钥） | routes/{customTools,open}.ts、models/{CustomTool,ApiKey}.ts、middleware/auth.ts（anonk_ 分流 + rejectApiKey 围栏）、middleware/projectAccess.ts（项目绑定 + scopes 收窄）、utils/jwt.ts（kind 隔离 + tool-launch） | project/ToolsTab.tsx、project/tools/{CustomToolEmbed,CustomToolDialog}.tsx、lib/toolLaunch.ts（启动令牌 postMessage 握手投递）、components/ApiKeysCard.tsx（Me 页）、lib/permissions.ts（共享权限清单） | tests/{customTools,open}.test.ts |
| 里程碑 | routes/milestones.ts、models/Milestone.ts | project/MilestoneSection.tsx | — |
| 通知（邮件+WebPush）/ cron | services/{notifications,mailer,webpush}.ts、routes/{push,cron}.ts、models/{PushSubscription,ReminderLog,WeeklyReportLog}.ts | lib/push.ts、components/{PushBanner,PushSettingsCard}.tsx、scripts/patch-sw.mjs | tests/{notifications,push,cron}.test.ts |
| PWA 安装入口 | —（纯前端） | lib/pwaInstall.ts（事件捕获/状态）、components/PwaInstallGuide.tsx（指引弹层）、pages/ProjectHome.tsx（「更多」Sheet 行） | .walkthrough/pwa-install.mjs（走查） |
| 试用模式 | services/trial.ts、models/TrialSession.ts、services/demoSeed.ts | components/TrialBanner.tsx | tests/trial.test.ts |
| 纯前端演示站 | —（mock 后端契约） | demo/ 全目录、components/{DemoBadge,DemoBanner}.tsx、vite.config.ts | — |
| 新手引导/帮助中心 | routes/me.ts（onboarded 端点） | onboarding/*、help/content.ts、pages/DocsPage.tsx | tests/onboarding.test.ts |
| 操作日志/动态 | models/Activity.ts、services/activity.ts、routes/activities.ts | —（暂未暴露界面） | — |
| 可见范围（visibility） | services/visibility.ts、models/ResourceType.ts（visibilitySchema 共用子文档） | project/VisibilityPicker.tsx | 散见于各域测试 |
| 个人中心/超管 | routes/{me,admin}.ts | pages/{Me,Admin}.tsx | tests/{me,admin}.test.ts |
| 边缘部署/运维 | worker/src/index.js、wrangler.toml、docker-compose.prod.yml、frontend/nginx.conf、前后端 Dockerfile | — | .github/workflows/dependency-scan.yml |

## 后端 `backend/`

### 装配与基建
- `src/app.ts` — Express 装配：helmet + json(2mb) + `/api/health` + errorHandler；路由挂载表（见下文「路由挂载」）
- `src/config.ts` — 环境配置聚合：port/mongoUri/jwtSecret/S3/SMTP/VAPID/trialEmail
- `src/index.ts` — 启动入口：连 Mongo → initStorage → grantPermissionToAllRoles（新权限点迁移）→ startTrialSweeper → listen
- `src/middleware/auth.ts` — authRequired 校验 Bearer（`anonk_` 前缀走 ApiKey 哈希鉴权：过期即删、lastUsedAt 1h 节流回写；否则 JWT）；requireSuperAdmin 超管闸；rejectApiKey 用户态专属接口围栏（403 api_key_forbidden）
- `src/middleware/projectAccess.ts` — loadMembership 载入 project/membership/myPermissions（API 密钥请求尾部统一收窄：绑项目错配 403 api_key_wrong_project、myPermissions ∩ key.scopes）；requirePermission(perm)
- `src/middleware/errorHandler.ts` — 统一 AppError/Mongoose 错误为 `{error:{code,message}}`
- `src/middleware/upload.ts` — multer 磁盘上传（20MB、UUID 命名）；fixFilename 中文名修复
- `src/utils/async.ts` — ah 包装 async handler 转 next(err)
- `src/utils/errors.ts` — AppError(status, code, message)
- `src/utils/jwt.ts` — signToken/verifyToken（15 分钟，kind:'user'）；signToolLaunchToken/verifyToolLaunchToken（5 分钟 kind:'tool-launch'，仅可兑换 API 密钥）
- `vitest.config.ts` — 单 fork 串行、注入测试 JWT_SECRET
- `scripts/seed-demo.ts` — CLI 种子：5 用户 + 示例项目 + 邀请码 DEMO-2026

### 路由挂载（app.ts）
- 顶级：`/api/auth`(限流 50/15min)、`/api/admin`、`/api/me`、`/api/open`、`/api/push`、`/api/invites`、`/api/files`、`/api/cron`、`/api/projects`、`/api/public/lostfound` 与 `/api/public/rundown-screen`(免登录,限流 300/min)
- 项目域 `/api/projects/:id/`：`files` `todos` `work-modules` `work-sheet` `finance` `materials` `physical` `accounts` `dashboard` `onsite` `risks` `announcements` `activities` `stages` `stage-rundowns` `stage-signups` `custom-tools` `lostfound` `milestones`

### 路由 `src/routes/`（27 个，一文件一业务域）
- `auth.ts` — POST register/login/refresh/logout，JWT+refresh 轮换；/login 内嵌试用入口（trialLogin）
- `admin.ts` — 超管邀请码 POST/GET /invite-codes
- `me.ts` — 个人资料 GET/PATCH /、POST /onboarded
- `projects.ts` — 项目 CRUD + roles/members/invites 子资源
- `invites.ts` — GET /:token 查询、POST /:token/accept
- `todos.ts` — 待办 CRUD、模板 import/export、POST /:todoId/complete|updates
- `finance.ts` — 账目 CRUD、PATCH /ticket、GET /export(CSV)
- `materials.ts` — 资料类型/资源/版本 CRUD、preview/download、内联预览白名单（位图+PDF/Markdown/音视频）
- `files.ts` — 双路由：项目内 POST 上传；/api/files GET /:id 下载
- `physical.ts` — 实物分类/条目 CRUD、POST /items/:itemId/log、GET /summary
- `accounts.ts` — 平台账号 CRUD、POST /:accountId/reveal 揭示凭证
- `announcements.ts` — 公告 CRUD、POST /:announcementId/confirm、GET /:announcementId/confirmations 确认名单
- `dashboard.ts` — GET / /preferences /summary /my-actions /schedule、PATCH /preferences
- `risks.ts` — GET /、POST /evaluate、POST /:riskId/ignore|restore
- `onsite.ts` — GET / 现场聚合（含 rundowns 舞台执行：running 恒在列 + ±24h 窗口 idle）、GET/POST /incidents、POST /incidents/:iid/resolve
- `workModules.ts` — 工作模块 CRUD、POST /:mid/confirm|unconfirm|checkin|finish
- `workSheet.ts` — GET / 本人任务单、GET /:userId（work:manage）
- `stages.ts` — 阶段 CRUD、PATCH /reorder
- `stageRundowns.ts` — 流程单 CRUD、节目 items、reorder（执行中仅未执行节目槽位可重排，动已演/在演位置 409）、execution 执行控制（start/advance/jump/shift/finish/reset）、screen-share 开关、publicRundownScreenRouter 公开大屏（token + 白名单）
- `stageSignups.ts` — 报名批次/节目、PUT|DELETE review 投票、POST /:sid/import
- `customTools.ts` — 自定义工具 CRUD（tools:manage；DELETE 级联删该工具 ApiKey）、POST /:toolId/launch（成员可用，passToken 工具签发 5 分钟启动令牌）
- `open.ts` — OpenAPI 模式：POST /exchange（launch token 换 30 天 API 密钥，限流 60/15min，同 user+tool 顶替）、GET /me（apikey 自查身份/权限交集/有效期）、keys CRUD（自助生成 30 天或永久，一次性返回原文；authRequired+rejectApiKey 防密钥造密钥）
- `lostFound.ts` — 双路由：项目域物品 CRUD/status/photo/share（lostfound:manage）；公开域免登录只读（token + 字段白名单）
- `milestones.ts` — 里程碑 CRUD、POST /:milestoneId/complete
- `activities.ts` — GET / 项目动态流（limit≤50）
- `push.ts` — GET /config(VAPID)、POST/DELETE /subscription
- `cron.ts` — CRON_SECRET 鉴权：POST /reminders、POST /weekly-report

### 模型 `src/models/`（35 个，Mongoose，`models.X ?? model(...)` 幂等注册）
- `User.ts` — 用户：email/name/passwordHash/isSuperAdmin/contacts；导出 publicUser() 脱敏
- `RefreshToken.ts` — 会话：tokenHash(sha256 唯一)、expiresAt
- `InviteCode.ts` — 注册邀请码：code/createdBy/usedBy/usedAt
- `Project.ts` — 项目：name/status/stages/roles/ticketTypes；导出默认阶段
- `Membership.ts` — 成员：projectId+userId+roleName（唯一索引）
- `ProjectInvite.ts` — 项目邀请：token/roleName/expiresAt
- `Todo.ts` — 待办：title/assigneeIds/dueAt/status
- `ReminderLog.ts` — 提醒去重：todoId+kind+targetId（唯一）
- `Transaction.ts` — 财务：type/amountCents/payerUserId/splitAmong
- `Resource.ts` / `ResourceType.ts` / `ResourceVersion.ts` / `File.ts` — 资料库四层：类型→资源→版本→文件；ResourceType 导出共用 visibilitySchema
- `PhysicalCategory.ts` / `PhysicalItem.ts` / `PhysicalItemLog.ts` — 实物台账：分类(含默认常量)/条目(状态枚举+中文标签)/操作日志
- `PlatformAccount.ts` — 平台账号：platform/mode/passwordCipher/visibility
- `Announcement.ts` / `AnnouncementConfirmation.ts` — 公告 + 确认记录（唯一索引）
- `DashboardPreference.ts` — 仪表盘偏好：defaultView/cardOrder
- `RiskInstance.ts` — 风险：ruleCode/level/status/fingerprint
- `Incident.ts` — 现场异常：category/note/status；导出 INCIDENT_CATEGORIES
- `WorkModule.ts` — 现场工作模块：requiredCount/assignees(确认/签到)
- `Milestone.ts` — 里程碑：title/date/completedAt
- `StageRundown.ts` / `StageScreenShare.ts` / `StageSignup.ts` — 舞台流程单（items 内嵌 + execution 执行子文档）/ 大屏对外分享（rundownId+token 唯一、开关）/ 报名（items 内嵌含 reviews）
- `LostFoundItem.ts` / `LostFoundShare.ts` — 失物（单照片+预览引用、认领状态）/ 对外分享（token 唯一、开关）
- `Activity.ts` — 操作日志：type/message/sourceId（90 天 TTL）
- `PushSubscription.ts` — WebPush 订阅：endpoint/p256dh/auth（端点唯一）
- `TrialSession.ts` — 试用会话：keyHash/userId/projectId/expiresAt(24h)
- `WeeklyReportLog.ts` — 周报发送记录：projectId+weekStart（唯一）
- `CustomTool.ts` — 自定义工具：projectId/name/url/mode(embed|link)/passToken/scopes
- `ApiKey.ts` — API 密钥：keyHash(sha256 唯一)/userId/projectId/toolId(可选，工具兑换来源)/scopes/expiresAt(可空=永久)/lastUsedAt

### 服务 `src/services/`
- `activity.ts` — logActivity 异步写操作日志
- `dashboard.ts` — buildSummary/buildMyActions/buildSchedule 仪表盘聚合
- `demoSeed.ts` — seedDemoData/deleteDemoData（CLI 与试用共用）
- `finance.ts` — 结算汇总 + 贪心转账方案（splitEvenly 精确分摊）
- `mailer.ts` — nodemailer 发信，未配 SMTP 降级 console
- `notifications.ts` — notify 统一多渠道通知（email+webpush），排除触发者
- `permissions.ts` — ALL_PERMISSIONS(15 项) + PRESET_ROLES(4 预设角色) + grantPermissionToAllRoles（新权限点启动迁移，默认授予所有角色）
- `platformCrypto.ts` — 平台账号密码 AES-256-GCM（iv:tag:data）
- `preview.ts` — sharp 转 WebP 预览（≤800px、≤100KB）
- `risk.ts` — computeRisks 规则探测 + reconcileRisks 落库/通知 + computeHealth
- `session.ts` — 刷新令牌签发/轮换/吊销（30 天、上限 10）
- `storage.ts` — S3/本地双后端文件存取
- `template.ts` — 待办模板导出（相对偏移）/导入（锚点重算）
- `trial.ts` — trialLogin 派生独立演示环境；sweepExpiredTrials 24h 清扫
- `visibility.ts` — canSee/isVisible 可见范围判定
- `webpush.ts` — webpushChannel：VAPID 推送、410 清除失效订阅
- `workModules.ts` — buildSheet 任务单生成、moduleJson 序列化

### 测试 `tests/`（vitest + supertest + mongodb-memory-server，打真实路由）
- `setup.ts` / `helpers.ts` — 内存 Mongo 基建 / 造号工具（createSuperAdmin/registerUser）
- 每域一个 `*.test.ts`：auth/admin/me/projects/invites/todos/todo-complete/todo-updates/template/finance/materials/files/physical/accounts/announcements/dashboard/onsite/workModules/stageRundowns/stageExecution/stageSignups/customTools/open/lostFound/notifications/push/cron/trial/onboarding/health

## 前端 `frontend/`

### 入口与基座
- `src/main.tsx` — Provider 挂载、PWA 注册、离线队列同步、demo 动态安装
- `src/App.tsx` — 路由表：公开 /login /register /lf/:token（失物招领公开页）、/screen/:token（现场大屏公开页）；RequireAuth：/projects、/p/:id（ProjectHome）、/p/:id/onsite、/me、/help、/admin、/invite/:token、/p/:id/work-sheet/print
- `src/api/client.ts` — api/authorizedFetch/downloadFile：Bearer 注入、401 单飞刷新重放；401 跳登录白名单 /invite/ 与 /lf/（公开页）
- `src/auth.tsx` — AuthProvider/useAuth：login/logout/refresh、trialExpiresAt
- `src/theme.tsx` — ThemeProvider/ModeToggle：日夜 × 简洁/明快
- `src/crypto.ts` — PBKDF2(60万次)+AES-GCM 浏览器端加密（平台账号 user 模式）
- `src/types.ts` — 全部 API 共享类型
- `src/index.css` — Tailwind v4 主题变量与全局样式
- `src/vite-env.d.ts` — Vite / vite-plugin-pwa 客户端类型引用
- `src/lib/datetime.ts` — 本地时间格式化 + 活动倒计时 + 开展倒排换算（daysBeforeLocal）
- `src/lib/offlineQueue.ts` — 离线 POST 队列（现场模式用）
- `src/lib/push.ts` — Web Push 订阅管理
- `src/lib/toolLaunch.ts` — 自定义工具启动令牌投递（fetchLaunchToken + registerLaunchTarget 握手：校验 source/origin 后回发 anon:launch，5 分钟过期自动清除；canDeliverViaOpener 判定 opener 通道可用性，不可用时该 URL fragment `#anon_launch=` 兜底投递，插件侧即读即抹）
- `src/lib/pwaInstall.ts` — PWA 安装状态管理（模块级捕获 beforeinstallprompt——SW 已激活回访中事件早于 React 挂载；installed/canPrompt/dismissedOnce/available，demo 构建期恒隐藏；promptInstall 等 userChoice 落地才作废一次性事件）
- `src/lib/permissions.ts` — PERMISSIONS 权限点清单（与后端 ALL_PERMISSIONS 对齐；RolesTab 矩阵/自定义工具 scopes/ApiKeysCard 勾选区共用）
- `src/lib/utils.ts` — cn() 类名合并

### 页面 `src/pages/`
- `Login.tsx` / `Register.tsx` — 登录 / 邀请码注册（演示模式一键进入）
- `Projects.tsx` — 项目列表：健康度/阶段/倒计时卡片 + 新建
- `ProjectHome.tsx` — 项目主页：10 个按权限过滤的 Tab + 现场模式入口；移动端底部导航「更多」Sheet（现场模式/溢出 Tab/「安装应用」PWA 入口，指引弹层挂 Sheet 外由本页持有）
- `OnsitePage.tsx` — 现场模式：签到/完成/异常上报（离线入队）、舞台执行卡（Rundown 开始/推进/顺延，按 tools:manage 显隐）、失物登记入口（复用 LostFoundItemDialog，按 myPermissions 显隐）、30s 轮询
- `WorkSheetPrint.tsx` — 任务单打印页（按人/全员）
- `Me.tsx` — 个人资料/联系方式/推送设置/API 密钥（ApiKeysCard）/界面偏好
- `Admin.tsx` — 超管邀请码管理
- `InviteAccept.tsx` — 接受项目邀请
- `PublicLostFound.tsx` — 失物招领免登录公开查找页（/lf/:token，搜索+状态筛选+照片）
- `RundownScreenPage.tsx` — 现场大屏免登录公开页（/screen/:token，强制深色投屏：当前节目/时钟/紧急公告位，10s 轮询）
- `DocsPage.tsx` — 帮助中心：章节切换/全文搜索/截图缩放

### 通用组件 `src/components/`
- `Layout.tsx` — 主布局：顶栏（项目切换/主题/用户菜单）+ 各横幅挂载点
- `FormOverlay.tsx` — **弹层规范核心**：所有含输入框的弹层一律经此渲染浮动居中 Dialog（禁底部 Sheet 表单）
- `AuthImg.tsx` — 鉴权图片（useAuthorizedObjectUrl → objectURL）
- `AuthMedia.tsx` — 鉴权 PDF/音视频/Markdown 预览（iframe/video/audio/react-markdown + useAuthorizedObjectUrl；previewKindOf 按 mime+扩展名归类）
- `DemoBadge.tsx` / `DemoBanner.tsx` — 演示站角标 / 横幅（一键还原种子）
- `TrialBanner.tsx` — 试用横幅（数据销毁倒计时）
- `PushBanner.tsx` / `PushSettingsCard.tsx` — Push 提示条 / 订阅开关卡
- `PwaInstallGuide.tsx` — PWA 手动安装指引弹层（iOS 分享路径 / 浏览器菜单路径两版；由 ProjectHome 挂在「更多」Sheet 外）
- `ApiKeysCard.tsx` — Me 页 API 密钥卡：自助生成（项目+实有权限点+30 天/永久）、一次性原文展示复制、列表与撤销
- `Toaster.tsx` — sonner 封装；`Logo.tsx` — 品牌标识（应用图标 /icons/icon-192.png + ANON 字样，顶栏/登录/注册共用）
- `help/content.ts` — HELP_CHAPTERS 帮助文案（11 章，UI 变化需同步并重生成截图）
- `onboarding/OnboardingDialog.tsx` — 首登三页幻灯；`onboarding/tour.ts` — driver.js 分步高亮（data-tour 锚点）
- `ui/*.tsx`（20 个）— shadcn/radix 基础组件封装；表单一律用 dialog.tsx（经 FormOverlay），sheet.tsx 仅限无输入纯操作面板

### 项目 Tab `src/components/project/`（挂在 ProjectHome，直调对应后端域）
- `DashboardTab.tsx` — 仪表盘聚合（内嵌公告/里程碑/阶段卡）
- `TodosTab.tsx` + `TodoFormDialog.tsx` + `TodoActionSheet.tsx` — 待办列表/表单（日期字段支持开展倒排录入）/完成与进度弹层
- `FinanceTab.tsx` — 记账/门票/CSV 导出
- `MaterialsTab.tsx` — 资料分类/版本/实物入口
- `PhysicalTab.tsx` — 实物分类/台账/状态/日志
- `AccountsTab.tsx` — 平台账号增删/密码揭示
- `MembersTab.tsx` / `RolesTab.tsx` — 成员邀请/角色权限
- `SettingsTab.tsx` — 项目信息 + 阶段管理（StageManager）
- `WorkTab.tsx` — 现场工作模块/确认/打印
- `AnnouncementManager.tsx` — 公告发布/置顶/确认名单
- `MilestoneSection.tsx` / `StageStepper.tsx` / `StageManager.tsx` — 里程碑卡 / 阶段进度条 / 阶段增删排序
- `VisibilityPicker.tsx` — 可见范围选择器（成员+角色勾选，多 Tab 复用）
- `ToolsTab.tsx` — 实用工具容器（内置：舞台编排/报名审核/失物招领卡片；自定义工具卡片网格 + ⋯ 管理菜单 + 虚框添加卡，点击 embed→页内 iframe / link→新标签页；passToken 工具先取启动令牌经 lib/toolLaunch.ts 投递：手势内同步 window.open 防移动端拦弹窗，opener 丢失（standalone PWA）走 fragment 兜底，iOS 先弹底部选择层「内置预览/独立窗口」，URL 干净无令牌）
- `tools/CustomToolEmbed.tsx` / `tools/CustomToolDialog.tsx` — 自定义工具页内 iframe 视图（sandbox 不放行 top-navigation + 新窗口打开；passToken 令牌经 iframe contentWindow 握手投递）/ 新建编辑弹层（FormOverlay，携带身份开关 + scopes 勾选）
- `tools/StageRundownTool.tsx` + `ProgramFormDialog.tsx` + `ExecutionPanel.tsx` + `ScreenShareDialog.tsx` — 流程单编排/节目表单/导出/执行控制台（开始/推进/跳节目/顺延/结束重置）/大屏分享管理
- `tools/StageSignupTool.tsx` + `SignupItemDialog.tsx` + `SignupReviewDialog.tsx` — 报名审核/投票/拍板/导入
- `tools/SwipeRow.tsx` — 触屏侧滑操作行；`tools/rundownExport.ts` — 时间推算/文本/PNG 导出（纯前端）；`tools/rundownExecution.ts` — 执行态推算纯函数（延误/超时/预计时间/实时级联推算开始与结束）
- `tools/LostFoundTool.tsx` + `LostFoundItemDialog.tsx` + `LostFoundClaimDialog.tsx` — 失物列表/登记表单(multipart 单照片)/认领备注弹层 + 公开分享开关卡

### 演示站 `src/demo/`（`npm run build:demo`，浏览器内 mock 全部 /api）
- `install.ts` — installDemo：包装 window.fetch 拦截 /api/*；sessionStorage 内存库
- `router.ts` — def/route：`:param` 模板路由 + 80ms 延迟；Ctx 透传 Authorization 头（open/me 识别 anonk_demo_*）
- `seed.ts` — buildSeed（DB_VERSION=7）：相对当前时刻生成演示数据（含两条自定义工具种子）
- `types.ts` / `helpers.ts` — Db/Ctx/Handler 类型 / 错误信封·权限·文件存取
- `aggregate.ts` — R1–R7 聚合（注释标注移植自后端哪个服务）
- `handlers/*.ts`（15 个）— 按域复刻后端路由：auth/projects/todos/finance/materials/physical/accounts/dashboard/work/stageRundowns/stageSignups/customTools/open/lostFound + index.ts 合并路由表
- `pwa-register-stub.ts` — 禁 SW 防缓存干扰 mock

### 构建与脚本
- `vite.config.ts` — React+Tailwind+VitePWA；demo 模式摘 SW 并 stub pwa-register
- `scripts/patch-sw.mjs` — 构建后向 sw.js 追加 Web Push 处理
- `scripts/capture-help-screenshots.mjs` — Playwright 重生成帮助截图
- `scripts/generate-icons.mjs` — sharp 生成 PWA 图标
- `nginx.conf` — 8080 静态 + SPA 回退，/api/ → backend:4000（50m 上传）
- `Dockerfile` — 两阶段：构建 dist → nginx-unprivileged 托管

## 边缘与部署
- `worker/src/index.js` — Cloudflare Worker 入口：/api/* 反代 ORIGIN（改写 X-Forwarded-For），静态走 ASSETS + 安全头
- `worker/wrangler.toml` — ORIGIN/ASSETS 绑定、SPA 回退、run_worker_first
- `docker-compose.prod.yml` — 生产全栈：postgres + ferretdb + minio + backend + frontend
- `docker-compose.yml` — 开发：仅 mongo:7
- `backend/Dockerfile` — tsc 编译 + 仅生产依赖，非 root，挂 uploads 卷
- `.github/workflows/dependency-scan.yml` — osv-scanner 依赖漏洞周扫
- `backend/.env.example` — 环境变量样例（数据库/认证/SMTP/VAPID/S3/加密密钥）

## 走查脚本 `.walkthrough/`（不入库的 Playwright 工具集）
- 截图生成：`help-screenshot*.mjs`（帮助中心 tab-*.png）、`stage-signup-shots.mjs` 等
- 功能走查：`stage-signup.mjs`、`stage-rundown.mjs`、`stage-execution.mjs`（执行模式+现场大屏）、`custom-tools.mjs`（自定义工具 + OpenAPI/Me 页密钥全流程）、`onsite-walkthrough.mjs`、`nav-layout-verify.mjs`、`security-verify.mjs` 等约 30 个，输出 PASS/FAIL
- 冒烟：`smoke/prod-smoke.mjs`、`pwa-smoke.mjs`
- 调试：`debug-*.mjs` 约 20 个临时复现脚本；`shots/` 为截图产物
