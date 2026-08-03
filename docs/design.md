# ANON 项目设计

## 说明



这是一个用来实现活动全流程追踪和管理的应用，你需要遵守下列的设计与修改项来实现该项目



## 技术栈约定



后端使用express.js，前端使用vite+react，前后端均使用typescript，使用mongodb作为数据库存储的实现



你需要使用两个独立的文件夹，分别用于存放前端和后端文件。



前端页面需要能够良好适配移动端设备显示，优先支持移动端UI



## 总体设计



### 主要模块



#### 财务模块



财务模块主要用于记录支出与收入记录，需要实现以下功能



* 记录收入/支出情况，需要记录账目的添加人，备注信息，账目类型，允许用户上传截图等凭证

* 允许在设置门票价格后记录售票数量，从而实时更新盈亏情况

* 支持导出每个人的收入/支出列表

* 支持计算所有涉及到账目的人间需要转账的数额，包括单纯的报销与盈利或亏损的分配



#### 进度追踪



进度追踪主要需要实现的功能有

* 一个todo列表，允许上传文件，允许添加用户并设置节点提醒和到期时间

* 允许设置在新建，节点提醒和到期时通过邮件通知用户

* todo事项允许设置类别，用户可以按类别，指派人，结束时间以及节点时间来进行筛选和排序

* 用户在完成节点时可以选择输入备注信息并上传备注文件，或是关联在下文物料列表中提到的文件

* 允许导出todo列表为模板，并根据新项目的开始时间或是结束时间自动计算每个todo项应该被应用的新节点



#### 物料管理

物料管理包括文件管理与资源管理两大部分



1. 文件管理

    1. 允许用户创建资源类型，如海报，宣传图等

    2. 每个资源类型下可以包含复数资源，每个资源可以更新版本，在展示时默认是最新版，也可以通过版本列表选择较老版本

    3. 图片类型的资源支持预览，在上传时默认生成预览图，预览图不大于100k，点击放大时加载原图

    4. 用户可以对资源或者资源类别单独设置可见范围

  

2. 账号管理

    1. 允许用户添加账号信息，包括平台，账户，密码等登录需要的信息

    2. 用户可以只添加账号，并记录添加人，来方便获取需要二步验证登录的账号所需的验证码

    3. 可以只记录账号，用来记录联系人

    4. 可以对每个账号记录设置平台类型，如QQ，小红书，B站等常用平台

    5. 可以对每个账号设置可见权限范围



#### 权限设计



1. 默认用户需要邀请码来注册，邀请码记录于数据库中，只允许拥有所有管理权限的超级管理员，即开发者进行创建

2. 用户进行注册时，记录所用的邀请码

3. 用户在创建一个新项目时，默认获取项目的所有权限，并成为项目管理员

4. 默认的身份类型包含主办（管理），美工，宣发，一般staff等，这几个身份类型带有符合身份所需工作内容的默认权限，也可以在每个项目中进行修改

5. 允许用户自行创建身份，并自定义授予的权限点

6. 当账号，文件等设置了可见范围时，可见范围设置高于权限点设置

7. 用户在为项目添加人员时，在添加了人员后，生成一个邀请链接，用户需要登录了指定账户并接受才能被添加；也可以生成一个不指定用户的链接，收到链接的用户可以选择登录已有账户或是注册一个新的账户

8. 允许用户绑定其它平台的联系方式，这些联系方式会显示在用户信息中

9. 需要使用混淆设计保证数据库中存储用户密码的安全



## 约束要求



* 需要保持项目良好的安全性和可维护性

* 需要及时更新gitignore文件

* 每次进行更新时都记录到docs/progress.md中，在每次有功能更新或修复时都需要记录

* 在处理修改列表中的要求时，每次都需要记录已完成的修改和修改的文件与代码位置

* 需要生成docs/readme.md文件来更新系统的使用要求，并在更新代码时实时更新readme



## 修改列表



---



## 实现与变更记录（持续维护）



> **维护约定（2026-04-02）**：凡功能增删改，除 `docs/progress.md` 与 `docs/readme.md` 外，**须在本节或下列条目同步摘要**，便于与原始需求对照。本条指令（「将之前和之后的所有功能修改记录于 design.md 中，这条指令也需要记录」）亦作为长期规则写入此处。



### 技术栈与仓库结构



* 后端：`backend/` — Express.js + TypeScript + MongoDB（Mongoose），JWT 鉴权，上传目录可配置。

