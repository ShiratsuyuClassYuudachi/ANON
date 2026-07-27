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
      { element: '[data-tour=user-menu]', popover: { title: '你的账号中心', description: '个人资料、帮助文档、重看引导都在这里——每个功能都有图文手册和真实截图。' } },
    ],
  });
  d.drive();
}
