# 新手引导 + 文档中心实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 首次使用用户看到「欢迎幻灯 + driver.js 高亮导览」（服务端 onboardedAt 判定、可跳过、跨设备一次）；新增 /help 文档中心（7 章图文手册 + 自动生成的真实截图）。

**Architecture:** 设计见 `docs/superpowers/specs/2026-07-27-onboarding-help-design.md`。后端 User 加 `onboardedAt` + `POST /api/me/onboarded`；前端 OnboardingDialog（幻灯）+ driver.js（导览）+ 数据驱动 DocsPage + Playwright 截图脚本。

**Tech Stack:** 后端 Express + TS + Mongoose + vitest；前端 React 18 + TS + Tailwind v4 + shadcn/ui + driver.js + Playwright（截图工具）。

## Global Constraints

- 仓库根 `/home/yuu/projects/anon`，分支 `feat/onboarding`；node/npm 不在默认 PATH，命令前先 `export PATH="$HOME/.local/share/node/bin:$PATH"`
- 后端：模型幂等注册惯例；错误用 AppError；异步包 ah；测试沿用 tests/ 现有模式（`npm test` + `npm run typecheck` 全绿）
- 前端：不改 `api/client.ts`、`auth.tsx`（允许只读消费）；不改后端路由之外的业务逻辑；图标只用 lucide-react
- **存量用户不做迁移**（onboardedAt null → 也会看到一次引导，这是已批准的设计决策）
- 截图脚本是开发工具，输出 `frontend/public/help/*.png` 入库；脚本本体也入库（`frontend/scripts/`）
- 验收：后端任务 = 测试 + typecheck 绿；前端任务 = `npm run build` 绿；已获授权直接 git commit（不 push）

---

### Task 1: 后端 onboardedAt

**Files:**
- Modify: `backend/src/models/User.ts`（字段 + publicUser）
- Modify: `backend/src/routes/me.ts`（若不存在则找挂载 `/api/me` 的路由文件，先读 `backend/src/app.ts` 确认）
- Test: `backend/tests/onboarding.test.ts`

**Interfaces:**
- Consumes: 现有 `authRequired`、`publicUser`
- Produces: `User.onboardedAt: Date | null`；`POST /api/me/onboarded` → 200 `{ user }`（publicUser 形状含 onboardedAt）

- [ ] **Step 1: 写失败测试**

创建 `backend/tests/onboarding.test.ts`：

```ts
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { InviteCode } from '../src/models/InviteCode';
import { User } from '../src/models/User';
import { createSuperAdmin, registerUser } from './helpers';

describe('onboarding', () => {
  it('注册响应 onboardedAt 为 null', async () => {
    const admin = await createSuperAdmin();
    await InviteCode.create({ code: 'C1', createdBy: (await User.findOne())!._id });
    const u = await registerUser('C1', 'a@x.com', 'A');
    const me = await request(app).get('/api/me').set('Authorization', `Bearer ${u.token}`);
    expect(me.status).toBe(200);
    expect(me.body.user.onboardedAt).toBeNull();
    void admin;
  });

  it('POST /api/me/onboarded 写入时戳，GET /api/me 一致', async () => {
    const admin = await createSuperAdmin();
    await InviteCode.create({ code: 'C1', createdBy: (await User.findOne())!._id });
    const u = await registerUser('C1', 'a@x.com', 'A');
    const res = await request(app).post('/api/me/onboarded').set('Authorization', `Bearer ${u.token}`).send({});
    expect(res.status).toBe(200);
    expect(res.body.user.onboardedAt).not.toBeNull();
    const me = await request(app).get('/api/me').set('Authorization', `Bearer ${u.token}`);
    expect(me.body.user.onboardedAt).toBe(res.body.user.onboardedAt);
    void admin;
  });

  it('重复 POST 幂等，不刷新时代码', async () => {
    const admin = await createSuperAdmin();
    await InviteCode.create({ code: 'C1', createdBy: (await User.findOne())!._id });
    const u = await registerUser('C1', 'a@x.com', 'A');
    const r1 = await request(app).post('/api/me/onboarded').set('Authorization', `Bearer ${u.token}`).send({});
    await new Promise((r) => setTimeout(r, 20));
    const r2 = await request(app).post('/api/me/onboarded').set('Authorization', `Bearer ${u.token}`).send({});
    expect(r2.body.user.onboardedAt).toBe(r1.body.user.onboardedAt);
    void admin;
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && npx vitest run tests/onboarding.test.ts`
Expected: FAIL（onboardedAt undefined / 404）

- [ ] **Step 3: 实现**

`backend/src/models/User.ts`：`IUser` 加 `onboardedAt: Date | null;`；schema 加 `onboardedAt: { type: Date, default: null },`；`publicUser` 返回对象加 `onboardedAt: u.onboardedAt ?? null,`。

