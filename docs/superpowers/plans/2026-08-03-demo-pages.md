# ANON 纯前端交互演示站（Cloudflare Pages）实施计划

## Context

ANON（/home/yuu/projects/anon）是面向活动组织团队的全流程协作工具：Express + MongoDB 后端（`backend/`），Vite 5 + React 18 + TS + Tailwind v4 + shadcn/ui 前端 SPA（`frontend/`）。需求：**不依赖任何后端**，在 Cloudflare Pages 部署纯前端演示站，让访客直接预览项目全部功能。形态（已与需求方确认）：

- 运行真实前端，浏览器内 mock 全部 `/api` 请求，预置一套中文示例数据。
- 访客的修改**会话保留**：mutations 写入 store 并同步到 sessionStorage（key `anon-demo-db`），刷新/同标签页重进保留；关闭标签页或点「还原示例数据」即还原种子。明确不写 localStorage（不跨会话残留）。
- 页面带演示**角标**（fixed 右下角）+ Layout 顶部横幅，标明「演示环境 · 数据为示例，修改保留于本会话」。
- 同仓库 demo 构建模式：`frontend/` 新增 `vite build --mode demo`，不触碰现有生产构建与 Docker 部署。

已验证事实（本 session 实地读取/侦察）：

- 前端多数请求经 `src/api/client.ts` 的 `api()`，但 `AuthImg.tsx`、财务 CSV 导出（`FinanceTab.tsx:178`）**直调 `window.fetch`** → mock 必须包装 `window.fetch`。
- `src/auth.tsx`：`getToken()`（localStorage `anon-token`）为 null 时跳过 `/api/me` 视为未登录 → demo 启动先种 token。
- `src/main.tsx:14` `registerSW({ immediate: true })`（虚拟模块 `virtual:pwa-register`，由 vite-plugin-pwa 提供）。demo 构建须摘除 VitePWA 并 alias 该虚拟模块到 no-op stub，否则构建失败且 SW 会缓存 mock 响应。
- 生产构建：`tsc --noEmit && vite build && node scripts/patch-sw.mjs`（patch-sw 仅追加 push 处理到 dist/sw.js，demo 跳过）。
- `src/` 现零 `import.meta.env` 读取 → `VITE_DEMO` 无冲突。
- Push：`/api/push/config` 返回 `{ publicKey: null }` 时 PushBanner 完全隐藏无报错（`PushBanner.tsx`、`src/lib/push.ts`）。
- 离线队列：`enqueueOffline` 仅 `OnsitePage.tsx:91` 在 `isOfflineError`（断网/TypeError）时调用；mock 以 JSON 错误响应拒绝不会入队。
- 新手引导：`user.onboardedAt` 非 null 即不弹（`App.tsx` OnboardingGate）→ 种子用户置非 null。
- `Login.tsx:23` 已登录自动跳 `/projects`。
- 管理页入口 `user.isSuperAdmin` 控制（`Layout.tsx`）；演示用户设 false。
- 项目 9 Tab（`ProjectHome.tsx` TABS）：看板/待办/财务/物料/账号/现场/成员/角色/设置；财务/角色/设置按 `myPermissions` 过滤 → 演示用户角色「管理者」给全权限。
- `frontend/public/` 现仅 `icons/`、`help/`，无 `_redirects`。
- `src/crypto.ts`：`encryptWithPassphrase(plain, passphrase)` → `ANONv2:600000:<salt>:<iv>:<data>`（PBKDF2-SHA256 600k → AES-GCM-256，纯浏览器 WebCrypto）→ mock 可运行期生成演示密文。
- 后端错误信封统一 `{ error: { code, message } }`；日期序列化为 ISO-8601 字符串；`api()` 对 `!res.ok` 抛 `Error(data.error.message)`，401 会清 token 跳登录（mock 永不返回 401）。
- **前端未调用**的后端端点（不 mock）：`/stages/*`（StageStepper 纯展示）、`/work-sheet*`（WorkSheetPrint 用 work-modules + 项目详情）、公告创建/删除、`/activities`、`/incidents` 的 GET 与 resolve、`POST /projects/:id/files`、`/dashboard/summary|my-actions|schedule` 子端点、`/risks/evaluate`、milestones PATCH/DELETE/complete、physical items GET 单条。

