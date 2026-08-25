/**
 * OpenAPI 覆盖率校验：对比 app.ts 实际挂载的全部路由操作与 docs/openapi.yaml 的 paths 声明。
 *
 * 用法：
 *   npx tsx scripts/check-openapi-coverage.ts          # 双向比对，不一致退出码 1
 *   npx tsx scripts/check-openapi-coverage.ts --list   # 仅打印 app 侧完整操作清单（不读 yaml）
 *
 * 注意：下方挂载表逐行照抄 src/app.ts 的 app.use/app.get；新增挂载时同步本表。
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { accountsRouter } from '../src/routes/accounts';
import { activitiesRouter } from '../src/routes/activities';
import { adminRouter } from '../src/routes/admin';
import { announcementsRouter } from '../src/routes/announcements';
import { authRouter } from '../src/routes/auth';
import { cronRouter } from '../src/routes/cron';
import { customToolsRouter } from '../src/routes/customTools';
import { dashboardRouter } from '../src/routes/dashboard';
import { filesRouter, projectFilesRouter } from '../src/routes/files';
import { financeRouter } from '../src/routes/finance';
import { invitesRouter } from '../src/routes/invites';
import { lostFoundRouter, publicLostFoundRouter } from '../src/routes/lostFound';
import { materialsRouter } from '../src/routes/materials';
import { meRouter } from '../src/routes/me';
import { milestonesRouter } from '../src/routes/milestones';
import { onsiteRouter } from '../src/routes/onsite';
import { openRouter } from '../src/routes/open';
import { projectsRouter } from '../src/routes/projects';
import { pushRouter } from '../src/routes/push';
import { physicalRouter } from '../src/routes/physical';
import { risksRouter } from '../src/routes/risks';
import { stagesRouter } from '../src/routes/stages';
import { stageRundownsRouter, publicRundownScreenRouter } from '../src/routes/stageRundowns';
import { stageSignupsRouter } from '../src/routes/stageSignups';
import { todosRouter } from '../src/routes/todos';
import { workModulesRouter } from '../src/routes/workModules';
import { workSheetRouter } from '../src/routes/workSheet';

// 挂载表：逐行照抄 src/app.ts 的 app.use；app.get('/api/health') 单列在 healthOp
const mounts: Array<[string, unknown]> = [
  ['/api/auth', authRouter],
  ['/api/admin', adminRouter],
  ['/api/me', meRouter],
  ['/api/open', openRouter],
  ['/api/push', pushRouter],
  ['/api/projects', projectsRouter],
  ['/api/invites', invitesRouter],
  ['/api/projects/:id/files', projectFilesRouter],
  ['/api/projects/:id/todos', todosRouter],
  ['/api/projects/:id/work-modules', workModulesRouter],
  ['/api/projects/:id/work-sheet', workSheetRouter],
  ['/api/projects/:id/finance', financeRouter],
  ['/api/projects/:id/materials', materialsRouter],
  ['/api/projects/:id/physical', physicalRouter],
  ['/api/projects/:id/accounts', accountsRouter],
  ['/api/projects/:id/dashboard', dashboardRouter],
  ['/api/projects/:id/onsite', onsiteRouter],
  ['/api/projects/:id/risks', risksRouter],
  ['/api/projects/:id/announcements', announcementsRouter],
  ['/api/projects/:id/activities', activitiesRouter],
  ['/api/projects/:id/stages', stagesRouter],
  ['/api/projects/:id/stage-rundowns', stageRundownsRouter],
  ['/api/projects/:id/stage-signups', stageSignupsRouter],
  ['/api/projects/:id/custom-tools', customToolsRouter],
  ['/api/projects/:id/lostfound', lostFoundRouter],
  ['/api/projects/:id/milestones', milestonesRouter],
  ['/api/public/lostfound', publicLostFoundRouter],
  ['/api/public/rundown-screen', publicRundownScreenRouter],
  ['/api/files', filesRouter],
  ['/api/cron', cronRouter],
];
const healthOp = 'GET /api/health'; // app.ts 内联定义，不属于任何 router

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

interface RouteLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
  };
}

function normalizePath(prefix: string, routePath: string): string {
  let full = prefix + routePath;
  if (full.length > 1 && full.endsWith('/')) full = full.slice(0, -1);
  return full.replace(/:([^/]+)/g, '{$1}');
}

function appOperations(): string[] {
  const ops = new Set<string>([healthOp]);
  for (const [prefix, router] of mounts) {
    const stack = (router as { stack?: RouteLayer[] }).stack ?? [];
    for (const layer of stack) {
      if (!layer.route) continue; // .use() 中间件层，无 route
      for (const method of HTTP_METHODS) {
        if (layer.route.methods[method]) {
          ops.add(`${method.toUpperCase()} ${normalizePath(prefix, layer.route.path)}`);
        }
      }
    }
  }
  return [...ops].sort();
}

function specOperations(yamlPath: string): string[] {
  const text = readFileSync(yamlPath, 'utf8');
  const lines = text.split('\n');
  const ops: string[] = [];
  let inPaths = false;
  let currentPath: string | null = null;
  for (const line of lines) {
    if (/^paths:/.test(line)) {
      inPaths = true;
      continue;
    }
    if (inPaths && /^\S/.test(line)) break; // 下一个顶级键，paths 块结束
    if (!inPaths) continue;
    const pathMatch = line.match(/^ {2}(\/\S*):$/);
    if (pathMatch) {
      currentPath = pathMatch[1];
      continue;
    }
    const methodMatch = line.match(/^ {4}(get|post|put|patch|delete):$/);
    if (methodMatch && currentPath) {
      ops.push(`${methodMatch[1].toUpperCase()} ${currentPath}`);
    }
  }
  return ops;
}

const appOps = appOperations();

if (process.argv.includes('--list')) {
  for (const op of appOps) console.log(op);
  console.log(`total: ${appOps.length} operations`);
  process.exit(0);
}

const here = dirname(fileURLToPath(import.meta.url));
const yamlPath = resolve(here, '../../docs/openapi.yaml');
const specOps = specOperations(yamlPath);
const specSet = new Set(specOps);
const appSet = new Set(appOps);

const missing = appOps.filter((op) => !specSet.has(op));
const extra = specOps.filter((op) => !appSet.has(op));

if (missing.length || extra.length) {
  if (missing.length) {
    console.error(`missing in spec (${missing.length}):`);
    for (const op of missing) console.error(`  ${op}`);
  }
  if (extra.length) {
    console.error(`extra in spec (${extra.length}):`);
    for (const op of extra) console.error(`  ${op}`);
  }
  process.exit(1);
}

console.log(`coverage OK (${appOps.length} operations)`);
