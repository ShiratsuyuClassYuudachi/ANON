# 工作台按权限控制可见性设计

- 日期：2026-07-27
- 状态：已批准（用户选定「彻底隐藏」策略）

## 目标

用户在项目工作台只能看到有权限的 Tab 和按钮：无权限的模块从导航中彻底消失，无权限的操作按钮不渲染。

## 现状与差距

- 已有门控：FinanceTab（canManage/canAdd）、MaterialsTab/AccountsTab/WorkTab（canManage）、MembersTab（邀请卡/角色选择/移除）、SettingsTab（保存按钮）
- 差距：ProjectHome 无条件渲染全部 8 个 Tab；TodosTab 的「新建待办」「模板」对无 `todo:manage` 的成员可见（提交才 403）；RolesTab/SettingsTab 对无权限者是无用的死 Tab

## 可见性映射

集中定义在 `frontend/src/pages/ProjectHome.tsx` 的 `TABS` 常量，每项加 `visible: (perms: string[]) => boolean`：

| Tab key | 可见条件 |
| --- | --- |
| todos | 全体成员（恒 true） |
| finance | `project:manage` \|\| `finance:manage` \|\| `finance:add` |
| materials / accounts / work / members | 全体成员（恒 true） |
| roles | `project:manage` \|\| `role:manage` |
| settings | `project:manage` |

## 实现要点

1. `visibleTabs = TABS.filter(t => t.visible(detail.myPermissions))`；桌面 Tabs、移动底部导航、「更多」Sheet、条件渲染统一消费。移动底部栏：主栏取 `visibleTabs.slice(0, 4)`，其余进「更多」；列数用内联 `gridTemplateColumns: repeat(n, minmax(0,1fr))`（n = 主栏数 + (more 非空 ? 1 : 0)），规避 Tailwind 动态类名
2. 当前 tab 不可见时 `useEffect` 回退到 `visibleTabs[0].key`
3. 按钮级补漏：TodosTab 的「新建待办」按钮与「模板」菜单用已有 `canManage`（`todo:manage`）门控
4. 不动：RolesTab/SettingsTab 内部（整 tab 隐藏后无意义）、其余 Tab 的既有门控、后端

## 验证

- `npm run build` 通过
- 浏览器自动走查断言：staff（一般staff 角色）只见 待办/财务/物料/账号/现场/成员 6 个 Tab、无「新建待办」按钮、移动端「更多」Sheet 内也无角色/设置；主办视角 8 个 Tab 齐全
