import { driver, type DriveStep } from 'driver.js';
import 'driver.js/dist/driver.css';
import { api } from '../../api/client';

/** 带页面跳转信息的导览步：path 存在时先经 react-router 导航到该页再高亮 */
type TourStep = DriveStep & { data?: { path?: string } };

/**
 * 跨页导览先导航，再等待目标页渲染锚点。财务步骤在启动前按权限过滤。
 */
export async function startTour(opts: { nav: (to: string) => void; projectId?: string }): Promise<void> {
  const { nav } = opts;
  const isDesktop = window.matchMedia('(min-width: 48rem)').matches;

  // 项目上下文：优先用调用方给的当前项目 id，否则取列表第一个；无项目则走全局精简版
  let pid = opts.projectId;
  if (!pid) {
    const d = await api<{ projects: Array<{ id: string }> }>('/api/projects').catch(() => null);
    pid = d?.projects[0]?.id;
  }
  // 权限预过滤：财务 Tab 不可见时不排入步骤（避免进度计数跳动与跳页闪烁）
  let canSeeFinance = true;
  if (pid) {
    const detail = await api<{ myPermissions: string[] }>(`/api/projects/${pid}`).catch(() => null);
    if (detail) canSeeFinance = ['project:manage', 'finance:manage', 'finance:add'].some((k) => detail.myPermissions.includes(k));
  }

  const projectSteps: TourStep[] = pid
    ? [
        { element: '[data-tour=project-card]', data: { path: '/projects' }, popover: { title: '活动状态一眼看清', description: '卡片汇总当前阶段、健康状态、开展倒计时与待办进度，点击即可进入该场活动。' } },
        { element: isDesktop ? '[data-tour=tab-nav]' : '[data-tour=mobile-tab-nav]', data: { path: `/p/${pid}` }, popover: isDesktop ? { title: '书脊目录栏', description: '左侧目录按筹备逻辑分为四组板块，底部可一键切入活动当天的「现场模式」。' } : { title: '底部快捷导航', description: '底栏直达看板、待办、财务与物料；现场、账号、工具、成员等其余板块收纳在右侧「更多」中。' } },
        { element: '[data-tour=tab-dashboard]', data: { path: `/p/${pid}?tab=dashboard` }, popover: { title: '看板：全局脉搏', description: '集中展示开展倒计时、阶段轨迹、待我处理与风险预警；支持切换「个人视角」与「活动全貌」。' } },
        { element: '[data-tour=tab-todos]', data: { path: `/p/${pid}?tab=todos` }, popover: { title: '待办：排期与催办', description: '输入事项回车即可快速添加，展开「详细设置」可指定负责人、开启开展倒排并设置自动提醒。' } },
        ...(canSeeFinance
          ? [{ element: '[data-tour=tab-finance]', data: { path: `/p/${pid}?tab=finance` }, popover: { title: '财务：账本与平摊', description: '登记每笔收支与凭证，自动核算按人净额与最简转账方案；支持多票种门票核算与 CSV 导出。' } } satisfies TourStep]
          : []),
        { element: '[data-tour=tab-materials]', data: { path: `/p/${pid}?tab=materials` }, popover: { title: '物料：图稿版本与实物', description: '「文件资料」支持两级分类、1 GB 大文件上传与多版本在线预览；切到「实物清单」可跟踪物资在库与损耗。' } },
        { element: '[data-tour=tab-accounts]', data: { path: `/p/${pid}?tab=accounts` }, popover: { title: '账号：加密凭证库', description: '支持浏览器本地口令加密保管共用账号，或登记合作方联络方式，并按成员与角色精细控制可见范围。' } },
        { element: '[data-tour=tab-work]', data: { path: `/p/${pid}?tab=work` }, popover: { title: '现场：岗位排班与打印', description: '按时段地点创建现场岗位并安排人力（含未注册协作者），确认后可一键排版打印 A4 排班单。' } },
        { element: '[data-tour=tab-members]', data: { path: `/p/${pid}?tab=members` }, popover: { title: '成员：邀请与临时建档', description: '生成链接邀请正式成员入组，也可直接录入临时支援人员档案参与排班。' } },
        { element: '[data-tour=onsite-content]', data: { path: `/p/${pid}/onsite` }, popover: { title: '现场模式：开展当日专用', description: '大字号单手打卡、舞台流程推进、现场异常上报与通讯录一键拨号，场馆弱网断网也能照常记录。' } },
      ]
    : [];

  const steps: TourStep[] = [
    { element: '[data-tour=new-project]', data: { path: '/projects' }, popover: { title: '从这里新建活动', description: '填好活动名称与起止日期即可立项，创建者自动拥有全部主办管理权限。' } },
    ...projectSteps,
    { element: '[data-tour=docs-content]', data: { path: '/help' }, popover: { title: '帮助中心：全流程手册', description: '内置各板块操作详解与全字段搜索，遇到疑问随时查阅。' } },
    ...(isDesktop
      ? [{ element: '[data-tour=theme-controls]', popover: { title: '三套风格与日夜模式', description: '可在「简洁」「明快」「anon tokyo」三套视觉风格及日夜模式间自由切换。' } } satisfies TourStep]
      : []),
    { element: '[data-tour=user-menu]', popover: { title: '账号与偏好中心', description: '个人资料、QQ 与推送通知绑定、API 密钥及重看导览都在这里。导览结束，祝筹备顺利！' } },
  ];

  const d = driver({
    steps,
    showProgress: true,
    progressText: '第 {{current}} 步 / 共 {{total}} 步',
    nextBtnText: '下一步',
    prevBtnText: '上一步',
    doneBtnText: '完成',
    // 后续页面尚未挂载。按当前 DOM 跳过锚点会让现场模式提前显示完成按钮。
    skipMissingElement: false,
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
