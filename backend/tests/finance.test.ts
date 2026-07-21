import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { InviteCode } from '../src/models/InviteCode';
import { User } from '../src/models/User';
import { createSuperAdmin, registerUser } from './helpers';

let owner: { token: string; user: { id: string } };
let staff: { token: string; user: { id: string } };
let staff2: { token: string; user: { id: string } };
let outsider: { token: string; user: { id: string } };
let projectId: string;

beforeEach(async () => {
  owner = await createSuperAdmin();
  const creator = (await User.findOne())!._id;
  await InviteCode.create([
    { code: 'C1', createdBy: creator },
    { code: 'C2', createdBy: creator },
    { code: 'C3', createdBy: creator },
  ]);
  staff = await registerUser('C1', 's@example.com', 'Staff');
  staff2 = await registerUser('C2', 's2@example.com', 'Staff2');
  outsider = await registerUser('C3', 'o@example.com', 'Outsider');
  const p = await request(app)
    .post('/api/projects')
    .set('Authorization', `Bearer ${owner.token}`)
    .send({ name: '活动' });
  projectId = p.body.project.id;
  for (const u of [staff, staff2]) {
    const inv = await request(app)
      .post(`/api/projects/${projectId}/invites`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ roleName: '一般staff' });
    await request(app)
      .post(`/api/invites/${inv.body.token}/accept`)
      .set('Authorization', `Bearer ${u.token}`);
  }
});

