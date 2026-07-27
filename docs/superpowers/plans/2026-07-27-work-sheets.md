# 现场任务单（Work Sheet）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 ANON 新增「现场任务单」功能：项目内创建任务模块（含所需人力）、分配成员、按人实时生成可打印任务单（网页查看 + 浏览器打印存 PDF），支持系统内确认与纸质签字确认。

**Architecture:** 设计文档见 `docs/superpowers/specs/2026-07-27-work-sheets-design.md`。后端新增 `WorkModule` 模型 + `work-modules`/`work-sheet` 两组项目作用域路由 + `work:manage` 权限点；前端新增工作台第 8 个 Tab「现场」与独立打印版式路由。任务单为实时计算的视图，不落库快照。

**Tech Stack:** 后端 Express 4 + TypeScript strict + Mongoose 8 + vitest（mongodb-memory-server）；前端 React 18 + TS + Tailwind v4 + shadcn/ui + sonner + lucide-react。

## Global Constraints

- 仓库根 `/home/yuu/projects/anon`，分支 `feat/work-sheets`；后端命令在 `backend/`、前端在 `frontend/` 下执行。
- **node/npm 不在默认 PATH**：所有 npm/npx 命令前先 `export PATH="$HOME/.local/share/node/bin:$PATH"`。
- 后端测试：`cd backend && npm test`（vitest run，mongodb-memory-server，`pool:'forks', singleFork:true`）；新增模型注册必须幂等：`models.X ?? model<X>('X', schema)`。
- 错误格式：一律 `throw new AppError(status, code, message)`（`src/utils/errors.ts`），异步 handler 包 `ah(...)`；已用 code 词汇：`unauthorized/forbidden/not_found/bad_request/internal`。
- 项目作用域路由：`Router({ mergeParams: true })` + 顶部 `router.use(authRequired, loadMembership)`；挂载点是 `/api/projects/:id/...`（参数名 `:id`）；单条查询必须带 projectId 双条件。
- 权限：`...requirePermission('work:manage')`（注意展开，它返回数组）；`project:manage` 由中间件自动放行，无需特判。
- **预置角色快照问题**：`PRESET_ROLES` 只在建项目时写入；`ALL_PERMISSIONS` 加 `work:manage` 后新项目的「主办」自动包含，既有项目靠 `project:manage` 全放行兜底，**不做数据迁移**。
- 确认语义：本人可确认/取消自己的分配；带 `userId` 的代确认/代取消需 `work:manage`；重复确认幂等（不刷新已有时戳）；PATCH 替换 assignees 时保留留任成员的确认记录、清除被移除者。
- 前端：沿用 UI 焕新后的体例（FormOverlay/AlertDialog/toast/勾选徽章组/Select 哨兵值）；图标只用 lucide-react；不改 `api/client.ts`、`auth.tsx`、`crypto.ts`。
- 验证：后端任务 = `npm test` + `npm run typecheck` 全绿；前端任务 = `npm run build` 通过。
- 每个 Task 结束按步骤 git commit（已获用户授权，不 push）。

---

### Task 1: 权限点 + WorkModule 模型 + 服务层

**Files:**
- Modify: `backend/src/services/permissions.ts:1-10`（`ALL_PERMISSIONS` 追加一项）
- Create: `backend/src/models/WorkModule.ts`
- Create: `backend/src/services/workModules.ts`
- Test: `backend/tests/workModules.test.ts`（本任务先建文件、只写模型/服务层用例，Task 2/3 继续追加路由用例）

**Interfaces:**
- Consumes: 现有 `Membership` 模型（`src/models/Membership.ts`，字段 `projectId/userId/roleName`）、`Project` 模型
- Produces（Task 2/3 依赖）：
  - `WorkModule` 模型（`IWorkModule`/`WorkModuleDoc`）
  - `memberNameMap(projectId: Types.ObjectId): Promise<Map<string, string>>` — userId→姓名
  - `moduleJson(m: WorkModuleDoc, names: Map<string, string>)` — 统一 JSON 形状
  - `ALL_PERMISSIONS` 含 `'work:manage'`

- [ ] **Step 1: 写失败测试（模型与服务层）**

创建 `backend/tests/workModules.test.ts`（测试装配模式照 `tests/todos.test.ts`：先读它确认 beforeEach 流程——本文件第一阶段只需直接操作模型，不走 HTTP）：

```ts
import { describe, expect, it } from 'vitest';
import { Membership } from '../src/models/Membership';
import { Project } from '../src/models/Project';
import { User } from '../src/models/User';
import { WorkModule } from '../src/models/WorkModule';
import { memberNameMap, moduleJson } from '../src/services/workModules';

// 直接建数据的轻量装配：一个项目 + 两个成员（不走路由）
async function seedProjectWithMembers() {
  const u1 = await User.create({ email: 'a@x.com', name: '甲', passwordHash: 'x' });
  const u2 = await User.create({ email: 'b@x.com', name: '乙', passwordHash: 'x' });
  const project = await Project.create({ name: 'CP31', createdBy: u1._id, roles: [{ name: '主办', permissions: ['project:manage'] }] });
  await Membership.create({ projectId: project._id, userId: u1._id, roleName: '主办' });
  await Membership.create({ projectId: project._id, userId: u2._id, roleName: '一般staff' });
  return { u1, u2, project };
}

describe('WorkModule 模型', () => {
  it('requiredCount 默认 1，assignees 默认空数组', async () => {
    const { u1, project } = await seedProjectWithMembers();
    const m = await WorkModule.create({ projectId: project._id, name: '检票', createdBy: u1._id });
    expect(m.requiredCount).toBe(1);
    expect(m.assignees).toHaveLength(0);
  });

  it('requiredCount < 1 被拒绝', async () => {
    const { u1, project } = await seedProjectWithMembers();
    await expect(
      WorkModule.create({ projectId: project._id, name: '检票', requiredCount: 0, createdBy: u1._id }),
    ).rejects.toThrow();
  });
});

describe('workModules 服务层', () => {
  it('memberNameMap 返回项目成员 userId→姓名', async () => {
    const { u1, u2, project } = await seedProjectWithMembers();
    const names = await memberNameMap(project._id);
    expect(names.get(String(u1._id))).toBe('甲');
    expect(names.get(String(u2._id))).toBe('乙');
  });

  it('moduleJson 输出统一形状（含确认字段与姓名）', async () => {
    const { u1, u2, project } = await seedProjectWithMembers();
    const names = await memberNameMap(project._id);
    const m = await WorkModule.create({
      projectId: project._id,
      name: '舞台协助',
      location: 'A 馆',
      requiredCount: 3,
      createdBy: u1._id,
      assignees: [{ userId: u2._id, confirmedAt: new Date('2026-08-01T10:00:00Z'), confirmedBy: u1._id }],
    });
    const j = moduleJson(m, names);
    expect(j).toMatchObject({
      name: '舞台协助',
      location: 'A 馆',
      requiredCount: 3,
      assignees: [{ userId: String(u2._id), name: '乙', confirmedBy: String(u1._id) }],
    });
    expect(j.assignees[0].confirmedAt).toBe('2026-08-01T10:00:00.000Z');
    expect(j.startAt).toBeNull();
  });
});
```

