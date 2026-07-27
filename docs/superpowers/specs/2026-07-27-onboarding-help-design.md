# 新手引导 + 文档中心设计

- 日期：2026-07-27
- 状态：已批准
- 分支：`feat/onboarding`

## 1. 目标

- **新手引导**：首次使用的用户登录后看到欢迎幻灯 + 界面高亮导览，可跳过；按账号跨设备只出现一次
- **文档中心**：应用内 `/help` 页面，按功能域组织的图文手册（真实界面截图）

关键决策（头脑风暴结论）：引导形态 = 欢迎幻灯 + driver.js 遮罩高亮（两者结合）；首次判定 = 服务端 `User.onboardedAt` 字段；文档形态 = 结构化图文手册（数据驱动，不用 markdown 渲染器）；**存量用户 onboardedAt 为 null 也会看到一次引导**（可跳过，兼作新功能告知，不做数据迁移）。

## 2. 后端

- `User` 模型：`onboardedAt: { type: Date, default: null }`；`publicUser` 输出该字段；登录/注册/`GET /api/me` 响应自然携带
- `POST /api/me/onboarded`（authRequired）→ 若 `onboardedAt` 为空则写入当前时间（幂等，不刷新已有值），返回 `{ user }`
- 测试（vitest + memory-server，追加到现有 me/auth 测试文件或新文件）：
  1. 注册响应 `onboardedAt` 为 null
  2. POST onboarded → 200 且 `onboardedAt` 非空，`GET /api/me` 一致
  3. 重复 POST 幂等（时戳不变）

## 3. 新手引导（前端）

### 3.1 依赖

`npm i driver.js`（约 5KB；`import { driver } from 'driver.js'` + `import 'driver.js/dist/driver.css'`）。

### 3.2 组成

- `frontend/src/components/onboarding/OnboardingDialog.tsx`：3 页幻灯（欢迎与核心概念 / 四步快速上手 / 文档中心入口），shadcn Dialog 实现，始终显示「跳过」；末页主按钮「开始导览」
- `frontend/src/components/onboarding/tour.ts`：driver.js 导览配置（步骤：`[data-tour=new-project]`、`[data-tour=theme-controls]`、`[data-tour=user-menu]`、`[data-tour=help-entry]`）与启动函数
- 关键元素加 `data-tour` 属性：Projects 页「新建项目」按钮、Layout 头部的 StylePicker+ModeToggle 容器、用户菜单触发器、用户菜单「帮助文档」项
- 触发：`App.tsx` 在 `user && !user.onboardedAt` 且位于 `/projects` 时渲染 OnboardingDialog；完成导览或点跳过 → `POST /api/me/onboarded` → `refresh()`
- 用户菜单（Layout 下拉）加两项：「帮助文档」（→ /help）、「重看引导」（本地再播幻灯+导览，不写 onboardedAt）

### 3.3 文案（幻灯 3 页）

1. **欢迎使用 ANON**：一句话定位（活动全流程协作）+ 核心概念（项目=一个活动；功能按 Tab 分区；权限按角色）
2. **四步快速上手**：建项目 → 邀请成员 → 各 Tab 开工（待办/财务/物料/账号）→ 现场分工与打印任务单
3. **随时可查的文档中心**：右上角用户菜单 → 帮助文档；随后进入界面导览

## 4. 文档中心（前端）

- 路由 `/help`（Layout 内）；`DocsPage`：左侧章节导航（移动端收进抽屉）+ 内容区；截图点击放大（Dialog）
- 内容 `frontend/src/components/help/content.ts`：类型化数据 `HelpChapter { key, title, sections: { heading?, paragraphs: string[], image?: { src, alt, caption? } }[] }`，7 章：
  1. 快速上手（注册/建项目/邀请成员）
  2. 待办（创建/筛选/完成带附件/模板）
  3. 财务（记账/多票种/汇总/转账建议/导出）
  4. 物料（类型/版本/预览/可见范围）
  5. 账号（三模式/两种加密/可见范围）
  6. 现场（建模块/分配/确认/打印任务单）
  7. 权限与角色（预置角色/自定义角色/可见范围优先级/Tab 可见性）
- **截图自动生成**：`frontend/scripts/capture-help-screenshots.mjs`（Playwright；用走查账号与「现场走查活动」项目，逐 Tab + 关键页截图，桌面 1280 视口，简洁浅色主题），输出 `frontend/public/help/*.png`（提交入库）；readme 备注重生成命令（`PLAYWRIGHT_BROWSERS_PATH=... node frontend/scripts/capture-help-screenshots.mjs`）

## 5. 验证

- 后端 vitest 全绿 + typecheck；前端 build 通过
- 浏览器走查：新注册用户首登弹幻灯（3 页可翻）→「开始导览」高亮 4 个元素 → 完成后不再出现；「跳过」同样落库；老账号（onboardedAt 已写）不再弹；/help 7 章渲染、截图加载、点击放大；移动端抽屉导航
