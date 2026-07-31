// 生成 PWA 图标：蓝底 #2563eb 白字粗体 A。复用 backend 的 sharp。
// 用法：node scripts/generate-icons.mjs
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';

const require = createRequire(new URL('../../backend/package.json', import.meta.url));
const sharp = require('sharp');

const outDir = fileURLToPath(new URL('../public/icons', import.meta.url));
const BG = '#2563eb';

function iconSvg(size, fontSize) {
  // y 取基线位置使字形视觉居中
  const y = size / 2 + fontSize * 0.36;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${BG}"/>
  <text x="${size / 2}" y="${y}" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-weight="bold" font-size="${fontSize}" fill="#ffffff">A</text>
</svg>`;
}

async function render(name, size, fontSize) {
  await sharp(Buffer.from(iconSvg(size, fontSize)), { density: 384 })
    .resize(size, size)
    .png()
    .toFile(`${outDir}/${name}`);
  console.log(`generated ${name} (${size}x${size})`);
}

await mkdir(outDir, { recursive: true });
await render('icon-192.png', 192, 118);
await render('icon-512.png', 512, 316);
// maskable：字形缩到 ~46%，保证落在 80% 安全区内
await render('icon-maskable-512.png', 512, 236);
