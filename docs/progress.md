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
- `backend/src/services/permissions.ts`：预置角色（主办/美工/宣发/一般staff）与权限点
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
- 页面：`pages/{Login,Register,Projects,ProjectHome,InviteAccept,Me,Admin}.tsx` + `components/project/`（项目工作台四 Tab：待办/成员/角色/设置）
- 超管后台邀请码管理、邀请接受页、个人资料维护

### Task 15：文档与收尾
- `docs/readme.md`（快速开始 / 环境变量表 / cron / 冒烟）、本文件、`docs/design.md` 追加「2026-07-21 第一阶段落地」
- 端到端冒烟（mongodb-memory-server，无 Docker）全部通过，覆盖：注册/邀请码/项目/邀请接受/待办/完成含附件/模板导入导出/cron/文件下载

### 工程
- `docker-compose.yml`（mongo:7，可选）、`.gitignore`（含 `backend/.env`、`backend/uploads/`）、`docs/api.md`（全量接口契约）

## 2026-07-21 第二阶段：财务/物料/账号

三条特性分支（finance/materials/accounts）合并入 main。后端 58 个 vitest 用例全绿、typecheck 通过，前端 `vite build` 通过。

### 财务模块（finance）
- `backend/src/models/Transaction.ts`：收支账目（类型/整数分金额/备注/付款人/平摊人/凭证附件）
- `backend/src/services/finance.ts`：汇总计算（门票盈亏、按人净额、公款池结算、贪心建议转账）
- `backend/src/routes/finance.ts`：账目 CRUD、门票价/售票数设置、按成员导出 CSV（UTF-8 带 BOM）
- `frontend/src/components/project/FinanceTab.tsx`：账目列表/录入/汇总/转账建议/CSV 导出

### 物料管理（materials）
- `backend/src/models/{ResourceType,Resource,ResourceVersion}.ts`：类型/资源/版本
- `backend/src/services/{visibility,preview}.ts`：可见范围判定（优先于权限点）、sharp 生成 WebP 预览（≤800px、≤100KB）
- `backend/src/routes/materials.ts`：类型/资源/版本 CRUD、版本上传、预览与原图下载（均过可见范围校验）
- `frontend/src/components/project/MaterialsTab.tsx`、`frontend/src/components/AuthImg.tsx`（fetch + Blob 鉴权图片）

