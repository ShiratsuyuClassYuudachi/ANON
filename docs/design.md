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

    4. 可以对每个账号记录设置平台类型，如QQ，小红书，微博等常用平台

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

---

### 2026-08-03 纯前端演示站（Cloudflare Pages）

* 目标：不依赖任何后端，在 Cloudflare Pages 部署可公开访问的功能预览站。形态：运行真实前端 + 浏览器内 mock 全部 `/api` + 中文示例数据，访客免登录直进。
* **构建隔离**：`vite build --mode demo` 为同仓库变体——demo 模式摘 VitePWA（防 SW 缓存 mock 响应）、alias `virtual:pwa-register` 到 no-op stub、`build.target=es2022`（入口顶层 await 安装 mock 需要）；`main.tsx` 以 `import.meta.env.VITE_DEMO === 'true'` + 动态 `import('./demo/install')` 加载 mock，生产构建静态替换为 false 后 demo chunk 被 tree-shake（产物零 demo 字符串，已验证），生产与 Docker 部署零影响。
* **mock 内核**（`frontend/src/demo/`）：`install.ts` 种 token + 恢复/重建内存库 + 包装 `window.fetch`（必须包 fetch 而非仅 api client——`AuthImg`/CSV 导出直调 window.fetch）；`router.ts` 表驱动有序匹配（字面量先于参数路由）；`handlers/` 9 模块响应 shape 逐字段对齐 `types.ts` 与后端错误信封、永不 401；`aggregate.ts` 按后端公式现算项目列表/dashboard/finance/onsite（R1–R7），访客会话修改正确驱动看板指标与结算建议。
* **会话保留**：mutation 后统一 `persist()` 到 `sessionStorage['anon-demo-db']`——按标签页隔离、关页即清（明确不用 localStorage）；写失败静默退化；`DB_VERSION` 递增作废旧会话防 schema 漂移；横幅「还原示例数据」删键 reload 即重种。
* **种子**（`seed.ts`）：日期全部相对 `new Date()`（任意时刻打开都是「筹备中」）；2 项目/6 成员/15 待办/9 账目/5 物料/3 账号/4 现场模块等；微博密码为真 `encryptWithPassphrase` 密文（口令 `demo`），解密走生产同一 WebCrypto 路径。
* **标识**：`DemoBadge` 右下角角标（print:hidden）+ `DemoBanner` 顶部横幅（还原按钮）+ Login「进入演示」按钮，均以 `VITE_DEMO` 为条件静态消除；mock 注册 403 `demo_readonly`。部署说明与维护指南见 `docs/demo-site.md`，实施计划见 `docs/superpowers/plans/2026-08-03-demo-pages.md`。

---

### 2026-07-30 ~ 08-05 项目看板、现场模式与存储/安全基建

* **项目看板（Dashboard）**：一屏聚合倒计时、阶段步进器与自定义阶段管理、关键里程碑、8 条风险探测规则（支持填写原因与期限的忽略闭环）、待我处理快捷操作、普通/重要/紧急三类公告（含确认名单与可见范围）、操作动态流与用户级视图/卡片布局偏好。
* **对象存储抽象**：支持 S3 兼容对象存储（生产编排默认内嵌 MinIO），未配置 `S3_ENDPOINT` 时无缝回退本地磁盘 `UPLOAD_DIR`。
* **现场模式与 PWA**：`/p/:id/onsite` 极简大字号页面，支持签到/完成、六分类异常上报、紧急公告置顶、电话直拨与断网离线操作队列；`vite-plugin-pwa` 提供离线应用外壳，移动端「更多」面板内置主屏安装指引。
* **实物清单与试用模式**：「物料」Tab 增加独立「实物清单」视图（分类、计划/在库/使用/损耗四数量、状态流转与权限化变动日志）；登录接口内置 `TRIAL_EMAIL` 24 小时独立演示沙箱与定时级联清扫。
* **安全加固与导航/导览升级**：会话升级为 15 分钟短期 access JWT + 30 天滚动轮换 refresh token（sha256 落库），增加 `/api/auth/*` 限流、位图与安全格式预览白名单、非 root 容器、严格 CSP 及 `osv-scanner` 依赖扫描 CI；桌面端改左侧固定边栏 + 顶栏分体式项目切换器，driver.js 导览升级为跨页面自动跳转全模块指引，帮助中心新增全文搜索与「活动全流程」章。

---

### 2026-08-07 ~ 08-18 实用工具体系、OpenAPI 模式与边缘部署