注：`User.create` 的必填字段以 `src/models/User.ts` 实际 schema 为准（若还有别的必填字段则补齐）；`Membership`/`Project` 同理（先读模型文件再落笔）。

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && npx vitest run tests/workModules.test.ts`
Expected: FAIL（`../src/models/WorkModule` 与 `../src/services/workModules` 不存在）

- [ ] **Step 3: 权限点 + 模型 + 服务层实现**

`backend/src/services/permissions.ts` 的 `ALL_PERMISSIONS` 数组末尾追加 `'work:manage'`（其余不动；`PRESET_ROLES` 的「主办」因 `[...ALL_PERMISSIONS]` 自动包含）。

创建 `backend/src/models/WorkModule.ts`：

```ts
import { HydratedDocument, Model, Schema, Types, model, models } from 'mongoose';

export interface IWorkAssignee {
  userId: Types.ObjectId;
  confirmedAt?: Date;
  confirmedBy?: Types.ObjectId;
}

export interface IWorkModule {
  projectId: Types.ObjectId;
  name: string;
  description?: string;
  location?: string;
  startAt?: Date;
  endAt?: Date;
  requiredCount: number;
  assignees: IWorkAssignee[];
  createdBy: Types.ObjectId;
}

export type WorkModuleDoc = HydratedDocument<IWorkModule>;

const assigneeSchema = new Schema<IWorkAssignee>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    confirmedAt: { type: Date },
    confirmedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { _id: false },
);

const schema = new Schema<IWorkModule>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    description: { type: String },
    location: { type: String },
    startAt: { type: Date },
    endAt: { type: Date },
    requiredCount: { type: Number, default: 1, min: 1 },
    assignees: { type: [assigneeSchema], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);
schema.index({ projectId: 1 });

export const WorkModule: Model<IWorkModule> = models.WorkModule ?? model<IWorkModule>('WorkModule', schema);
```

创建 `backend/src/services/workModules.ts`：

```ts
import { Types } from 'mongoose';
import { Membership } from '../models/Membership';
import type { WorkModuleDoc } from '../models/WorkModule';

/** userId → 成员姓名（Membership 联查 User.name；populate 写法照 routes/todos.ts 中 assignees 姓名的联查方式，先读该文件对齐） */
export async function memberNameMap(projectId: Types.ObjectId): Promise<Map<string, string>> {
  const ms = await Membership.find({ projectId }).populate<{ userId: { _id: Types.ObjectId; name: string } }>(
    'userId',
    'name',
  );
  return new Map(ms.map((m) => [String(m.userId._id), m.userId.name]));
}

export function moduleJson(m: WorkModuleDoc, names: Map<string, string>) {
  return {
    id: String(m._id),
    name: m.name,
    description: m.description ?? '',
    location: m.location ?? '',
    startAt: m.startAt ? m.startAt.toISOString() : null,
    endAt: m.endAt ? m.endAt.toISOString() : null,
    requiredCount: m.requiredCount,
    assignees: m.assignees.map((a) => ({
      userId: String(a.userId),
      name: names.get(String(a.userId)) ?? '',
      confirmedAt: a.confirmedAt ? a.confirmedAt.toISOString() : null,
      confirmedBy: a.confirmedBy ? String(a.confirmedBy) : null,
    })),
    createdBy: String(m.createdBy),
    createdAt: m.createdAt.toISOString(),
  };
}
```

- [ ] **Step 4: 运行确认通过 + typecheck**

Run: `cd backend && npx vitest run tests/workModules.test.ts && npm run typecheck`
Expected: 4 用例 PASS，typecheck 无错误

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/permissions.ts backend/src/models/WorkModule.ts backend/src/services/workModules.ts backend/tests/workModules.test.ts
git commit -m "feat(backend): work:manage 权限点与 WorkModule 模型/服务层"
```

---

### Task 2: work-modules 路由（CRUD + 确认/取消确认）

**Files:**
- Create: `backend/src/routes/workModules.ts`
- Modify: `backend/src/app.ts`（挂载一行）
- Test: `backend/tests/workModules.test.ts`（追加路由用例）

**Interfaces:**
- Consumes: Task 1 的 `WorkModule`、`memberNameMap`、`moduleJson`；`authRequired`、`loadMembership`、`requirePermission`；`AppError`、`ah`
- Produces（前端依赖的响应形状）：
  - `GET /api/projects/:id/work-modules` → `{ modules: ModuleJson[] }`
  - `POST /api/projects/:id/work-modules` → 201 `{ module: ModuleJson }`，body `{ name, description?, location?, startAt?, endAt?, requiredCount?, assigneeIds?: string[] }`
  - `PATCH /api/projects/:id/work-modules/:mid` → `{ module: ModuleJson }`，body 同 POST（全量替换语义）
  - `DELETE /api/projects/:id/work-modules/:mid` → `{ ok: true }`
  - `POST .../work-modules/:mid/confirm` body `{}` 或 `{ userId }` → `{ module: ModuleJson }`
  - `POST .../work-modules/:mid/unconfirm` 同 confirm

- [ ] **Step 1: 写失败测试（追加到 tests/workModules.test.ts）**

先在文件顶部 import 区追加：

```ts
import request from 'supertest';
import { app } from '../src/app';
import { InviteCode } from '../src/models/InviteCode';
import { createSuperAdmin, registerUser } from './helpers';
```

再追加以下完整 describe（HTTP 装配与 `tests/todos.test.ts` 同款）：