async function addTx(token: string, body: Record<string, unknown>) {
  const res = await request(app)
    .post(`/api/projects/${projectId}/finance`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
  expect(res.status).toBe(201);
  return res.body.transaction as { id: string };
}

describe('finance', () => {
  it('创建/列出账目，金额为整数分', async () => {
    await addTx(owner.token, {
      type: 'expense',
      amount: 300,
      note: '场地费',
      payerUserId: owner.user.id,
    });
    const res = await request(app)
      .get(`/api/projects/${projectId}/finance`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(res.status).toBe(200);
    expect(res.body.transactions).toHaveLength(1);
    const tx = res.body.transactions[0];
    expect(tx.amountCents).toBe(30000);
    expect(tx.payer.name).toBe('Admin');
    expect(tx.createdByName).toBe('Admin');
    expect(res.body.summary.expenseCents).toBe(30000);
    expect(res.body.summary.perUser).toHaveLength(3);
  });

  it('支持 multipart 上传凭证附件', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/finance`)
      .set('Authorization', `Bearer ${owner.token}`)
      .field('type', 'expense')
      .field('amount', '12.50')
      .field('payerUserId', owner.user.id)
      .field('note', '打印')
      .attach('files', Buffer.from('png-data'), '凭证.png');
    expect(res.status).toBe(201);
    expect(res.body.transaction.amountCents).toBe(1250);
    expect(res.body.transaction.attachments[0].filename).toBe('凭证.png');
  });

  it('无 finance:manage 的成员写操作返回 403', async () => {
    const post = await request(app)
      .post(`/api/projects/${projectId}/finance`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ type: 'expense', amount: 1, payerUserId: staff.user.id });
    expect(post.status).toBe(403);
    const tx = await addTx(owner.token, { type: 'expense', amount: 1, payerUserId: owner.user.id });
    const patch = await request(app)
      .patch(`/api/projects/${projectId}/finance/${tx.id}`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ note: 'x' });
    expect(patch.status).toBe(403);
    const del = await request(app)
      .delete(`/api/projects/${projectId}/finance/${tx.id}`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(del.status).toBe(403);
    const ticket = await request(app)
      .patch(`/api/projects/${projectId}/finance/ticket`)
      .set('Authorization', `Bearer ${staff.token}`)
      .send({ ticketPrice: 10, ticketCount: 1 });
    expect(ticket.status).toBe(403);
  });

  it('非项目成员访问返回 403', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/finance`)
      .set('Authorization', `Bearer ${outsider.token}`);
    expect(res.status).toBe(403);
  });

  it('付款人/平摊人必须是项目成员，金额须为正且最多两位小数', async () => {
    const badPayer = await request(app)
      .post(`/api/projects/${projectId}/finance`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ type: 'expense', amount: 1, payerUserId: outsider.user.id });
    expect(badPayer.status).toBe(400);
    const badAmount = await request(app)
      .post(`/api/projects/${projectId}/finance`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ type: 'expense', amount: 1.005, payerUserId: owner.user.id });
    expect(badAmount.status).toBe(400);
  });

  it('可编辑与删除账目', async () => {
    const tx = await addTx(owner.token, {
      type: 'expense',
      amount: 100,
      note: '旧',
      payerUserId: owner.user.id,
    });
    const patch = await request(app)
      .patch(`/api/projects/${projectId}/finance/${tx.id}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ amount: 80, note: '新', splitAmong: [owner.user.id, staff.user.id] });
    expect(patch.status).toBe(200);
    expect(patch.body.transaction.amountCents).toBe(8000);
    expect(patch.body.transaction.note).toBe('新');
    expect(patch.body.transaction.splitAmong).toHaveLength(2);
    const del = await request(app)
      .delete(`/api/projects/${projectId}/finance/${tx.id}`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(del.status).toBe(200);
    const list = await request(app)
      .get(`/api/projects/${projectId}/finance`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(list.body.transactions).toHaveLength(0);
  });

  it('splitAmong 重复 id 会去重，结算保持守恒', async () => {
    const tx = await addTx(owner.token, {
      type: 'expense',
      amount: 60,
      payerUserId: staff.user.id,
      splitAmong: [staff.user.id, staff.user.id, owner.user.id],
    });
    const list = await request(app)
      .get(`/api/projects/${projectId}/finance`)
      .set('Authorization', `Bearer ${owner.token}`);
    const stored = list.body.transactions[0];
    expect(stored.splitAmong.map((s: { userId: string }) => s.userId).sort()).toEqual(
      [owner.user.id, staff.user.id].sort(),
    );
    // 按去重后的两人平摊：staff 垫付 6000 自摊 3000 → +3000，owner −3000，staff2 无关为 0，合计守恒为 0
    const s = list.body.summary;
    const netOf = (id: string) =>
      s.perUser.find((p: { userId: string }) => p.userId === id).netCents as number;
    expect(netOf(staff.user.id)).toBe(3000);
    expect(netOf(owner.user.id)).toBe(-3000);
    expect(netOf(staff2.user.id)).toBe(0);
    expect(s.perUser.reduce((sum: number, p: { netCents: number }) => sum + p.netCents, 0)).toBe(0);
    // PATCH 路径同样去重
    const patch = await request(app)
      .patch(`/api/projects/${projectId}/finance/${tx.id}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ splitAmong: [owner.user.id, owner.user.id] });
    expect(patch.status).toBe(200);
    expect(patch.body.transaction.splitAmong).toHaveLength(1);
  });

  it('门票设置计入汇总', async () => {
    const res = await request(app)
      .patch(`/api/projects/${projectId}/finance/ticket`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ ticketPrice: 70, ticketCount: 3 });
    expect(res.status).toBe(200);
    const list = await request(app)
      .get(`/api/projects/${projectId}/finance`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(list.body.summary.ticketIncomeCents).toBe(21000);
    expect(list.body.summary.profitCents).toBe(21000);
    // 门票收入为公款，均摊到 3 名成员
    for (const p of list.body.summary.perUser) expect(p.netCents).toBe(7000);
  });

  it('三人场景：按人净额与建议转账正确', async () => {
    await request(app)
      .patch(`/api/projects/${projectId}/finance/ticket`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ ticketPrice: 70, ticketCount: 3 }); // 门票公款 21000
    await addTx(owner.token, { type: 'expense', amount: 300, payerUserId: owner.user.id }); // 全员支出
    await addTx(owner.token, {
      type: 'expense',
      amount: 60,
      payerUserId: staff.user.id,
      splitAmong: [owner.user.id, staff.user.id], // 仅 owner/staff 平摊
    });
    await addTx(owner.token, { type: 'income', amount: 150, payerUserId: staff2.user.id }); // staff2 代收款
    const list = await request(app)
      .get(`/api/projects/${projectId}/finance`)
      .set('Authorization', `Bearer ${owner.token}`);
    const s = list.body.summary;
    expect(s.ticketIncomeCents).toBe(21000);
    expect(s.incomeCents).toBe(15000);
    expect(s.expenseCents).toBe(36000);
    expect(s.profitCents).toBe(0);
    // 公款池 = 21000 + 15000 − 30000 = 6000，每人 +2000
    const netOf = (id: string) =>
      s.perUser.find((p: { userId: string }) => p.userId === id).netCents as number;
    expect(netOf(owner.user.id)).toBe(30000 - 3000 + 2000); // 29000
    expect(netOf(staff.user.id)).toBe(6000 - 3000 + 2000); // 5000
    expect(netOf(staff2.user.id)).toBe(-15000 + 2000); // -13000
    const transfers = s.settlement.map(
      (t: { from: { userId: string }; to: { userId: string }; amountCents: number }) =>
        `${t.from.userId}->${t.to.userId}:${t.amountCents}`,
    );
    expect(transfers).toEqual([`${staff2.user.id}->${owner.user.id}:13000`]);
  });

  it('导出 CSV：UTF-8 BOM、仅含该成员相关账目', async () => {
    await addTx(owner.token, { type: 'expense', amount: 300, note: '全员场地', payerUserId: owner.user.id });
    await addTx(owner.token, {
      type: 'expense',
      amount: 60,
      note: '两人餐费',
      payerUserId: staff.user.id,
      splitAmong: [owner.user.id, staff.user.id],
    });
    await addTx(owner.token, { type: 'income', amount: 150, note: '预售', payerUserId: staff2.user.id });
    await addTx(owner.token, {
      type: 'expense',
      amount: 20,
      note: '私人物品',
      payerUserId: owner.user.id,
      splitAmong: [owner.user.id],
    });
    const res = await request(app)
      .get(`/api/projects/${projectId}/finance/export?userId=${staff.user.id}`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text.charCodeAt(0)).toBe(0xfeff);
    const lines = res.text.slice(1).trim().split('\r\n');
    expect(lines[0]).toBe('日期,类型,金额(元),付款人,参与平摊,备注,添加人');
    // staff 相关：全员场地（全员）、两人餐费（平摊人）、预售（splitAmong 空）；不含私人物品
    expect(lines).toHaveLength(1 + 3);
    expect(res.text).toContain('全员场地');
    expect(res.text).toContain('两人餐费');
    expect(res.text).toContain('预售');
    expect(res.text).not.toContain('私人物品');
    expect(res.text).toContain('300.00');

    const own = await request(app)
      .get(`/api/projects/${projectId}/finance/export`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(own.text.slice(1).trim().split('\r\n')).toHaveLength(1 + 4);

    const badUser = await request(app)
      .get(`/api/projects/${projectId}/finance/export?userId=${outsider.user.id}`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(badUser.status).toBe(400);
  });
});