* **舞台时间编排（Stage Rundown）与执行大屏**：支持多份流程单、拖拽/键盘排序、自动推算起止时段、勾选列导出长文本自动换行 2 倍高清 PNG 与纯文本；新增演出当日「执行模式」（当前节目追踪、一键顺延、未演节目双向实时级联推算、未执行槽位局部重排）与免登录公开「现场大屏」（`/screen/:token`，深色高对比投屏、白名单脱敏、全员紧急公告上屏）。
* **舞台报名审核（Stage Signup）**：按批次设定舞台可用时长收集节目，按名称排序自动高亮「撞名」条目，勾选实时试算容量盈亏，成员投票评议后侧滑拍板，已通过节目一键追加导入既有 Rundown。
* **失物招领（Lost & Found）**：默认全角色授予 `lostfound:manage`（启动幂等补授），支持单张照片 WebP 缩略、待认领/已认领状态流转、现场模式快捷登记卡片，以及免登录对外公开查找页（`/lf/:token`）。
* **自定义工具接入与 OpenAPI 模式**：项目「工具」Tab 支持登记自研外部 Web 组件（沙箱 iframe 页内嵌入或新标签页打开）；开启「携带用户身份」后通过页内 `postMessage` 握手（移动端无 `opener` 环境自动切换一次性 `#anon_launch=` fragment 兜底）投递 5 分钟启动令牌，经 `POST /api/open/exchange` 兑换绑定单项目、按 `scopes ∩ 用户实时角色权限` 收窄的 30 天 `anonk_` API 密钥；个人中心支持自助生成 30 天或永久 API 密钥。
* **Cloudflare Workers 边缘入口**：`worker/` 托管前端静态资产并将 `/api/*` 反代回源站（透传真实客户端 IP、双端同步安全响应头、边缘直接应答 QQ webhook 验证与 ACK）。

---

### 2026-11-27 画册视觉重塑、全链路术语统一与 `anon tokyo` 适配

* **画册排版与壳层重构**：去除外层占屏简介头卡与多层嵌套圆角框，桌面活动区采用左侧通高四组书脊目录 + 右侧纯净纸页，移动端升级为最多 5 格等宽底栏（保留看板直达）；高频列表（待办、财务、账号、现场排班、成员、工具子视图及公告/风险）改用开放节界与细横线分栏；财务列表将事由前置并去除常规支出的红底告警胶囊。
* **前后端与演示站文案统一**：全链路统一以「活动」替代后台「项目」暴露词，「现场岗位 / 我的排班 / 现场排班单 / 文件资料 / 新建资料 / 本分类及子分类 / 负责人 / 个人视角 / 活动全貌 / 待处理风险 / 舞台时间编排 / 正常·留意·预警·紧急」贯穿前后端与 `demo` 内核（严格保持路由、Schema、权限点与错误码不变）。
* **三档主题与千早爱音 `anon tokyo` 适配**：在保留默认「简洁」与「明快」基础上新增第 3 档 `anon tokyo`（樱雾白纸面 `#fdfbfa` / 深樱炭黑 `#141216`、官方应援樱粉 `#ff8899` / 日间 `#ce3d60`、ESP 冲浪绿语义色 `#0e7c6b` / `#73d9be`），并覆盖双色预览圆点、封面双色渐变短线、全端移动端主题直选入口及 `theme-init.js` 首屏 `theme-color` 同步。

---

### 2026-08-18 ~ 10-22 三渠道通知与 QQ 机器人交互生态

* **QQ 机器人通知与多群订阅**：接入 QQ 开放平台 Bot API v2（Ed25519 webhook 验签 + 去重），一次性 6 位绑定码关联个人单聊（接收全量个人通知）与项目多群（每群独立勾选 7 类精选通知，支持个人群内身份补绑）。
* **AI 智能录入与分段上传**：接入 OpenAI 兼容模型（默认 DeepSeek Flash，按项目本地时区提供日历锚点），支持群内 `@机器人` 或单聊一句话创建待办（群 `@成员` 三层身份对照自动指派，来源群提醒定向回源）、提交待审核舞台报名（支持逐群开关全员免绑报名授权）、录入单笔人民币收支记账（预览确认后入账，平摊不明默认全员）；另支持不依赖 AI 的分段批量物料上传。
* **聊天记录导出与内置帮助**：支持合并转发即时导出及单聊「开始导出 / 结束导出」收集模式（直发图片抓取内嵌 base64），生成带 UTF-8 BOM 的 Markdown 文件经 `/dl/:id` 鉴权下载；内置 `帮助` / `/help` 总菜单与六类分项指引，查阅帮助不中断既有录入草稿。

---

### 2026-10-16 ~ 11-20 物料升级、未注册成员、工作台安全与账目改额

* **物料两级类别与 1GB 分片上传**：数字资源升级为最多两层类别结构（联动筛选、独立类别管理、资源→子类→一级逐级可见范围继承）；默认折叠等高卡片与 80×80 缩略图，大图按动态视口等比缩放，扩展 PDF/Markdown/常见音视频内联预览；新增 8MB 串行分片上传会话，单文件上限提升至 1GB，支持实时进度展示与失败保留重试。
* **未注册成员档案与混合指派**：新增 `ExternalMember` 模型，无需注册账号仅凭姓名即可建档，支持待办与现场模块混合指派、管理者代确认/代签到/代完成/代报进度及独立或全员任务单打印；成员日后注册入项可一键关联账号，自动合并去重并接续全部历史状态。
* **工作台视觉基础与跨标签页会话安全**：项目工作台增加统计汇总与多维搜索；统一四主题 WCAG AA 对比度令牌与移动端 44px 触控尺寸；前端 `fetch`/上传全面引入随机会话隔离、Web Locks 跨标签页刷新互斥与换号防串写；后端全量 API 下发 `Cache-Control: no-store` 并脱敏请求解析错误。
* **财务账目金额修改**：账目操作菜单新增「修改金额」居中表单（预填原金额，保留原凭证附件、备注、收付款人与分摊关系），保存后实时重算汇总、每人净额与建议转账方案，纯前端演示站同步复刻完整契约。