```ts
describe('work-modules 路由', () => {
  let owner: { token: string; user: { id: string } };
  let staff: { token: string; user: { id: string } };
  let projectId: string;

  beforeEach(async () => {
    owner = await createSuperAdmin();
    const creator = (await User.findOne())!._id;
    await InviteCode.create({ code: 'C1', createdBy: creator });
    staff = await registerUser('C1', 's@example.com', 'Staff');
    const p = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: '活动' });
    projectId = p.body.project.id;
    const inv = await request(app)
      .post(`/api/projects/${projectId}/invites`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ roleName: '一般staff' });
    await request(app)
      .post(`/api/invites/${inv.body.token}/accept`)
      .set('Authorization', `Bearer ${staff.token}`);
  });

  async function addModule(body: Record<string, unknown>) {
    const res = await request(app)
      .post(`/api/projects/${projectId}/work-modules`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send(body);
    expect(res.status).toBe(201);
    return res.body.module as {
      id: string;
      requiredCount: number;
      assignees: { userId: string; name: string; confirmedAt: string | null; confirmedBy: string | null }[];
    };
  }

  it('创建模块（主办）→ 201 且形状正确', async () => {
    const m = await addModule({ name: '检票', requiredCount: 2, location: 'A 馆', assigneeIds: [staff.user.id] });
    expect(m.requiredCount).toBe(2);
    expect(m.assignees).toHaveLength(1);
    expect(m.assignees[0]).toMatchObject({ userId: staff.user.id, name: 'Staff', confirmedAt: null });
  });

  it('校验：name 空 / requiredCount<1 / startAt>endAt / 非成员 assigneeIds → 均 400', async () => {
    const bad: Record<string, unknown>[] = [
      { name: '  ' },
      { name: 'X', requiredCount: 0 },
      { name: 'X', startAt: '2026-08-02T00:00:00.000Z', endAt: '2026-08-01T00:00:00.000Z' },
      { name: 'X', assigneeIds: [staff.user.id.replace(/.$/, (c) => (c === '0' ? '1' : '0'))] },
    ];
    for (const body of bad) {
      const res = await request(app)
        .post(`/api/projects/${projectId}/work-modules`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send(body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('bad_request');
    }
  });

  it('权限：一般staff 创建/修改/删除 → 403；非成员访问列表 → 403', async () => {
    const m = await addModule({ name: '检票' });
    const post = await request(app)
      .post(`/api/projects/${projectId}/work-modules`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ name: 'X' });
    expect(post.status).toBe(403);
    const patch = await request(app)
      .patch(`/api/projects/${projectId}/work-modules/${m.id}`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ name: 'Y' });
    expect(patch.status).toBe(403);
    const del = await request(app)
      .delete(`/api/projects/${projectId}/work-modules/${m.id}`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(del.status).toBe(403);
    // 非项目成员（第三个用户，不进项目）
    await InviteCode.create({ code: 'C2', createdBy: (await User.findOne())!._id });
    const outsider = await registerUser('C2', 'o@example.com', 'Out');
    const list = await request(app)
      .get(`/api/projects/${projectId}/work-modules`)
      .set('Authorization', `Bearer ${outsider.token}`);
    expect(list.status).toBe(403);
  });

  it('成员可读列表 GET → { modules }，含姓名联查', async () => {
    await addModule({ name: '检票', assigneeIds: [staff.user.id] });
    await addModule({ name: '舞台协助' });
    const res = await request(app)
      .get(`/api/projects/${projectId}/work-modules`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(res.status).toBe(200);
    expect(res.body.modules).toHaveLength(2);
    expect(res.body.modules[0].assignees[0]?.name).toBe('Staff');
  });

  it('PATCH 替换 assignees：留任成员确认记录保留，被移除者清除', async () => {
    const m = await addModule({ name: '检票', assigneeIds: [owner.user.id, staff.user.id] });
    await request(app)
      .post(`/api/projects/${projectId}/work-modules/${m.id}/confirm`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({});
    const res = await request(app)
      .patch(`/api/projects/${projectId}/work-modules/${m.id}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ assigneeIds: [owner.user.id] });
    expect(res.status).toBe(200);
    expect(res.body.module.assignees).toHaveLength(1);
    expect(res.body.module.assignees[0].userId).toBe(owner.user.id);
    expect(res.body.module.assignees[0].confirmedAt).not.toBeNull();
  });

  it('confirm：本人确认自己的分配 → confirmedAt/confirmedBy=本人', async () => {
    const m = await addModule({ name: '检票', assigneeIds: [staff.user.id] });
    const res = await request(app)
      .post(`/api/projects/${projectId}/work-modules/${m.id}/confirm`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.module.assignees[0].confirmedAt).not.toBeNull();
    expect(res.body.module.assignees[0].confirmedBy).toBe(staff.user.id);
  });

  it('confirm：重复确认幂等，不刷新时戳', async () => {
    const m = await addModule({ name: '检票', assigneeIds: [staff.user.id] });
    const r1 = await request(app)
      .post(`/api/projects/${projectId}/work-modules/${m.id}/confirm`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({});
    const t1 = r1.body.module.assignees[0].confirmedAt;
    await new Promise((r) => setTimeout(r, 20));
    const r2 = await request(app)
      .post(`/api/projects/${projectId}/work-modules/${m.id}/confirm`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({});
    expect(r2.body.module.assignees[0].confirmedAt).toBe(t1);
  });

  it('confirm：staff 带他人 userId → 403；主办带 userId 代确认 → 200 且 confirmedBy=主办', async () => {
    const m = await addModule({ name: '检票', assigneeIds: [staff.user.id] });
    const forbidden = await request(app)
      .post(`/api/projects/${projectId}/work-modules/${m.id}/confirm`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ userId: owner.user.id });
    expect(forbidden.status).toBe(403);
    const ok = await request(app)
      .post(`/api/projects/${projectId}/work-modules/${m.id}/confirm`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ userId: staff.user.id });
    expect(ok.status).toBe(200);
    expect(ok.body.module.assignees[0].confirmedBy).toBe(owner.user.id);
  });

  it('confirm：目标不在 assignees 中 → 400', async () => {
    const m = await addModule({ name: '检票', assigneeIds: [owner.user.id] });
    const res = await request(app)
      .post(`/api/projects/${projectId}/work-modules/${m.id}/confirm`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('unconfirm：清除确认字段', async () => {
    const m = await addModule({ name: '检票', assigneeIds: [staff.user.id] });
    await request(app)
      .post(`/api/projects/${projectId}/work-modules/${m.id}/confirm`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({});
    const res = await request(app)
      .post(`/api/projects/${projectId}/work-modules/${m.id}/unconfirm`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.module.assignees[0].confirmedAt).toBeNull();
    expect(res.body.module.assignees[0].confirmedBy).toBeNull();
  });

  it('单条操作防跨项目：用别的项目的 mid PATCH/confirm → 404', async () => {
    const m = await addModule({ name: '检票', assigneeIds: [owner.user.id] });
    const p2 = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: '另一个活动' });
    const pid2 = p2.body.project.id;
    const patch = await request(app)
      .patch(`/api/projects/${pid2}/work-modules/${m.id}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Y' });
    expect(patch.status).toBe(404);
    const confirm = await request(app)
      .post(`/api/projects/${pid2}/work-modules/${m.id}/confirm`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({});
    expect(confirm.status).toBe(404);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && npx vitest run tests/workModules.test.ts`
Expected: 新用例 FAIL（404，路由未挂载）

- [ ] **Step 3: 实现 routes/workModules.ts 并挂载**

创建 `backend/src/routes/workModules.ts`：

```ts
import { Router } from 'express';
import { isValidObjectId, Types } from 'mongoose';
import { authRequired } from '../middleware/auth';
import { loadMembership, requirePermission } from '../middleware/projectAccess';
import { Membership } from '../models/Membership';
import { WorkModule } from '../models/WorkModule';
import { memberNameMap, moduleJson } from '../services/workModules';
import { ah } from '../utils/async';
import { AppError } from '../utils/errors';

export const workModulesRouter = Router({ mergeParams: true });
workModulesRouter.use(authRequired, loadMembership);

interface BodyShape {
  name?: unknown;
  description?: unknown;
  location?: unknown;
  startAt?: unknown;
  endAt?: unknown;
  requiredCount?: unknown;
  assigneeIds?: unknown;
}

/** 解析并校验 body；partial=false 时 name 必填。返回净化后的字段（assigneeIds 已校验全是项目成员）。 */
async function parseBody(projectId: Types.ObjectId, body: BodyShape) {
  const out: {
    name?: string;
    description?: string;
    location?: string;
    startAt?: Date | null;
    endAt?: Date | null;
    requiredCount?: number;
    assigneeIds?: Types.ObjectId[];
  } = {};
  if (body.name !== undefined) {
    const name = String(body.name ?? '').trim();
    if (!name || name.length > 100) throw new AppError(400, 'bad_request', '名称必填且不超过 100 字');
    out.name = name;
  }
  if (body.description !== undefined) out.description = String(body.description ?? '').trim();
  if (body.location !== undefined) out.location = String(body.location ?? '').trim();
  if (body.startAt !== undefined || body.endAt !== undefined) {
    const s = body.startAt ? new Date(String(body.startAt)) : null;
    const e = body.endAt ? new Date(String(body.endAt)) : null;
    if (s && Number.isNaN(s.getTime())) throw new AppError(400, 'bad_request', 'startAt 非法');
    if (e && Number.isNaN(e.getTime())) throw new AppError(400, 'bad_request', 'endAt 非法');
    if (s && e && s.getTime() > e.getTime()) throw new AppError(400, 'bad_request', '开始时间不能晚于结束时间');
    out.startAt = s;
    out.endAt = e;
  }
  if (body.requiredCount !== undefined) {
    const n = Number(body.requiredCount);
    if (!Number.isInteger(n) || n < 1) throw new AppError(400, 'bad_request', '所需人力须为 ≥1 的整数');
    out.requiredCount = n;
  }
  if (body.assigneeIds !== undefined) {
    if (!Array.isArray(body.assigneeIds)) throw new AppError(400, 'bad_request', 'assigneeIds 须为数组');
    const ids = [...new Set(body.assigneeIds.map(String))];
    if (ids.some((x) => !isValidObjectId(x))) throw new AppError(400, 'bad_request', 'assigneeIds 含非法 ID');
    const cnt = await Membership.countDocuments({ projectId, userId: { $in: ids } });
    if (cnt !== ids.length) throw new AppError(400, 'bad_request', 'assigneeIds 含非项目成员');
    out.assigneeIds = ids.map((x) => new Types.ObjectId(x));
  }
  return out;
}

async function findInProject(req: { params: { mid: string }; project?: { _id: Types.ObjectId } }) {
  const m = await WorkModule.findOne({ _id: req.params.mid, projectId: req.project!._id });
  if (!m) throw new AppError(404, 'not_found', '任务模块不存在');
  return m;
}

workModulesRouter.get(
  '/',
  ah(async (req, res) => {
    const [modules, names] = await Promise.all([
      WorkModule.find({ projectId: req.project!._id }).sort({ createdAt: 1 }),
      memberNameMap(req.project!._id),
    ]);
    res.json({ modules: modules.map((m) => moduleJson(m, names)) });
  }),
);

workModulesRouter.post(
  '/',
  ...requirePermission('work:manage'),
  ah(async (req, res) => {
    const p = await parseBody(req.project!._id, req.body);
    if (!p.name) throw new AppError(400, 'bad_request', '名称必填');
    const m = await WorkModule.create({
      projectId: req.project!._id,
      name: p.name,
      description: p.description,
      location: p.location,
      startAt: p.startAt ?? undefined,
      endAt: p.endAt ?? undefined,
      requiredCount: p.requiredCount ?? 1,
      assignees: (p.assigneeIds ?? []).map((userId) => ({ userId })),
      createdBy: new Types.ObjectId(req.userId!),
    });
    const names = await memberNameMap(req.project!._id);
    res.status(201).json({ module: moduleJson(m, names) });
  }),
);

workModulesRouter.patch(
  '/:mid',
  ...requirePermission('work:manage'),
  ah(async (req, res) => {
    const m = await findInProject(req);
    const p = await parseBody(req.project!._id, req.body);
    if (p.name !== undefined) m.name = p.name;
    if (p.description !== undefined) m.description = p.description;
    if (p.location !== undefined) m.location = p.location;
    if (p.startAt !== undefined) m.startAt = p.startAt ?? undefined;
    if (p.endAt !== undefined) m.endAt = p.endAt ?? undefined;
    if (p.requiredCount !== undefined) m.requiredCount = p.requiredCount;
    if (p.assigneeIds !== undefined) {
      // 留任成员保留确认记录，被移除者清除
      m.assignees = p.assigneeIds.map((userId) => {
        const kept = m.assignees.find((a) => String(a.userId) === String(userId));
        return kept ? { userId: kept.userId, confirmedAt: kept.confirmedAt, confirmedBy: kept.confirmedBy } : { userId };
      });
    }
    await m.save();
    const names = await memberNameMap(req.project!._id);
    res.json({ module: moduleJson(m, names) });
  }),
);

workModulesRouter.delete(
  '/:mid',
  ...requirePermission('work:manage'),
  ah(async (req, res) => {
    const m = await findInProject(req);
    await m.deleteOne();
    res.json({ ok: true });
  }),
);

/** confirm/unconfirm 共用：解析目标 userId 并做权限判断，返回模块与目标 */
async function resolveConfirmTarget(req: {
  params: { mid: string };
  body: { userId?: unknown };
  userId?: string;
  project?: { _id: Types.ObjectId };
  myPermissions?: Set<string>;
}) {
  const m = await findInProject(req);
  const target = req.body.userId ? String(req.body.userId) : req.userId!;
  const managing = target !== req.userId;
  if (managing) {
    const perms = req.myPermissions ?? new Set<string>();
    if (!perms.has('project:manage') && !perms.has('work:manage')) {
      throw new AppError(403, 'forbidden', '无权代他人确认');
    }
  }
  const a = m.assignees.find((x) => String(x.userId) === target);
  if (!a) throw new AppError(400, 'bad_request', '该成员未被分配到此模块');
  return { m, a, target };
}

workModulesRouter.post(
  '/:mid/confirm',
  ah(async (req, res) => {
    const { m, a } = await resolveConfirmTarget(req);
    if (!a.confirmedAt) {
      a.confirmedAt = new Date();
      a.confirmedBy = new Types.ObjectId(req.userId!);
      await m.save();
    }
    const names = await memberNameMap(req.project!._id);
    res.json({ module: moduleJson(m, names) });
  }),
);

workModulesRouter.post(
  '/:mid/unconfirm',
  ah(async (req, res) => {
    const { m, a } = await resolveConfirmTarget(req);
    a.confirmedAt = undefined;
    a.confirmedBy = undefined;
    await m.save();
    const names = await memberNameMap(req.project!._id);
    res.json({ module: moduleJson(m, names) });
  }),
);
```

`backend/src/app.ts` 在 todos 挂载行附近追加：

```ts
app.use('/api/projects/:id/work-modules', workModulesRouter);
```

（import 一并加；`req.project`/`req.myPermissions`/`req.userId` 的类型来自现有中间件的 declare 扩展，若 resolveConfirmTarget 的形参类型与扩展类型冲突，改为在函数内直接取 `req as any` 略宽处理并在报告说明——以 typecheck 通过为准。）

- [ ] **Step 4: 运行确认通过 + typecheck**

Run: `cd backend && npx vitest run tests/workModules.test.ts && npm run typecheck`
Expected: 全部用例 PASS

- [ ] **Step 5: 全量回归**

Run: `cd backend && npm test`
Expected: 65 + 新增用例全部 PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/workModules.ts backend/src/app.ts backend/tests/workModules.test.ts
git commit -m "feat(backend): work-modules CRUD 与确认/取消确认路由"
```

---

### Task 3: work-sheet 任务单端点

**Files:**
- Create: `backend/src/routes/workSheet.ts`
- Modify: `backend/src/app.ts`（挂载一行）
- Modify: `backend/src/services/workModules.ts`（追加 `buildSheet`）
- Test: `backend/tests/workModules.test.ts`（追加用例）

**Interfaces:**
- Consumes: Task 1/2 全部
- Produces（前端打印页依赖）：
  - `GET /api/projects/:id/work-sheet` → `SheetJson`
  - `GET /api/projects/:id/work-sheet/:userId`（`work:manage`）→ `SheetJson`
  - `SheetJson = { project: { id, name }, user: { id, name }, generatedAt: string(ISO), items: ModuleJson[] }`

- [ ] **Step 1: 写失败测试（追加用例）**

```ts
describe('work-sheet 端点', () => {
  let owner: { token: string; user: { id: string } };
  let staff: { token: string; user: { id: string } };
  let projectId: string;

  beforeEach(async () => {
    owner = await createSuperAdmin();
    const creator = (await User.findOne())!._id;
    await InviteCode.create({ code: 'C1', createdBy: creator });
    staff = await registerUser('C1', 's@example.com', 'Staff');
    const p = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: '活动' });
    projectId = p.body.project.id;
    const inv = await request(app)
      .post(`/api/projects/${projectId}/invites`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ roleName: '一般staff' });
    await request(app)
      .post(`/api/invites/${inv.body.token}/accept`)
      .set('Authorization', `Bearer ${staff.token}`);
  });

  async function addModule(body: Record<string, unknown>) {
    const res = await request(app)
      .post(`/api/projects/${projectId}/work-modules`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send(body);
    expect(res.status).toBe(201);
    return res.body.module as { id: string };
  }

  it('本人任务单：只含分配给自己的模块，含项目名/姓名/generatedAt', async () => {
    await addModule({ name: '检票', assigneeIds: [staff.user.id] });
    await addModule({ name: '摊位引导', assigneeIds: [staff.user.id, owner.user.id] });
    await addModule({ name: '主办专属', assigneeIds: [owner.user.id] });
    const res = await request(app)
      .get(`/api/projects/${projectId}/work-sheet`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(res.status).toBe(200);
    expect(res.body.project.name).toBe('活动');
    expect(res.body.user).toMatchObject({ id: staff.user.id, name: 'Staff' });
    expect(Number.isNaN(Date.parse(res.body.generatedAt))).toBe(false);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items.map((m: { name: string }) => m.name).sort()).toEqual(['摊位引导', '检票']);
  });

  it('未分配的本人任务单 → items 为空数组', async () => {
    await addModule({ name: '主办专属', assigneeIds: [owner.user.id] });
    const res = await request(app)
      .get(`/api/projects/${projectId}/work-sheet`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });

  it('staff 查他人的任务单 → 403；主办查任意成员 → 200', async () => {
    const forbidden = await request(app)
      .get(`/api/projects/${projectId}/work-sheet/${owner.user.id}`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(forbidden.status).toBe(403);
    const ok = await request(app)
      .get(`/api/projects/${projectId}/work-sheet/${staff.user.id}`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(ok.status).toBe(200);
    expect(ok.body.user.id).toBe(staff.user.id);
  });

  it('目标用户非项目成员 → 404', async () => {
    await InviteCode.create({ code: 'C2', createdBy: (await User.findOne())!._id });
    const outsider = await registerUser('C2', 'o@example.com', 'Out');
    const res = await request(app)
      .get(`/api/projects/${projectId}/work-sheet/${outsider.user.id}`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });

  it('items 内确认状态与模块一致', async () => {
    const m = await addModule({ name: '检票', assigneeIds: [staff.user.id] });
    await request(app)
      .post(`/api/projects/${projectId}/work-modules/${m.id}/confirm`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({});
    const res = await request(app)
      .get(`/api/projects/${projectId}/work-sheet`)
      .set('Authorization', `Bearer ${staff.token}`);
    const mine = res.body.items[0].assignees.find((a: { userId: string }) => a.userId === staff.user.id);
    expect(mine.confirmedAt).not.toBeNull();
    expect(mine.confirmedBy).toBe(staff.user.id);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && npx vitest run tests/workModules.test.ts -t 'work-sheet'`
Expected: FAIL（404）

- [ ] **Step 3: 实现 buildSheet + 路由并挂载**

`backend/src/services/workModules.ts` 追加：

```ts
import { AppError } from '../utils/errors';
import { WorkModule } from '../models/WorkModule';
import type { ProjectDoc } from '../models/Project';

/** 实时计算某成员的任务单：分配给 ta 的模块（按 startAt 升序、空值最后，其次 createdAt） */
export async function buildSheet(project: ProjectDoc, targetUserId: string) {
  const ms = await Membership.find({ projectId: project._id }).populate<{
    userId: { _id: Types.ObjectId; name: string };
  }>('userId', 'name');
  const target = ms.find((m) => String(m.userId._id) === targetUserId);
  if (!target) throw new AppError(404, 'not_found', '该用户不是项目成员');
  const names = new Map(ms.map((m) => [String(m.userId._id), m.userId.name]));
  const modules = await WorkModule.find({ projectId: project._id, 'assignees.userId': targetUserId }).sort({
    startAt: 1,
    createdAt: 1,
  });
  return {
    project: { id: String(project._id), name: project.name },
    user: { id: targetUserId, name: target.userId.name },
    generatedAt: new Date().toISOString(),
    items: modules.map((m) => moduleJson(m, names)),
  };
}
```

创建 `backend/src/routes/workSheet.ts`：

```ts
import { Router } from 'express';
import { authRequired } from '../middleware/auth';
import { loadMembership, requirePermission } from '../middleware/projectAccess';
import { buildSheet } from '../services/workModules';
import { ah } from '../utils/async';

export const workSheetRouter = Router({ mergeParams: true });
workSheetRouter.use(authRequired, loadMembership);

workSheetRouter.get(
  '/',
  ah(async (req, res) => {
    res.json(await buildSheet(req.project!, req.userId!));
  }),
);

workSheetRouter.get(
  '/:userId',
  ...requirePermission('work:manage'),
  ah(async (req, res) => {
    res.json(await buildSheet(req.project!, req.params.userId));
  }),
);
```

`backend/src/app.ts` 追加：`app.use('/api/projects/:id/work-sheet', workSheetRouter);`

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && npm test && npm run typecheck`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/workSheet.ts backend/src/app.ts backend/src/services/workModules.ts backend/tests/workModules.test.ts
git commit -m "feat(backend): work-sheet 任务单实时端点"
```

---

### Task 4: 前端类型 + WorkTab + RolesTab 权限清单

**Files:**
- Modify: `frontend/src/types.ts`（追加两个类型）
- Create: `frontend/src/components/project/WorkTab.tsx`
- Modify: `frontend/src/components/project/RolesTab.tsx:21-32`（PERMISSIONS 追加一项）

**Interfaces:**
- Consumes: Task 2/3 的响应形状 `{ modules: ModuleJson[] }`、`{ module: ModuleJson }`、`SheetJson`；ui 组件、`FormOverlay`、`toast`；`useAuth()`
- Produces（Task 5 依赖）：
  - `WorkTab({ project, members, myPermissions })` 默认导出
  - types：`WorkModuleItem`、`WorkSheetData`

- [ ] **Step 1: types.ts 追加**

```ts
export interface WorkAssignee {
  userId: string; name: string;
  confirmedAt: string | null; confirmedBy: string | null;
}
export interface WorkModuleItem {
  id: string; name: string; description: string; location: string;
  startAt: string | null; endAt: string | null; requiredCount: number;
  assignees: WorkAssignee[]; createdBy: string; createdAt: string;
}
export interface WorkSheetData {
  project: { id: string; name: string };
  user: { id: string; name: string };
  generatedAt: string;
  items: WorkModuleItem[];
}
```

- [ ] **Step 2: 创建 WorkTab.tsx**

完整实现（逻辑 + 渲染一次给全；体例与 TodosTab 对齐）：

```tsx
import { ClipboardList, MoreHorizontal, Pencil, Plus, Printer, Trash2, Users } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { api } from '../../api/client';
import { useAuth } from '../../auth';
import type { Member, ProjectDetail, WorkModuleItem } from '../../types';
import { FormOverlay } from '@/components/FormOverlay';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';

interface Props {
  project: ProjectDetail;
  members: Member[];
  myPermissions: string[];
}

const fmt = (iso: string | null) => (iso ? iso.slice(5, 16).replace('T', ' ') : '');
const fmtRange = (m: WorkModuleItem) =>
  m.startAt || m.endAt ? `${fmt(m.startAt) || '…'} ~ ${fmt(m.endAt) || '…'}` : '';

export default function WorkTab({ project, members, myPermissions }: Props) {
  const { user } = useAuth();
  const nav = useNavigate();
  const canManage = myPermissions.includes('project:manage') || myPermissions.includes('work:manage');

  const [modules, setModules] = useState<WorkModuleItem[] | null>(null);
  const [err, setErr] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<WorkModuleItem | null>(null);
  const [deleting, setDeleting] = useState<WorkModuleItem | null>(null);
  const [form, setForm] = useState({ name: '', description: '', location: '', startAt: '', endAt: '', requiredCount: '1' });
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);

  const load = useCallback(async () => {
    const d = await api<{ modules: WorkModuleItem[] }>(`/api/projects/${project.id}/work-modules`);
    setModules(d.modules);
  }, [project.id]);

  useEffect(() => {
    load().catch((e) => setErr((e as Error).message));
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', description: '', location: '', startAt: '', endAt: '', requiredCount: '1' });
    setAssigneeIds([]);
    setEditOpen(true);
  };

  const openEdit = (m: WorkModuleItem) => {
    setEditing(m);
    setForm({
      name: m.name,
      description: m.description,
      location: m.location,
      startAt: m.startAt ? m.startAt.slice(0, 16) : '',
      endAt: m.endAt ? m.endAt.slice(0, 16) : '',
      requiredCount: String(m.requiredCount),
    });
    setAssigneeIds(m.assignees.map((a) => a.userId));
    setEditOpen(true);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const body = {
      name: form.name,
      description: form.description || undefined,
      location: form.location || undefined,
      startAt: form.startAt ? new Date(form.startAt).toISOString() : undefined,
      endAt: form.endAt ? new Date(form.endAt).toISOString() : undefined,
      requiredCount: Number(form.requiredCount) || 1,
      assigneeIds,
    };
    try {
      if (editing) {
        await api(`/api/projects/${project.id}/work-modules/${editing.id}`, { method: 'PATCH', body });
        toast.success('已保存');
      } else {
        await api(`/api/projects/${project.id}/work-modules`, { body });
        toast.success('已创建');
      }
      setEditOpen(false);
      await load();
    } catch (e2) {
      toast.error((e2 as Error).message);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      await api(`/api/projects/${project.id}/work-modules/${deleting.id}`, { method: 'DELETE' });
      toast.success('已删除');
      setDeleting(null);
      await load();
    } catch (e2) {
      toast.error((e2 as Error).message);
    }
  };

  const setConfirmed = async (moduleId: string, confirmed: boolean) => {
    try {
      await api(`/api/projects/${project.id}/work-modules/${moduleId}/${confirmed ? 'confirm' : 'unconfirm'}`, { body: {} });
      toast.success(confirmed ? '已确认' : '已取消确认');
      await load();
    } catch (e2) {
      toast.error((e2 as Error).message);
    }
  };

  const printSheet = (u: string) => nav(`/p/${project.id}/work-sheet/print?user=${u}`);

  const myItems = (modules ?? []).filter((m) => user && m.assignees.some((a) => a.userId === user.id));
  const myAssignment = (m: WorkModuleItem) => m.assignees.find((a) => a.userId === user?.id);

  if (err) return <Card><CardContent className="p-4 text-sm text-destructive">{err}</CardContent></Card>;
  if (!modules) return <div className="space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-lg font-semibold">现场</h3>
        {canManage && (
          <Button size="sm" onClick={openCreate}><Plus className="size-4" /> 新建模块</Button>
        )}
      </div>

      {/* 我的任务单（全体成员可见） */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-base">我的任务单</CardTitle>
          <Button variant="outline" size="sm" onClick={() => printSheet('me')}>
            <Printer className="size-4" /> 打印任务单
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {myItems.length === 0 && <p className="text-sm text-muted-foreground">暂无分配给你的任务</p>}
          {myItems.map((m) => {
            const a = myAssignment(m)!;
            return (
              <div key={m.id} className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{m.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {[fmtRange(m), m.location].filter(Boolean).join(' ｜ ')}
                  </p>
                  {m.description && <p className="text-sm">{m.description}</p>}
                </div>
                {a.confirmedAt ? (
                  <Badge variant="outline" className="shrink-0 border-green-500 text-green-600 dark:text-green-400">
                    已确认 {a.confirmedAt.slice(5, 16).replace('T', ' ')}
                  </Badge>
                ) : (
                  <Button size="sm" className="shrink-0" onClick={() => setConfirmed(m.id, true)}>确认</Button>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* 模块管理（work:manage） */}
      {canManage && (
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-muted-foreground">任务模块（{modules.length}）</h4>
          {modules.length === 0 && (
            <Card className="flex flex-col items-center gap-3 py-10 text-center">
              <ClipboardList className="size-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">还没有任务模块，点击「新建模块」开始分工</p>
            </Card>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            {modules.map((m) => {
              const shortage = m.requiredCount - m.assignees.length;
              return (
                <Card key={m.id}>
                  <CardContent className="space-y-2 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">{m.name}</p>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          <Badge variant="secondary">需 {m.requiredCount} 人</Badge>
                          <Badge variant="outline">已分配 {m.assignees.length}</Badge>
                          {shortage > 0 && <Badge variant="destructive">缺 {shortage}</Badge>}
                        </div>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label="模块操作"><MoreHorizontal className="size-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEdit(m)}><Pencil className="size-4" /> 编辑</DropdownMenuItem>
                          <DropdownMenuItem variant="destructive" onClick={() => setDeleting(m)}><Trash2 className="size-4" /> 删除</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    {(fmtRange(m) || m.location) && (
                      <p className="text-sm text-muted-foreground">{[fmtRange(m), m.location].filter(Boolean).join(' ｜ ')}</p>
                    )}
                    {m.description && <p className="text-sm">{m.description}</p>}
                    {m.assignees.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {m.assignees.map((a) => (
                          <Badge
                            key={a.userId}
                            variant={a.confirmedAt ? 'default' : 'outline'}
                            className={a.confirmedAt ? 'bg-green-600 hover:bg-green-600' : ''}
                          >
                            {a.name}{a.confirmedAt ? ' ✓' : ''}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* 成员任务单（work:manage） */}
      {canManage && (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-base flex items-center gap-1.5"><Users className="size-4" /> 成员任务单</CardTitle>
            <Button variant="outline" size="sm" onClick={() => printSheet('all')}>
              <Printer className="size-4" /> 打印全员任务单
            </Button>
          </CardHeader>
          <CardContent className="divide-y">
            {members.map((mb) => {
              const cnt = modules.filter((m) => m.assignees.some((a) => a.userId === mb.userId)).length;
              return (
                <div key={mb.userId} className="flex items-center justify-between py-2 text-sm">
                  <span>{mb.name} <span className="text-muted-foreground">（{cnt} 项任务）</span></span>
                  <Button variant="ghost" size="sm" onClick={() => printSheet(mb.userId)}>任务单</Button>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* 新建/编辑弹层 */}
      <FormOverlay open={editOpen} onOpenChange={setEditOpen} title={editing ? '编辑模块' : '新建模块'}>
        <form onSubmit={save} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="wm-name">模块名称</Label>
            <Input id="wm-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如：检票 / 舞台协助" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="wm-start">开始时间</Label>
              <Input id="wm-start" type="datetime-local" value={form.startAt} onChange={(e) => setForm({ ...form, startAt: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wm-end">结束时间</Label>
              <Input id="wm-end" type="datetime-local" value={form.endAt} onChange={(e) => setForm({ ...form, endAt: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="wm-loc">地点</Label>
              <Input id="wm-loc" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wm-req">所需人力</Label>
              <Input id="wm-req" type="number" min={1} step={1} required value={form.requiredCount} onChange={(e) => setForm({ ...form, requiredCount: e.target.value })} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>分配成员（{assigneeIds.length}）</Label>
            <div className="flex flex-wrap gap-1.5">
              {members.map((mb) => (
                <label
                  key={mb.userId}
                  className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${
                    assigneeIds.includes(mb.userId) ? 'border-primary bg-accent text-accent-foreground' : 'border-border text-muted-foreground'
                  }`}
                >
                  <Checkbox
                    checked={assigneeIds.includes(mb.userId)}
                    onCheckedChange={(c) =>
                      setAssigneeIds(c ? [...assigneeIds, mb.userId] : assigneeIds.filter((x) => x !== mb.userId))
                    }
                  />
                  {mb.name}
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wm-desc">工作内容</Label>
            <Textarea id="wm-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <Button type="submit" className="w-full">{editing ? '保存' : '创建'}</Button>
        </form>
      </FormOverlay>

      {/* 删除确认 */}
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除模块「{deleting?.name}」？</AlertDialogTitle>
            <AlertDialogDescription>分配与确认记录将一并删除，该操作不可撤销。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={remove}>删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
```

注意：`api()` 默认方法是「有 body 则 POST」，confirm/unconfirm 传 `{ body: {} }` 即为 POST；时间处理与 TodosTab 同款（slice 显示、`new Date(v).toISOString()` 提交），不做时区改造。

- [ ] **Step 3: RolesTab 权限清单**

`frontend/src/components/project/RolesTab.tsx` 的 `PERMISSIONS` 数组末尾（`accounts:manage` 之后）追加：

```ts
  { key: 'work:manage', label: '现场分工管理' },
```

- [ ] **Step 4: 验证构建**

Run: `cd frontend && npm run build`
Expected: 构建成功（WorkTab 暂无引用属正常，Task 5 接入）

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types.ts frontend/src/components/project/WorkTab.tsx frontend/src/components/project/RolesTab.tsx
git commit -m "feat(frontend): 现场 WorkTab 与 work:manage 权限清单"
```

---

### Task 5: ProjectHome 集成 + 打印版式页

**Files:**
- Modify: `frontend/src/pages/ProjectHome.tsx`（TABS 加一项 + 条件渲染 + import）
- Modify: `frontend/src/App.tsx`（打印路由）
- Create: `frontend/src/pages/WorkSheetPrint.tsx`

**Interfaces:**
- Consumes: Task 4 的 `WorkTab`、`WorkSheetData`、`WorkModuleItem`；Task 3 的 `SheetJson`
- Produces: 路由 `/p/:id/work-sheet/print?user=me|<userId>|all`

- [ ] **Step 1: ProjectHome 集成**

`frontend/src/pages/ProjectHome.tsx`：
1. lucide import 追加 `ClipboardList`；组件 import 追加 `import WorkTab from '../components/project/WorkTab';`
2. `TABS` 在 `accounts` 之后插入：`{ key: 'work', label: '现场', icon: ClipboardList },`（移动端主栏仍为前 4 项，「现场」自动进「更多」Sheet）
3. 条件渲染区在 accounts 块之后追加：

```tsx
        {tab === 'work' && (
          <WorkTab project={detail.project} members={detail.members} myPermissions={detail.myPermissions} />
        )}
```

- [ ] **Step 2: 创建 WorkSheetPrint.tsx**

```tsx
import { ArrowLeft, Printer } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import type { Member, WorkModuleItem, WorkSheetData } from '../types';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

const fmt = (iso: string | null) => (iso ? iso.slice(0, 16).replace('T', ' ') : '');

interface Detail {
  project: { id: string; name: string };
  members: Member[];
}

export default function WorkSheetPrint() {
  const { id } = useParams<{ id: string }>();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const userParam = sp.get('user') ?? 'me';

  const [sheets, setSheets] = useState<WorkSheetData[] | null>(null);
  const [unassigned, setUnassigned] = useState<string[]>([]);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      if (userParam === 'all') {
        const [mods, detail] = await Promise.all([
          api<{ modules: WorkModuleItem[] }>(`/api/projects/${id}/work-modules`),
          api<Detail>(`/api/projects/${id}`),
        ]);
        const generatedAt = new Date().toISOString();
        const grouped = new Map<string, WorkModuleItem[]>();
        for (const m of mods.modules) {
          for (const a of m.assignees) {
            grouped.set(a.userId, [...(grouped.get(a.userId) ?? []), m]);
          }
        }
        setSheets(
          detail.members
            .filter((mb) => grouped.has(mb.userId))
            .map((mb) => ({
              project: detail.project,
              user: { id: mb.userId, name: mb.name },
              generatedAt,
              items: grouped.get(mb.userId)!,
            })),
        );
        setUnassigned(detail.members.filter((mb) => !grouped.has(mb.userId)).map((mb) => mb.name));
      } else {
        const path =
          userParam === 'me'
            ? `/api/projects/${id}/work-sheet`
            : `/api/projects/${id}/work-sheet/${userParam}`;
        const d = await api<WorkSheetData>(path);
        setSheets([d]);
      }
    })().catch((e) => setErr((e as Error).message));
  }, [id, userParam]);

  if (err) return <p className="p-6 text-sm text-destructive">{err}</p>;
  if (!sheets)
    return (
      <div className="mx-auto max-w-[210mm] space-y-3 p-6">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-[210mm] p-4 md:p-6 print:p-0">
        {/* 工具栏：打印时隐藏 */}
        <div className="mb-4 flex items-center gap-2 print:hidden">
          <Button variant="ghost" size="sm" onClick={() => nav(-1)}>
            <ArrowLeft className="size-4" /> 返回
          </Button>
          <span className="flex-1" />
          <Button size="sm" onClick={() => window.print()}>
            <Printer className="size-4" /> 打印 / 下载 PDF
          </Button>
        </div>

        {sheets.length === 0 && <p className="text-sm text-muted-foreground">没有可打印的任务单。</p>}

        {sheets.map((s) => (
          <section key={s.user.id} className="sheet-page mb-6 rounded-lg border bg-card p-6 print:mb-0 print:rounded-none print:border-0 print:p-0">
            <header className="mb-4 border-b pb-3">
              <h1 className="text-xl font-bold">{s.project.name} · 现场任务单</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                姓名：<span className="font-medium text-foreground">{s.user.name}</span>
                <span className="mx-2">｜</span>生成时间:{fmt(s.generatedAt)}
              </p>
            </header>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  {['任务模块', '时间', '地点', '工作内容', '确认'].map((h) => (
                    <th key={h} className="border px-2 py-1.5 text-left font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {s.items.length === 0 && (
                  <tr><td colSpan={5} className="border px-2 py-4 text-center text-muted-foreground">暂无分配任务</td></tr>
                )}
                {s.items.map((m) => (
                  <tr key={m.id}>
                    <td className="border px-2 py-1.5 font-medium">{m.name}</td>
                    <td className="border px-2 py-1.5 whitespace-nowrap">
                      {m.startAt || m.endAt ? `${fmt(m.startAt) || '…'} ~ ${fmt(m.endAt) || '…'}` : '—'}
                    </td>
                    <td className="border px-2 py-1.5">{m.location || '—'}</td>
                    <td className="border px-2 py-1.5">{m.description || '—'}</td>
                    <td className="border px-2 py-1.5 whitespace-nowrap">
                      {m.assignees.find((a) => a.userId === s.user.id)?.confirmedAt
                        ? `已确认 ${fmt(m.assignees.find((a) => a.userId === s.user.id)!.confirmedAt)}`
                        : '待确认'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <footer className="mt-6 flex gap-12 text-sm">
              <p>签字：＿＿＿＿＿＿＿＿</p>
              <p>日期：＿＿＿＿＿＿＿＿</p>
            </footer>
          </section>
        ))}

        {userParam === 'all' && unassigned.length > 0 && (
          <p className="mt-4 text-sm text-muted-foreground print:hidden">
            未分配任务：{unassigned.join('、')}
          </p>
        )}
      </div>

      {/* 打印版式：每张任务单分页 */}
      <style>{`
        @media print {
          .sheet-page { page-break-after: always; }
          .sheet-page:last-child { page-break-after: auto; }
        }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 3: App.tsx 挂路由**

`frontend/src/App.tsx`：import 追加 `import WorkSheetPrint from './pages/WorkSheetPrint';`；在 Layout 路由组**之前**（与 `/invite/:token` 同级）插入：

```tsx
      <Route
        path="/p/:id/work-sheet/print"
        element={
          <RequireAuth>
            <WorkSheetPrint />
          </RequireAuth>
        }
      />
```

- [ ] **Step 4: 验证构建**

Run: `cd frontend && npm run build`
Expected: 构建成功

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/ProjectHome.tsx frontend/src/App.tsx frontend/src/pages/WorkSheetPrint.tsx
git commit -m "feat(frontend): 工作台「现场」Tab 与任务单打印版式"
```

---

### Task 6: 文档更新与全量验证

**Files:**
- Modify: `docs/api.md`（追加 work-modules / work-sheet 端点）
- Modify: `docs/features.md`（权限点表加行 + 现场任务单功能说明一节）
- Modify: `docs/design.md`（实现与变更记录节追加 2026-07-27 条目）
- Modify: `docs/progress.md`（追加条目）
- Modify: `docs/readme.md`（如功能/权限点清单有提及则同步）

- [ ] **Step 1: 更新 docs/api.md**

在待办/财务等章节后追加「现场任务单」节，逐端点列出：方法/路径/权限/请求体/响应形状（从 Task 2/3 的 Interfaces 块抄），错误码沿用统一格式说明。

- [ ] **Step 2: 更新 docs/features.md**

- 「权限点一览」表追加一行：`` `work:manage` | 现场分工管理（任务模块、分配、代确认、全员任务单） ``
- 追加「现场任务单」章节：建模块（名称/时间/地点/所需人力/分配成员）→ 成员在「现场」Tab 确认 → 打印任务单（本人/按成员/全员连排，浏览器另存为 PDF，含签字栏）

- [ ] **Step 3: 更新 docs/design.md 与 progress.md**

- design.md「实现与变更记录」追加 2026-07-27 条目：WorkModule 模型、work:manage 权限点（预置角色快照问题的兜底说明：既有项目靠 project:manage 放行，不做迁移）、work-modules/work-sheet 路由、前端「现场」Tab 与打印版式
- progress.md 追加同内容条目（含测试结果）

- [ ] **Step 4: 核对 docs/readme.md**

功能列表/权限点如提及则同步追加；无提及则不改。

- [ ] **Step 5: 全量验证**

```bash
cd backend && npm test && npm run typecheck
cd ../frontend && npm run build
```

Expected: 后端全部测试 PASS（65 + 新增 20 个用例：模型/服务 4 + 路由 11 + 任务单 5）+ typecheck 无错误；前端构建成功

- [ ] **Step 6: Commit**

```bash
git add docs/
git commit -m "docs: 现场任务单功能文档"
```

---

## 附：任务依赖关系

1 → 2 → 3（后端链，后者依赖前者接口）→ 4 → 5（前端链）→ 6（收尾）。测试文件 `backend/tests/workModules.test.ts` 由 Task 1/2/3 接力扩充。
