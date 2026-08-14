import mongoose, { Types } from 'mongoose';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { Announcement } from '../src/models/Announcement';
import { InviteCode } from '../src/models/InviteCode';
import { User } from '../src/models/User';
import { createSuperAdmin, registerUser } from './helpers';

let owner: { token: string; user: { id: string } };
let staff: { token: string; user: { id: string } };
let projectId: string;
let creatorId: string;

const BASE = () => `/api/projects/${projectId}/stage-rundowns`;
const EXEC = (rid: string, op: string) => `${BASE()}/${rid}/execution/${op}`;

async function invite(token: string, user: { token: string }, roleName: string) {
  const inv = await request(app)
    .post(`/api/projects/${projectId}/invites`)
    .set('Authorization', `Bearer ${token}`)
    .send({ roleName });
  await request(app)
    .post(`/api/invites/${inv.body.token}/accept`)
    .set('Authorization', `Bearer ${user.token}`);
}

async function createRundown(name = 'Day1 主舞台', startAt = '2026-10-17T10:00:00+08:00') {
  const res = await request(app)
    .post(BASE())
    .set('Authorization', `Bearer ${owner.token}`)
    .send({ name, startAt });
  expect(res.status).toBe(201);
  return res.body.rundown as { id: string };
}

async function addItem(rid: string, name: string, durationMin = '10') {
  const res = await request(app)
    .post(`${BASE()}/${rid}/items`)
    .set('Authorization', `Bearer ${owner.token}`)
    .field('name', name)
    .field('durationMin', durationMin);
  expect(res.status).toBe(201);
  return res.body.item as { id: string; name: string };
}

/** 建 3 节目 rundown 并返回条目 id 列表 */
async function rundownWith3() {
  const r = await createRundown();
  const a = await addItem(r.id, 'A');
  const b = await addItem(r.id, 'B', '20');
  const c = await addItem(r.id, 'C', '15');
  return { rid: r.id, ids: [a.id, b.id, c.id] };
}

const post = (url: string, token = owner.token, body: unknown = {}) =>
  request(app).post(url).set('Authorization', `Bearer ${token}`).send(body as object);

const getRundown = async (rid: string) => {
  const res = await request(app).get(`${BASE()}/${rid}`).set('Authorization', `Bearer ${owner.token}`);
  expect(res.status).toBe(200);
  return res.body.rundown;
};

beforeEach(async () => {
  owner = await createSuperAdmin();
  const creator = (await User.findOne())!._id;
  creatorId = creator.toString();
  await InviteCode.create({ code: 'C1', createdBy: creator });
  staff = await registerUser('C1', 's@example.com', 'Staff');
  const p = await request(app)
    .post('/api/projects')
    .set('Authorization', `Bearer ${owner.token}`)
    .send({ name: '活动' });
  projectId = p.body.project.id;
  await invite(owner.token, staff, '一般staff');
});

