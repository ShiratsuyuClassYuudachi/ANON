# 纯前端演示站（Cloudflare Pages）

不依赖任何后端、可公开访问的功能预览站：运行真实前端，浏览器内 mock 全部 `/api` 请求，预置一套中文示例数据。用于向访客展示活动全部功能（10 个板块、看板聚合、物料预览、账号解密、现场模式、打印排班单等，支持切换「简洁 / 明快 / anon tokyo」三套日夜主题）。

- **构建**：`cd frontend && npm run build:demo`（= `tsc --noEmit && vite build --mode demo`），产物 `frontend/dist/`。
- **与生产构建的关系**：demo 是 vite `--mode demo` 的同仓库构建变体；生产构建（`npm run build` + Docker 部署）完全不受影响——demo 代码经动态 import + `import.meta.env.VITE_DEMO` 静态替换被 tree-shake（生产产物中零 demo 字符串/chunk，已验证），且 demo 模式摘除 VitePWA（不生成 sw.js，避免 Service Worker 缓存 mock 响应）。
- **演示数据**：种子（`DB_VERSION = 9`）含 2 个项目（「示例·夏日同人祭」+「示例·秋季 Live」）、6 名注册成员 + 1 条未注册成员档案（参与待办与现场混合指派）、15 条待办、9 笔账目 + 双票种、两层结构的 7 个物料类别与 6 个物料资源（含可预览 SVG 海报/平面图、PDF 参展指南、Markdown 宣传文案、可下载 CSV 摊位号表）、3 个平台账号、4 个现场模块、实物清单、公告/风险/动态/里程碑/邀请码、舞台 Rundown、报名审核批次、失物招领物品（含公开分享 `/lf/demo-lostfound`）以及 2 条自定义工具种子（支持 OpenAPI 启动令牌与 `anonk_demo_*` 密钥兑换演示）。舞台 Rundown 附执行模式（默认未开始），现场大屏分享已开启——直接访问 `/screen/demo-screen-token` 可演示免登录深色大屏（含种子紧急公告上屏）。微博账号密码可输入口令 `demo` 在前端解密（真 PBKDF2 + AES-GCM，与生产同一代码路径）。

## 部署（Cloudflare Pages，二选一）

**自定义域名**：`https://demo.anontokyo.design`（已绑定激活，CA google 证书自动签发）。同账户 zone 解析链：DNS `demo.anontokyo.design` CNAME → `anon-19b.pages.dev`（proxied，记录建有 comment 标注）+ Pages 项目 anon → Custom domains 挂载（`POST /accounts/<id>/pages/projects/anon/domains`，需 token Pages: Edit）。主 subdomain `anon-19b.pages.dev` 与分支别名 `<branch>.anon-19b.pages.dev` 照旧可用。

**Dashboard**：Pages 项目连仓库 →

| 项 | 值 |
| --- | --- |
| 构建命令 | `cd frontend && npm ci && npm run build:demo` |
| 输出目录 | `frontend/dist` |
| 环境变量 | `NODE_VERSION=20`（报 engine/语法错误改 `22`） |

**CLI**：

```bash
cd frontend && npm ci && npm run build:demo && npx wrangler pages deploy dist --project-name=<项目名>
```

SPA 深链回退由 `frontend/public/_redirects`（`/* /index.html 200`）提供，随构建拷入 dist；生产 nginx 仅把它当静态文件，无副作用。

部署后验证：访问 `https://<site>/projects` 深链（验证 `_redirects`）→ 应直接进入项目列表（自动登录），按下方「冒烟清单」抽查。

## 工作原理

**安装（`frontend/src/demo/install.ts`）**：`main.tsx` 在渲染前 `await import('./demo/install')`（顶层 await，demo 模式构建目标 es2022）。安装做三件事：

1. 种 token：`localStorage['anon-token'] = 'demo-token'`（`AuthProvider` 据此视为已登录，访客免登录直进）。
2. 初始化内存库：`sessionStorage['anon-demo-db']` 存在且 `version === DB_VERSION` 则恢复，否则 `await buildSeed()` 重建（async：微博密文需 `encryptWithPassphrase`）。
3. 包装 `window.fetch`：路径以 `/api/` 开头 → 内存路由 `route()`；其余（静态资产、data: URL）原样透传。**必须包 window.fetch 而非只改 api client**——`AuthImg.tsx`、财务 CSV 导出等直调 `window.fetch`。

**路由（`router.ts` + `handlers/`）**：表驱动 `{ method, re, keys, handler }` 按序匹配（字面量路由先于参数路由，如 `/finance/export` 先于 `/finance/:txId`）。handler 收到 `{ db, params, query, body, origFetch }`，返回 `Response`。统一 ~80ms 延迟让骨架屏可见；未匹配 → 后端同款 404 错误信封 `{ error: { code, message } }`（mock 永不返回 401，避免触发前端清 token 跳登录）。每个非 GET 请求成功后统一 `persist()`。