## Approach

按顺序实施；每步完成后 `cd frontend && npx tsc --noEmit` 应保持通过。步骤 A→B→C→D 有依赖（D 的界面挂在 A 的构建模式上），E 与 C 同步进行。

### A. Demo 构建模式

1. 新增 `frontend/.env.demo`：`VITE_DEMO=true`。
2. `frontend/package.json` scripts 新增：`"build:demo": "tsc --noEmit && vite build --mode demo"`。
3. 改 `frontend/vite.config.ts` 为函数式 `defineConfig(({ mode }) => ({ ... }))`：
   - `mode === 'demo'`：plugins 仅 `react()`、`tailwindcss()`（**不含 VitePWA**）；`resolve.alias` 增加 `'virtual:pwa-register': fileURLToPath(new URL('./src/demo/pwa-register-stub.ts', import.meta.url))`。
   - 其他 mode：保持现状（react + tailwindcss + VitePWA 原配置）。
4. 新增 `frontend/src/demo/pwa-register-stub.ts`：`export function registerSW(_opts?: unknown): () => void { return () => {}; }`。
5. 新增 `frontend/public/_redirects`：单行 `/*    /index.html   200`（Pages SPA 回退；生产 nginx 仅当静态文件，无副作用）。
6. 改 `frontend/src/main.tsx`：在 `registerSW(...)` 行之前插入：
   ```ts
   if (import.meta.env.VITE_DEMO === 'true') {
     const { installDemo } = await import('./demo/install');
     await installDemo();
   }
   ```
   生产构建中 `import.meta.env.VITE_DEMO` 静态替换为 `undefined`，条件折叠为 false，demo chunk 被 tree-shake（Verification 步骤 1 验证）。

### B. Mock 内核（`frontend/src/demo/`）

7. `frontend/src/demo/install.ts` 导出 `async function installDemo()`：
   - `localStorage.getItem('anon-token')` 为空时写入 `'demo-token'`。
   - store 初始化（会话保留）：读 `sessionStorage.getItem('anon-demo-db')`，存在且其中 `version === DB_VERSION` → JSON.parse 得 db；否则 `await buildSeed()`（async：账号密文需 `encryptWithPassphrase`）并立即 `persist()`。
   - `persist()`：`try { sessionStorage.setItem('anon-demo-db', JSON.stringify(db)) } catch { /* QuotaExceeded 静默忽略，退化为当次内存态——同 offlineQueue.ts save 的容错模式 */ }`。触发时机：`route()` 内每个非 GET handler 成功完成后统一调一次（GET 不改 store）。
   - `DB_VERSION = 1`（seed.ts 导出常量）：种子结构变更时递增，旧会话数据自动作废重种，防 schema 漂移。
   - 保存原 fetch 并包装：
     ```ts
     const origFetch = window.fetch.bind(window);
     window.fetch = async (input, init) => {
       const url = new URL(typeof input === 'string' ? input : input.url, location.origin);
       if (!url.pathname.startsWith('/api/')) return origFetch(input as never, init);
       const method = (init?.method ?? 'GET').toUpperCase();
       const res = await route(db, method, url, init, origFetch);
       return res;
     };
     ```
   - `route()` 统一加 ~80ms 延迟让骨架屏可见；未匹配返回 404 `{ error: { code: 'not_found', message: 'Not Found' } }`。