* 前端：`frontend/` — Vite + React + TypeScript，移动端优先布局。

* 环境变量、启动与脚本说明见 `docs/readme.md`。



### 认证与用户



* 注册需邀请码；邀请码由**超级管理员**通过接口/前端 `/admin` 创建与查看。

* 登录密码：**bcrypt**（cost 12）哈希存入 `User.passwordHash`，不明文存储。

* 可选环境变量 `SUPER_ADMIN_EMAIL`：首次注册该邮箱时自动标记超级管理员。

* 用户可维护**联系方式**（contacts），在「个人资料」中编辑；登录/注册接口返回 contacts。

* 种子脚本 `scripts/seed-super-admin.ts`（由 `backend` 下 `npm run seed:superadmin` 调用，`cross-env NODE_PATH=./node_modules` 解析依赖）：可直接写入/提升超级管理员，**不经过邀请码**；默认账号见 `docs/readme.md`。



### 项目与权限



* 创建项目者即项目成员，默认「主办」角色；预置角色：主办（管理）、美工、宣发、一般 staff，可自定义角色与权限点。

* 项目成员邀请：生成 token 链接；用户登录后在 `/invite/:token` 接受。

* 资源与平台账号支持**可见范围**（用户/角色）；与权限点叠加时，可见范围优先（见原权限设计）。



### 财务模块（已实现能力摘要）



* 收支记录：类型、金额、备注、添加人、多文件凭证（multer）；付款/收款人与参与平摊人；汇总含门票价×售票数、账目收支、按人净额、**建议转账**列表。

* 支持按成员**导出 CSV**（UTF-8）。

* 门票与售票数在项目设置中维护。



### 进度追踪 / 待办（已实现能力摘要）



* 待办：类别、指派人、节点时间、到期时间、提醒、完成备注；筛选（类别、指派人）与排序（创建/到期/节点）。

* 模板：**导出** JSON（含 `importTemplate` 等字段）；**导入**时锚定项目开始或结束时间批量生成待办。

* 提醒统一走通知管线（`services/notifications.ts`，渠道接口当前为邮件 + Web Push）；定时任务接口 `POST /api/cron/reminders`、`POST /api/cron/weekly-report`（需 `CRON_SECRET`）；推送订阅接口见 `docs/api.md`「推送订阅」。



### 物料管理（已实现能力摘要）



* 资源类型与资源；资源多**版本**，前端可下拉选择历史版本；图片上传时生成 WebP 预览（控制体积）。

* 静态文件通过鉴权接口访问；前端对需登录图片使用 **fetch + Blob** 预览（`AuthImg`）。



### 平台账号（账号管理）



* 模式：完整（含密码）、仅 OTP 辅助、仅联系人。

* **默认**：平台密码在浏览器内用用户自设「**保险库口令**」经 **PBKDF2 + AES-GCM**（`ANONv1` 格式）加密后上传；库字段 `cipherKeySource: user`，**服务端不保存保险库口令**。

* **可选旧版**：勾选「服务端密钥加密」则仍由服务端使用 `PLATFORM_CRYPTO_KEY`/`JWT_SECRET` 派生密钥加密（`cipherKeySource: server`），兼容旧数据。



### 脚本与工程化



* `scripts/build-and-start.ps1` / `.cmd` / `.sh`：安装依赖、构建前后端、启动 `npm start` + `vite preview`（PS 输出为英文以避免 Windows 下 UTF-8 无 BOM 解析错误）。

* `scripts/init-test-env.ps1` / `.cmd` / `.sh`：一键安装依赖并执行超级管理员种子。

* `frontend/tsconfig.json`：已移除 `baseUrl`，使用 `paths` 中 `"*": ["./*"]`（见 TypeScript 新版本要求）。



### 其他



* `.gitignore` 包含 `uploads/`、`backend/uploads/`、`dist` 等。

* 详细迭代日志见 `docs/progress.md`；部署与命令见 `docs/readme.md`。



### 前端主题



* 支持**日间 / 夜间**模式切换：全局固定按钮（右上角），`localStorage` 键 `anon-theme`；首屏 `index.html` 内联脚本避免闪烁；`theme-color` meta 随主题更新。实现见 `frontend/src/theme.tsx`、`index.css`。

* 表单控件使用 `--input-bg` / `--input-border` / `--input-placeholder`，与卡片 `--surface` 区分；`color-scheme` 与 `:-webkit-autofill` 覆盖，避免与主题冲突。



### 2026-07-21 第一阶段落地