`POST /api/me/onboarded`（挂在 `/api/me` 路由文件内，authRequired 之后）：

```ts
meRouter.post(
  '/onboarded',
  ah(async (req, res) => {
    const u = req.user!;
    if (!u.onboardedAt) {
      u.onboardedAt = new Date();
      await u.save();
    }
    res.json({ user: publicUser(u) });
  }),
);
```

（若 `req.user` 是文档快照而非 Mongoose 文档，改为 `User.findByIdAndUpdate(req.userId, { $setOnInsert: {}, onboardedAt: new Date() })` 前先查——以现有 me 路由的 PATCH 实现方式为准对齐写法。）

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && npx vitest run tests/onboarding.test.ts && npm test && npm run typecheck`
Expected: 3 新用例 PASS，全量回归绿

- [ ] **Step 5: Commit**

```bash
git add backend/src/models/User.ts backend/src/routes backend/tests/onboarding.test.ts
git commit -m "feat(backend): User.onboardedAt 与 POST /api/me/onboarded"
```

---

### Task 2: 前端新手引导

**Files:**
- Modify: `frontend/package.json`（`npm i driver.js`）
- Modify: `frontend/src/types.ts`（User 加 onboardedAt）
- Create: `frontend/src/components/onboarding/OnboardingDialog.tsx`
- Create: `frontend/src/components/onboarding/tour.ts`
- Modify: `frontend/src/App.tsx`（触发逻辑）
- Modify: `frontend/src/components/Layout.tsx`（data-tour 属性 + 用户菜单加两项）
- Modify: `frontend/src/pages/Projects.tsx`（「新建项目」按钮加 data-tour）

**Interfaces:**
- Consumes: Task 1 的 `onboardedAt` 字段与端点；`useAuth()` 的 `user`、`refresh`
- Produces: `startTour()`（tour.ts 导出）；Layout 用户菜单含「帮助文档」「重看引导」（/help 路由 Task 3 落地，本任务先挂菜单项与空路由占位亦可——但更佳：本任务只做引导，菜单「帮助文档」项放 Task 3）

- [ ] **Step 1: 安装与类型**

```bash
cd frontend && npm install driver.js
```

`frontend/src/types.ts` 的 `User` 接口加：`onboardedAt: string | null;`

- [ ] **Step 2: OnboardingDialog.tsx**

```tsx
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const SLIDES = [
  {
    title: '欢迎使用 ANON',
    body: '面向活动组织团队的全流程协作工具。\n\n核心概念很简单：一个「项目」就是一场活动；项目内按 Tab 分区（待办/财务/物料/账号/现场）；每个成员有角色，角色决定权限——你只会看到有权限的功能。',
  },
  {
    title: '四步快速上手',
    body: '1. 建项目：首页「新建项目」，填名称与日期\n2. 邀请成员：项目内「成员」Tab 生成邀请链接发给伙伴\n3. 开工：待办追踪进度、财务记账分摊、物料管理版本、账号记录平台密码\n4. 现场：建任务模块分配人力，成员确认后打印任务单发放',
  },
  {
    title: '随时可查的文档中心',
    body: '右上角头像菜单 →「帮助文档」，每个功能都有图文说明与真实截图。\n\n接下来将带你快速浏览界面要点（可随时跳过）。',
  },
];

