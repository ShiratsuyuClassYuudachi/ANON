/**
 * 共享演示数据服务：CLI 种子脚本（scripts/seed-demo.ts）与试用模式（services/trial.ts）共用。
 * 创建逻辑移植自原 scripts/seed-demo.ts（全部演示文案/日期/数值保持一致），并修复与现行
 * schema 的漂移：角色权限对齐 permissions.ts、resourceversions 走 File/存储、invitecodes
 * 不写 used 字段、riskinstances 对齐 risk.ts 探测器、activities 类型串对齐 logActivity 约定。
 */
import mongoose, { Types, type Model } from 'mongoose';
import { Activity } from '../models/Activity';
import { Announcement } from '../models/Announcement';
import { AnnouncementConfirmation } from '../models/AnnouncementConfirmation';
import { DashboardPreference } from '../models/DashboardPreference';
import { File } from '../models/File';
import { Incident } from '../models/Incident';
import { Membership } from '../models/Membership';
import { Milestone } from '../models/Milestone';
import { PhysicalCategory } from '../models/PhysicalCategory';
import { PhysicalItem } from '../models/PhysicalItem';
import { PhysicalItemLog } from '../models/PhysicalItemLog';
import { PlatformAccount } from '../models/PlatformAccount';
import { Project } from '../models/Project';
import { ProjectInvite } from '../models/ProjectInvite';
import { PushSubscription } from '../models/PushSubscription';
import { ReminderLog } from '../models/ReminderLog';
import { Resource } from '../models/Resource';
import { ResourceType } from '../models/ResourceType';
import { ResourceVersion } from '../models/ResourceVersion';
import { RiskInstance } from '../models/RiskInstance';
import { StageRundown } from '../models/StageRundown';
import { StageSignup } from '../models/StageSignup';
import { Todo } from '../models/Todo';
import { Transaction } from '../models/Transaction';
import { User } from '../models/User';
import { WeeklyReportLog } from '../models/WeeklyReportLog';
import { WorkModule } from '../models/WorkModule';
import { ALL_PERMISSIONS, PRESET_ROLES } from './permissions';
import { deleteStored, storeBuffer } from './storage';

export interface DemoSeedOptions {
  adminEmail: string; // CLI 演示: 'demo@anon.local'；试用: 'trial-<tag12>@trial.anon.local'
  passwordHash: string; // 5 个用户共用同一 bcrypt hash
  adminIsSuperAdmin: boolean; // CLI 演示: true；试用: false
  emailTag?: string; // 试用时传 12 位 hex，成员邮箱变为 art-<tag>@demo.anon.local 等；缺省为标准演示邮箱
  inviteCode?: string; // CLI 演示传 'DEMO-2026'；试用不传（不创建邀请码）
  adminName?: string; // 缺省 '演示管理员'
}

export interface DemoSeedResult {
  adminUserId: Types.ObjectId;
  memberUserIds: Types.ObjectId[]; // 4 个虚拟成员
  userIds: Types.ObjectId[]; // admin + members
  projectId: Types.ObjectId;
}

/** 内置 1×1 PNG，用作演示资源版本的实际文件内容 */
const DEMO_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

