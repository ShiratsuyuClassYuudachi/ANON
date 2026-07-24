# ANON 前端 UI 焕新设计

- 日期：2026-07-24
- 状态：已通过头脑风暴评审，待实施
- 范围：仅 `frontend/`，后端与业务逻辑零改动

## 1. 背景与目标

当前前端（Vite + React 18 + TS）全部样式为 62 行手写 CSS（`frontend/src/index.css`），无任何组件库，页面观感简陋。目标：引入开源样式与组件体系，对全部页面做**视觉焕新 + 布局优化**，并提供**「简洁」「明快」两套可选风格主题**（各自支持日/夜模式）。

非目标：

- 不改任何 API、数据模型、权限逻辑、加密逻辑
- 不改路由结构与页面 URL
- 不引入新的业务功能

## 2. 技术选型

| 项 | 选择 | 说明 |
| --- | --- | --- |
| 样式 | Tailwind CSS | 原子化 CSS，配合 CSS 变量主题 |
| 组件 | shadcn/ui 模式 | 组件源码落在 `frontend/src/components/ui/`，基于 Radix UI 原语 + `class-variance-authority` + `clsx`/`tailwind-merge`，无黑盒依赖 |
| 图标 | lucide-react | shadcn 标准图标库 |
| 轻提示 | sonner | 替代 `alert()`/内联错误 |
| 构建 | 沿用 Vite 5 + TS | 新增 PostCSS/Tailwind 配置 |

明确不改动：`api/client.ts`、`auth.tsx`、`crypto.ts`、`AuthImg`（fetch+Blob 鉴权图片）、`types.ts`、所有后端代码。

## 3. 主题系统（核心）

### 3.1 维度

- 风格：`data-style="minimal" | "playful"`（挂在 `<html>`）
  - **简洁 minimal**：中性灰底 + 蓝主色、紧凑圆角（≈0.5rem），类 Linear/Notion
  - **明快 playful**：紫粉系主色、大圆角（≈1rem）、轻渐变点缀（仅头部/品牌位使用，不大面积铺）
- 明暗：`class="dark"`（shadcn 约定），沿用现有 ☾/☀ 切换

共 4 组 CSS 变量组合：`:root`、`.dark`、`:root[data-style='playful']`、`:root[data-style='playful'].dark`。

### 3.2 变量约定

遵循 shadcn 命名（HSL 通道值）：`--background --foreground --card --card-foreground --popover --popover-foreground --primary --primary-foreground --secondary --secondary-foreground --muted --muted-foreground --accent --accent-foreground --destructive --destructive-foreground --border --input --ring --radius`。Tailwind 配置把这些变量映射为语义色（`bg-background`、`text-muted-foreground`、`bg-card` 等），组件只消费变量，主题切换零业务侵入。

### 3.3 持久化与防闪烁

- `localStorage`：`anon-style`（minimal/playful，默认 minimal）、`anon-theme`（light/dark，沿用现有键与默认值逻辑）
- `index.html` 内联脚本启动时读取两个键写入 `data-style` 与 `dark` 类，避免首屏闪烁；`theme-color` meta 同步更新
- 现有 `theme.tsx` 重写为同时管理两个维度；用户偏好切换入口：头部用户菜单 + 「我的」页

## 4. 组件清单

新增 `frontend/src/components/ui/`（约 20 个，按需复制 shadcn 实现并适配双主题）：

- 基础：button、input、textarea、label、checkbox、radio-group、select、switch、badge、card、separator、skeleton、avatar、tooltip
- 覆盖层：dialog、alert-dialog（替代 `confirm()`）、dropdown-menu、popover、sheet（移动端抽屉）
- 反馈：sonner（toast）

原手写类（`.card/.btn/.chip/.tabs/.row/.muted` 等）全部退役，页面改用上述组件 + Tailwind 工具类。

## 5. 布局与导航（移动端优先）

### 5.1 全局头部

吸顶 + 毛玻璃（backdrop-blur）+ 底部分隔线：左侧 ANON 标识；右侧 ☾/☀ 切换、用户菜单（dropdown：个人资料、风格主题切换、退出登录）。未登录页（登录/注册）头部仅标识与主题切换。

### 5.2 项目工作台导航

- **移动端（<768px）**：底部固定图标导航栏 —— 待办、财务、物料、账号 + 「更多」（sheet 抽屉内放 成员/角色/设置）
- **桌面端（≥768px）**：项目页顶部 tabs（shadcn Tabs），内容区最大宽度 960px，保留双栏网格布局
- 当前 Tab 状态与 URL 同步逻辑不变，仅改呈现组件

### 5.3 通用反馈

- 加载：骨架屏（skeleton）替代空白
- 空状态：图标 + 文案 + 主操作按钮（如「暂无待办，创建第一个」）
- 错误/成功：sonner toast；危险操作：alert-dialog 二次确认

## 6. 页面改造要点

| 页面 | 要点 |
| --- | --- |
| Login / Register / InviteAccept | 居中品牌卡片，表单用 ui 组件，错误 toast 化 |
| Projects | 项目卡片（名称、日期、成员数等现有数据），「新建项目」改 dialog |
| ProjectHome | 导航见 5.2；其余结构由 Tab 组件承载 |
| TodosTab | 筛选栏用 select/popover 紧凑排布；待办卡片加状态 badge（进行中/已完成/已逾期）；「完成」走 dialog（备注+附件）；模板导入/导出收进卡片菜单或页头按钮 |
| FinanceTab | 汇总改统计卡网格（门票收入/记账收入/总支出/盈亏，数字用 tabular-nums）；「记一笔」移动端走 sheet、桌面端 dialog；按人净额、建议转账分卡展示；导出 CSV 进菜单 |
| MaterialsTab | 类型切换用 chips/badge；资源卡片带预览图（沿用 AuthImg）、版本下拉；上传走 dialog |
| AccountsTab | 账号卡片按平台分组/筛选；「查看密码」走 dialog（口令输入/直接显示） |
| MembersTab | 成员卡片 + 角色 select；「生成邀请链接」dialog（含复制按钮） |
| RolesTab | 角色卡 + 权限点 checkbox 矩阵 |
| SettingsTab / Me / Admin | 分区卡片表单，保持现有字段与提交逻辑 |

所有页面保持现有数据获取与提交流程，仅替换呈现与交互组件。

## 7. 兼容与迁移

- 构建链：新增 `tailwind.config`、`postcss.config`、`index.css` 改为 Tailwind 指令 + 变量定义
- `anon-theme` 旧值（dark/light）直接兼容；无 `anon-style` 时默认 minimal
- 构建产物仍为静态文件，部署方式不变（`vite preview` / 静态托管）

## 8. 验证方式

- `npm run build`（`tsc --noEmit && vite build`）通过
- 人工核对清单：全部 13 个页面/Tab × 4 种主题组合（简洁/明快 × 日/夜）× 移动端/桌面两种视口，重点检查对比度、表单对齐、弹窗/抽屉在窄屏可用性
- 冒烟主流程：登录 → 建项目 → 待办增删完成 → 记账看汇总 → 传物料 → 查账号密码

## 9. 文档更新义务

实施完成后按仓库约定更新：`docs/progress.md`（变更记录）、`docs/readme.md`（如新依赖/命令变化）、`docs/design.md`（实现与变更记录节）。