export function OnboardingDialog({
  open,
  onSkip,
  onStartTour,
}: {
  open: boolean;
  onSkip: () => void;
  onStartTour: () => void;
}) {
  const [idx, setIdx] = useState(0);
  const last = idx === SLIDES.length - 1;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onSkip()}>
      <DialogContent className="sm:max-w-md" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{SLIDES[idx].title}</DialogTitle>
          <DialogDescription className="sr-only">新手引导 {idx + 1}/{SLIDES.length}</DialogDescription>
        </DialogHeader>
        <p className="whitespace-pre-line text-sm leading-6">{SLIDES[idx].body}</p>
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {SLIDES.map((_, i) => (
              <span key={i} className={`size-1.5 rounded-full ${i === idx ? 'bg-primary' : 'bg-muted'}`} />
            ))}
          </div>
          <span className="flex-1" />
          <Button variant="ghost" size="sm" onClick={onSkip}>跳过</Button>
          {last ? (
            <Button size="sm" onClick={onStartTour}>开始导览</Button>
          ) : (
            <Button size="sm" onClick={() => setIdx(idx + 1)}>下一步</Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: tour.ts**

```ts
import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';

export function startTour(onDone: () => void) {
  const d = driver({
    showProgress: true,
    nextBtnText: '下一步',
    prevBtnText: '上一步',
    doneBtnText: '完成',
    onDestroyed: () => onDone(),
    steps: [
      { element: '[data-tour=new-project]', popover: { title: '从这里开始', description: '创建你的第一个项目（一场活动），你就是主办。' } },
      { element: '[data-tour=theme-controls]', popover: { title: '主题随心换', description: '调色板切换「简洁/明快」两种风格，月亮切换日/夜模式。' } },
      { element: '[data-tour=user-menu]', popover: { title: '你的账号中心', description: '个人资料、联系方式、重看引导都在这里。' } },
      { element: '[data-tour=help-entry]', popover: { title: '帮助文档', description: '每个功能都有图文手册和真实截图，随时可以查。' } },
    ],
  });
  d.drive();
}
```

- [ ] **Step 4: data-tour 属性与触发**

- `Projects.tsx`：「新建项目」Button 加 `data-tour="new-project"`（页头那个，不是空态里的）
- `Layout.tsx`：StylePicker+ModeToggle 外层容器加 `data-tour="theme-controls"`；用户菜单 DropdownMenuTrigger 的 button 加 `data-tour="user-menu"`；下拉中新增「帮助文档」项的 DropdownMenuItem 加 `data-tour="help-entry"`（本任务先加「重看引导」项：onClick 本地弹 OnboardingDialog+startTour，不写 onboardedAt；「帮助文档」项 Task 3 加）
- `App.tsx`：

```tsx
function OnboardingGate() {
  const { user, refresh } = useAuth();
  const location = useLocation();
  const [showSlides, setShowSlides] = useState(false);
  useEffect(() => {
    if (user && !user.onboardedAt && location.pathname === '/projects') setShowSlides(true);
  }, [user, location.pathname]);
  const finish = async (tour: boolean) => {
    setShowSlides(false);
    try {
      await api('/api/me/onboarded', { method: 'POST', body: {} });
      await refresh();
    } catch {
      /* 落库失败不阻塞用户 */
    }
    if (tour) startTour(() => {});
  };
  if (!user) return null;
  return <OnboardingDialog open={showSlides} onSkip={() => finish(false)} onStartTour={() => finish(true)} />;
}
```

在 `App()` 的 `Routes` 同级（ThemeProvider 内）渲染 `<OnboardingGate />`。注意 import：`useAuth`、`useLocation`、`api`、`OnboardingDialog`、`startTour`。

- [ ] **Step 5: 验证构建**

Run: `cd frontend && npm run build`
Expected: 构建成功（driver.js 类型定义随包提供）

- [ ] **Step 6: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src
git commit -m "feat(frontend): 新手引导（欢迎幻灯 + driver.js 高亮导览）"
```

---

### Task 3: 文档中心（/help + 截图）

**Files:**
- Create: `frontend/src/components/help/content.ts`
- Create: `frontend/src/pages/DocsPage.tsx`
- Modify: `frontend/src/App.tsx`（/help 路由，Layout 内）
- Modify: `frontend/src/components/Layout.tsx`（用户菜单加「帮助文档」项 + data-tour）
- Create: `frontend/scripts/capture-help-screenshots.mjs`
- Create: `frontend/public/help/*.png`（脚本生成）

**Interfaces:**
- Consumes: Task 2 的 Layout 菜单结构；走查账号（walker-admin@wt.local / password123）与「现场走查活动」项目（截图场景）
- Produces: 路由 `/help`；`HelpChapter` 类型

- [ ] **Step 1: content.ts**

类型 + 7 章内容（每章 2-4 节，文字为简明中文要点；图片路径 `/help/<name>.png`）：

```ts
export interface HelpSection {
  heading?: string;
  paragraphs: string[];
  image?: { src: string; alt: string; caption?: string };
}
export interface HelpChapter {
  key: string;
  title: string;
  sections: HelpSection[];
}

export const HELP_CHAPTERS: HelpChapter[] = [
  { key: 'quick-start', title: '快速上手', sections: [/* 注册/建项目/邀请成员，图 /help/projects.png */] },
  { key: 'todos', title: '待办', sections: [/* 图 /help/tab-todos.png */] },
  { key: 'finance', title: '财务', sections: [/* 图 /help/tab-finance.png */] },
  { key: 'materials', title: '物料', sections: [/* 图 /help/tab-materials.png */] },
  { key: 'accounts', title: '账号', sections: [/* 图 /help/tab-accounts.png */] },
  { key: 'work', title: '现场', sections: [/* 图 /help/tab-work.png 与 /help/work-sheet.png */] },
  { key: 'permissions', title: '权限与角色', sections: [/* 无图或 /help/tab-members.png */] },
];
```

写全部 7 章的完整文案（参照 docs/features.md 压缩为应用内阅读篇幅，每段 1-3 句）。

- [ ] **Step 2: DocsPage.tsx**

```tsx
// 结构：页面标题「帮助文档」；移动端章节 Select 切换；桌面端左栏章节按钮列表（w-40）+ 右侧内容
// 内容区：当前章节逐节渲染（heading → h3；paragraphs → p text-sm leading-7；image → 圆角边框卡片图，点击弹 Dialog 放大原图）
// 组件状态：const [chapter, setChapter] = useState(HELP_CHAPTERS[0].key); const [zoom, setZoom] = useState<string | null>(null);
```

- [ ] **Step 3: 路由与菜单**

- `App.tsx`：Layout 路由组内加 `<Route path="/help" element={<DocsPage />} />`
- `Layout.tsx`：用户菜单「个人资料」之后加 `帮助文档` 项（`data-tour="help-entry"`，图标 BookOpen，onClick `nav('/help')`）

- [ ] **Step 4: 截图脚本与生成**

创建 `frontend/scripts/capture-help-screenshots.mjs`（Playwright chromium；BASE 默认 `http://localhost:5173`；桌面 1280×800；登录 walker-admin → 逐一路径截图）：

