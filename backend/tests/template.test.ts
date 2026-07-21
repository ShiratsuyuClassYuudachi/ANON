import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { createSuperAdmin } from './helpers';

let owner: { token: string; user: { id: string } };
let projectId: string;

beforeEach(async () => {
  owner = await createSuperAdmin();
  const p = await request(app)
    .post('/api/projects')
    .set('Authorization', `Bearer ${owner.token}`)
    .send({ name: '活动', startDate: '2026-08-01T00:00:00.000Z' });
  projectId = p.body.project.id;
});

describe('todo template', () => {
  it('导出模板包含相对偏移，导入按新锚点重算时间', async () => {
    await request(app)
      .post(`/api/projects/${projectId}/todos`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        title: '联系场地',
        category: '后勤',
        dueAt: '2026-07-20T00:00:00.000Z', // 开始前 12 天
        remindAt: '2026-07-18T00:00:00.000Z',
      });

    const exp = await request(app)
      .get(`/api/projects/${projectId}/todos/template/export`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(exp.status).toBe(200);
    const tpl = exp.body;
    expect(tpl.anchorField).toBe('start');
    expect(tpl.todos).toHaveLength(1);
    expect(tpl.todos[0].dueOffsetMs).toBe(-12 * 24 * 3600 * 1000);

    const imp = await request(app)
      .post(`/api/projects/${projectId}/todos/template/import`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ template: tpl, anchor: 'start', date: '2026-10-01T00:00:00.000Z' });
    expect(imp.status).toBe(201);
    expect(imp.body.created).toBe(1);

    const list = await request(app)
      .get(`/api/projects/${projectId}/todos?sort=createdAt&order=desc`)
      .set('Authorization', `Bearer ${owner.token}`);
    const imported = list.body.todos[0];
    expect(imported.title).toBe('联系场地');
    expect(new Date(imported.dueAt).toISOString()).toBe('2026-09-19T00:00:00.000Z');
    expect(imported.assignees).toEqual([]);
  });
});
