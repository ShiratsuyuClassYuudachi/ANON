# 工作台按权限控制可见性实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 工作台 Tab 与按钮按 `myPermissions` 过滤可见性（spec: `docs/superpowers/specs/2026-07-27-permission-visibility-design.md`）。

**Architecture:** 可见性断言集中在 ProjectHome 的 TABS 常量；所有导航呈现与条件渲染消费同一 `visibleTabs`；TodosTab 补两个按钮门控。

**Tech Stack:** React 18 + TS + Tailwind v4 + shadcn/ui。

## Global Constraints

- 仓库根 `/home/yuu/projects/anon`，分支 `feat/perm-visibility`；node/npm 不在默认 PATH，先 `export PATH="$HOME/.local/share/node/bin:$PATH"`
- 只改 `frontend/src/pages/ProjectHome.tsx` 与 `frontend/src/components/project/TodosTab.tsx`；不改后端、不改其他 Tab
- 可见性映射（逐字照 spec）：todos/materials/accounts/work/members 恒 true；finance = `project:manage || finance:manage || finance:add`；roles = `project:manage || role:manage`；settings = `project:manage`
- 验收 = `npm run build` 通过；已获授权直接 git commit（不 push）

---

### Task 1: ProjectHome 集中可见性 + TodosTab 按钮门控

**Files:**
- Modify: `frontend/src/pages/ProjectHome.tsx`
- Modify: `frontend/src/components/project/TodosTab.tsx`（「新建待办」按钮与「模板」菜单加 canManage 门控）

**Interfaces:**
- Consumes: 现有 `Detail.myPermissions: string[]`；TodosTab 已有 `canManage`（`project:manage || todo:manage`，第 60 行附近）
- Produces: `visibleTabs`（同文件内消费，不外泄）

- [ ] **Step 1: 改 ProjectHome.tsx**

1. `TABS` 常量每项追加 `visible` 字段（类型标注放宽为 `{ key: string; label: string; icon: ...; visible: (p: string[]) => boolean }`；`tab` state 的键类型同步放宽或保持 `(typeof TABS)[number]['key']`）：

```tsx
const TABS = [
  { key: 'todos', label: '待办', icon: ListTodo, visible: () => true },
  { key: 'finance', label: '财务', icon: Wallet, visible: (p: string[]) => hasAny(p, ['project:manage', 'finance:manage', 'finance:add']) },
  { key: 'materials', label: '物料', icon: FolderOpen, visible: () => true },
  { key: 'accounts', label: '账号', icon: KeyRound, visible: () => true },
  { key: 'work', label: '现场', icon: ClipboardList, visible: () => true },
  { key: 'members', label: '成员', icon: Users, visible: () => true },
  { key: 'roles', label: '角色', icon: Shield, visible: (p: string[]) => hasAny(p, ['project:manage', 'role:manage']) },
  { key: 'settings', label: '设置', icon: Settings, visible: (p: string[]) => p.includes('project:manage') },
] as const;

function hasAny(p: string[], keys: string[]) {
  return keys.some((k) => p.includes(k));
}
```

2. 组件内（`detail` 就绪后）计算：

```tsx
const visibleTabs = TABS.filter((t) => t.visible(detail.myPermissions));
const mainTabs = visibleTabs.slice(0, 4);
const moreTabs = visibleTabs.slice(4);

// 当前 tab 不可见时回退
useEffect(() => {
  if (detail && !visibleTabs.some((t) => t.key === tab)) {
    setTab(visibleTabs[0]?.key ?? 'todos');
  }
}, [detail, tab, visibleTabs]);
```

注意 `visibleTabs` 每次渲染新建数组会让该 useEffect 频繁触发——用 `useMemo` 包 visibleTabs/mainTabs/moreTabs（依赖 `detail?.myPermissions`），或把回退逻辑写成渲染期直接取 `const activeTab = visibleTabs.some(...) ? tab : visibleTabs[0].key`（渲染期派生，免 effect，推荐）。原 `MOBILE_MAIN`/`MOBILE_MORE` 常量删除。

3. 三处呈现统一改用 visibleTabs 派生：
   - 桌面 `Tabs`：`TABS.map` → `visibleTabs.map`
   - 条件渲染：判据改为 `activeTab === 'xxx'`（若用上渲染期派生）且该 tab 在 visibleTabs 中
   - 移动底部导航：`<div className="grid" style={{ gridTemplateColumns: `repeat(${mainTabs.length + (moreTabs.length > 0 ? 1 : 0)}, minmax(0, 1fr))` }}>`；`MOBILE_MAIN.map` → `mainTabs.map`；「更多」按钮仅 `moreTabs.length > 0` 时渲染，高亮判据 `moreTabs.some(t => t.key === activeTab)`；Sheet 内 `MOBILE_MORE.map` → `moreTabs.map`

- [ ] **Step 2: 改 TodosTab.tsx**

页头「模板」DropdownMenu 触发按钮与「新建待办」按钮（第 240-270 行附近）外层包 `{canManage && (...)}`（两个按钮同在一个 flex 容器内，整容器门控即可）。其余不动。

- [ ] **Step 3: 验证构建**

Run: `cd frontend && npm run build`
Expected: 构建成功

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/ProjectHome.tsx frontend/src/components/project/TodosTab.tsx
git commit -m "feat(frontend): 工作台 Tab 与待办按钮按权限控制可见性"
```

---

### Task 2: 浏览器走查验证 + 文档

**Files:**
- Create: `.walkthrough/perm-visibility.mjs`（临时走查脚本，gitignored）
- Modify: `docs/progress.md`、`docs/features.md`（界面与体验节：Tab 可见性说明）

- [ ] **Step 1: 走查脚本（Playwright，复用 .walkthrough 环境）**

用 `PLAYWRIGHT_BROWSERS_PATH=.walkthrough/browsers node .walkthrough/perm-visibility.mjs` 执行，断言：

1. staff（walker-staff@wt.local / password123）登录进「现场走查活动」：桌面 tabs 只有 6 项且无「角色」「设置」；无「新建待办」按钮；移动端「更多」Sheet 内无角色/设置
2. admin（walker-admin@wt.local）登录：8 个 Tab 齐全，「新建待办」可见
3. 截图各一张存 `.walkthrough/shots/`

注意：走查项目里 staff 是「一般staff」角色（todo:complete + finance:add，无 role:manage/project:manage）。

- [ ] **Step 2: 跑走查并人工读截图核对**

- [ ] **Step 3: 更新文档**

- `docs/progress.md` 追加 2026-07-27 条目
- `docs/features.md`「界面与体验」节补一句：工作台 Tab 与操作按钮按项目内权限点过滤可见性（角色/设置仅管理者可见）

- [ ] **Step 4: Commit**

```bash
git add docs/progress.md docs/features.md
git commit -m "docs: 权限可见性说明"
```

---

## 附：任务依赖关系

1 → 2（验证依赖实现）。走查脚本为临时工具（.walkthrough/ 已 gitignore），不进版本库。