* 按 `docs/superpowers/plans/2026-07-21-anon-phase1.md`（15 个任务）完成第一阶段：后端 Express + TS + Mongoose 脚手架（vitest + mongodb-memory-server，33 用例全绿）、认证（邀请码注册 + `SUPER_ADMIN_EMAIL` 首超管引导、bcrypt cost 12）、个人资料与超管邀请码后台、项目/预置与自定义角色/权限中间件、指定与开放邀请链接、文件上传与鉴权下载（multer，可见范围字段预留未启用）、待办 CRUD/筛选/排序/完成带附件/模板导出导入（锚点偏移重算）、提醒（`ReminderLog` 去重 + SMTP 存根 + `POST /api/cron/reminders`）；前端 Vite + React 全部页面（登录/注册/项目列表/工作台四 Tab/邀请接受/个人资料/超管后台，含日夜主题）。工程侧含 `docker-compose.yml`（mongo:7，可选）、`.gitignore`、`docs/api.md`、`docs/readme.md`。端到端冒烟基于 mongodb-memory-server 全流程通过（Task 15 报告）。详细逐任务改动见 `docs/progress.md`。



### 2026-07-21 第二阶段落地



* **财务**：金额一律**整数分**（元提交、服务端转分）；门票价×售票数实时计入**盈亏**；结算口径为「门票收入与全员支出归入公款池、按全员均摊并入净额」，余数按 userId 排序分摊保证合计精确；支持按成员**导出 CSV**（UTF-8 带 BOM）。

* **物料**：资源**类型**与资源多**版本**管理；图片上传经 **sharp** 生成 **WebP 预览**（≤800px、≤100KB）；类型与资源均可设**可见范围**（用户/角色）。

* **账号**：三模式（full/otp/contact）；默认 **ANONv1 浏览器端加密**（PBKDF2-SHA256 10 万次 + AES-GCM，保险库口令不入库）；可选 **server 模式 AES-256-GCM**（密钥 = SHA-256(`PLATFORM_CRYPTO_KEY`)，缺省回退 `JWT_SECRET`），reveal 接口返回明文或密文。

* **可见范围优先于权限点**：账号/物料设置 visibility 后，仅列出的用户/角色可见（超管不受限），不再走权限点放行。

* 新增权限点：`finance:manage`、`materials:manage`、`accounts:manage`；新增环境变量 **`PLATFORM_CRYPTO_KEY`**（可选，平台账号服务端加密密钥）。



---


### 2026-07-21 财务权限拆分

* 财务权限点拆分为 `finance:manage`（完整管理与查看、门票设置、按人导出 CSV）与 `finance:add`（仅可添加并管理自己添加的账目，无项目级汇总与导出权限）；预置角色 美工/宣发/一般staff 默认带 `finance:add`。


---

### 2026-07-24 前端 UI 焕新

* 前端全部页面（登录/注册/邀请接受、项目列表、工作台 7 Tab、个人资料、管理页）由手写 CSS 迁移至 **Tailwind CSS v4 + shadcn/ui**（new-york / neutral），图标 lucide-react，通知 sonner（`alert()`/`confirm()` 全部替换为 toast / AlertDialog）；旧手写 CSS 类（page/card/row/chip/muted/error/field/grid-2/tabs/active/ghost/danger/theme-toggle/app-header/spacer）删除后核对零残留。

* **双风格主题**：`localStorage` 键 `anon-theme`（light/dark → `<html>` 的 `.dark` 类）与 `anon-style`（minimal/playful → `data-style` 属性），简洁/明快 × 日/夜共 4 种组合即时切换；`index.html` 内联脚本首屏应用防闪烁，`theme-color` meta 随模式更新；旧用户 `anon-theme=dark` 升级后仍为暗色。

* **响应式布局**：移动端（<768px）底部导航 + 桌面端顶栏；新建/编辑表单统一走 `FormOverlay` 模式——移动端底部 Sheet、桌面端居中 Dialog（`useMediaQuery` 判定）。

* 运维约束：新增 shadcn 组件须使用 `npx shadcn@3`（v4 CLI 移除了 `--base-color` 参数，与当前 `components.json` 不兼容）；`shadcn` devDependency 已固定为精确版本 4.14.1（`index.css` 引用其内部 CSS，防止语义化升级破坏）。

---

### 2026-07-27 现场任务单