export async function seedDemoData(opts: DemoSeedOptions): Promise<DemoSeedResult> {
  const db = mongoose.connection.db!;
  const now = new Date();
  const oid = () => new Types.ObjectId();
  const tag = opts.emailTag;
  const memberEmail = (local: string) =>
    tag ? `${local}-${tag}@demo.anon.local` : `${local}@demo.anon.local`;

  // --- Users ---
  const adminId = oid();
  const artId = oid();
  const prId = oid();
  const logId = oid();
  const staffId = oid();

  const users = [
    { _id: adminId, email: opts.adminEmail, name: opts.adminName ?? '演示管理员', passwordHash: opts.passwordHash, isSuperAdmin: opts.adminIsSuperAdmin, contacts: [{ platform: 'QQ', value: '123456789' }, { platform: '微信', value: 'demo_admin_wx' }], onboardedAt: now, createdAt: now, updatedAt: now },
    { _id: artId, email: memberEmail('art'), name: '小美（美工）', passwordHash: opts.passwordHash, isSuperAdmin: false, contacts: [{ platform: 'QQ', value: '987654321' }], onboardedAt: now, createdAt: now, updatedAt: now },
    { _id: prId, email: memberEmail('pr'), name: '阿宣（宣发）', passwordHash: opts.passwordHash, isSuperAdmin: false, contacts: [{ platform: '微博', value: '@axuan_pr' }], onboardedAt: now, createdAt: now, updatedAt: now },
    { _id: logId, email: memberEmail('logistics'), name: '大后（后勤）', passwordHash: opts.passwordHash, isSuperAdmin: false, contacts: [{ platform: '电话', value: '13800138000' }], onboardedAt: now, createdAt: now, updatedAt: now },
    { _id: staffId, email: memberEmail('staff'), name: '小一（staff）', passwordHash: opts.passwordHash, isSuperAdmin: false, contacts: [], onboardedAt: now, createdAt: now, updatedAt: now },
  ];
  await db.collection('users').insertMany(users);

  // --- Project ---
  const projectId = oid();
  const startDate = new Date('2026-10-17T09:00:00+08:00');
  const endDate = new Date('2026-10-18T18:00:00+08:00');

  const preset = (name: string) => PRESET_ROLES.find((r) => r.name === name)!.permissions;
  const STAGE_NAMES = ['立项', '策划', '宣发与招募', '制作与采购', '行前准备', '现场执行', '财务结算', '复盘归档'];

  const stages = STAGE_NAMES.map((name, i) => ({
    _id: oid(),
    name,
    order: i,
    completedAt: i < 3 ? new Date(now.getTime() - (30 - i * 7) * 86400000) : undefined,
    note: i === 0 ? '项目已立项，场地已初步确认' : i === 2 ? '宣发渠道已确定' : undefined,
  }));

  await db.collection('projects').insertOne({
    _id: projectId,
    name: '2026 秋季同人展',
    description: '秋季大型同人志即卖会，预计 200 摊位、3000 人次客流。',
    status: 'preparing',
    startDate,
    endDate,
    location: '上海国际会展中心 B2 馆',
    timezone: 'Asia/Shanghai',
    currentStage: '制作与采购',
    stages,
    createdBy: adminId,
    roles: [
      { name: '主办', permissions: [...ALL_PERMISSIONS] },
      { name: '美工', permissions: preset('美工') },
      { name: '宣发', permissions: preset('宣发') },
      { name: '一般staff', permissions: preset('一般staff') },
    ],
    ticketPriceCents: 6800,
    ticketCount: 500,
    ticketTypes: [
      { name: '预售票', priceCents: 5800, count: 300 },
      { name: '现场票', priceCents: 6800, count: 200 },
    ],
    createdAt: now,
    updatedAt: now,
  });

  // --- Memberships ---
  await db.collection('memberships').insertMany([
    { _id: oid(), projectId, userId: adminId, roleName: '主办', createdAt: now, updatedAt: now },
    { _id: oid(), projectId, userId: artId, roleName: '美工', createdAt: now, updatedAt: now },
    { _id: oid(), projectId, userId: prId, roleName: '宣发', createdAt: now, updatedAt: now },
    { _id: oid(), projectId, userId: logId, roleName: '一般staff', createdAt: now, updatedAt: now },
    { _id: oid(), projectId, userId: staffId, roleName: '一般staff', createdAt: now, updatedAt: now },
  ]);

  // --- Todos ---
  const todoBase = { projectId, createdBy: adminId, createdAt: now, updatedAt: now };
  const todos = [
    { _id: oid(), ...todoBase, title: '确认场地合同并支付定金', category: '后勤', status: 'done', assigneeIds: [logId], nodeAt: new Date('2026-08-01'), dueAt: new Date('2026-08-05'), remindAt: new Date('2026-07-30'), note: '与场地方确认 B2 馆档期', completedAt: new Date('2026-08-03'), completedBy: logId, completionNote: '已签合同，定金 2 万已付', attachments: [] },
    { _id: oid(), ...todoBase, title: '主视觉海报设计（初稿）', category: '美工', status: 'done', assigneeIds: [artId], nodeAt: new Date('2026-08-10'), dueAt: new Date('2026-08-15'), remindAt: new Date('2026-08-08'), note: '包含主 KV + 横幅 + 社交媒体尺寸', completedAt: new Date('2026-08-14'), completedBy: artId, completionNote: '初稿已交付，见附件', attachments: [] },
    { _id: oid(), ...todoBase, title: '宣发渠道排期表', category: '宣发', status: 'done', assigneeIds: [prId], nodeAt: new Date('2026-08-20'), dueAt: new Date('2026-08-25'), remindAt: null, note: '微博/B站/小红书/LOFTER 发布节奏', completedAt: new Date('2026-08-22'), completedBy: prId, completionNote: '', attachments: [] },
    { _id: oid(), ...todoBase, title: '摊位图设计', category: '美工', status: 'open', assigneeIds: [artId], nodeAt: new Date('2026-09-15'), dueAt: new Date('2026-09-20'), remindAt: new Date('2026-09-13'), note: '根据 200 摊位规划动线', completedAt: null, completedBy: null, completionNote: null, attachments: [] },
    { _id: oid(), ...todoBase, title: '志愿者招募（30人）', category: '后勤', status: 'open', assigneeIds: [logId, staffId], nodeAt: new Date('2026-09-10'), dueAt: new Date('2026-09-30'), remindAt: new Date('2026-09-08'), note: '通过高校社团渠道招募', completedAt: null, completedBy: null, completionNote: null, attachments: [] },
    { _id: oid(), ...todoBase, title: '印刷物料下单（场刊+指引牌）', category: '后勤', status: 'open', assigneeIds: [logId], nodeAt: new Date('2026-10-01'), dueAt: new Date('2026-10-05'), remindAt: new Date('2026-09-28'), note: '场刊 500 本、指引牌 20 块', completedAt: null, completedBy: null, completionNote: null, attachments: [] },
    { _id: oid(), ...todoBase, title: '社交媒体预热第一波', category: '宣发', status: 'open', assigneeIds: [prId], nodeAt: new Date('2026-09-01'), dueAt: new Date('2026-09-05'), remindAt: null, note: '发布主视觉 + 时间地点', completedAt: null, completedBy: null, completionNote: null, attachments: [] },
    { _id: oid(), ...todoBase, title: '票务系统对接', category: '后勤', status: 'open', assigneeIds: [staffId], nodeAt: new Date('2026-09-20'), dueAt: new Date('2026-09-25'), remindAt: new Date('2026-09-18'), note: '对接猫眼/大麦预售通道', completedAt: null, completedBy: null, completionNote: null, attachments: [] },
    // 逾期待办（演示风险检测）
    { _id: oid(), ...todoBase, title: '赞助商确认（已逾期）', category: '宣发', status: 'open', assigneeIds: [prId], nodeAt: new Date('2026-07-20'), dueAt: new Date('2026-07-25'), remindAt: new Date('2026-07-18'), note: '3 家赞助商待最终确认', completedAt: null, completedBy: null, completionNote: null, attachments: [] },
    // 无指派人的待办（演示风险）
    { _id: oid(), ...todoBase, title: '安保方案制定', category: '后勤', status: 'open', assigneeIds: [], nodeAt: new Date('2026-10-01'), dueAt: new Date('2026-10-10'), remindAt: null, note: '需对接物业安保', completedAt: null, completedBy: null, completionNote: null, attachments: [] },
  ];
  await db.collection('todos').insertMany(todos);

  // --- Finance ---
  const txBase = { projectId, createdAt: now, updatedAt: now };
  const transactions = [
    { _id: oid(), ...txBase, type: 'expense', amountCents: 2000000, note: '场地定金', payerUserId: adminId, splitAmong: [], createdBy: adminId, attachments: [] },
    { _id: oid(), ...txBase, type: 'expense', amountCents: 350000, note: '主视觉设计外包尾款', payerUserId: artId, splitAmong: [], createdBy: artId, attachments: [] },
    { _id: oid(), ...txBase, type: 'expense', amountCents: 120000, note: '宣传物料打印', payerUserId: prId, splitAmong: [prId, artId], createdBy: prId, attachments: [] },
    { _id: oid(), ...txBase, type: 'expense', amountCents: 85000, note: '志愿者餐饮预付', payerUserId: logId, splitAmong: [], createdBy: logId, attachments: [] },
    { _id: oid(), ...txBase, type: 'income', amountCents: 500000, note: '赞助商 A 赞助款', payerUserId: adminId, splitAmong: [], createdBy: adminId, attachments: [] },
    { _id: oid(), ...txBase, type: 'income', amountCents: 300000, note: '赞助商 B 赞助款', payerUserId: adminId, splitAmong: [], createdBy: adminId, attachments: [] },
    { _id: oid(), ...txBase, type: 'expense', amountCents: 45000, note: '快递费（物料寄送）', payerUserId: staffId, splitAmong: [staffId, logId], createdBy: staffId, attachments: [] },
  ];
  await db.collection('transactions').insertMany(transactions);

  // --- Resource Types & Resources ---
  const rtPoster = oid();
  const rtDoc = oid();
  const rtVenue = oid();
  await db.collection('resourcetypes').insertMany([
    { _id: rtPoster, projectId, name: '海报与宣传图', visibility: { userIds: [], roleNames: [] }, createdAt: now, updatedAt: now },
    { _id: rtDoc, projectId, name: '策划文档', visibility: { userIds: [], roleNames: [] }, createdAt: now, updatedAt: now },
    { _id: rtVenue, projectId, name: '场地资料', visibility: { userIds: [adminId, logId], roleNames: [] }, createdAt: now, updatedAt: now },
  ]);

  const resPoster = oid();
  const resGuide = oid();
  const resContract = oid();
  await db.collection('resources').insertMany([
    { _id: resPoster, projectId, typeId: rtPoster, name: '主视觉海报', description: '2026 秋季同人展主 KV', visibility: { userIds: [], roleNames: [] }, createdAt: now, updatedAt: now },
    { _id: resGuide, projectId, typeId: rtDoc, name: '参展指南', description: '摊主须知与规则', visibility: { userIds: [], roleNames: [] }, createdAt: now, updatedAt: now },
    { _id: resContract, projectId, typeId: rtVenue, name: '场地合同扫描件', description: 'B2 馆租赁合同', visibility: { userIds: [adminId, logId], roleNames: [] }, createdAt: now, updatedAt: now },
  ]);

  // 现行 schema：ResourceVersion 需要 resourceId + fileId（ref File），文件先入存储再建档
  const createVersion = async (
    resourceId: Types.ObjectId,
    version: number,
    filename: string,
    note: string,
    createdBy: Types.ObjectId,
    createdAt: Date,
  ) => {
    const ref = await storeBuffer(DEMO_PNG, `demo/${projectId}/${filename}`, 'image/png');
    const file = await File.create({
      projectId,
      filename,
      path: ref,
      mime: 'image/png',
      size: DEMO_PNG.length,
      uploadedBy: createdBy,
      createdAt,
      updatedAt: createdAt,
    });
    await ResourceVersion.create({
      resourceId,
      version,
      fileId: file._id,
      previewPath: null,
      note,
      createdBy,
      createdAt,
      updatedAt: createdAt,
    });
  };
  await createVersion(resPoster, 1, 'poster-v1.png', '初稿', artId, new Date(now.getTime() - 20 * 86400000));
  await createVersion(resPoster, 2, 'poster-v2.png', '修改配色后终版', artId, new Date(now.getTime() - 5 * 86400000));
  await createVersion(resGuide, 1, 'guide-v1.png', 'v1', adminId, now);
  await createVersion(resContract, 1, 'contract-v1.png', '扫描件', logId, now);

  // --- Platform Accounts ---
  await db.collection('platformaccounts').insertMany([
    { _id: oid(), projectId, platform: 'B站', account: 'anon_expo_2026', mode: 'full', passwordCipher: 'ANONv1:c2FsdA==:aXY=:ZGF0YQ==', cipherKeySource: 'user', note: '官方宣传号', addedBy: prId, visibility: { userIds: [], roleNames: [] }, createdAt: now, updatedAt: now },
    { _id: oid(), projectId, platform: '微博', account: '@秋季同人展官方', mode: 'otp', passwordCipher: null, cipherKeySource: null, note: '需要短信验证码时联系阿宣', addedBy: prId, visibility: { userIds: [], roleNames: [] }, createdAt: now, updatedAt: now },
    { _id: oid(), projectId, platform: 'QQ', account: '287654321', mode: 'contact', passwordCipher: null, cipherKeySource: null, note: '场地方对接人 王经理', addedBy: logId, visibility: { userIds: [], roleNames: [] }, createdAt: now, updatedAt: now },
    { _id: oid(), projectId, platform: '小红书', account: '秋季同人展', mode: 'full', passwordCipher: null, cipherKeySource: 'server', note: '种草号', addedBy: prId, visibility: { userIds: [prId, adminId], roleNames: [] }, createdAt: now, updatedAt: now },
  ]);

  // --- Work Modules ---
  const wm1 = oid(), wm2 = oid(), wm3 = oid(), wm4 = oid();
  await db.collection('workmodules').insertMany([
    { _id: wm1, projectId, name: '入口检票', description: '核验电子票/纸质票，发放手环', location: 'B2 馆正门', startAt: new Date('2026-10-17T08:00:00+08:00'), endAt: new Date('2026-10-17T10:00:00+08:00'), requiredCount: 4, assignees: [
      { userId: staffId, confirmedAt: new Date('2026-09-20'), confirmedBy: staffId },
      { userId: logId, confirmedAt: null, confirmedBy: null },
    ], createdBy: adminId, createdAt: now, updatedAt: now },
    { _id: wm2, projectId, name: '摊位巡场', description: '定时巡查摊位秩序与安全', location: '全馆', startAt: new Date('2026-10-17T10:00:00+08:00'), endAt: new Date('2026-10-17T17:00:00+08:00'), requiredCount: 3, assignees: [
      { userId: logId, confirmedAt: new Date('2026-09-21'), confirmedBy: logId },
    ], createdBy: adminId, createdAt: now, updatedAt: now },
    { _id: wm3, projectId, name: '舞台区管理', description: '嘉宾签到、设备调试、流程把控', location: '主舞台', startAt: new Date('2026-10-17T13:00:00+08:00'), endAt: new Date('2026-10-17T16:00:00+08:00'), requiredCount: 2, assignees: [
      { userId: prId, confirmedAt: new Date('2026-09-22'), confirmedBy: prId },
      { userId: staffId, confirmedAt: new Date('2026-09-22'), confirmedBy: adminId },
    ], createdBy: adminId, createdAt: now, updatedAt: now },
    { _id: wm4, projectId, name: '撤场与清洁', description: '引导摊主撤场、垃圾清运', location: '全馆', startAt: new Date('2026-10-18T17:00:00+08:00'), endAt: new Date('2026-10-18T20:00:00+08:00'), requiredCount: 6, assignees: [], createdBy: adminId, createdAt: now, updatedAt: now },
  ]);

  // --- Milestones ---
  await db.collection('milestones').insertMany([
    { _id: oid(), projectId, title: '场地合同签署', date: new Date('2026-08-05'), stageId: stages[0]._id, completedAt: new Date('2026-08-03'), createdBy: adminId, createdAt: now, updatedAt: now },
    { _id: oid(), projectId, title: '主视觉定稿', date: new Date('2026-08-20'), stageId: stages[1]._id, completedAt: new Date('2026-08-14'), createdBy: adminId, createdAt: now, updatedAt: now },
    { _id: oid(), projectId, title: '预售开启', date: new Date('2026-09-15'), stageId: stages[2]._id, completedAt: null, createdBy: adminId, createdAt: now, updatedAt: now },
    { _id: oid(), projectId, title: '物料交付截止', date: new Date('2026-10-10'), stageId: stages[3]._id, completedAt: null, createdBy: adminId, createdAt: now, updatedAt: now },
    { _id: oid(), projectId, title: '志愿者培训', date: new Date('2026-10-14'), stageId: stages[4]._id, completedAt: null, createdBy: adminId, createdAt: now, updatedAt: now },
  ]);

  // --- Announcements ---
  const ann1 = oid(), ann2 = oid(), ann3 = oid();
  await db.collection('announcements').insertMany([
    { _id: ann1, projectId, title: '欢迎加入筹备组！', content: '各位好，秋季同人展筹备正式启动，请大家熟悉各自分工。', type: 'normal', isPinned: false, requireConfirmation: false, visibility: { userIds: [], roleNames: [] }, attachmentIds: [], publishedBy: adminId, publishedAt: new Date(now.getTime() - 30 * 86400000), expiresAt: null, createdAt: new Date(now.getTime() - 30 * 86400000), updatedAt: now },
    { _id: ann2, projectId, title: '【重要】预售票定价调整', content: '经讨论决定，预售票从 68 元调整为 58 元，现场票维持 68 元。请宣发组更新所有宣传物料。', type: 'important', isPinned: true, requireConfirmation: true, visibility: { userIds: [], roleNames: [] }, attachmentIds: [], publishedBy: adminId, publishedAt: new Date(now.getTime() - 3 * 86400000), expiresAt: null, createdAt: new Date(now.getTime() - 3 * 86400000), updatedAt: now },
    { _id: ann3, projectId, title: '【紧急】场地消防检查通知', content: '物业通知：10月15日上午消防检查，所有搭建材料须提供防火证明。请后勤组立即对接供应商。', type: 'emergency', isPinned: true, requireConfirmation: true, visibility: { userIds: [], roleNames: [] }, attachmentIds: [], publishedBy: adminId, publishedAt: new Date(now.getTime() - 1 * 86400000), expiresAt: null, createdAt: new Date(now.getTime() - 1 * 86400000), updatedAt: now },
  ]);
  // Confirmations for ann2
  await db.collection('announcementconfirmations').insertMany([
    { _id: oid(), projectId, announcementId: ann2, userId: artId, confirmedAt: new Date(now.getTime() - 2 * 86400000) },
    { _id: oid(), projectId, announcementId: ann2, userId: prId, confirmedAt: new Date(now.getTime() - 2 * 86400000) },
  ]);

  // --- Activities（类型串对齐 routes 中 logActivity 的现行约定） ---
  const actTypes: { type: string; message: string; sourceType: string; actorId: Types.ObjectId; permissionGate: string | null }[] = [
    { type: 'todo:create', message: '创建了待办「确认场地合同并支付定金」', sourceType: 'todo', actorId: adminId, permissionGate: null },
    { type: 'todo:complete', message: '完成了待办「主视觉海报设计（初稿）」', sourceType: 'todo', actorId: artId, permissionGate: null },
    { type: 'finance:create', message: '添加了支出「场地定金」¥20,000.00', sourceType: 'finance', actorId: adminId, permissionGate: 'finance:manage' },
    { type: 'finance:create', message: '添加了收入「赞助商 A 赞助款」¥5,000.00', sourceType: 'finance', actorId: adminId, permissionGate: 'finance:manage' },
    { type: 'material:create', message: '创建了资源「主视觉海报」', sourceType: 'material', actorId: artId, permissionGate: null },
    { type: 'material:upload_version', message: '上传了「主视觉海报」v2', sourceType: 'material', actorId: artId, permissionGate: null },
    { type: 'work:create', message: '创建了现场任务「入口检票」', sourceType: 'work', actorId: adminId, permissionGate: null },
    { type: 'work:confirm', message: '确认了现场任务「舞台区管理」的分配', sourceType: 'work', actorId: prId, permissionGate: null },
    { type: 'announcement:publish', message: '发布了公告「【重要】预售票定价调整」', sourceType: 'announcement', actorId: adminId, permissionGate: null },
    { type: 'stage:update', message: '标记阶段「宣发与招募」为已完成', sourceType: 'stage', actorId: adminId, permissionGate: null },
  ];
  await db.collection('activities').insertMany(actTypes.map((a, i) => ({
    _id: oid(),
    projectId,
    actorId: a.actorId,
    type: a.type,
    message: a.message,
    sourceType: a.sourceType,
    sourceId: null,
    permissionGate: a.permissionGate,
    createdAt: new Date(now.getTime() - (actTypes.length - i) * 3600000),
  })));

  // --- Incidents (onsite) ---
  await db.collection('incidents').insertMany([
    { _id: oid(), projectId, category: 'equipment', note: '主舞台音响设备有杂音，需调试', moduleId: wm3, reporterId: prId, status: 'open', resolvedAt: null, resolvedBy: null, createdAt: new Date(now.getTime() - 2 * 3600000), updatedAt: now },
    { _id: oid(), projectId, category: 'material', note: '入口指引牌少了 3 块', moduleId: wm1, reporterId: staffId, status: 'resolved', resolvedAt: new Date(now.getTime() - 1 * 3600000), resolvedBy: adminId, createdAt: new Date(now.getTime() - 4 * 3600000), updatedAt: now },
  ]);

  // --- Risk Instances（ruleCode/fingerprint 对齐 services/risk.ts 探测器现行格式） ---
  await db.collection('riskinstances').insertMany([
    { _id: oid(), projectId, ruleCode: 'todo:overdue', level: 'warning', fingerprint: `todo:${todos[8]._id}:overdue`, title: '待办已逾期', description: '「赞助商确认（已逾期）」已超过截止时间', status: 'active', sourceType: 'todo', sourceId: todos[8]._id, firstDetectedAt: new Date(now.getTime() - 5 * 86400000), lastDetectedAt: now, createdAt: now, updatedAt: now },
    { _id: oid(), projectId, ruleCode: 'todo:no_assignee', level: 'info', fingerprint: `todo:${todos[9]._id}:no_assignee`, title: '待办无负责人', description: '「安保方案制定」尚未指派负责人', status: 'active', sourceType: 'todo', sourceId: todos[9]._id, firstDetectedAt: new Date(now.getTime() - 2 * 86400000), lastDetectedAt: now, createdAt: now, updatedAt: now },
    { _id: oid(), projectId, ruleCode: 'work:staff_shortage', level: 'critical', fingerprint: `work:${wm4}:staff_shortage`, title: '现场人员不足', description: '「撤场与清洁」需要 6 人，目前仅分配 0 人', status: 'active', sourceType: 'work', sourceId: wm4, firstDetectedAt: new Date(now.getTime() - 1 * 86400000), lastDetectedAt: now, createdAt: now, updatedAt: now },
    { _id: oid(), projectId, ruleCode: 'work:no_assignees', level: 'warning', fingerprint: `work:${wm4}:no_assignees`, title: '现场任务无人分配', description: '「撤场与清洁」尚未分配任何成员', status: 'ignored', ignoreReason: '活动前一周统一分配', ignoredBy: adminId, ignoredAt: now, ignoredUntil: new Date('2026-10-10'), sourceType: 'work', sourceId: wm4, firstDetectedAt: new Date(now.getTime() - 1 * 86400000), lastDetectedAt: now, createdAt: now, updatedAt: now },
  ]);

  // --- Physical Inventory ---
  const pcPrint = oid(), pcEquip = oid(), pcDecor = oid(), pcSupply = oid(), pcBadge = oid(), pcOther = oid();
  await db.collection('physicalcategories').insertMany([
    { _id: pcPrint, projectId, name: '印刷品', order: 0, createdAt: now, updatedAt: now },
    { _id: pcEquip, projectId, name: '设备器材', order: 1, createdAt: now, updatedAt: now },
    { _id: pcDecor, projectId, name: '装饰布置', order: 2, createdAt: now, updatedAt: now },
    { _id: pcSupply, projectId, name: '耗材文具', order: 3, createdAt: now, updatedAt: now },
    { _id: pcBadge, projectId, name: '证件票券', order: 4, createdAt: now, updatedAt: now },
    { _id: pcOther, projectId, name: '其他', order: 5, createdAt: now, updatedAt: now },
  ]);
  const piItems = [
    { _id: oid(), projectId, categoryId: pcPrint, name: 'A3 指引牌', spec: 'A3 铜版纸 双面覆膜', unit: '块', plannedQty: 20, onHandQty: 20, usedQty: 0, lostQty: 0, status: 'in_stock', responsibleId: logId, location: '仓库 A 架', tags: ['现场必带'], note: '', createdBy: adminId, createdAt: now, updatedAt: now },
    { _id: oid(), projectId, categoryId: pcPrint, name: '场刊', spec: 'A5 骑马钉 32 页', unit: '本', plannedQty: 500, onHandQty: 300, usedQty: 0, lostQty: 0, status: 'in_stock', responsibleId: logId, location: '仓库 B 架', tags: [], note: '剩余 200 本预计 10-12 到货', createdBy: adminId, createdAt: now, updatedAt: now },
    { _id: oid(), projectId, categoryId: pcPrint, name: '工作证', spec: 'PVC 卡 + 挂绳', unit: '套', plannedQty: 100, onHandQty: 0, usedQty: 0, lostQty: 0, status: 'planned', responsibleId: staffId, location: '', tags: ['待采购'], note: '', createdBy: adminId, createdAt: now, updatedAt: now },
    { _id: oid(), projectId, categoryId: pcEquip, name: '对讲机', spec: '摩托罗拉 T600', unit: '台', plannedQty: 10, onHandQty: 10, usedQty: 3, lostQty: 0, status: 'in_use', responsibleId: logId, location: '后台设备柜', tags: ['贵重'], note: '现场 3 台已领用', createdBy: adminId, createdAt: now, updatedAt: now },
    { _id: oid(), projectId, categoryId: pcEquip, name: '投影仪', spec: '爱普生 CB-FH52', unit: '台', plannedQty: 2, onHandQty: 2, usedQty: 0, lostQty: 0, status: 'in_stock', responsibleId: prId, location: '仓库 C 架', tags: ['贵重'], note: '', createdBy: adminId, createdAt: now, updatedAt: now },
    { _id: oid(), projectId, categoryId: pcDecor, name: '主舞台背景布', spec: '6m×3m 喷绘', unit: '幅', plannedQty: 1, onHandQty: 1, usedQty: 0, lostQty: 0, status: 'in_stock', responsibleId: artId, location: '仓库 D 架', tags: ['易折'], note: '', createdBy: adminId, createdAt: now, updatedAt: now },
    { _id: oid(), projectId, categoryId: pcDecor, name: '气球拱门', spec: '粉色系 4m 宽', unit: '套', plannedQty: 2, onHandQty: 2, usedQty: 0, lostQty: 1, status: 'in_stock', responsibleId: artId, location: '仓库 D 架', tags: [], note: '运输途中损坏 1 套', createdBy: adminId, createdAt: now, updatedAt: now },
    { _id: oid(), projectId, categoryId: pcSupply, name: '记号笔', spec: '黑色 粗头', unit: '支', plannedQty: 50, onHandQty: 50, usedQty: 12, lostQty: 0, status: 'in_use', responsibleId: staffId, location: '文具箱', tags: ['耗材'], note: '', createdBy: adminId, createdAt: now, updatedAt: now },
    { _id: oid(), projectId, categoryId: pcBadge, name: '观众手环', spec: '一次性 防伪', unit: '条', plannedQty: 3000, onHandQty: 3000, usedQty: 0, lostQty: 0, status: 'in_stock', responsibleId: logId, location: '仓库 E 架', tags: ['现场必带'], note: '', createdBy: adminId, createdAt: now, updatedAt: now },
  ];
  await db.collection('physicalitems').insertMany(piItems);
  await db.collection('physicalitemlogs').insertMany([
    { _id: oid(), projectId, itemId: piItems[3]._id, type: 'adjust_on_hand', qty: 10, note: '设备到货', operatorId: logId, createdAt: new Date(now.getTime() - 5 * 86400000) },
    { _id: oid(), projectId, itemId: piItems[3]._id, type: 'adjust_used', qty: 3, note: '现场领用', operatorId: logId, createdAt: new Date(now.getTime() - 1 * 86400000) },
    { _id: oid(), projectId, itemId: piItems[6]._id, type: 'adjust_lost', qty: 1, note: '运输损坏', operatorId: artId, createdAt: new Date(now.getTime() - 2 * 86400000) },
  ]);

  // --- Stage Rundown（实用工具） ---
  await db.collection('stagerundowns').insertOne({
    _id: oid(),
    projectId,
    name: 'Day1 主舞台',
    startAt: new Date('2026-10-17T10:00:00+08:00'),
    note: '主舞台 A 区，提前 30 分钟候场',
    items: [
      { _id: oid(), name: '开场舞《跃动晴空》', durationMin: 12, participants: [{ cn: '阿喵', contact: 'QQ 11001001' }, { cn: '露露', contact: '微信 lulu_dance' }], attachmentIds: [], note: '开场即满功率，音响推满' },
      { _id: oid(), name: '宅歌连唱', durationMin: 20, participants: [{ cn: '千羽', contact: '微信 qianyu_live' }], attachmentIds: [], note: '' },
      { _id: oid(), name: 'COS 走秀（社团专场）', durationMin: 25, participants: [{ cn: '老白', contact: '' }, { cn: '苏苏', contact: 'QQ 33003300' }, { cn: '阿桔', contact: '' }], attachmentIds: [], note: '按报名表顺序出场' },
      { _id: oid(), name: '嘉宾见面会 · 签售', durationMin: 40, participants: [{ cn: '星野（特邀）', contact: '经纪人 13800001111' }], attachmentIds: [], note: '签售物料提前摆台' },
      { _id: oid(), name: '随机宅舞', durationMin: 30, participants: [{ cn: '全场自由上台', contact: '' }], attachmentIds: [], note: '歌单 B 盘，主持人口播规则' },
      { _id: oid(), name: '闭幕合唱《给明天的信》', durationMin: 10, participants: [{ cn: '全体成员', contact: '' }], attachmentIds: [], note: '' },
    ],
    createdBy: adminId,
    createdAt: now,
    updatedAt: now,
  });

  // --- Stage Signup（实用工具 · 舞台报名审核） ---
  await db.collection('stagesignups').insertOne({
    _id: oid(),
    projectId,
    name: 'Day1 舞台报名',
    startAt: new Date('2026-10-17T10:00:00+08:00'),
    endAt: new Date('2026-10-17T12:00:00+08:00'),
    note: '主舞台 A 区，可用 120 分钟；按名称排序自查撞名',
    items: [
      { _id: oid(), name: '宅歌连唱', durationMin: 20, participants: [{ cn: '千羽', contact: '微信 qianyu_live' }], note: '', status: 'approved',
        reviews: [
          { userId: artId, decision: 'approve', comment: '上届压轴，唱功稳', updatedAt: new Date(now.getTime() - 5 * 3600000) },
          { userId: prId, decision: 'approve', comment: '', updatedAt: new Date(now.getTime() - 3 * 3600000) },
        ] },
      { _id: oid(), name: 'COS 走秀（社团专场）', durationMin: 25, participants: [{ cn: '老白', contact: '' }, { cn: '苏苏', contact: 'QQ 33003300' }], note: '按报名表顺序出场', status: 'approved',
        reviews: [{ userId: artId, decision: 'approve', comment: '', updatedAt: new Date(now.getTime() - 4 * 3600000) }] },
      { _id: oid(), name: '脱口秀《漫展吐槽大会》', durationMin: 15, participants: [{ cn: '阿梗', contact: '微博 @ageng' }], note: '', status: 'rejected',
        reviews: [{ userId: prId, decision: 'reject', comment: '时长压不住，容易冷场', updatedAt: new Date(now.getTime() - 2 * 3600000) }] },
      { _id: oid(), name: '随机宅舞', durationMin: 30, participants: [{ cn: '全场自由上台', contact: '' }], note: '歌单 B 盘，主持人口播规则', status: 'pending', reviews: [] },
      { _id: oid(), name: '随机宅舞', durationMin: 45, participants: [{ cn: '宅舞联萌', contact: 'QQ 55005500' }], note: '社团专场版，疑似与上上条撞名', status: 'pending', reviews: [] },
      { _id: oid(), name: '乐队 Live《黄昏列车》', durationMin: 30, participants: [{ cn: '老白', contact: '' }], note: '需提前接电与返听', status: 'pending', reviews: [] },
    ],
    createdBy: adminId,
    createdAt: now,
    updatedAt: now,
  });

  // --- Invite Code（仅 CLI 演示创建；不写 used/usedBy/usedAt，注册逻辑按 usedBy 不存在判定未用） ---
  if (opts.inviteCode) {
    await db.collection('invitecodes').insertOne({
      _id: oid(), code: opts.inviteCode, createdBy: adminId, createdAt: now, updatedAt: now,
    });
  }

  return {
    adminUserId: adminId,
    memberUserIds: [artId, prId, logId, staffId],
    userIds: [adminId, artId, prId, logId, staffId],
    projectId,
  };
}