8. `frontend/src/demo/router.ts`：表驱动 `{ method, re: RegExp, keys: string[], handler }[]`，按序匹配；handler 签名 `(ctx: { db: Db; params: Record<string,string>; query: URLSearchParams; body: any; origFetch } ) => Promise<Response>`。body 解析：`init.body` 为 string → `JSON.parse`；`FormData` → 原样传 handler；undefined → undefined。JSON 响应助手 `json(data, status=200)`。
9. 文件/图片策略：
   - 新增 `frontend/public/demo/poster.svg`、`frontend/public/demo/floorplan.svg`（手写小 SVG，各 <8KB，海报风/场地平面图风）。
   - `db.files: Record<string, { dataUrl?: string; asset?: string; filename: string; mime: string; size: number }>`（普通对象而非 Map，保证 db 可 JSON 序列化）。种子附件指向 `asset: '/demo/poster.svg'` 等；会话上传的 File 在 handler 内用 `FileReader.readAsDataURL` 转成 base64 data URL 存 `dataUrl`（小图，sessionStorage 可容）。
   - 命中下载/预览：`asset` → `origFetch(asset)` 透传 Response；`dataUrl` → `origFetch(dataUrl)`（浏览器原生支持 fetch data: URL，直接得 blob Response）。
   - 财务 CSV 导出：浏览器内拼串（格式见接口表），`new Response('\uFEFF' + csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="finance-${userId || 'all'}.csv"` } })`。

### C. 种子数据（`frontend/src/demo/seed.ts`）

10. `buildSeed()` 日期全部相对 `new Date()` 计算：活动开始 = +21d 09:00、结束 = +22d 17:00；待办 nodeAt/dueAt 散布 -10d…+20d；公告/动态 -5d…0d。id 用稳定字符串（`'u-demo'`、`'p-demo'`、`'t-01'`…），会话新增用 `crypto.randomUUID()`。
11. store 集合：`version(DB_VERSION), users, projects[], members, todos[], transactions[], ticketTypes, resourceTypes[], resources[], versions(嵌于 resource), accounts[], workModules[], physicalCategories[], physicalItems[], physicalLogs[], announcements[], risks[], activities[], milestones[], incidents[], dashboardPreferences, inviteCodes[], files(Record)`。
12. 内容（项目 1 `p-demo`「示例·夏日同人祭」，地点「上海世博展览馆」）：
    - 演示用户 `u-demo`：林小满 / demo@anon.local / isSuperAdmin:false / contacts:[{platform:'QQ',value:'10001'}] / onboardedAt: 种子时刻。
    - 成员 6 人（含 u-demo）：角色「管理者」(u-demo)、「财务」×1、「成员」×4；角色数组含三角色。`myPermissions` 固定返回前端实际检查的全部 12 个权限点（`grep -o "'[a-z]*:[a-z]*'" frontend/src` 穷尽）：`['accounts:manage','file:upload','finance:add','finance:manage','materials:manage','member:manage','project:manage','role:manage','todo:complete','todo:create','todo:manage','work:manage']`；「管理者」角色 permissions 同此 12 点，「财务」=['finance:add','finance:manage']，「成员」=['todo:complete','file:upload']。
    - 阶段 8 个（选题/立项/宣传/售票/筹备/布展/现场/结算），前 3 个 completedAt 非 null → currentStage='宣传'。
    - 里程碑 3：开票(-14d→已完成)、截稿(-2d)、正式开幕(+21d)。
    - 待办 15 条：类别（宣传/招商/物料/现场/财务），6 done（含 completedAt/completionNote/1 条带 updates 时间线 2 条）、9 open（2 条 dueAt 已过期、2 条指派给 u-demo 供「待我处理」演示）。
    - 财务：ticketTypes [{预售票, 5000分, 120}, {现场票, 6000分, 80}]；交易 9 条（收入 3：含门票外收入；支出 6：payer 分布 4 人、2 条 splitAmong 部分成员、1 条带凭证附件→poster.svg）。
    - 物料：类型 3（视觉设计/场地资料/周边）；资源 5：「主视觉海报」（2 版本，v1/v2 均 hasPreview→poster.svg，体验版本切换）、「场地平面图」（1 版本→floorplan.svg）、「摊位号表」（1 版本无预览）、「周边清单」（0 版本，触发 material:no_versions 风险）、「宣传文案」（1 版本）。
    - 平台账号 3：微博（mode:'full', cipherKeySource:'user', 密文=`await encryptWithPassphrase('Weibo@Demo2026', 'demo')`，note 写明「演示口令：demo」）、BOOTH（mode:'otp'，addedBy 带 contacts）、画师联络-阿桔（mode:'contact'）。
    - 现场模块 4：布展(+21d 07:00-09:00, 需4人/派3→staff_shortage)、收银(+21d 全天, 需2/派2, u-demo 已确认)、看摊轮班(+21d, 需3/派3, u-demo 未确认→供「待我处理」确认演示)、撤展(+22d 17:00-19:00, 需4/派2)。
    - 实物：分类 2（物料/设备）；物品 6（桌布×2、收款码立牌、POS 充电线等，状态混合 in_stock/planned/in_use，2 条带 logs）。
    - 公告 3：普通（摊位须知）、重要（布展时间变更, requireConfirmation:true, u-demo 未确认）、紧急（台风预案提醒）。
    - 风险 2（预烘焙实例）：`work:staff_shortage` critical（布展模块）、`todo:overdue` warning（2 条逾期待办）；状态 active。
    - 动态 10 条：覆盖 todo/finance/materials/work/announcement 类型，时间 -5d…-1h。
    - incidents 1 条 open（设备类「排插数量不足」）。
    - dashboardPreferences 默认：`{ defaultView:'project', collapsedCards:[], hiddenCards:[], scheduleRange:7, cardOrder:[] }`。
13. 项目 2 `p-live`「示例·秋季 Live」：基础信息 + 阶段 8 全未完成 + 空模块；成员仅 u-demo（管理者）。所有集合查询按 projectId 过滤自然返回空。ProjectSummary 由聚合逻辑现算（health:'normal'、todoCompletionRate:0、activeRiskCount:0）。

### D. 界面标识与入口

14. 新增 `frontend/src/components/DemoBadge.tsx`（角标）：`import.meta.env.VITE_DEMO !== 'true'` → null；否则渲染
    ```tsx
    <div className="fixed bottom-3 right-3 z-50 print:hidden" title="数据为示例，修改保留于本会话，关闭标签页即还原">
      <span className="rounded-full border border-amber-500/40 bg-amber-500/90 px-3 py-1 text-xs font-semibold text-white shadow">演示环境</span>
    </div>
    ```
    在 `App.tsx` 的 `<Routes>` 同级（Fragment 内）挂载 `<DemoBadge />` → 覆盖全部页面含登录页/现场模式；`print:hidden` 保证任务单打印干净。
15. 新增 `frontend/src/components/DemoBanner.tsx`：复制 `TrialBanner.tsx` 版式（amber 边框 + Badge + 说明），文案 `演示环境 · 数据为示例，修改保留于本会话`，右侧 `还原示例数据` 按钮（`size="sm" variant="outline"`，`onClick={() => { sessionStorage.removeItem('anon-demo-db'); location.reload(); }}`）；非 demo 返回 null。`Layout.tsx` 在 `<TrialBanner />` 前挂载（TrialBanner 因 trialExpiresAt=null 自然不渲染，不冲突）。
16. 改 `frontend/src/pages/Login.tsx`：`const isDemo = import.meta.env.VITE_DEMO === 'true'`；为 true 时在 `<form>` 上方渲染提示块：「这是功能预览演示，无需账号，点击下方按钮直接进入」+ `进入演示` 按钮（`type="button"`，onClick 用固定值 `demo@anon.local`/`demo-pass-123` 调用既有 `submit` 路径——抽取 submit 逻辑使按钮与表单共用，或直接 `setEmail/setPassword` 后 `form.requestSubmit()`，选改动小的后者）。mock 登录接受任意凭据。
17. mock `POST /api/auth/register` → 403 `{ error: { code: 'demo_readonly', message: '演示环境无需注册，请从登录页直接进入演示' } }`。

### E. Mock 接口表（全部按 `frontend/src/types.ts` shape；聚合规则源自后端源码，file:line 见注）

通用：路径中 `:pid` 不匹配种子项目 → 404 not_found；所有写接口生效于 store 并由 `route()` 统一 `persist()`（B-7），返回后端同款响应。

| 方法+路径 | 行为 |
|---|---|
| POST /api/auth/login | 任意凭据 → `{ token:'demo-token', user: 演示用户 }` |
| POST /api/auth/register | 403 demo_readonly（见 D-17） |
| GET /api/me | `{ user, trialExpiresAt: null }` |
| PATCH /api/me | 更新 name/contacts → `{ user }` |
| POST /api/me/onboarded | 置 onboardedAt → `{ user }` |
| GET /api/projects | `{ projects: ProjectSummary[] }` 现算（规则 R1） |
| POST /api/projects | body {name,startDate?,endDate?} → 201 `{ project }`（空项目入 store，u-demo 为管理者，默认 8 阶段模板） |
| GET /api/projects/:pid | `{ project, members, myRole:'管理者', myPermissions: C-12 的 12 权限点 }` |
| PATCH /api/projects/:pid | 更新 name/description/startDate/endDate/location/timezone/status → `{ project }`（重算 currentStage，R2） |
| GET /api/projects/:pid/dashboard?scheduleDays=N | DashboardData 现算（R3），N clamp 30 |
| PATCH /api/projects/:pid/dashboard/preferences | 合并存入 store → preferences 对象 |
| GET /api/projects/:pid/risks | `{ risks:[含 ignored* 全字段, active+ignored, level 降序后 lastDetectedAt 降序], health }`（R4） |
| POST /api/projects/:pid/risks/:rid/ignore | body {reason, ignoredUntil?} → 置 status:'ignored'+字段 → `{ risk }` |
| POST /api/projects/:pid/risks/:rid/restore | 置 status:'active'，清 ignored* → `{ risk }` |
| POST /api/projects/:pid/announcements/:aid/confirm | 置 confirmedByMe → `{ ok:true, confirmedAt: now }` |
| GET /api/projects/:pid/todos?category&assignee&status&sort&order | `{ todos }` 过滤+排序（status=open\|done；sort=dueAt\|nodeAt\|createdAt，null 排尾） |
| POST /api/projects/:pid/todos | 201 `{ todo }`（assignees 由 userId 解析出 name） |
| PATCH /api/projects/:pid/todos/:tid | `{ todo }`（status:'open' 重开时清 completed*） |
| DELETE /api/projects/:pid/todos/:tid | `{ ok:true }` |
| POST …/todos/:tid/complete | FormData(completionNote, files[]) → 置 done+completedAt/By/Note，附件入 db.files → `{ todo }` |
| POST …/todos/:tid/updates | FormData(note, files[]) → 追加 TodoUpdateItem → 201 `{ todo }` |
| GET …/todos/template/export | 烘焙 `{ name:'示例模板', exportedAt:now, anchorField:'end', anchorDate:项目endDate, todos:[{title,category,note,nodeOffsetMs,dueOffsetMs,remindOffsetMs}×5] }` |
| POST …/todos/template/import | body {template,anchor:'start'\|'end',date} → 按 anchorDate=传入 date、各 offset 现算生成待办入 store → 201 `{ created:n }` |
| GET /api/projects/:pid/finance | `{ transactions, summary }`（summary 现算，R5） |
| POST /api/projects/:pid/finance | FormData(type,amount 元,note,payerUserId,splitAmong,files[]) → 201 `{ transaction }` |
| PATCH /api/projects/:pid/finance/ticket | body {ticketTypes, ticketIncomeCents} → 更新 store → `{ summary 同款财务字段 }`（按后端 finance.ts 实际返回；实现时核对 FinanceTab.tsx:156 调用后未用返回值，返回 `{ ok:true }` 亦可——以 finance.ts PATCH /ticket 真实响应为准） |
| DELETE /api/projects/:pid/finance/:txId | `{ ok:true }` |
| GET /api/projects/:pid/finance/export?userId= | CSV（R6） |
| GET /api/projects/:pid/materials/types | `{ types }` |
| POST …/materials/types | 201 `{ type }` |
| PATCH/DELETE …/materials/types/:typeId | `{ type }` / `{ ok:true }` |
| GET /api/projects/:pid/materials?typeId= | `{ resources }`（latestVersion、hasPreview 现算） |
| POST …/materials (FormData: file?,typeId,name,description,note?) | 201 `{ resource }`（有 file 则同时建 v1 版本+files 入 Map） |
| GET/PATCH/DELETE …/materials/:rid | `{ resource }` / `{ resource }` / `{ ok:true }` |
| GET …/materials/:rid/versions | `{ versions }`（version 降序） |
| POST …/materials/:rid/versions (FormData: file,note) | 201 `{ version }`（latestVersion+1，file 入 Map；图片 mime 置 hasPreview:true） |
| GET …/materials/:rid/versions/:v/preview | 图片 blob（B-9 策略）；非图片/无文件 → 404 |
| GET …/materials/:rid/versions/:v/download | blob + Content-Disposition attachment |
| GET …/materials/:rid/preview | 最新版本预览（无 → 404） |
| GET /api/projects/:pid/physical/categories | `{ categories }`（order 升序） |
| POST …/physical/categories | 201 `{ category }` |
| PATCH …/physical/categories/reorder | body {order:string[]} → `{ categories }` |
| PATCH/DELETE …/physical/categories/:cid | `{ category }` / `{ ok:true }` |
| GET …/physical/items?categoryId&status&responsibleId&tag&sort&order | `{ items }` |
| POST …/physical/items | 201 `{ item }` |
| PATCH/DELETE …/physical/items/:iid | `{ item }` / `{ ok:true }` |
| POST …/physical/items/:iid/log | body {type,delta?/status?,note} → 调整数量/状态+追加 log → `{ item }` |
| GET …/physical/items/:iid/logs | `{ logs }`（createdAt 降序 ≤100） |
| GET …/physical/summary | **不带信封**的 PhysicalSummary（total+byCategory 现算） |
| GET /api/projects/:pid/accounts?platform= | `{ accounts }`（mode='otp' 的 addedBy 含 contacts，其余不含） |
| POST …/accounts | 201 `{ account }`（full+server 存明文密码入 store；full+user 存 cipher） |
| PATCH/DELETE …/accounts/:aid | `{ account }` / `{ ok:true }` |
| POST …/accounts/:aid/reveal | cipherKeySource='server' → `{ password }`；'user' → `{ cipher }` |
| GET /api/projects/:pid/work-modules | `{ modules }` |
| POST …/work-modules | 201 `{ module }` |
| PATCH/DELETE …/work-modules/:mid | `{ module }` / `{ ok:true }` |
| POST …/work-modules/:mid/confirm\|unconfirm | 置/清当前用户 confirmedAt → `{ module }` |
| POST …/work-modules/:mid/checkin\|finish | 置 checkedInAt/completedAt → `{ module }` |
| GET /api/projects/:pid/milestones | `{ milestones }` |
| POST …/milestones | 201 `{ milestone }` |
| GET /api/projects/:pid/onsite | OnsiteData 现算（R7） |
| POST /api/projects/:pid/onsite/incidents | body {category,note,moduleId?} → 201 `{ incident }`（入 store） |
| GET /api/invites/:token | 任意 token → `{ invite:{ projectName:'示例·夏日同人祭', roleName:'成员', expiresAt:+7d, targeted:false } }` |
| POST /api/invites/:token/accept | `{ ok:true, projectId:'p-demo' }` |
| GET /api/admin/invite-codes | `{ inviteCodes:[烘焙 2 条] }` |
| POST /api/admin/invite-codes | 201 `{ code, id }`（入 store） |
| GET /api/push/config | `{ publicKey: null }` |
| POST /api/push/subscription | `{ ok:true }` |
| DELETE /api/push/subscription | `{ ok:true, removed:1 }` |
| GET /api/files/:id | db.files 查找 → blob 下载（B-9）；未找到 → 404 |

**聚合规则（实现依据，均为后端真实逻辑）：**

- **R1 ProjectSummary**（backend/src/routes/projects.ts:75-119）：todoCompletionRate=round(done/total×100)（total=0 → 0）；activeRiskCount=status='active' 风险数；health=computeHealth（≥1 critical→'critical'；≥2 warning→'at_risk'；1 warning 或 ≥1 info→'attention'；否则 'normal'）；stageProgress={completed,total}；currentStage 见 R2；myRole='管理者'。
- **R2 currentStage**（projects.ts:22-39）：stages 按 order 排序后第一个 completedAt=null 的 name；全无则 ''。
- **R3 DashboardData**（routes/dashboard.ts:92-134 + services/dashboard.ts:141-153）：
  - metrics：todoCompletionRate 同 R1；overdueCount=open 且 dueAt<now；budgetUsageRate=round(expense/(ticketIncome+income)×100)，分母 0 → null；pendingMaterialCount=无版本资源数；workConfirmationRate=round(confirmed/assigned×100)，assigned=0 → 100；memberCount；activeRiskCount。
  - modules.todos：{total,done,open,overdue,dueThisWeek(open 且 dueAt ≤ now+7d),completionRate}；modules.finance={ticketIncomeCents,incomeCents,expenseCents,profitCents}（演示用户有权限，不返回 null）；modules.materials={totalResources,noVersionCount,recentCount(createdAt ≥ now-7d)}；modules.work={totalModules,totalRequired,totalAssigned,confirmedCount,shortageCount(assigned<required 的模块数)}。
  - myActions.items：u-demo 的 open 待办（action:'complete'，detail=类别）+ 未确认现场指派（action:'confirm'，detail=模块时间）；isOverdue=dueAt<now；逾期优先后按 dueAt 升序。
  - schedule.groups：窗口 now…now+N 天内，todos(dueAt)/work(startAt)/milestones(date, allDay:true)/项目起止（'活动开始'/'活动结束'）→ ScheduleItem{ id, sourceType, title, time:ISO, allDay }；按本地 YYYY-MM-DD 分组，label='今天'|'明天'|'MM-DD'。
  - announcements.items ≤5（isPinned 优先、publishedAt 降序；未过期）；activities.items ≤10（createdAt 降序）。
  - risks：active only，level 降序，字段为 dashboard 版（**不含** ignoredBy/ignoredUntil/ignoreReason/resolvedAt）；health 同 R1。
- **R4 /risks 全字段**（routes/risks.ts:17-34）：dashboard 字段 + resolvedAt/ignoredBy/ignoredUntil/ignoreReason（均 string|null）。
- **R5 FinanceSummary**（services/finance.ts:55-135）：ticketIncomeCents=Σ ticketTypes price×count；incomeCents/expenseCents 按交易类型汇总；perUser：income→payer −amt；expense→payer +amt 减 splitAmong 均摊（余数 +1 分给前 N 人；splitAmong 空=全员）；perUser 按 userId 排序；profitCents=ticketIncome+income−expense，盈余全员均摊进 net；settlement=贪心 debtor→creditor {from:{userId,name},to:{userId,name},amountCents}。
- **R6 财务 CSV**（routes/finance.ts export）：BOM `\uFEFF`；表头 `日期,类型,金额(元),付款人,参与平摊,备注,添加人`；行分隔 `\r\n`；日期 `YYYY-MM-DD HH:mm:ss`；类型 `收入`/`支出`；金额 toFixed(2)；参与平摊=`全员` 或名字 `、` 连接；?userId= 过滤该用户相关交易。
- **R7 OnsiteData**（routes/onsite.ts:85-167）：now=当前 ISO；myModules=u-demo 被指派的模块，state：completedAt→'done'，startAt≤now≤endAt→'current'，否则 'upcoming'，按 state 序后 startAt 排序；myAssignee={confirmedAt,checkedInAt,completedAt}；emergency=type∈{emergency,important} 公告 ≤5；contacts=成员+其 contacts+roleName；incidents=store 全量（createdAt 降序 ≤50）。

## Critical files & anchors

- `frontend/src/main.tsx:14` — demo install 插入点（`registerSW` 调用之前）。
- `frontend/vite.config.ts` — demo mode 分支（摘 VitePWA + alias `virtual:pwa-register`）。
- `frontend/src/api/client.ts` — `api()` 错误信封/401 约定；mock 响应须兼容（永不 401）。
- `frontend/src/components/TrialBanner.tsx` — DemoBanner 复制的版式样板；`Layout.tsx` 中 `<TrialBanner />` 处为挂载点。
- `frontend/src/components/AuthImg.tsx` — 直取 window.fetch 的典型，物料预览是验证 fetch 包装正确性的试金石。
- `frontend/src/types.ts` — 全部响应 shape 的唯一权威（mock handler 逐字段对齐）。

## Verification

1. **构建**：`cd frontend && npm run build:demo` 通过；`dist/` 无 sw.js、无 manifest.webmanifest、有 `_redirects`；再跑 `npm run build`（生产）通过且产物含 sw.js、assets 列表无 demo chunk（对比两构建文件列表确认 tree-shake 生效）。
2. **本地冒烟**：`cd frontend && npx vite preview`（预览 demo 产物，`dist` 为 demo 构建结果时）浏览器打开：
   - `/` → 直接进项目列表（种子 token），2 个项目卡片带健康点/倒计时/进度。
   - 进项目 1：9 Tab 全显；看板倒计时/指标/风险 2 条/公告 3 条/日程分组/阶段进度条正常；物料「主视觉海报」预览图显示且 v1/v2 切换预览变化（AuthImg→mock）；账号「微博」条目输入口令 `demo` 解密出密码。
   - **会话保留**：完成一条待办 → toast 成功、待办列表与看板 myActions/计数更新（重新 load）；F5 刷新 → 修改仍在；点横幅「还原示例数据」→ 恢复种子；另开新标签页访问站点 → 种子状态（sessionStorage 按标签页隔离）。会话内上传图片作物料新版本 → 预览立即可见，F5 后仍可预览（data URL 已持久化）。
   - 财务导出 CSV 下载非空、Excel 打开中文不乱码（BOM）；任务单打印页（现场 Tab 入口 → /p/:id/work-sheet/print）渲染且打印预览无角标。
   - DevTools Network：**零真实 /api 请求发出**（全部被 mock 拦截），控制台无报错。
   - 右下角角标常显；Layout 顶部横幅可见，点「还原示例数据」页面重载数据还原；退出登录 → 登录页「进入演示」按钮一键回站。
3. **Cloudflare Pages 部署**（二选一）：
   - Dashboard：Pages 项目连仓库 → 构建命令 `cd frontend && npm ci && npm run build:demo`，输出目录 `frontend/dist`，环境变量 `NODE_VERSION=20` → 访问 `*.pages.dev` 重跑第 2 步关键路径，并直接访问 `https://<site>/projects` 深链验证 `_redirects` 生效。
   - CLI：`cd frontend && npm ci && npm run build:demo && npx wrangler pages deploy dist --project-name=<项目名>`。