### 平台账号（accounts）
- `backend/src/models/PlatformAccount.ts`：三模式（full/otp/contact）、密文、可见范围
- `backend/src/services/platformCrypto.ts`：server 模式 AES-256-GCM（密钥 = SHA-256(`PLATFORM_CRYPTO_KEY`，缺省回退 `JWT_SECRET`））
- `backend/src/routes/accounts.ts`：账号 CRUD、reveal（server 返回明文 / user 返回 ANONv1 密文）
- `frontend/src/components/project/AccountsTab.tsx`、`frontend/src/crypto.ts`（ANONv1：PBKDF2-SHA256 10 万次 + AES-GCM 浏览器端加密）

### 其他
- 新权限点：`finance:manage` / `materials:manage` / `accounts:manage`（`backend/src/services/permissions.ts`）
- 新环境变量：`PLATFORM_CRYPTO_KEY`（可选，见 `backend/.env.example`）
- 端到端冒烟（mongodb-memory-server，无 Docker）第二阶段全流程通过，覆盖：门票设置/支出平摊/汇总与转账/CSV 导出 BOM、类型/资源/PNG 版本上传/WebP 预览生成与下载、server 加密 reveal 明文往返、ANONv1 密文原样存储

## 2026-07-21 财务权限拆分
- 新增权限点 `finance:add`（`backend/src/services/permissions.ts`），预置角色 美工/宣发/一般staff 默认获得
- `backend/src/routes/finance.ts`：非管理者仅可见/改/删自己创建的账目（summary 为 null）；POST 鉴权前置 multer 防孤儿文件；导出仅限 `finance:manage`
- 前端 `FinanceTab.tsx` 按权限隐藏门票卡/汇总卡/导出卡/删除按钮
- 测试：`backend/tests/finance.test.ts` 61/61

## 2026-07-24 前端 UI 焕新（Tailwind v4 + shadcn/ui）

前端全部页面由手写 CSS 迁移至 Tailwind CSS v4 + shadcn/ui，14 个任务（基座 → 各页面/Tab → 清理收尾）全部完成并逐任务评审通过。`tsc --noEmit` + `vite build` 通过。

### 技术选型
- Tailwind CSS v4（`@tailwindcss/vite`）+ shadcn/ui（new-york 风格 / neutral 基色，`components/ui/` 共 20 个组件，`cn()` = clsx + tailwind-merge）
- lucide-react 图标；sonner 通知——全部 `alert()`/`confirm()` 替换为 toast / AlertDialog，全局零残留

### 双风格主题
- 简洁/明快（`localStorage` 键 `anon-style`：minimal/playful → `<html data-style>`）× 日/夜（键 `anon-theme`：light/dark → `.dark` 类），共 4 种组合即时切换
- `index.html` 内联脚本首屏应用，无闪烁；`theme-color` meta 随模式更新；旧值 `anon-theme=dark` 用户升级后仍为暗色

### 布局与页面
- 响应式布局：移动端（<768px）底部导航 + 桌面端顶栏；表单弹层统一走 `FormOverlay`（移动端底部 Sheet / 桌面端居中 Dialog，`useMediaQuery` 判定）
- 重写范围：登录/注册/邀请接受、项目列表、工作台 7 Tab（待办/财务/物料/账号/成员/角色/设置）、个人资料、管理页

### 收尾验证（Task 14）
- 旧手写 CSS 类（page/card/row/chip/muted/error/field/grid-2/tabs/active/ghost/danger/theme-toggle/app-header/spacer）全库核对零残留（修复 `AuthImg.tsx` 一处 `className="muted"`）
- `npm run build` 通过；浏览器人工走查清单（主题 4 组合 / 页面 × 视口 / 主流程冒烟 / 移动端专项）留待用户执行

## 2026-07-27 现场任务单

后端 85 个 vitest 用例全绿（65 + 新增 20：模型/服务 4 + 路由 11 + 任务单 5）、typecheck 通过，前端 `vite build` 通过。

### 后端
- `backend/src/models/WorkModule.ts`：任务模块（名称/描述/地点/起止时间/所需人力/分配成员内嵌确认记录）
- `backend/src/services/workModules.ts`：`memberNameMap` 姓名联查、`moduleJson` 统一形状、`buildSheet` 任务单实时计算
- `backend/src/routes/workModules.ts`：work-modules CRUD（成员读列表，`work:manage` 增删改）+ confirm/unconfirm（本人成员即可，代他人需 `work:manage`/`project:manage`，幂等）
- `backend/src/routes/workSheet.ts`：`GET /` 本人任务单、`GET /:userId`（`work:manage`）
- 新权限点 `work:manage`（`backend/src/services/permissions.ts`）；既有项目预置角色快照不做迁移，靠 `project:manage` 兜底放行

### 前端
- `frontend/src/components/project/WorkTab.tsx`：「现场」Tab（模块 CRUD/成员分配/确认与代确认/打印入口）
- `frontend/src/pages/WorkSheetPrint.tsx`：打印版式页 `/p/:id/work-sheet/print?user=me|<userId>|all`，全员按人分页连排 + 签字日期栏
- `frontend/src/pages/ProjectHome.tsx`：TABS 新增「现场」（移动端底部导航入「更多」）

### 测试
- `backend/tests/workModules.test.ts`：20 用例——模型默认值与校验（2）、服务层姓名联查与输出形状（2）、路由权限/校验/分配替换保留确认/确认流转/代确认权限/跨项目防护（11）、任务单本人/空单/他人权限/非成员 404/确认状态一致（5）

### 2026-07-27 现场任务单：浏览器自动走查与时区修复

- 用 Playwright 自动走查前端（19/19 通过）：登录/建模块/分配/确认/打印版式/全员连排/双主题/权限（成员无管理入口、全员打印被拒）/移动端底部导航与 Sheet。
- 走查发现并修复**时区显示 bug**：WorkTab 与 WorkSheetPrint 的时间显示直接截取 UTC ISO 字符串，未转本地时区（输入 09:00 显示 01:00）。新增 `frontend/src/lib/datetime.ts`（`fmtLocal`/`toLocalInput`），统一本地时区显示与编辑回填；TodosTab 的 fmt 原本已是本地转换，不受影响。

### 2026-07-27 工作台按权限控制可见性

- ProjectHome 的 TABS 集中定义 `visible` 断言，桌面标签/移动底栏/更多 Sheet/条件渲染统一消费 `visibleTabs`；当前 tab 不可见时渲染期回退到首个可见 tab。
- 可见性：角色（role:manage 以上）、设置（project:manage）对无权限者隐藏；财务需 finance:add/manage 其一；其余 Tab 全体成员可见。
- TodosTab 的「新建待办」「模板」补 todo:manage 门控。
- 浏览器走查 10/10 通过（staff 6 Tab 无管理入口、移动端更多 Sheet 同步过滤、admin 8 Tab 不变）。
