# 现场任务单（Work Sheet）设计

- 日期：2026-07-27
- 状态：已通过头脑风暴评审，待实施
- 分支：`feat/work-sheets`（从 main 分出，main 已含 UI 焕新）

## 1. 背景与目标

活动现场需要把分工落到纸面：按「任务模块」（检票、舞台协助、摊位引导等）定义岗位与所需人力，把成员指定到模块，然后**按人自动生成任务单**——网页可直接查看，也可打印/另存为 PDF，用于现场发放与工作确认。

关键决策（头脑风暴结论）：

- **独立新模块**，与筹备期「待办」无关
- **确认方式两者都要**：任务单可打印（纸质签字栏），系统内也可点确认（含时间戳）
- **PDF 方案为浏览器打印版式**（`window.print()`，另存为 PDF），不引入 pdfkit/jsPDF
- **任务单为实时视图**：不是存储实体，按当前分配数据实时计算，网页与打印版是同一份数据的两种呈现

非目标：模块不设可见范围（对项目成员全公开）；不做快照/版本管理；不与待办关联。

## 2. 数据模型

新集合 `WorkModule`（项目作用域，沿用现有 Mongoose 模式）：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `projectId` | ObjectId | 所属项目（索引） |
| `name` | string | 模块名（必填，trim，≤100） |
| `description` | string? | 工作内容说明 |
| `location` | string? | 集合/工作地点 |
| `startAt` / `endAt` | Date? | 工作时间段（均可空；两者都有时 startAt ≤ endAt） |
| `requiredCount` | number | 所需人力，整数 ≥1，默认 1；仅作目标，分配可少可多，界面显示缺口 |
| `assignees` | 子文档数组 | `{ userId: ObjectId, confirmedAt?: Date, confirmedBy?: ObjectId }`（userId 唯一） |
| `createdBy` | ObjectId | 创建者 |
| timestamps | — | createdAt/updatedAt |

校验：`assignees` 的 userId 必须全是项目成员，否则 400；确认时 `confirmedBy` 记录操作者（本人或代确认的管理者）。

## 3. 权限

- 新权限点 **`work:manage`**：模块增删改、分配成员、查看任意成员任务单、代确认/取消确认、批量打印入口。预置角色「主办」默认包含；`project:manage` 照旧全放行
- **普通项目成员**（无需权限点）：查看模块列表与自己的任务单、确认分配给自己的任务
- 权限中间件沿用现有 `requirePermission` 模式

## 4. API

路由挂在项目作用域（沿用 `/api/projects/:id/...` 模式，成员身份 + ObjectId 校验中间件复用）：

| 方法/路径 | 权限 | 说明 |
| --- | --- | --- |
| `GET /api/projects/:id/work-modules` | 成员 | 模块列表（含 assignees 与确认状态、成员姓名联查） |
| `POST /api/projects/:id/work-modules` | `work:manage` | 新建 |
| `PATCH /api/projects/:id/work-modules/:mid` | `work:manage` | 编辑（含 assignees 整体替换；被移除成员的确认记录随之删除） |
| `DELETE /api/projects/:id/work-modules/:mid` | `work:manage` | 删除 |
| `POST .../work-modules/:mid/confirm` | 本人 或 `work:manage` | 确认自己的分配；`work:manage` 可带 body `{ userId }` 代确认。重复确认幂等（不更新已有时戳） |
| `POST .../work-modules/:mid/unconfirm` | 本人 或 `work:manage` | 取消确认（清除 confirmedAt/confirmedBy） |
| `GET /api/projects/:id/work-sheet` | 成员 | 当前用户的任务单数据（实时计算：分配给 ta 的模块 + 项目名 + 成员名 + 生成时间） |
| `GET /api/projects/:id/work-sheet/:userId` | `work:manage` | 任意成员的任务单数据 |

错误格式统一 `{ error: { code, message } }`；确认/取消确认的目标必须在该模块 assignees 中，否则 404/400。

## 5. 前端（Tailwind + shadcn/ui 体系）

### 5.1 工作台入口

新增第 8 个 Tab「现场」（key `work`，图标 `ClipboardList`）：桌面端顶部 Tabs；移动端归入底部导航「更多」Sheet（底部主栏保持 4 项不变）。

### 5.2 WorkTab（`frontend/src/components/project/WorkTab.tsx`）

props `{ project, members, myPermissions }`（与 Todos/Finance 等 Tab 契约一致）。

- **管理视角**（`project:manage || work:manage`）：
  - 页头：「新建模块」按钮（FormOverlay：名称/描述/地点/时间段/所需人数）
  - 模块卡片：名称、时间段（`MM-DD HH:mm`）、地点、所需人数、已分配 n（缺口红字）、各成员确认状态（头像/姓名 + 已确认时间或待确认）
  - 卡片菜单：编辑（FormOverlay，含分配成员勾选徽章组）、删除（AlertDialog）
  - 「成员任务单」区：成员列表 + 「查看任务单」跳转打印版（`?user=<id>`）；「打印全员任务单」（`?user=all`）
- **成员视角**：「我的任务单」卡——分配给我的模块列表（名称/时间/地点/内容 + 每项「确认」按钮或 `已确认 HH:mm`）+「查看打印版」按钮（`?user=me`）
- 操作反馈沿用体例：成功/失败 sonner toast；加载骨架屏；空状态卡

### 5.3 打印版式（独立路由）

路由 `/p/:id/work-sheet/print`（挂在 RequireAuth 内、Layout 外，避免页头干扰）：

- 查询参数：`user=<userId>`（管理者指定成员）/ `user=me`（本人）/ `user=all`（全员连排，每人一节，`page-break-after` 分页）
- 数据来源：对应 work-sheet API（`user=all` 时管理者逐个成员获取，或前端并行请求）
- 版式：A4 优化；`@media print` 隐藏「打印/下载 PDF」按钮与返回链接；每张含：项目名、姓名、生成时间、任务表（模块/时间/地点/工作内容/确认状态）、底部**签字确认栏**（签字：____ 日期：____）
- 「下载 PDF」按钮 = `window.print()`（浏览器另存为 PDF）

### 5.4 类型

`frontend/src/types.ts` 增加：`WorkModuleItem { id, name, description, location, startAt, endAt, requiredCount, assignees: { userId, name, confirmedAt, confirmedBy }[], createdBy, createdAt }`、`WorkSheetData { project: { id, name }, user: { id, name }, generatedAt: string, items: WorkModuleItem[] }`。

## 6. 测试与验证

- 后端（vitest + mongodb-memory-server，沿用现有测试模式）：模型校验（requiredCount/时间顺序/非成员分配 400）、权限矩阵（`work:manage`/普通成员/非成员 403）、确认/代确认/重复确认幂等/取消、work-sheet 数据正确性（只含分配给该用户的模块、含项目名与生成时间）
- 前端：`npm run build`（tsc）通过；人工走查：打印预览（浏览器打印面板）、双主题、移动端

## 7. 文档更新义务

实施完成后更新 `docs/progress.md`（变更记录）、`docs/design.md`（实现与变更记录节）、`docs/readme.md`（如新权限点/环境变量有变化）、`docs/api.md`（新端点）。