## Assumptions & contingencies

- **聚合现算**：dashboard/finance/onsite/项目列表按 R1–R7 从 store 现算（规则已给出精确公式与后端出处）。若实施中发现某规则隐含未列出的后端依赖（如 myActions 排序细节），按「与种子数据自洽、随会话修改正确变化」为准补齐，不追求与后端逐字节一致。
- **会话保留边界**：持久化仅到 sessionStorage（按标签页隔离、关页即清），明确不用 localStorage。若写入触发 QuotaExceededError，静默退化为当次内存态，不阻塞操作。
- **占位图**：手写 SVG（poster/floorplan）即可；若后续要 PNG，B-9 透传策略不变，仅换资产文件。
- **演示口令**：微博账号保险库口令固定 `demo`，写在该条目 note 字段供访客查看。
- **PATCH /finance/ticket 返回 shape**：以 `backend/src/routes/finance.ts` 该路由实际响应为准（前端未消费返回值，错配风险低）。
- **Pages 构建 Node 版本**：默认 `NODE_VERSION=20`；若 Pages 构建报 engine/语法错误，改 `NODE_VERSION=22` 重试。
- **`vite preview` 与 mode**：`vite preview` 服务的是 `dist/` 当前产物，与 build mode 无关；冒烟前先跑 `build:demo`。