* 新增 `WorkModule` 模型（`backend/src/models/WorkModule.ts`）：名称（必填，≤100 字）、描述、地点、开始/结束时间（可空）、所需人力（`requiredCount` ≥1，默认 1）、分配成员（内嵌 `confirmedAt`/`confirmedBy` 确认记录）、`createdBy`；`projectId` 索引。
* 新增权限点 `work:manage`（`backend/src/services/permissions.ts`）。**预置角色快照说明**：角色权限以快照存于各项目文档，既有项目的预置角色不含新权限点，**不做数据迁移**——既有项目的主办角色凭 `project:manage` 在 `requirePermission` 中兜底放行全部现场操作；其他角色如需，由管理者在「角色」Tab 手动勾选（新建项目的预置角色快照自动包含该权限点）。
* 后端路由：`/api/projects/:id/work-modules`（`backend/src/routes/workModules.ts`）——GET 列表项目成员可读，POST/PATCH/DELETE 需 `work:manage`；`confirm`/`unconfirm` 本人确认成员即可、代他人需 `work:manage` 或 `project:manage`，重复确认幂等；单条操作按项目隔离（跨项目 mid 返回 404）。`/api/projects/:id/work-sheet`（`backend/src/routes/workSheet.ts`）——GET `/` 本人任务单，GET `/:userId` 需 `work:manage`。服务层 `backend/src/services/workModules.ts`：`moduleJson` 统一输出形状、`buildSheet` 实时计算任务单。
* 前端：工作台新增「现场」Tab（`frontend/src/components/project/WorkTab.tsx`：模块 CRUD/成员分配/确认与代确认/打印入口；移动端底部导航收入「更多」）；打印版式页 `/p/:id/work-sheet/print`（`frontend/src/pages/WorkSheetPrint.tsx`，`?user=me|<userId>|all`，全员模式按人分页连排，含签字/日期栏，浏览器打印或另存为 PDF）；RolesTab 权限清单自动包含新权限点。

---

### 2026-08-03 待办流程优化（快速创建 + 进度时间线 + 编辑/重新打开 + 分组列表）

* 新增权限点 `todo:create`（`backend/src/services/permissions.ts`），预置角色 美工/宣发/一般staff 默认获得。**预置角色快照说明**：既有项目角色不迁移，凭 `project:manage` 在 `requirePermission` 兜底放行（同 `work:manage` 先例），其余角色由管理者在「角色」Tab 勾选「创建待办」。
* 后端：`POST /todos` 加 `todo:create` gate（此前无权限校验）；`Todo` 新增嵌入式 `updates[]`（`_id: false`，note/attachments/createdBy/createdAt，不可编辑/删除）；新端点 `POST /todos/:todoId/updates`（multipart note + files），权限同完成（`todo:manage` 或持 `todo:complete` 的指派人），空内容 400、已完成 409；完成与进度共用中间件 `loadActionableTodo`（原 `loadTodoForComplete` 更名）；`todoJson` 批量查询扩展至 updates 的创建人与附件，输出新增 `updates[]`；通知类型新增 `todo:progress`（活动日志同步）。
* 前端：「待办」Tab 重构为按类别分组列表（组头 + 数量，「未分类」最后），顶部快速创建行（标题回车即建，「详细」预填标题打开完整表单）；新组件 `TodoFormDialog`（创建/编辑共用，默认 标题/指派人/到期，「更多字段」折叠类别/节点/提醒/备注，编辑全字段提交、空值清除）、`TodoActionSheet`（完成/进度共用备注+附件弹层）；卡片左侧圆圈一键完成，「进度」按钮提交进度形成时间线（倒序、默认 2 条可展开），⋯ 菜单纳入编辑与重新打开（`PATCH { status: 'open' }`）。
* 测试：后端新增 8 用例（todos.test.ts 2 + todo-updates.test.ts 6），共 153 全绿；前端 build（含 tsc）通过。文档同步：api.md/features.md/README/help/progress.md 与本节。

---

### 2026-08-03 表单弹层移动端浮动化（键盘防遮盖修复）

* `FormOverlay` 由「移动端底部 Sheet / 桌面端居中 Dialog」改为**全端浮动居中 Dialog**（`max-h-[85dvh]` 内部滚动）——底部 Sheet 在移动端聚焦输入框后会被虚拟键盘盖住备注与提交按钮。`index.html` viewport 增加 `interactive-widget=resizes-content`，键盘弹出时布局视口收缩、弹层随之上移。删除仅被引用的 `useMediaQuery` hook。12 处调用点全部受益；无输入框的移动「更多」Sheet 保持底部形态。
