import { encryptWithPassphrase } from '../crypto';
import type { Db, DbProject, DbStage, DbUser } from './types';

/** 种子结构版本：变更时递增，旧会话数据自动作废重种，防 schema 漂移 */
export const DB_VERSION = 5;

// 种子数据：全部日期相对构建时刻（new Date()）计算，保证演示站任何时候打开都「正在进行中」。

const DAY = 86400000;
const HOUR = 3600000;

/** 相对 now 偏移（保持当前时刻）：days 天 + hours 小时 */
function rel(days: number, hours = 0): string {
  return new Date(Date.now() + days * DAY + hours * HOUR).toISOString();
}

/** 未来第 days 天的本地 HH:mm（活动/模块时间的自然表达） */
function dayAt(days: number, hour: number, minute = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

const ALL_PERMS = [
  'accounts:manage',
  'file:upload',
  'finance:add',
  'finance:manage',
  'materials:manage',
  'member:manage',
  'project:manage',
  'role:manage',
  'todo:complete',
  'todo:create',
  'todo:manage',
  'work:manage',
  'lostfound:manage',
];

const ROLES = [
  { name: '管理者', permissions: ALL_PERMS },
  { name: '财务', permissions: ['finance:add', 'finance:manage', 'lostfound:manage'] },
  { name: '成员', permissions: ['todo:complete', 'file:upload', 'lostfound:manage'] },
];

const STAGE_NAMES = ['选题', '立项', '宣传', '售票', '筹备', '布展', '现场', '结算'];

function stagesOf(prefix: string, completedCount: number, completedAt: (i: number) => string): DbStage[] {
  return STAGE_NAMES.map((name, i) => ({
    id: `${prefix}-st${i}`,
    name,
    order: i,
    completedAt: i < completedCount ? completedAt(i) : null,
    note: '',
  }));
}

function emptyProject(id: string, name: string, patch: Partial<DbProject>): DbProject {
  return {
    id,
    name,
    description: '',
    status: 'draft',
    startDate: null,
    endDate: null,
    location: '',
    timezone: 'Asia/Shanghai',
    stages: [],
    roles: ROLES.map((r) => ({ name: r.name, permissions: [...r.permissions] })),
    createdBy: 'u-demo',
    ticketTypes: [],
    ticketPriceCents: 0,
    ticketCount: 0,
    ...patch,
  };
}

export async function buildSeed(): Promise<Db> {
  const users: DbUser[] = [
    { id: 'u-demo', email: 'demo@anon.local', name: '林小满', isSuperAdmin: false, contacts: [{ platform: 'QQ', value: '10001' }], onboardedAt: rel(0) },
    { id: 'u-01', email: 'ajie@anon.local', name: '陈阿桔', isSuperAdmin: false, contacts: [{ platform: 'QQ', value: '20002' }, { platform: '微博', value: '@阿桔' }], onboardedAt: rel(-60) },
    { id: 'u-02', email: 'shenmo@anon.local', name: '沈墨', isSuperAdmin: false, contacts: [{ platform: '微信', value: 'shenmo2026' }], onboardedAt: rel(-60) },
    { id: 'u-03', email: 'suqing@anon.local', name: '苏晴', isSuperAdmin: false, contacts: [{ platform: 'QQ', value: '30003' }], onboardedAt: rel(-60) },
    { id: 'u-04', email: 'laobai@anon.local', name: '老白', isSuperAdmin: false, contacts: [{ platform: '微信', value: 'laobai-h' }], onboardedAt: rel(-60) },
    { id: 'u-05', email: 'xiaozhou@anon.local', name: '小舟', isSuperAdmin: false, contacts: [{ platform: '电话', value: '13800000005' }], onboardedAt: rel(-60) },
  ];

  // 项目 1：夏日同人祭。选题/立项已完成 → currentStage = '宣传'
  const p1 = emptyProject('p-demo', '示例·夏日同人祭', {
    description: '社团年度同人展，两天摊位 + 舞台活动。',
    status: 'preparing',
    startDate: dayAt(21, 9),
    endDate: dayAt(22, 17),
    location: '上海世博展览馆',
    stages: stagesOf('pd', 2, (i) => rel(i === 0 ? -58 : -42)),
    ticketTypes: [
      { name: '预售票', priceCents: 5000, count: 120 },
      { name: '现场票', priceCents: 6000, count: 80 },
    ],
  });

  // 项目 2：秋季 Live（空项目，展示初始状态）
  const p2 = emptyProject('p-live', '示例·秋季 Live', {
    description: 'Live 演出（筹备示例）。',
    status: 'draft',
    startDate: dayAt(60, 14),
    endDate: dayAt(60, 21),
    location: '摩登天空 LAB',
    stages: stagesOf('pl', 0, () => ''),
  });

  const memberships = [
    { projectId: 'p-demo', userId: 'u-demo', roleName: '管理者' },
    { projectId: 'p-demo', userId: 'u-01', roleName: '成员' },
    { projectId: 'p-demo', userId: 'u-02', roleName: '财务' },
    { projectId: 'p-demo', userId: 'u-03', roleName: '成员' },
    { projectId: 'p-demo', userId: 'u-04', roleName: '成员' },
    { projectId: 'p-demo', userId: 'u-05', roleName: '成员' },
    { projectId: 'p-live', userId: 'u-demo', roleName: '管理者' },
  ];

  // 内置文件资产（public/demo/）与会话上传的存储 Record
  const files: Db['files'] = {
    'f-poster-v1': { filename: '主视觉海报-v1.svg', mime: 'image/svg+xml', size: 6120, asset: '/demo/poster-v1.svg' },
    'f-poster-v2': { filename: '主视觉海报-v2.svg', mime: 'image/svg+xml', size: 6880, asset: '/demo/poster-v2.svg' },
    'f-floorplan': { filename: '场地平面图.svg', mime: 'image/svg+xml', size: 5210, asset: '/demo/floorplan.svg' },
    'f-booth-csv': {
      filename: '摊位号表.csv',
      mime: 'text/csv',
      size: 128,
      dataUrl:
        'data:text/csv;base64,' +
        '5pGK5L2N5Y+3LOekvuWboizogZTns7vkuroKQS0xMizmnKznpL7lsZXkvY0s6Zi/5qGU44CB5bCP5ruh44CB6ICB55m9CkEtMTMs6ZqU5aOB5Y+L56S+LOmYv+a+hAo=',
    },
    'f-copy-md': {
      filename: '宣传文案.md',
      mime: 'text/markdown',
      size: 96,
      dataUrl: 'data:text/markdown;base64,' + 'IyDlpI/ml6XlkIzkurrnpa0g5a6j5Lyg5paH5qGICgrlvIDnpajllabvvIHpooTllK7npaggNTAg5YWD77yM546w5Zy656WoIDYwIOWFg+OAggrkuKTlpKnmkYrkvY0gKyDoiJ7lj7DmtLvliqjvvIzkuIrmtbfkuJbljZrlsZXop4jppobop4HjgIIK',
    },
    'f-receipt-01': { filename: '场地押金凭证.svg', mime: 'image/svg+xml', size: 6120, asset: '/demo/poster-v1.svg' },
    'f-guide-pdf': { filename: '参展指南.pdf', mime: 'application/pdf', size: 641, asset: '/demo/guide.pdf' },
  };

  const todos: Db['todos'] = [
    // ---- 已完成 6 ----
    {
      id: 't-01', projectId: 'p-demo', title: '确定主视觉风格', category: '宣传',
      assigneeIds: ['u-01'], nodeAt: rel(-16), dueAt: rel(-12), remindAt: null,
      status: 'done', note: '三版方向选一，定稿后同步物料组', createdBy: 'u-demo', createdAt: rel(-16),
      completedAt: rel(-12), completedBy: 'u-01', completionNote: '终稿采用暖色系方案，已同步物料组',
      attachments: [],
      updates: [
        { note: '初稿三版方向讨论，选定暖色', createdBy: 'u-01', createdAt: rel(-15), attachments: [] },
        { note: '完成线稿并内部评审通过', createdBy: 'u-01', createdAt: rel(-13), attachments: [] },
      ],
    },
    {
      id: 't-02', projectId: 'p-demo', title: '开通 BOOTH 店铺并上架摊位信息', category: '招商',
      assigneeIds: ['u-demo'], nodeAt: null, dueAt: rel(-20), remindAt: null,
      status: 'done', note: '', createdBy: 'u-demo', createdAt: rel(-21),
      completedAt: rel(-20), completedBy: 'u-demo', completionNote: '店铺审核已通过',
      attachments: [], updates: [],
    },
    {
      id: 't-03', projectId: 'p-demo', title: '场地合同签署', category: '招商',
      assigneeIds: ['u-02'], nodeAt: null, dueAt: rel(-30), remindAt: null,
      status: 'done', note: '合同编号 EXPO-2026-0817', createdBy: 'u-demo', createdAt: rel(-31),
      completedAt: rel(-30), completedBy: 'u-02', completionNote: '双方盖章完成，扫描件已归档',
      attachments: [], updates: [],
    },
    {
      id: 't-04', projectId: 'p-demo', title: '预售票第一波开票公告', category: '宣传',
      assigneeIds: ['u-03'], nodeAt: rel(-15), dueAt: rel(-14), remindAt: null,
      status: 'done', note: '', createdBy: 'u-demo', createdAt: rel(-15),
      completedAt: rel(-14), completedBy: 'u-03', completionNote: null,
      attachments: [], updates: [],
    },
    {
      id: 't-05', projectId: 'p-demo', title: '桌布/收款码采购', category: '物料',
      assigneeIds: ['u-04'], nodeAt: null, dueAt: rel(-2), remindAt: null,
      status: 'done', note: '', createdBy: 'u-demo', createdAt: rel(-7),
      completedAt: rel(-2, 2), completedBy: 'u-04', completionNote: null,
      attachments: [], updates: [],
    },
    {
      id: 't-06', projectId: 'p-demo', title: '场地押金支付', category: '财务',
      assigneeIds: ['u-02'], nodeAt: null, dueAt: rel(-25), remindAt: null,
      status: 'done', note: '', createdBy: 'u-02', createdAt: rel(-26),
      completedAt: rel(-25), completedBy: 'u-02', completionNote: null,
      attachments: [], updates: [],
    },
    // ---- 进行中 9 ----
    {
      id: 't-07', projectId: 'p-demo', title: '微博宣传图第二批发布', category: '宣传',
      assigneeIds: ['u-03'], nodeAt: null, dueAt: rel(-2), remindAt: null,
      status: 'open', note: '用 v2 海报裁九宫格', createdBy: 'u-demo', createdAt: rel(-9),
      completedAt: null, completedBy: null, completionNote: null, attachments: [], updates: [],
    },
    {
      id: 't-08', projectId: 'p-demo', title: '社团合作宣发对接', category: '宣传',
      assigneeIds: ['u-demo'], nodeAt: null, dueAt: rel(-1), remindAt: null,
      status: 'open', note: '联动三个友社互相转发', createdBy: 'u-03', createdAt: rel(-5),
      completedAt: null, completedBy: null, completionNote: null, attachments: [], updates: [],
    },
    {
      id: 't-09', projectId: 'p-demo', title: '摊位招商名单确认', category: '招商',
      assigneeIds: ['u-02'], nodeAt: null, dueAt: rel(3), remindAt: null,
      status: 'open', note: '', createdBy: 'u-demo', createdAt: rel(-4),
      completedAt: null, completedBy: null, completionNote: null, attachments: [], updates: [],
    },
    {
      id: 't-10', projectId: 'p-demo', title: '周边打样确认', category: '物料',
      assigneeIds: ['u-01'], nodeAt: rel(4), dueAt: rel(5), remindAt: null,
      status: 'open', note: '吧唧 + 亚克力立牌各两款', createdBy: 'u-demo', createdAt: rel(-6),
      completedAt: null, completedBy: null, completionNote: null, attachments: [],
      updates: [
        { note: '打样照片已收到，待确认色差', createdBy: 'u-01', createdAt: rel(-3, 6), attachments: [] },
      ],
    },
    {
      id: 't-11', projectId: 'p-demo', title: '印刷品下单（海报/传单）', category: '物料',
      assigneeIds: ['u-01', 'u-04'], nodeAt: rel(6), dueAt: rel(8), remindAt: null,
      status: 'open', note: '', createdBy: 'u-demo', createdAt: rel(-3),
      completedAt: null, completedBy: null, completionNote: null, attachments: [], updates: [],
    },
    {
      id: 't-12', projectId: 'p-demo', title: '布展物料装车清单', category: '现场',
      assigneeIds: ['u-04'], nodeAt: null, dueAt: rel(19), remindAt: null,
      status: 'open', note: '', createdBy: 'u-demo', createdAt: rel(-2),
      completedAt: null, completedBy: null, completionNote: null, attachments: [], updates: [],
    },
    {
      id: 't-13', projectId: 'p-demo', title: '收银流程演练', category: '现场',
      assigneeIds: ['u-demo'], nodeAt: rel(19), dueAt: rel(20), remindAt: rel(19),
      status: 'open', note: 'POS + 收款码双通道', createdBy: 'u-02', createdAt: rel(-1),
      completedAt: null, completedBy: null, completionNote: null, attachments: [], updates: [],
    },
    {
      id: 't-14', projectId: 'p-demo', title: '预算中期核对', category: '财务',
      assigneeIds: ['u-02'], nodeAt: null, dueAt: rel(10), remindAt: null,
      status: 'open', note: '', createdBy: 'u-02', createdAt: rel(0, -6),
      completedAt: null, completedBy: null, completionNote: null, attachments: [], updates: [],
    },
    {
      id: 't-15', projectId: 'p-demo', title: '志愿者招募收尾', category: '现场',
      assigneeIds: ['u-05'], nodeAt: rel(12), dueAt: rel(15), remindAt: null,
      status: 'open', note: '', createdBy: 'u-demo', createdAt: rel(0, -12),
      completedAt: null, completedBy: null, completionNote: null, attachments: [], updates: [],
    },
  ];

  const transactions: Db['transactions'] = [
    { id: 'tx-01', projectId: 'p-demo', type: 'income', amountCents: 200000, note: '社团赞助费', payerUserId: 'u-02', splitAmong: [], createdBy: 'u-02', createdAt: rel(-18), attachments: [] },
    { id: 'tx-02', projectId: 'p-demo', type: 'income', amountCents: 85000, note: '上届寄售分成', payerUserId: 'u-demo', splitAmong: [], createdBy: 'u-demo', createdAt: rel(-10), attachments: [] },
    { id: 'tx-03', projectId: 'p-demo', type: 'income', amountCents: 30000, note: '摊位加租收入', payerUserId: 'u-02', splitAmong: [], createdBy: 'u-02', createdAt: rel(-5), attachments: [] },
    { id: 'tx-04', projectId: 'p-demo', type: 'expense', amountCents: 400000, note: '场地租金（尾款）', payerUserId: 'u-demo', splitAmong: [], createdBy: 'u-02', createdAt: rel(-20), attachments: [] },
    { id: 'tx-05', projectId: 'p-demo', type: 'expense', amountCents: 100000, note: '场地押金', payerUserId: 'u-demo', splitAmong: [], createdBy: 'u-demo', createdAt: rel(-25), attachments: ['f-receipt-01'] },
    { id: 'tx-06', projectId: 'p-demo', type: 'expense', amountCents: 50000, note: '印刷定金', payerUserId: 'u-01', splitAmong: ['u-01', 'u-04'], createdBy: 'u-01', createdAt: rel(-9), attachments: [] },
    { id: 'tx-07', projectId: 'p-demo', type: 'expense', amountCents: 12000, note: '桌布采购', payerUserId: 'u-04', splitAmong: [], createdBy: 'u-04', createdAt: rel(-6), attachments: [] },
    { id: 'tx-08', projectId: 'p-demo', type: 'expense', amountCents: 36000, note: '宣传投放（微博粉丝通）', payerUserId: 'u-03', splitAmong: ['u-03', 'u-demo'], createdBy: 'u-03', createdAt: rel(-4), attachments: [] },
    { id: 'tx-09', projectId: 'p-demo', type: 'expense', amountCents: 8000, note: 'POS 机租赁', payerUserId: 'u-04', splitAmong: [], createdBy: 'u-04', createdAt: rel(-2), attachments: [] },
  ];

  const resourceTypes: Db['resourceTypes'] = [
    { id: 'rt-1', projectId: 'p-demo', name: '视觉设计', visibility: { userIds: [], roleNames: [] }, createdAt: rel(-16) },
    { id: 'rt-2', projectId: 'p-demo', name: '场地资料', visibility: { userIds: [], roleNames: [] }, createdAt: rel(-16) },
    { id: 'rt-3', projectId: 'p-demo', name: '周边', visibility: { userIds: [], roleNames: [] }, createdAt: rel(-10) },
  ];

  const resources: Db['resources'] = [
    { id: 'r-01', projectId: 'p-demo', typeId: 'rt-1', name: '主视觉海报', description: '终稿为 v2，A2 印刷用', visibility: { userIds: [], roleNames: [] }, createdAt: rel(-8) },
    { id: 'r-02', projectId: 'p-demo', typeId: 'rt-2', name: '场地平面图', description: 'B2 馆官方平面图，标注摊位 A-12', visibility: { userIds: [], roleNames: [] }, createdAt: rel(-5) },
    { id: 'r-03', projectId: 'p-demo', typeId: 'rt-2', name: '摊位号表', description: '全部参展社团摊位分配', visibility: { userIds: [], roleNames: [] }, createdAt: rel(-4) },
    { id: 'r-04', projectId: 'p-demo', typeId: 'rt-3', name: '周边清单', description: '待阿桔整理打样数量后上传', visibility: { userIds: [], roleNames: [] }, createdAt: rel(-2) },
    { id: 'r-05', projectId: 'p-demo', typeId: 'rt-1', name: '宣传文案', description: '开票公告与日常宣发文案', visibility: { userIds: [], roleNames: [] }, createdAt: rel(-6) },
    { id: 'r-06', projectId: 'p-demo', typeId: 'rt-2', name: '参展指南 PDF', description: '观众入场须知与摊位地图（PDF 在线预览示例）', visibility: { userIds: [], roleNames: [] }, createdAt: rel(-3) },
  ];

  const versions: Db['versions'] = [
    { id: 'rv-011', resourceId: 'r-01', version: 1, note: '初稿', fileId: 'f-poster-v1', hasPreview: true, createdBy: 'u-01', createdAt: rel(-8) },
    { id: 'rv-012', resourceId: 'r-01', version: 2, note: '终稿 · 加深对比', fileId: 'f-poster-v2', hasPreview: true, createdBy: 'u-01', createdAt: rel(-3) },
    { id: 'rv-021', resourceId: 'r-02', version: 1, note: '', fileId: 'f-floorplan', hasPreview: true, createdBy: 'u-02', createdAt: rel(-5) },
    { id: 'rv-031', resourceId: 'r-03', version: 1, note: '', fileId: 'f-booth-csv', hasPreview: false, createdBy: 'u-01', createdAt: rel(-4) },
    { id: 'rv-051', resourceId: 'r-05', version: 1, note: '', fileId: 'f-copy-md', hasPreview: true, createdBy: 'u-03', createdAt: rel(-6) },
    { id: 'rv-061', resourceId: 'r-06', version: 1, note: '', fileId: 'f-guide-pdf', hasPreview: true, createdBy: 'u-02', createdAt: rel(-3) },
  ];

  const weiboCipher = await encryptWithPassphrase('Weibo@Demo2026', 'demo');
  const accounts: Db['accounts'] = [
    {
      id: 'a-01', projectId: 'p-demo', platform: '微博', account: '@夏日同人祭-official',
      mode: 'full', cipherKeySource: 'user', passwordCipher: weiboCipher, plainPassword: null,
      note: '官方宣传微博。演示口令：demo', addedBy: 'u-demo',
      visibility: { userIds: [], roleNames: [] }, createdAt: rel(-30),
    },
    {
      id: 'a-02', projectId: 'p-demo', platform: '其他', account: 'BOOTH 店铺（anon-demo）',
      mode: 'otp', cipherKeySource: null, passwordCipher: null, plainPassword: null,
      note: '社团店铺，登录验证码找阿桔索取', addedBy: 'u-01',
      visibility: { userIds: [], roleNames: [] }, createdAt: rel(-21),
    },
    {
      id: 'a-03', projectId: 'p-demo', platform: 'QQ', account: '20002（画师阿桔）',
      mode: 'contact', cipherKeySource: null, passwordCipher: null, plainPassword: null,
      note: '本子画师，赶稿期每晚 9 点后在线', addedBy: 'u-demo',
      visibility: { userIds: [], roleNames: [] }, createdAt: rel(-20),
    },
  ];

  const workModules: Db['workModules'] = [
    {
      id: 'wm-01', projectId: 'p-demo', name: '布展', description: '卸货、搭建摊位、布置展品',
      location: '展馆 B2 卸货区', startAt: dayAt(21, 7), endAt: dayAt(21, 9), requiredCount: 4,
      assignees: [
        { userId: 'u-demo', confirmedAt: rel(-3), confirmedBy: 'u-demo', checkedInAt: null, completedAt: null },
        { userId: 'u-04', confirmedAt: rel(-2), confirmedBy: 'u-04', checkedInAt: null, completedAt: null },
        { userId: 'u-05', confirmedAt: null, confirmedBy: null, checkedInAt: null, completedAt: null },
      ],
      createdBy: 'u-demo', createdAt: rel(-10),
    },
    {
      id: 'wm-02', projectId: 'p-demo', name: '收银', description: 'POS + 收款码双通道收银',
      location: '摊位 A-12', startAt: dayAt(21, 9), endAt: dayAt(21, 17), requiredCount: 2,
      assignees: [
        { userId: 'u-02', confirmedAt: rel(-4), confirmedBy: 'u-02', checkedInAt: null, completedAt: null },
        { userId: 'u-demo', confirmedAt: rel(-2), confirmedBy: 'u-demo', checkedInAt: null, completedAt: null },
      ],
      createdBy: 'u-demo', createdAt: rel(-10),
    },
    {
      id: 'wm-03', projectId: 'p-demo', name: '看摊轮班', description: '两人一组轮换，每小时一班',
      location: '摊位 A-12', startAt: dayAt(21, 9), endAt: dayAt(21, 17), requiredCount: 3,
      assignees: [
        { userId: 'u-demo', confirmedAt: null, confirmedBy: null, checkedInAt: null, completedAt: null },
        { userId: 'u-01', confirmedAt: rel(0, -1), confirmedBy: 'u-01', checkedInAt: null, completedAt: null },
        { userId: 'u-05', confirmedAt: rel(0, -3), confirmedBy: 'u-05', checkedInAt: null, completedAt: null },
      ],
      createdBy: 'u-demo', createdAt: rel(0, -20),
    },
    {
      id: 'wm-04', projectId: 'p-demo', name: '撤展', description: '展品打包、物料装车、场地还原',
      location: '展馆 B2 卸货区', startAt: dayAt(22, 17), endAt: dayAt(22, 19), requiredCount: 4,
      assignees: [
        { userId: 'u-04', confirmedAt: rel(-1), confirmedBy: 'u-04', checkedInAt: null, completedAt: null },
        { userId: 'u-05', confirmedAt: null, confirmedBy: null, checkedInAt: null, completedAt: null },
      ],
      createdBy: 'u-demo', createdAt: rel(-8),
    },
  ];

  const physicalCategories: Db['physicalCategories'] = [
    { id: 'pc-1', projectId: 'p-demo', name: '物料', order: 0, createdAt: rel(-7) },
    { id: 'pc-2', projectId: 'p-demo', name: '设备', order: 1, createdAt: rel(-7) },
  ];

  const physicalItems: Db['physicalItems'] = [
    { id: 'pi-01', projectId: 'p-demo', categoryId: 'pc-1', name: '桌布（藏青）', spec: '1.5m×2m', unit: '块', plannedQty: 2, onHandQty: 2, usedQty: 0, lostQty: 0, status: 'in_stock', responsibleId: 'u-04', location: '老白家', tags: ['摊位布置'], note: '', createdBy: 'u-04', createdAt: rel(-7), updatedAt: rel(-7) },
    { id: 'pi-02', projectId: 'p-demo', categoryId: 'pc-1', name: '收款码立牌', spec: 'A5 亚克力', unit: '个', plannedQty: 2, onHandQty: 1, usedQty: 0, lostQty: 0, status: 'in_stock', responsibleId: 'u-demo', location: '', tags: ['收银'], note: '微信/支付宝各一', createdBy: 'u-demo', createdAt: rel(-6), updatedAt: rel(-6) },
    { id: 'pi-03', projectId: 'p-demo', categoryId: 'pc-2', name: '排插', spec: '6 位 1.8m', unit: '个', plannedQty: 4, onHandQty: 2, usedQty: 0, lostQty: 0, status: 'in_stock', responsibleId: 'u-05', location: '仓库', tags: ['电力'], note: '', createdBy: 'u-05', createdAt: rel(-5), updatedAt: rel(-5) },
    { id: 'pi-04', projectId: 'p-demo', categoryId: 'pc-2', name: 'POS 机', spec: '拉卡拉 4G', unit: '台', plannedQty: 1, onHandQty: 1, usedQty: 1, lostQty: 0, status: 'in_use', responsibleId: 'u-02', location: '', tags: ['收银'], note: '', createdBy: 'u-02', createdAt: rel(-4), updatedAt: rel(-4) },
    { id: 'pi-05', projectId: 'p-demo', categoryId: 'pc-1', name: '展示网格架', spec: '60×90cm', unit: '片', plannedQty: 3, onHandQty: 0, usedQty: 0, lostQty: 0, status: 'planned', responsibleId: 'u-01', location: '', tags: ['摊位布置'], note: '等打样确认后下单', createdBy: 'u-01', createdAt: rel(-3), updatedAt: rel(-3) },
    { id: 'pi-06', projectId: 'p-demo', categoryId: 'pc-2', name: '充电线（Type-C）', spec: '1m', unit: '根', plannedQty: 5, onHandQty: 5, usedQty: 0, lostQty: 1, status: 'in_stock', responsibleId: 'u-05', location: '仓库', tags: ['电力'], note: '', createdBy: 'u-05', createdAt: rel(-2), updatedAt: rel(-2) },
  ];

  const physicalLogs: Db['physicalLogs'] = [
    { id: 'pl-011', projectId: 'p-demo', itemId: 'pi-01', type: 'adjust_on_hand', qty: 2, status: null, note: '采购到货', operatorId: 'u-04', createdAt: rel(-7) },
    { id: 'pl-041', projectId: 'p-demo', itemId: 'pi-04', type: 'status_change', qty: 0, status: 'in_use', note: '已领用调试', operatorId: 'u-02', createdAt: rel(-4) },
  ];

  const announcements: Db['announcements'] = [
    {
      id: 'an-01', projectId: 'p-demo', title: '摊位须知', content: '摊位号 A-12。布展请先到服务台领取参展证，贵重物品勿离人。',
      type: 'normal', isPinned: false, requireConfirmation: false,
      visibility: { userIds: [], roleNames: [] }, publishedBy: 'u-02', publishedAt: rel(-5), expiresAt: null,
      confirmedBy: [],
    },
    {
      id: 'an-02', projectId: 'p-demo', title: '布展时间变更', content: '接展馆通知：布展入场时间由 08:00 提前至 07:00，请布展组同学务必准时。',
      type: 'important', isPinned: true, requireConfirmation: true,
      visibility: { userIds: [], roleNames: [] }, publishedBy: 'u-demo', publishedAt: rel(-2), expiresAt: null,
      confirmedBy: [],
    },
    {
      id: 'an-03', projectId: 'p-demo', title: '台风预案提醒', content: '若活动前 48 小时发布台风预警，将启动预案 B：布展顺延一天，请关注群内通知。',
      type: 'emergency', isPinned: false, requireConfirmation: false,
      visibility: { userIds: [], roleNames: [] }, publishedBy: 'u-demo', publishedAt: rel(-1), expiresAt: null,
      confirmedBy: [],
    },
  ];

  const risks: Db['risks'] = [
    {
      id: 'risk-01', projectId: 'p-demo', ruleCode: 'work:staff_shortage', level: 'critical',
      sourceType: 'work', sourceId: 'wm-01', title: '现场人员不足',
      description: '「布展」需要 4 人，目前仅分配 3 人',
      status: 'active', firstDetectedAt: rel(-3), lastDetectedAt: rel(0, -1),
      resolvedAt: null, ignoredBy: null, ignoredUntil: null, ignoreReason: null,
    },
    {
      id: 'risk-02', projectId: 'p-demo', ruleCode: 'todo:overdue', level: 'warning',
      sourceType: 'todo', sourceId: null, title: '待办已逾期',
      description: '「微博宣传图第二批发布」等 2 条待办已超过截止时间',
      status: 'active', firstDetectedAt: rel(-2), lastDetectedAt: rel(0, -1),
      resolvedAt: null, ignoredBy: null, ignoredUntil: null, ignoreReason: null,
    },
  ];

  const activities: Db['activities'] = [
    { id: 'act-01', projectId: 'p-demo', actorId: 'u-02', type: 'announcement:publish', message: '沈墨发布了公告「摊位须知」', sourceType: 'announcement', sourceId: 'an-01', permissionGate: null, createdAt: rel(-5) },
    { id: 'act-02', projectId: 'p-demo', actorId: 'u-03', type: 'finance:create', message: '苏晴添加了一笔支出记录', sourceType: 'finance', sourceId: 'tx-08', permissionGate: 'finance:manage', createdAt: rel(-4, -2) },
    { id: 'act-03', projectId: 'p-demo', actorId: 'u-01', type: 'material:upload_version', message: '陈阿桔上传了「摊位号表」的新版本', sourceType: 'material', sourceId: 'r-03', permissionGate: null, createdAt: rel(-4) },
    { id: 'act-04', projectId: 'p-demo', actorId: 'u-01', type: 'material:upload_version', message: '陈阿桔上传了「主视觉海报」的新版本', sourceType: 'material', sourceId: 'r-01', permissionGate: null, createdAt: rel(-3) },
    { id: 'act-05', projectId: 'p-demo', actorId: 'u-01', type: 'todo:progress', message: '陈阿桔提交了待办「周边打样确认」的进度', sourceType: 'todo', sourceId: 't-10', permissionGate: null, createdAt: rel(-3, 6) },
    { id: 'act-06', projectId: 'p-demo', actorId: 'u-demo', type: 'announcement:publish', message: '林小满发布了公告「布展时间变更」', sourceType: 'announcement', sourceId: 'an-02', permissionGate: null, createdAt: rel(-2) },
    { id: 'act-07', projectId: 'p-demo', actorId: 'u-04', type: 'todo:complete', message: '老白完成了待办「桌布/收款码采购」', sourceType: 'todo', sourceId: 't-05', permissionGate: null, createdAt: rel(-2, 2) },
    { id: 'act-08', projectId: 'p-demo', actorId: 'u-demo', type: 'work:create', message: '林小满创建了现场任务「看摊轮班」', sourceType: 'work', sourceId: 'wm-03', permissionGate: null, createdAt: rel(0, -20) },
    { id: 'act-09', projectId: 'p-demo', actorId: 'u-02', type: 'todo:create', message: '沈墨创建了待办「预算中期核对」', sourceType: 'todo', sourceId: 't-14', permissionGate: null, createdAt: rel(0, -6) },
    { id: 'act-10', projectId: 'p-demo', actorId: 'u-01', type: 'work:confirm', message: '陈阿桔确认了现场任务「看摊轮班」', sourceType: 'work', sourceId: 'wm-03', permissionGate: null, createdAt: rel(0, -1) },
  ];

  const milestones: Db['milestones'] = [
    { id: 'ms-01', projectId: 'p-demo', title: '预售票开票', date: rel(-14), description: '第一波 120 张，2 小时售罄', stageId: 'pd-st3', completedAt: rel(-13), createdBy: 'u-demo' },
    { id: 'ms-02', projectId: 'p-demo', title: '本子截稿', date: rel(-2), description: '全部稿件截止，进入排版', stageId: 'pd-st2', completedAt: null, createdBy: 'u-01' },
    { id: 'ms-03', projectId: 'p-demo', title: '正式开幕', date: dayAt(21, 9), description: 'Day1 09:00 观众入场', stageId: 'pd-st6', completedAt: null, createdBy: 'u-demo' },
  ];

  const incidents: Db['incidents'] = [
    { id: 'i-01', projectId: 'p-demo', moduleId: 'wm-01', category: 'equipment', note: '排插数量不足，需再备 2 个', reporterId: 'u-04', status: 'open', createdAt: rel(-1, -3) },
  ];

  const stageRundowns: Db['stageRundowns'] = [
    {
      id: 'sr-01', projectId: 'p-demo', name: 'Day1 主舞台', startAt: dayAt(21, 10), note: '主舞台 A 区，提前 30 分钟候场',
      items: [
        { id: 'sri-01', name: '开场舞《跃动晴空》', durationMin: 12, participants: [{ cn: '阿喵', contact: 'QQ 11001001' }, { cn: '露露', contact: '微信 lulu_dance' }], attachmentIds: [], note: '开场即满功率，音响推满' },
        { id: 'sri-02', name: '宅歌连唱', durationMin: 20, participants: [{ cn: '千羽', contact: '微信 qianyu_live' }], attachmentIds: [], note: '' },
        { id: 'sri-03', name: 'COS 走秀（社团专场）', durationMin: 25, participants: [{ cn: '老白', contact: '' }, { cn: '苏苏', contact: 'QQ 33003300' }, { cn: '阿桔', contact: '' }], attachmentIds: [], note: '按报名表顺序出场' },
        { id: 'sri-04', name: '嘉宾见面会 · 签售', durationMin: 40, participants: [{ cn: '星野（特邀）', contact: '经纪人 13800001111' }], attachmentIds: [], note: '签售物料提前摆台' },
        { id: 'sri-05', name: '随机宅舞', durationMin: 30, participants: [{ cn: '全场自由上台', contact: '' }], attachmentIds: [], note: '歌单 B 盘，主持人口播规则' },
        { id: 'sri-06', name: '闭幕合唱《给明天的信》', durationMin: 10, participants: [{ cn: '全体成员', contact: '' }], attachmentIds: [], note: '' },
      ],
      createdBy: 'u-demo', createdAt: rel(-3), updatedAt: rel(-3),
    },
  ];

  const stageSignups: Db['stageSignups'] = [
    {
      id: 'ss-01', projectId: 'p-demo', name: 'Day1 舞台报名',
      startAt: dayAt(21, 10), endAt: dayAt(21, 12), note: '主舞台 A 区，可用 120 分钟；按名称排序自查撞名',
      items: [
        { id: 'ssi-01', name: '宅歌连唱', durationMin: 20, participants: [{ cn: '千羽', contact: '微信 qianyu_live' }], note: '', status: 'approved',
          reviews: [
            { userId: 'u-01', decision: 'approve', comment: '上届压轴，唱功稳', updatedAt: rel(-1, -5) },
            { userId: 'u-02', decision: 'approve', comment: '', updatedAt: rel(-1, -3) },
          ] },
        { id: 'ssi-02', name: 'COS 走秀（社团专场）', durationMin: 25, participants: [{ cn: '老白', contact: '' }, { cn: '苏苏', contact: 'QQ 33003300' }], note: '按报名表顺序出场', status: 'approved',
          reviews: [{ userId: 'u-01', decision: 'approve', comment: '', updatedAt: rel(-1, -4) }] },
        { id: 'ssi-03', name: '脱口秀《漫展吐槽大会》', durationMin: 15, participants: [{ cn: '阿梗', contact: '微博 @ageng' }], note: '', status: 'rejected',
          reviews: [{ userId: 'u-02', decision: 'reject', comment: '时长压不住，容易冷场', updatedAt: rel(-1, -2) }] },
        { id: 'ssi-04', name: '随机宅舞', durationMin: 30, participants: [{ cn: '全场自由上台', contact: '' }], note: '歌单 B 盘，主持人口播规则', status: 'pending', reviews: [] },
        { id: 'ssi-05', name: '随机宅舞', durationMin: 45, participants: [{ cn: '宅舞联萌', contact: 'QQ 55005500' }], note: '社团专场版，疑似与上上条撞名', status: 'pending', reviews: [] },
        { id: 'ssi-06', name: '乐队 Live《黄昏列车》', durationMin: 30, participants: [{ cn: '老白', contact: '' }], note: '需提前接电与返听', status: 'pending', reviews: [] },
      ],
      createdBy: 'u-demo', createdAt: rel(-2), updatedAt: rel(-1),
    },
  ];

  const dashboardPreferences: Db['dashboardPreferences'] = [
    { userId: 'u-demo', projectId: 'p-demo', defaultView: 'project', collapsedCards: [], hiddenCards: [], scheduleRange: 7, cardOrder: [] },
  ];

  const inviteCodes: Db['inviteCodes'] = [
    { id: 'ic-01', code: 'ANON-DEMO2026', used: false, usedAt: null, createdAt: rel(-30) },
    { id: 'ic-02', code: 'ANON-USED001', used: true, usedAt: rel(-20), createdAt: rel(-25) },
  ];

  const lostFoundItems: Db['lostFoundItems'] = [
    {
      id: 'lf-01', projectId: 'p-demo', name: '黑色折叠伞', note: '伞柄挂有橙色挂件',
      hasPhoto: false, foundAt: rel(20, 3), foundLocation: 'A 馆入口服务台',
      status: 'pending', claimedAt: null, claimNote: '', createdBy: 'u-01', createdAt: rel(20, 3), updatedAt: rel(20, 3),
    },
    {
      id: 'lf-02', projectId: 'p-demo', name: '学生证', note: '蓝色卡套，贴有吧唧',
      hasPhoto: false, foundAt: rel(20, 5), foundLocation: '同人摊位区 B-12',
      status: 'pending', claimedAt: null, claimNote: '', createdBy: 'u-02', createdAt: rel(20, 5), updatedAt: rel(20, 5),
    },
    {
      id: 'lf-03', projectId: 'p-demo', name: '充电宝（20000mAh）', note: '白色小米，带 Type-C 线',
      hasPhoto: false, foundAt: rel(19, 6), foundLocation: '主舞台观众席',
      status: 'claimed', claimedAt: rel(20, 1), claimNote: '失主 CN 阿凪，已现场归还', createdBy: 'u-01', createdAt: rel(19, 6), updatedAt: rel(20, 1),
    },
  ];

  const lostFoundShares: Db['lostFoundShares'] = [
    { projectId: 'p-demo', token: 'demo-lostfound', enabled: true },
  ];

  return {
    version: DB_VERSION,
    currentUserId: 'u-demo',
    users,
    projects: [p1, p2],
    memberships,
    todos,
    transactions,
    resourceTypes,
    resources,
    versions,
    accounts,
    workModules,
    physicalCategories,
    physicalItems,
    physicalLogs,
    announcements,
    risks,
    activities,
    milestones,
    incidents,
    stageRundowns,
    stageSignups,
    lostFoundItems,
    lostFoundShares,
    dashboardPreferences,
    inviteCodes,
    invites: [],
    files,
  };
}