describe('stage rundown execution', () => {
  it('start 默认首项：进入 running 且记录首项 actual', async () => {
    const { rid, ids } = await rundownWith3();
    const res = await post(EXEC(rid, 'start'));
    expect(res.status).toBe(200);
    const e = res.body.rundown.execution;
    expect(e.status).toBe('running');
    expect(e.currentItemId).toBe(ids[0]);
    expect(e.actuals).toHaveLength(1);
    expect(e.actuals[0]).toMatchObject({ itemId: ids[0], endedAt: null });
    expect(e.startedAt).toBeTruthy();
    expect(e.finishedAt).toBeNull();
    expect(e.shiftMin).toBe(0);
  });

  it('start 指定第三项', async () => {
    const { rid, ids } = await rundownWith3();
    const res = await post(EXEC(rid, 'start'), owner.token, { itemId: ids[2] });
    expect(res.status).toBe(200);
    expect(res.body.rundown.execution.currentItemId).toBe(ids[2]);
  });

  it('start 边界：空节目单 400、坏 itemId 400、重复 start 409、staff 403', async () => {
    const empty = await createRundown();
    expect((await post(EXEC(empty.id, 'start'))).status).toBe(400);

    const { rid } = await rundownWith3();
    expect((await post(EXEC(rid, 'start'), owner.token, { itemId: 'ffffffffffffffffffffffff' })).status).toBe(400);
    expect((await post(EXEC(rid, 'start'), staff.token)).status).toBe(403);

    await post(EXEC(rid, 'start'));
    const again = await post(EXEC(rid, 'start'));
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_RUNNING');
  });

  it('advance：推进到下一项并最终 finished', async () => {
    const { rid, ids } = await rundownWith3();
    await post(EXEC(rid, 'start'));
    const adv1 = await post(EXEC(rid, 'advance'));
    expect(adv1.status).toBe(200);
    let e = adv1.body.rundown.execution;
    expect(e.currentItemId).toBe(ids[1]);
    expect(e.actuals.find((a: { itemId: string }) => a.itemId === ids[0]).endedAt).toBeTruthy();

    await post(EXEC(rid, 'advance'));
    const adv3 = await post(EXEC(rid, 'advance'));
    e = adv3.body.rundown.execution;
    expect(e.status).toBe('finished');
    expect(e.finishedAt).toBeTruthy();
    expect(e.currentItemId).toBeNull();
  });

  it('advance 非 running 409', async () => {
    const { rid } = await rundownWith3();
    const res = await post(EXEC(rid, 'advance'));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NOT_RUNNING');
  });

  it('jump：跳转记录 actual，回跳替换旧记录，跳当前幂等', async () => {
    const { rid, ids } = await rundownWith3();
    await post(EXEC(rid, 'start'));
    const res = await post(EXEC(rid, 'jump'), owner.token, { itemId: ids[2] });
    expect(res.status).toBe(200);
    let e = res.body.rundown.execution;
    expect(e.currentItemId).toBe(ids[2]);
    expect(e.actuals).toHaveLength(2);
    expect(e.actuals.find((a: { itemId: string }) => a.itemId === ids[0]).endedAt).toBeTruthy();

    // 跳回首项：旧 actual 被替换（仍 2 条，首项重新计时）
    const back = await post(EXEC(rid, 'jump'), owner.token, { itemId: ids[0] });
    e = back.body.rundown.execution;
    expect(e.actuals).toHaveLength(2);
    expect(e.actuals.find((a: { itemId: string }) => a.itemId === ids[0]).endedAt).toBeNull();

    // 跳当前项幂等：actuals 不变
    const same = await post(EXEC(rid, 'jump'), owner.token, { itemId: ids[0] });
    expect(same.body.rundown.execution.actuals).toEqual(e.actuals);

    expect((await post(EXEC(rid, 'jump'), owner.token, {})).status).toBe(400);
    expect((await post(EXEC(rid, 'jump'), owner.token, { itemId: 'ffffffffffffffffffffffff' })).status).toBe(400);
  });

  it('jump 非 running 409', async () => {
    const { rid, ids } = await rundownWith3();
    const res = await post(EXEC(rid, 'jump'), owner.token, { itemId: ids[1] });
    expect(res.status).toBe(409);
  });

  it('shift：累加与边界（±240 单步、±1440 累计、整数校验）', async () => {
    const { rid } = await rundownWith3();
    expect((await post(EXEC(rid, 'shift'), owner.token, { minutes: 10 })).status).toBe(409); // 非 running
    await post(EXEC(rid, 'start'));

    let res = await post(EXEC(rid, 'shift'), owner.token, { minutes: 10 });
    expect(res.body.rundown.execution.shiftMin).toBe(10);
    res = await post(EXEC(rid, 'shift'), owner.token, { minutes: -5 });
    expect(res.body.rundown.execution.shiftMin).toBe(5);

    for (const bad of ['abc', 1.5, 241, -241]) {
      expect((await post(EXEC(rid, 'shift'), owner.token, { minutes: bad })).status).toBe(400);
    }
    // 当前 5；+240×6 = 1445 > 1440 → 最后一次 400
    for (let i = 0; i < 5; i++) await post(EXEC(rid, 'shift'), owner.token, { minutes: 240 });
    const overflow = await post(EXEC(rid, 'shift'), owner.token, { minutes: 240 });
    expect(overflow.status).toBe(400);
  });

  it('finish：结束执行并封存当前 actual；非 running 409', async () => {
    const { rid, ids } = await rundownWith3();
    await post(EXEC(rid, 'start'));
    const res = await post(EXEC(rid, 'finish'));
    expect(res.status).toBe(200);
    const e = res.body.rundown.execution;
    expect(e.status).toBe('finished');
    expect(e.finishedAt).toBeTruthy();
    expect(e.currentItemId).toBeNull();
    expect(e.actuals.find((a: { itemId: string }) => a.itemId === ids[0]).endedAt).toBeTruthy();

    expect((await post(EXEC(rid, 'finish'))).status).toBe(409);
  });

  it('reset：任何状态回 idle 初始态；idle 幂等', async () => {
    const { rid } = await rundownWith3();
    await post(EXEC(rid, 'start'));
    await post(EXEC(rid, 'shift'), owner.token, { minutes: 15 });
    const res = await post(EXEC(rid, 'reset'));
    expect(res.status).toBe(200);
    expect(res.body.rundown.execution).toMatchObject({
      status: 'idle',
      currentItemId: null,
      startedAt: null,
      finishedAt: null,
      shiftMin: 0,
      actuals: [],
    });
    const again = await post(EXEC(rid, 'reset'));
    expect(again.status).toBe(200);
    expect(again.body.rundown.execution.status).toBe('idle');
  });

  it('finished 后可重新 start：清旧记录重新执行', async () => {
    const { rid, ids } = await rundownWith3();
    await post(EXEC(rid, 'start'));
    await post(EXEC(rid, 'finish'));
    const res = await post(EXEC(rid, 'start'), owner.token, { itemId: ids[1] });
    expect(res.status).toBe(200);
    const e = res.body.rundown.execution;
    expect(e.status).toBe('running');
    expect(e.currentItemId).toBe(ids[1]);
    expect(e.actuals).toHaveLength(1);
    expect(e.shiftMin).toBe(0);
  });

  it('执行中锁定编排：增/删/改/删 Rundown/改 startAt 全 409，name 可改', async () => {
    const { rid, ids } = await rundownWith3();
    await post(EXEC(rid, 'start'));

    const auth = (r: request.Test) => r.set('Authorization', `Bearer ${owner.token}`);
    const cases: { req: request.Test }[] = [
      { req: request(app).post(`${BASE()}/${rid}/items`).field('name', 'X').field('durationMin', '10') },
      { req: request(app).patch(`${BASE()}/${rid}/items/${ids[0]}`).field('name', 'X') },
      { req: request(app).delete(`${BASE()}/${rid}/items/${ids[0]}`) },
      { req: request(app).delete(`${BASE()}/${rid}`) },
      { req: request(app).patch(`${BASE()}/${rid}`).send({ startAt: '2026-10-18T10:00:00+08:00' }) },
    ];
    for (const { req } of cases) {
      const res = await auth(req);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('EXECUTION_RUNNING');
    }

    const rename = await request(app)
      .patch(`${BASE()}/${rid}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: '改名了' });
    expect(rename.status).toBe(200);
    expect(rename.body.rundown.name).toBe('改名了');

    // finish 后恢复编排
    await post(EXEC(rid, 'finish'));
    const add = await request(app)
      .post(`${BASE()}/${rid}/items`)
      .set('Authorization', `Bearer ${owner.token}`)
      .field('name', '返场')
      .field('durationMin', '5');
    expect(add.status).toBe(201);
  });

  it('执行中排序：未执行节目槽位内可重排，动当前/已演位置 409', async () => {
    const { rid, ids } = await rundownWith3();
    await post(EXEC(rid, 'start')); // current = ids[0]

    const auth = (r: request.Test) => r.set('Authorization', `Bearer ${owner.token}`);
    // 交换两个未执行节目 → 200 且顺序落库
    const ok = await auth(
      request(app).patch(`${BASE()}/${rid}/items/reorder`).send({ order: [ids[0], ids[2], ids[1]] }),
    );
    expect(ok.status).toBe(200);
    expect(ok.body.rundown.items.map((it: { id: string }) => it.id)).toEqual([ids[0], ids[2], ids[1]]);
    // 当前节目被挤位 → 409
    const moveCurrent = await auth(
      request(app).patch(`${BASE()}/${rid}/items/reorder`).send({ order: [ids[2], ids[0], ids[1]] }),
    );
    expect(moveCurrent.status).toBe(409);
    expect(moveCurrent.body.error.code).toBe('EXECUTION_RUNNING');
    // 推进后已演节目位置同样锁定
    await post(EXEC(rid, 'advance'), owner.token); // ids[0] done，current = ids[2]
    const moveDone = await auth(
      request(app).patch(`${BASE()}/${rid}/items/reorder`).send({ order: [ids[2], ids[0], ids[1]] }),
    );
    expect(moveDone.status).toBe(409);
    expect(moveDone.body.error.code).toBe('EXECUTION_RUNNING');
  });

  it('序列化：详情 execution 全键；列表 executionStatus', async () => {
    const { rid } = await rundownWith3();
    const detail = await getRundown(rid);
    expect(Object.keys(detail.execution).sort()).toEqual(
      ['actuals', 'currentItemId', 'finishedAt', 'shiftMin', 'startedAt', 'status'].sort(),
    );
    const list = await request(app).get(BASE()).set('Authorization', `Bearer ${owner.token}`);
    expect(list.status).toBe(200);
    expect(list.body.rundowns[0].executionStatus).toBe('idle');
  });

  it('旧文档兼容：无 execution 字段按 idle 读取且可 start', async () => {
    const ins = await mongoose.connection.db!.collection('stagerundowns').insertOne({
      projectId: new Types.ObjectId(projectId),
      name: '旧格式',
      startAt: new Date('2026-10-17T10:00:00+08:00'),
      note: '',
      items: [
        { _id: new Types.ObjectId(), name: 'A', durationMin: 10, participants: [], attachmentIds: [], note: '' },
      ],
      createdBy: new Types.ObjectId(owner.user.id),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const rid = ins.insertedId.toString();
    const detail = await getRundown(rid);
    expect(detail.execution).toMatchObject({ status: 'idle', shiftMin: 0, actuals: [] });

    const res = await post(EXEC(rid, 'start'));
    expect(res.status).toBe(200);
    expect(res.body.rundown.execution.status).toBe('running');
  });

  it('screen-share：惰性创建、开关、重置 token；staff 403', async () => {
    const { rid } = await rundownWith3();
    const first = await request(app)
      .get(`${BASE()}/${rid}/screen-share`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(first.status).toBe(200);
    expect(first.body.share.enabled).toBe(false);
    expect(first.body.share.token).toBeTruthy();

    const on = await request(app)
      .put(`${BASE()}/${rid}/screen-share`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ enabled: true });
    expect(on.body.share.enabled).toBe(true);

    const regen = await request(app)
      .put(`${BASE()}/${rid}/screen-share`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ regenerate: true });
    expect(regen.body.share.token).not.toBe(first.body.share.token);

    const forbidden = await request(app)
      .get(`${BASE()}/${rid}/screen-share`)
      .set('Authorization', `Bearer ${staff.token}`);
    expect(forbidden.status).toBe(403);
  });

  it('公开端点：白名单字段、开关与坏 token', async () => {
    const { rid } = await rundownWith3();
    const share = (
      await request(app)
        .put(`${BASE()}/${rid}/screen-share`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ enabled: true })
    ).body.share;

    const res = await request(app).get(`/api/public/rundown-screen/${share.token}`);
    expect(res.status).toBe(200);
    expect(res.body.projectName).toBe('活动');
    expect(res.body.now).toBeTruthy();
    expect(res.body.rundown.execution.status).toBe('idle');
    const item = res.body.rundown.items[0];
    expect(Object.keys(item).sort()).toEqual(['durationMin', 'id', 'name', 'participants']);

    // 关闭后 404；坏 token 404
    await request(app)
      .put(`${BASE()}/${rid}/screen-share`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ enabled: false });
    expect((await request(app).get(`/api/public/rundown-screen/${share.token}`)).status).toBe(404);
    expect((await request(app).get('/api/public/rundown-screen/no-such-token')).status).toBe(404);
  });

  it('公开端点 participants 仅 cn（contact 不外泄）', async () => {
    const r = await createRundown();
    await request(app)
      .post(`${BASE()}/${r.id}/items`)
      .set('Authorization', `Bearer ${owner.token}`)
      .field('name', 'A')
      .field('durationMin', '10')
      .field('participants', JSON.stringify([{ cn: '阿喵', contact: 'QQ 11001001' }]))
      .field('note', '内部备注');
    const share = (
      await request(app)
        .put(`${BASE()}/${r.id}/screen-share`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ enabled: true })
    ).body.share;

    const res = await request(app).get(`/api/public/rundown-screen/${share.token}`);
    expect(res.status).toBe(200);
    const item = res.body.rundown.items[0];
    expect(item.participants).toEqual([{ cn: '阿喵' }]);
    expect(item).not.toHaveProperty('note');
    expect(item).not.toHaveProperty('attachments');
  });

  it('公开公告白名单：仅未过期 emergency 且 visibility 为空的上屏', async () => {
    const { rid } = await rundownWith3();
    const share = (
      await request(app)
        .put(`${BASE()}/${rid}/screen-share`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ enabled: true })
    ).body.share;

    const base = { projectId: new Types.ObjectId(projectId), content: '', publishedBy: new Types.ObjectId(owner.user.id) };
    await Announcement.create({ ...base, title: '全员紧急', type: 'emergency', visibility: { userIds: [], roleNames: [] } });
    await Announcement.create({ ...base, title: '受限紧急', type: 'emergency', visibility: { userIds: [], roleNames: ['摄影组'] } });
    await Announcement.create({ ...base, title: '重要非紧急', type: 'important', visibility: { userIds: [], roleNames: [] } });
    await Announcement.create({
      ...base,
      title: '已过期紧急',
      type: 'emergency',
      visibility: { userIds: [], roleNames: [] },
      expiresAt: new Date(Date.now() - 3600_000),
    });

    const res = await request(app).get(`/api/public/rundown-screen/${share.token}`);
    expect(res.status).toBe(200);
    expect(res.body.announcements.map((a: { title: string }) => a.title)).toEqual(['全员紧急']);
  });

  it('onsite 聚合：running 含当前节目信息、窗口内 idle 出现、finished 不出现', async () => {
    // running（开始时间在窗口外也应出现）
    const r1 = await createRundown('执行中', '2026-10-17T10:00:00+08:00');
    const a1 = await addItem(r1.id, '开场');
    await addItem(r1.id, '第二');
    await post(EXEC(r1.id, 'start'));
    await post(EXEC(r1.id, 'shift'), owner.token, { minutes: 5 });

    // 窗口内 idle
    const r2 = await createRundown('待开始', new Date(Date.now() + 3600_000).toISOString());
    await addItem(r2.id, 'X');

    // finished 不出现
    const r3 = await createRundown('已结束', new Date().toISOString());
    await addItem(r3.id, 'Y');
    await post(EXEC(r3.id, 'start'));
    await post(EXEC(r3.id, 'finish'));

    const res = await request(app)
      .get(`/api/projects/${projectId}/onsite`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(
      (res.body.rundowns as Record<string, unknown>[]).map((x) => [x.id as string, x]),
    ) as Record<string, Record<string, unknown>>;

    const running = byId[r1.id];
    expect(running).toBeTruthy();
    expect(running.status).toBe('running');
    expect(running.currentItemName).toBe('开场');
    expect(running.currentIndex).toBe(0);
    expect(running.currentItemId).toBe(a1.id);
    expect(running.shiftMin).toBe(5);
    expect(running.currentPlannedStart).toBeTruthy();
    expect(running.currentActualStart).toBeTruthy();

    const idle = byId[r2.id];
    expect(idle).toBeTruthy();
    expect(idle.status).toBe('idle');
    expect(idle.currentItemId).toBeNull();
    expect(idle.shiftMin).toBe(0);

    expect(byId[r3.id]).toBeUndefined();
  });
});
