import { driver, type DriveStep } from 'driver.js';
import 'driver.js/dist/driver.css';
import { api } from '../../api/client';

/** 带页面跳转信息的导览步：path 存在时先经 react-router 导航到该页再高亮 */
type TourStep = DriveStep & { data?: { path?: string } };


/**
 * 全模块引导导览：每步自动跳转到目标页面（react-router 客户端导航），
 * 依赖 driver.js waitForElement（MutationObserver）等待目标页渲染出锚点；
 * 权限预过滤财务步，skipMissingElement 兜底其余锚点缺失（如项目加载失败）。
 */
export async function startTour(opts: { nav: (to: string) => void; projectId?: string }): Promise<void> {
  const { nav } = opts;
  const isDesktop = window.matchMedia('(min-width: 768px)').matches;

  // 项目上下文：优先用调用方给的当前项目 id，否则取列表第一个；无项目则走全局精简版
  let pid = opts.projectId;
  if (!pid) {
    const d = await api<{ projects: Array<{ id: string }> }>('/api/projects').catch(() => null);
    pid = d?.projects[0]?.id;
  }
  // 权限预过滤：财务 Tab 不可见时不排入步骤（避免进度计数跳动与跳页闪烁）；拉取失败则保留全部步骤交给 skipMissingElement 兜底
  let canSeeFinance = true;
  if (pid) {
    const detail = await api<{ myPermissions: string[] }>(`/api/projects/${pid}`).catch(() => null);
    if (detail) canSeeFinance = ['project:manage', 'finance:manage', 'finance:add'].some((k) => detail.myPermissions.includes(k));
  }

  const projectSteps: TourStep[] = pid
    ? [
        { element: '[data-tour=project-card]', data: { path: '/projects' }, popover: { title: '项目卡片：状态一眼看全', description: '卡片汇集健康度灯、你的角色、倒计时、当前阶段、待办进度与风险数。<br>点卡片进入项目工作台。' } },
        { element: isDesktop ? '[data-tour=tab-nav]' : '[data-tour=mobile-tab-nav]', data: { path: `/p/${pid}` }, popover: { title: '模块导航', description: isDesktop ? '左侧边栏切换各功能模块；下方「现场模式」进入活动当日专用页。' : '底部导航切换常用模块；看板、账号、现场、成员等其余模块收在「更多」里。' } },
        { element: '[data-tour=tab-dashboard]', data: { path: `/p/${pid}?tab=dashboard` }, popover: { title: '看板：项目全貌', description: '健康度、倒计时、阶段进度、风险与最新动态一屏总览；切换个人/项目视图，点指标卡直达对应模块。' } },
        { element: '[data-tour=tab-todos]', data: { path: `/p/${pid}?tab=todos` }, popover: { title: '待办：任务追踪', description: '输入标题回车快速派任务，点「详细」可设负责人、截止时间与附件；成员报进度，到期自动邮件+推送提醒。' } },
        ...(canSeeFinance
          ? [{ element: '[data-tour=tab-finance]', data: { path: `/p/${pid}?tab=finance` }, popover: { title: '财务：收支与门票', description: '「记一笔」登记收入/支出/报销并上传凭证；「门票设置」管理票种与售价；账目可导出 CSV 对账。' } } satisfies TourStep]
          : []),
        { element: '[data-tour=tab-materials]', data: { path: `/p/${pid}?tab=materials` }, popover: { title: '物料：文件版本与实物', description: '数字资源按类型归档、逐版本上传可回溯；切到「实物清单」管理采购、借还与损耗。' } },
        { element: '[data-tour=tab-accounts]', data: { path: `/p/${pid}?tab=accounts` }, popover: { title: '账号：平台凭证库', description: '「新建账号」登记各平台账号密码（加密存储）；按平台筛选，「解密查看」会留操作记录。' } },
        { element: '[data-tour=tab-work]', data: { path: `/p/${pid}?tab=work` }, popover: { title: '现场分工：排班与任务单', description: '「新建模块」按时段与地点排人力；成员确认后「打印任务单」生成 A4 单发放。' } },
        { element: '[data-tour=tab-members]', data: { path: `/p/${pid}?tab=members` }, popover: { title: '成员：邀请与角色', description: '「生成链接」邀请伙伴（可指定角色）；成员列表随时调整角色，角色决定各模块可见功能。' } },
        { element: '[data-tour=onsite-content]', data: { path: `/p/${pid}/onsite` }, popover: { title: '现场模式：活动当日', description: '签到与完成任务、按分类查看安排、异常一键上报、联系人直拨；支持离线使用（PWA）。' } },
      ]
    : [];

  const steps: TourStep[] = [
    { element: '[data-tour=new-project]', data: { path: '/projects' }, popover: { title: '从这里开始：创建项目', description: '一个「项目」就是一场活动（漫展、演出、展会…）。<br>点「新建项目」填名称与日期即可创建，创建者自动成为主办。' } },
    ...projectSteps,
    { element: '[data-tour=docs-content]', data: { path: '/help' }, popover: { title: '帮助中心：图文手册', description: '每个模块都有图文说明与真实截图；顶部搜索框可全文检索，点截图可放大。' } },
    ...(isDesktop
      ? [{ element: '[data-tour=theme-controls]', popover: { title: '主题随心换', description: '调色板切换「简洁/明快」两种风格，月亮图标切换日/夜模式。' } } satisfies TourStep]
      : []),
    { element: '[data-tour=user-menu]', popover: { title: '你的账号中心', description: '个人资料、帮助文档、重看引导都在这个菜单里；移动端的主题切换也收在这里。<br>导览到此结束，开工吧！' } },
  ];

  const d = driver({
    steps,
    showProgress: true,
    progressText: '第 {{current}} 步 / 共 {{total}} 步',
    nextBtnText: '下一步',
    prevBtnText: '上一步',
    doneBtnText: '完成',
    skipMissingElement: true,
    waitForElement: 5000,
    onNextClick: (_el, _step, { state }) => go((state.activeIndex ?? -1) + 1),
    onPrevClick: (_el, _step, { state }) => go((state.activeIndex ?? 0) - 1),
    onDoneClick: () => d.destroy(),
  });

  function go(idx: number) {
    const s = steps[idx];
    if (!s) {
      d.destroy();
      return;
    }
    const path = s.data?.path;
    if (path && window.location.pathname + window.location.search !== path) nav(path);
    d.moveTo(idx);
  }

  const first = steps[0]?.data?.path;
  if (first && window.location.pathname + window.location.search !== first) nav(first);
  d.drive(0);
}
