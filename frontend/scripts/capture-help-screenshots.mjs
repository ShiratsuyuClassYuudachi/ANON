// 用法：PLAYWRIGHT_BROWSERS_PATH=<浏览器目录> node frontend/scripts/capture-help-screenshots.mjs
// 前置：dev 服务器运行中（localhost:5173）、走查账号与「现场走查活动」项目存在
// 输出：frontend/public/help/ 下 8 张截图（projects / tab-todos / tab-finance / tab-materials /
//       tab-accounts / tab-work / work-sheet / tab-members），供 /help 文档中心引用
import { mkdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// playwright 安装在仓库 .walkthrough 目录下，从其 package.json 解析
const require = createRequire(new URL('../../.walkthrough/package.json', import.meta.url));
const { chromium } = require('playwright');

const BASE = process.env.BASE ?? 'http://localhost:5173';
const API = process.env.API ?? 'http://localhost:4000';
const EMAIL = process.env.WALKER_EMAIL ?? 'walker-admin@wt.local';
const PASSWORD = process.env.WALKER_PASSWORD ?? 'password123';
const PROJECT_NAME = '现场走查活动';
const OUT_DIR = fileURLToPath(new URL('../public/help/', import.meta.url));
mkdirSync(OUT_DIR, { recursive: true });

// 登录接口换 token，查「现场走查活动」项目 id
const loginRes = await fetch(`${API}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
if (!loginRes.ok) throw new Error(`登录接口失败：HTTP ${loginRes.status}`);
const { token } = await loginRes.json();
// 标记已完成新手引导，避免 OnboardingDialog 遮挡截图
await fetch(`${API}/api/me/onboarded`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: '{}',
});
const projectsRes = await fetch(`${API}/api/projects`, { headers: { Authorization: `Bearer ${token}` } });
if (!projectsRes.ok) throw new Error(`项目列表接口失败：HTTP ${projectsRes.status}`);
const { projects } = await projectsRes.json();
const project = projects.find((p) => p.name === PROJECT_NAME);
if (!project) throw new Error(`找不到项目「${PROJECT_NAME}」`);
const pid = project.id;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

async function shot(name) {
  await page.waitForTimeout(800); // 等页面稳定
  const path = join(OUT_DIR, name);
  await page.screenshot({ path });
  console.log(`✓ ${name} (${(statSync(path).size / 1024).toFixed(1)} KB)`);
}

async function clickTab(label) {
  await page.click(`button[role=tab]:has-text("${label}")`);
}

// UI 登录
await page.goto(`${BASE}/login`);
await page.fill('input#email', EMAIL);
await page.fill('input#password', PASSWORD);
await page.click('button[type=submit]');
await page.waitForURL('**/projects');

// 1. 项目列表
await shot('projects.png');

// 2-6. 项目内各 Tab（默认落在待办）
await page.goto(`${BASE}/p/${pid}`);
await page.waitForSelector('button[role=tab]');
await shot('tab-todos.png');
await clickTab('财务');
await shot('tab-finance.png');
await clickTab('物料');
await shot('tab-materials.png');
await clickTab('账号');
await shot('tab-accounts.png');
await clickTab('现场');
await shot('tab-work.png');

// 7. 任务单打印版式
await page.goto(`${BASE}/p/${pid}/work-sheet/print?user=me`);
await shot('work-sheet.png');

// 8. 成员 Tab
await page.goto(`${BASE}/p/${pid}`);
await page.waitForSelector('button[role=tab]');
await clickTab('成员');
await shot('tab-members.png');

await browser.close();
console.log(`完成：8 张截图已输出到 ${OUT_DIR}`);