```js
// 截图清单（输出到 frontend/public/help/）：
// projects.png          /projects（项目列表）
// tab-todos.png         /p/<pid>（待办 Tab）
// tab-finance.png       财务 Tab
// tab-materials.png     物料 Tab
// tab-accounts.png      账号 Tab
// tab-work.png          现场 Tab
// work-sheet.png        /p/<pid>/work-sheet/print?user=me（任务单）
// tab-members.png       成员 Tab
```

项目 id 用「现场走查活动」（先 GET /api/projects 用 token 查到 id；token 由登录接口换取）。Tab 切换用 `button[role=tab]:has-text("xxx")`。每张截图前等待 800ms 稳定。文件头注释写明用法：

```js
// 用法：PLAYWRIGHT_BROWSERS_PATH=<浏览器目录> node frontend/scripts/capture-help-screenshots.mjs
// 前置：dev 服务器运行中（localhost:5173）、走查账号与「现场走查活动」项目存在
```

执行生成：`cd /home/yuu/projects/anon && PLAYWRIGHT_BROWSERS_PATH=$PWD/.walkthrough/browsers node frontend/scripts/capture-help-screenshots.mjs`，然后目检 `frontend/public/help/` 下 8 张图非空。

- [ ] **Step 5: 验证构建**

Run: `cd frontend && npm run build`
Expected: 构建成功（public/ 下 png 会被 vite 原样拷贝到 dist）

- [ ] **Step 6: Commit**

```bash
git add frontend/src frontend/scripts frontend/public/help
git commit -m "feat(frontend): /help 文档中心与截图生成脚本"
```

---

### Task 4: 走查验证 + 文档收尾

**Files:**
- Create: `.walkthrough/onboarding-help.mjs`（临时走查脚本，gitignored）
- Modify: `docs/progress.md`、`docs/features.md`、`docs/api.md`、`docs/readme.md`

- [ ] **Step 1: 走查脚本断言（Playwright）**

1. 新注册用户（mongosh 插邀请码 + 注册）首登 → 幻灯可见（标题「欢迎使用 ANON」）→ 点两次「下一步」→「开始导览」→ driver 高亮层出现（`.driver-popover`）→ 点「完成」→ 刷新页面不再弹
2. 另一新用户点「跳过」→ 刷新不再弹；`GET /api/me` 的 onboardedAt 非空
3. `/help` 打开 → 7 章导航可见 → 切到「现场」章 → 截图 img 加载成功（naturalWidth > 0）→ 点击图片弹放大 Dialog
4. 用户菜单含「帮助文档」「重看引导」；点「重看引导」幻灯再出现
5. 移动端视口 /help 可用（章节 Select）

- [ ] **Step 2: 跑走查 + 人工读关键截图**

- [ ] **Step 3: 文档更新**

- `docs/api.md`：`POST /api/me/onboarded` 端点 + User 响应含 onboardedAt
- `docs/features.md`：新增「新手引导与帮助文档」小节（首次引导/重看引导/帮助文档中心）
- `docs/progress.md`：2026-07-27 条目
- `docs/readme.md`：功能清单加「新手引导 / 内置帮助文档（/help）」+ 备注重生成截图命令

- [ ] **Step 4: 全量验证 + Commit**

```bash
cd backend && npm test && npm run typecheck
cd ../frontend && npm run build
git add docs/
git commit -m "docs: 新手引导与文档中心文档"
```

---

## 附：任务依赖关系

1（后端字段）→ 2（引导前端依赖字段）→ 3（文档中心，独立于 1/2 但菜单项挂在 Task 2 的 Layout 改动上）→ 4（收尾）。走查脚本为临时工具（.walkthrough/ 已 gitignore）。
