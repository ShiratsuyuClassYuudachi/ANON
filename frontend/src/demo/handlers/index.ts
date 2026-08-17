import { accountRoutes } from './accounts';
import { authRoutes } from './auth';
import { customToolRoutes } from './customTools';
import { dashboardRoutes } from './dashboard';
import { financeRoutes } from './finance';
import { lostFoundRoutes } from './lostFound';
import { materialRoutes } from './materials';
import { openRoutes } from './open';
import { physicalRoutes } from './physical';
import { projectRoutes } from './projects';
import { stageRundownRoutes } from './stageRundowns';
import { stageSignupRoutes } from './stageSignups';
import { todoRoutes } from './todos';
import { workRoutes } from './work';
import type { Route } from '../router';

/** 合并顺序即匹配顺序；各文件内部已保证「字面量路由先于参数路由」 */
export const routes: Route[] = [
  ...authRoutes,
  ...projectRoutes,
  ...dashboardRoutes,
  ...todoRoutes,
  ...financeRoutes,
  ...materialRoutes,
  ...physicalRoutes,
  ...accountRoutes,
  ...workRoutes,
  ...stageRundownRoutes,
  ...stageSignupRoutes,
  ...customToolRoutes,
  ...openRoutes,
  ...lostFoundRoutes,
];