/**
 * 级联删除一套演示数据（试用清扫与 CLI 清理共用）。
 * 注意：ResourceVersion/ReminderLog 无 projectId 字段，需经 resourceId/todoId/milestoneId 间接删除。
 */
export async function deleteDemoData(ref: {
  userIds: Types.ObjectId[];
  projectId: Types.ObjectId;
}): Promise<void> {
  const { userIds, projectId } = ref;
  const resourceIds = await Resource.distinct('_id', { projectId });
  const versions = await ResourceVersion.find({ resourceId: { $in: resourceIds } }).lean();
  const files = await File.find({
    $or: [{ projectId }, { _id: { $in: versions.map((v) => v.fileId) } }],
  }).lean();
  for (const f of files) await deleteStored(f.path).catch(() => {});
  for (const v of versions) if (v.previewPath) await deleteStored(v.previewPath).catch(() => {});
  await File.deleteMany({ _id: { $in: files.map((f) => f._id) } });
  await ResourceVersion.deleteMany({ resourceId: { $in: resourceIds } });
  await Resource.deleteMany({ projectId });
  const todoIds = await Todo.distinct('_id', { projectId });
  const milestoneIds = await Milestone.distinct('_id', { projectId });
  await ReminderLog.deleteMany({
    $or: [{ todoId: { $in: todoIds } }, { targetId: { $in: milestoneIds } }],
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const projectScoped: Model<any>[] = [
    ResourceType, Todo, Transaction, PlatformAccount, WorkModule, Announcement,
    AnnouncementConfirmation, Activity, Milestone, RiskInstance, DashboardPreference,
    Incident, PhysicalCategory, PhysicalItem, PhysicalItemLog, ProjectInvite, WeeklyReportLog,
    StageRundown, StageSignup,
  ];
  for (const m of projectScoped) await m.deleteMany({ projectId });
  await Project.deleteMany({ _id: projectId });
  await PushSubscription.deleteMany({ userId: { $in: userIds } });
  await Membership.deleteMany({ $or: [{ projectId }, { userId: { $in: userIds } }] });
  await User.deleteMany({ _id: { $in: userIds } });
}
