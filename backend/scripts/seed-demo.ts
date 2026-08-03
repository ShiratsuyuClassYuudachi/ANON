/**
 * ANON 演示数据种子脚本
 * 用法：在 backend 目录下 npx tsx scripts/seed-demo.ts
 * 或 docker exec 内 node scripts/seed-demo.js
 *
 * 创建（逻辑见 src/services/demoSeed.ts，与试用模式共用）：
 * - 1 个超级管理员 (demo@anon.local / demo12345)
 * - 4 个普通成员（美工/宣发/后勤/一般staff）
 * - 1 个演示项目「2026 秋季同人展」含完整阶段
 * - 各模块演示数据
 */
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { InviteCode } from '../src/models/InviteCode';
import { User } from '../src/models/User';
import { Project } from '../src/models/Project';
import { deleteDemoData, seedDemoData } from '../src/services/demoSeed';

const MONGO_URI = process.env.MONGO_URI ?? 'mongodb://localhost:27017/anon';
const PASSWORD = 'demo12345';

const DEMO_EMAILS = [
  'demo@anon.local',
  'art@demo.anon.local',
  'pr@demo.anon.local',
  'logistics@demo.anon.local',
  'staff@demo.anon.local',
];

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected to', MONGO_URI);

  // --- Cleanup previous demo data ---
  if (await User.findOne({ email: 'demo@anon.local' })) {
    console.log('Demo data already exists, cleaning up...');
    const demoUserIds = (await User.find({ email: { $in: DEMO_EMAILS } }).lean()).map((u) => u._id);
    const demoProjectIds = (await Project.find({ name: '2026 秋季同人展' }).lean()).map((p) => p._id);
    for (const projectId of demoProjectIds) {
      await deleteDemoData({ userIds: demoUserIds, projectId });
    }
    await InviteCode.deleteMany({ code: 'DEMO-2026' });
    console.log('Cleanup done.');
  }

  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  await seedDemoData({
    adminEmail: 'demo@anon.local',
    passwordHash,
    adminIsSuperAdmin: true,
    inviteCode: 'DEMO-2026',
  });
  console.log('✓ Demo data seeded: 5 users, project「2026 秋季同人展」, all modules');

  console.log('\n========================================');
  console.log('  演示数据种子完成！');
  console.log('========================================');
  console.log('  管理员: demo@anon.local / demo12345');
  console.log('  美工:   art@demo.anon.local / demo12345');
  console.log('  宣发:   pr@demo.anon.local / demo12345');
  console.log('  后勤:   logistics@demo.anon.local / demo12345');
  console.log('  staff:  staff@demo.anon.local / demo12345');
  console.log('  邀请码: DEMO-2026');
  console.log('  项目:   2026 秋季同人展');
  console.log('========================================\n');

  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