**聚合（`aggregate.ts`）**：项目列表 / dashboard / finance summary / onsite 全部从 store 现算，公式与后端逐条对齐（R1–R7，出处见 `docs/superpowers/plans/2026-08-03-demo-pages.md` 接口表附录），因此访客的会话修改（完成待办、记账、确认任务…）会正确反映到看板指标、结算建议与现场模式。

**种子（`seed.ts`）**：日期全部相对 `new Date()` 计算（活动 +21d 开展），任意时刻打开都是「筹备中」的鲜活状态。`DB_VERSION`：种子结构变更时递增，旧会话数据自动作废重种，防 schema 漂移。

**文件策略**：种子附件大部分指向 `frontend/public/demo/` 下的静态示例文件（`poster-v1/v2.svg`、`floorplan.svg`、`guide.pdf`，透传 `origFetch`），CSV/Markdown 等小文件直接以内联 base64 data URL 入种子；会话内上传支持单文件最大 1GB 与 8MB 分片会话模拟，大文件二进制存入 **IndexedDB** 持久化，并通过 Web Locks 保护活跃标签页引用，删除资源、还原示例数据或下次打开会话时自动清扫孤立 Blob。预览/下载统一经 `GET /api/files/:id` 与 materials versions 端点返回 blob。

**覆盖范围与只读面**：`handlers/` 下共 16 个业务域模块，完整复刻活动/阶段、未注册成员、待办、财务（含账目金额修改）、两层物料与分片上传、实物清单、账号、看板/公告管理、现场岗位/排班单、舞台编排与执行模式/大屏、舞台报名审核、失物招领及公开页、自定义工具与 OpenAPI 密钥兑换；`/api/push/config` 与 QQ 机器人配置返回未启用态（推送提示条与 QQ 绑定入口自然隐藏）；`POST /api/auth/register` 固定返回 403 `demo_readonly`。

## 会话保留语义

- 持久化仅写 `sessionStorage['anon-demo-db']`：**按标签页隔离**，刷新/同标签页重进保留，关闭标签页即清；新标签页打开是全新种子。明确不用 localStorage（不跨会话残留）。
- 写失败（QuotaExceededError）静默退化为当次内存态，不阻塞操作。
- Layout 顶部横幅「还原示例数据」按钮：删 sessionStorage + reload → 立即恢复种子。
- 登录页有「进入演示」按钮（mock 登录接受任意凭据）；退出登录后可一键回站。直接访问 `/login` 会因种子 token 自动跳 `/projects`（自动登录是预期行为）。

## 界面标识

- `DemoBadge`：右下角 fixed 角标「演示」，全页面常显（含登录页/现场模式；顶部若已有演示横幅则自动隐藏避免重复），`print:hidden` 不影响排班单打印。
- `DemoBanner`：Layout 顶部横幅「演示 · 当前为示例数据，所做修改仅保留在本标签页内」+ 还原按钮。
- 两者均以 `import.meta.env.VITE_DEMO === 'true'` 为条件，生产构建中静态消除。

## 维护

- **改种子数据**：编辑 `seed.ts`；若改了结构（新增/重命名集合或字段），递增 `DB_VERSION`。
- **新增前端调用的后端端点**：在 `handlers/` 对应模块加路由（注意注册顺序：字面量先于参数），否则演示站该功能 404。前端未调用的端点无需 mock。
- **聚合公式改动**（后端 R1–R7 对应逻辑）：同步 `aggregate.ts`，并核对 `frontend/src/types.ts` shape。
- **回归验证**：`npm run build:demo` 与 `npm run build` 双双通过；对比产物文件列表确认生产构建无 demo chunk（`grep -c "anon-demo-db" dist/assets/index-*.js` 应为 0）。

## 冒烟清单（已按此验证通过）

1. `/` → 自动进项目列表，2 个项目卡片；零真实 `/api` 网络请求（DevTools Network / resource timing 均无条目）。
2. 项目 1 看板：倒计时、指标卡（待办完成率/预算使用率/现场确认率）、风险 2 条、公告 3 条（置顶优先）、日程分组、阶段进度、最近动态。
3. 物料：「主视觉海报」预览显示 SVG，v1/v2 切换预览变化；「场地平面图」预览正常；CSV 版本可下载（Content-Disposition UTF-8 文件名）。
4. 账号：微博条目「查看密码」→ 口令 `demo` → 解密显示 `Weibo@Demo2026`。
5. 会话保留：完成一条待办 → 看板指标/待我处理即时更新 → F5 仍在 → 「还原示例数据」恢复种子。
6. 财务：导出 CSV（BOM 头，Excel 中文不乱码）；结算建议与按人净额随记账变化。
7. 现场模式（`/p/p-demo/onsite`）：紧急公告、我的排班岗位、异常、联系人；排班单打印页（`/p/p-demo/work-sheet/print`）渲染且无角标。
8. 注册提交 → 403 演示只读提示；退出登录 → 登录页「进入演示」一键回站。
