// 用法：PLAYWRIGHT_BROWSERS_PATH=<浏览器目录> node frontend/scripts/capture-help-screenshots.mjs
// 前置：服务运行中（BASE 默认 http://localhost:5173，API 默认 http://localhost:4000），账号与目标项目已就绪
// 输出：frontend/public/help/ 下核心模块界面截图，供 README 与 /help 帮助中心引用
import { mkdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../../.walkthrough/package.json', import.meta.url));
const { chromium } = require('playwright');

const BASE = process.env.BASE ?? 'http://localhost:5173';
const API = process.env.API ?? BASE;
const EMAIL = process.env.WALKER_EMAIL ?? 'walker-admin@wt.local';
const PASSWORD = process.env.WALKER_PASSWORD ?? 'password123';
const PROJECT_NAME = process.env.PROJECT_NAME ?? '现场走查活动';
const OUT_DIR = fileURLToPath(new URL('../public/help/', import.meta.url));
mkdirSync(OUT_DIR, { recursive: true });

const loginRes = await fetch(`${API}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
if (!loginRes.ok) throw new Error(`登录接口失败：HTTP ${loginRes.status}`);
const { token } = await loginRes.json();

await fetch(`${API}/api/me/onboarded`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: '{}',
});

const projectsRes = await fetch(`${API}/api/projects`, {
  headers: { Authorization: `Bearer ${token}` },
});
if (!projectsRes.ok) throw new Error(`项目列表接口失败：HTTP ${projectsRes.status}`);
const { projects } = await projectsRes.json();
const project = projects.find((p) => p.name === PROJECT_NAME) ?? projects[0];
if (!project) throw new Error(`找不到可用项目`);
const pid = project.id;

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
});
const page = await browser.newPage({
  viewport: { width: 1280, height: 840 },
  deviceScaleFactor: 1.5,
});

await page.addInitScript(() => {
  localStorage.setItem('anon-push-dismissed', '1');
  localStorage.setItem('anon-theme', 'light');
  localStorage.setItem('anon-style', 'minimal');
});

async function shot(name, opts = {}) {
  await page.waitForTimeout(600);
  const path = join(OUT_DIR, name);
  await page.screenshot({ path, ...opts });
  console.log(`✓ ${name} (${(statSync(path).size / 1024).toFixed(1)} KB)`);
}

await page.goto(`${BASE}/login`);
await page.fill('input#email', EMAIL);
await page.fill('input#password', PASSWORD);
await page.click('button[type=submit]');
await page.waitForURL('**/projects');

await shot('projects.png');

const tabs = [
  ['dashboard', 'tab-dashboard.png'],
  ['todos', 'tab-todos.png'],
  ['finance', 'tab-finance.png'],
  ['materials', 'tab-materials.png'],
  ['accounts', 'tab-accounts.png'],
  ['work', 'tab-work.png'],
  ['tools', 'tab-tools.png'],
  ['members', 'tab-members.png'],
];

for (const [tab, file] of tabs) {
  await page.goto(`${BASE}/p/${pid}?tab=${tab}`);
  await shot(file);
}

await page.goto(`${BASE}/p/${pid}/work-sheet/print?user=me`);
await shot('work-sheet.png');

await browser.close();
console.log(`完成：核心截图已输出到 ${OUT_DIR}`);
