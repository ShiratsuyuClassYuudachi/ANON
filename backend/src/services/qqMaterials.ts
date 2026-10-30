import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { config } from '../config';
import { Membership } from '../models/Membership';
import { File, type FileDoc } from '../models/File';
import { Resource, type ResourceDoc } from '../models/Resource';
import { ResourceType } from '../models/ResourceType';
import { ResourceVersion } from '../models/ResourceVersion';
import type { ProjectDoc } from '../models/Project';
import type { UserDoc } from '../models/User';
import { AppError } from '../utils/errors';
import { logActivity } from './activity';
import { downloadQqAttachment } from './qqAttachments';
import { sendC2CMessage, sendGroupMessage } from './qqApi';
import { checkedQqProject, qqProjects, qqSessionKey, resolveQqUser, serializeQqMessage, type QqMessage } from './qqContext';
import { generatePreview } from './preview';
import { deleteStored, storeBuffer } from './storage';
import { canSeeMaterialCategory, indexMaterialCategories } from './materialVisibility';

type Staged = { filename: string; mime: string; size: number; path: string };
type Draft = { userId: string; files: Staged[]; description: string; seenIds: Set<string> } & (
  | { step: 'project'; projectIds: string[] }
  | { step: 'type'; projectId: string; typeIds: string[] }
  | { step: 'collect'; projectId: string; typeId: string | null }
);
type State = Draft & { expiresAt: number; timer: ReturnType<typeof setTimeout> };
const sessions = new Map<string, State>();
const TTL = 30 * 60_000;
const TOTAL_LIMIT = 50 * 1024 * 1024;
const START = /^(开始上传物料|开始物料|开始上传)$/;
const END = /^(结束上传物料|结束物料|结束上传)$/;
const CANCEL = /^(取消上传物料|取消物料|取消上传|取消|0)$/;
const reply = (d: QqMessage, text: string) => d.group_openid
  ? sendGroupMessage(d.group_openid, text, { msgId: d.id }) : sendC2CMessage(d.author!.user_openid!, text, { msgId: d.id });

async function cleanFiles(files: Staged[]): Promise<void> {
  await Promise.all(files.map(async (f) => { await fs.unlink(f.path).catch(() => {}); await fs.rmdir(path.dirname(f.path)).catch(() => {}); }));
}
export async function clearQqMaterials(d: QqMessage): Promise<void> {
  const key = qqSessionKey(d);
  const state = key ? sessions.get(key) : undefined;
  if (!key || !state) return;
  sessions.delete(key); clearTimeout(state.timer);
  await cleanFiles(state.files);
}
export function hasQqMaterials(d: QqMessage): boolean {
  const key = qqSessionKey(d);
  return !!key && sessions.has(key);
}

function save(d: QqMessage, data: Draft): void {
  const key = qqSessionKey(d)!;
  const previous = sessions.get(key);
  if (previous) clearTimeout(previous.timer);
  const state = { ...data, expiresAt: Date.now() + TTL, timer: setTimeout(() => {
    // 下载与提交通过事件队列串行；到期只回收仍指向同一个草稿的内容。
    void serializeQqMessage(d, async () => {
      if (sessions.get(key) === state) await clearQqMaterials(d);
    });
  }, TTL) } as State;
  state.timer.unref(); sessions.set(key, state);
}

async function visibleTypes(user: UserDoc, project: ProjectDoc) {
  const member = await Membership.findOne({ projectId: project._id, userId: user._id }).lean();
  const types = await ResourceType.find({ projectId: project._id }).sort({ createdAt: 1, _id: 1 });
  const viewer = { userId: String(user._id), roleName: member?.roleName ?? null, isSuperAdmin: user.isSuperAdmin };
  const categoryMap = indexMaterialCategories(types);
  return types.filter((t) => canSeeMaterialCategory(viewer, t, categoryMap));
}

function materialTypeLabel(
  type: Awaited<ReturnType<typeof visibleTypes>>[number],
  categories: Awaited<ReturnType<typeof visibleTypes>>,
  visibleCategories: Awaited<ReturnType<typeof visibleTypes>>,
): string {
  if (!type.parentId) return type.name;
  const parent = categories.find((category) => String(category._id) === String(type.parentId));
  const visibleParent = parent && visibleCategories.some((category) => String(category._id) === String(parent._id));
  return `${visibleParent ? parent.name : '受限类别'} / ${type.name}`;
}

async function beginCollect(d: QqMessage, user: UserDoc, project: ProjectDoc, typeId: string | null): Promise<void> {
  save(d, { step: 'collect', userId: String(user._id), projectId: String(project._id), typeId, files: [], description: '', seenIds: new Set(d.id ? [d.id] : []) });
  await reply(d, `已开始上传物料，活动：${project.name}。\n请逐条发送文件或图片，文字将作为物料说明。单文件最多20MB，每次最多10个、合计50MB。\n发完发送「结束上传物料」保存，发送「取消上传物料」放弃，30分钟无操作后过期。${typeId === null ? '\n暂无分类，保存时会新建「QQ上传」分类。' : ''}${d.group_openid ? '\n群内文件和控制消息请继续 @我；QQ 未回传的文件可改用私聊或网页上传。' : ''}`);
}
async function chooseType(d: QqMessage, user: UserDoc, project: ProjectDoc): Promise<void> {
  const types = await visibleTypes(user, project);
  if (!types.length && await ResourceType.exists({ projectId: project._id })) {
    throw new AppError(403, 'forbidden', '本项目暂无对你可见的物料分类，请先在网页创建或调整可见范围。');
  }
  if (types.length <= 1) { await beginCollect(d, user, project, types[0] ? String(types[0]._id) : null); return; }
  const categories = await ResourceType.find({ projectId: project._id }).sort({ createdAt: 1, _id: 1 });
  save(d, { step: 'type', userId: String(user._id), projectId: String(project._id), typeIds: types.map((t) => String(t._id)), files: [], description: '', seenIds: new Set(d.id ? [d.id] : []) });
  await reply(d, `请选择物料分类，回复序号（0 取消）：\n${types.map((t, i) => `${i + 1}. ${materialTypeLabel(t, categories, types)}`).join('\n')}`);
}

async function persistMaterial(file: Staged, description: string, user: UserDoc, project: ProjectDoc, typeId: string): Promise<void> {
  let stored: string | null = null;
  let preview: string | null = null;
  let doc: FileDoc | null = null;
  let resource: ResourceDoc | null = null;
  try {
    stored = await storeBuffer(await fs.readFile(file.path), `qq-materials/${crypto.randomUUID()}${path.extname(file.filename).slice(0, 20)}`, file.mime);
    if (['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.mime)) preview = await generatePreview(file.path);
    doc = await File.create({ projectId: project._id, uploadedBy: user._id, filename: file.filename, mime: file.mime, size: file.size, path: stored });
    resource = await Resource.create({ projectId: project._id, typeId, name: file.filename, description });
    await ResourceVersion.create({ resourceId: resource._id, version: 1, fileId: doc._id, previewPath: preview, note: 'QQ机器人上传', createdBy: user._id });
  } catch (err) {
    if (resource) { await ResourceVersion.deleteMany({ resourceId: resource._id }); await resource.deleteOne(); }
    if (doc) await doc.deleteOne();
    if (preview) await deleteStored(preview);
    if (stored) await deleteStored(stored);
    throw err;
  }
  logActivity({ projectId: project._id, actorId: user._id, type: 'material:create',
    message: `${user.name}创建了资源「${file.filename}」`, sourceType: 'material', sourceId: resource!._id });
}

async function process(d: QqMessage): Promise<boolean> {
  const content = (d.content ?? '').trim();
  const key = qqSessionKey(d);
  const marker = START.test(content) || END.test(content) || /^(取消上传物料|取消物料|取消上传)$/.test(content);
  if (!d.id || !key) {
    if (marker && d.id && (d.group_openid || d.author?.user_openid)) await reply(d, '请先绑定个人账号后再上传物料。');
    return marker;
  }
  let state = sessions.get(key);
  if (state && state.expiresAt <= Date.now()) { await clearQqMaterials(d); state = undefined; }
  if (!state && !marker) return false;
  if (state?.seenIds.has(d.id)) return true;
  state?.seenIds.add(d.id);
  if (CANCEL.test(content)) { await clearQqMaterials(d); await reply(d, state ? '已取消上传，暂存文件已清理。' : '当前没有进行中的物料上传。'); return true; }
  const user = await resolveQqUser(d);
  if (!user || (state && String(user._id) !== state.userId)) throw new AppError(403, 'forbidden', '请先绑定个人账号；若绑定已变化，请重新发送「开始上传物料」。');
  if (START.test(content)) {
    if (state) { await reply(d, '已有物料上传进行中，请先发送「结束上传物料」或「取消上传物料」。'); return true; }
    if (sessions.size >= 100) throw new AppError(429, 'busy', '当前上传会话较多，请稍后重试。');
    const projects = await qqProjects(d, user, 'material');
    if (!projects.length) throw new AppError(403, 'forbidden', '没有可上传物料的活动，请检查群绑定、活动状态及物料管理权限。');
    if (projects.length === 1) await chooseType(d, user, projects[0]);
    else {
      save(d, { step: 'project', userId: String(user._id), projectIds: projects.map((p) => String(p._id)), files: [], description: '', seenIds: new Set(d.id ? [d.id] : []) });
      await reply(d, `上传到哪个活动？回复序号（0 取消）：\n${projects.map((p, i) => `${i + 1}. ${p.name}`).join('\n')}`);
    }
    return true;
  }
  if (!state) { await reply(d, '当前没有进行中的物料上传，可能已过期。请发送「开始上传物料」。'); return true; }
  if (state.step !== 'collect') {
    const ids = state.step === 'project' ? state.projectIds : state.typeIds;
    const index = Number(content) - 1;
    if (!/^\d+$/.test(content) || !Number.isSafeInteger(index) || index < 0 || index >= ids.length) {
      await reply(d, `请先回复 1-${ids.length} 选择${state.step === 'project' ? '活动' : '分类'}，或 0 取消；选好后再发送文件。`); return true;
    }
    const project = await checkedQqProject(d, user, state.step === 'project' ? ids[index] : state.projectId, 'material');
    if (state.step === 'project') await chooseType(d, user, project);
    else {
      if (!(await visibleTypes(user, project)).some((t) => String(t._id) === ids[index])) throw new AppError(403, 'forbidden', '分类已不存在或不可见，请重新开始上传。');
      await beginCollect(d, user, project, ids[index]);
    }
    return true;
  }
  const project = await checkedQqProject(d, user, state.projectId, 'material');
  const types = await visibleTypes(user, project);
  const selectedTypeId = state.typeId;
  if (selectedTypeId && !types.some((t) => String(t._id) === selectedTypeId)) throw new AppError(403, 'forbidden', '分类已删除或对你不可见，请重新开始上传。');
  // 清掉定时器；同发送者队列保证处理结束前不会同时提交/取消。
  clearTimeout(state.timer);
  if (END.test(content)) {
    if (!state.files.length) { await clearQqMaterials(d); await reply(d, '本次未收到文件或图片，没有创建物料。'); return true; }
    let typeId = state.typeId;
    if (!typeId) {
      const existing = types.find((t) => t.name === 'QQ上传');
      typeId = String(existing?._id ?? (await ResourceType.create({ projectId: project._id, name: 'QQ上传' }))._id);
    }
    const failed: Staged[] = [];
    let saved = 0;
    for (const file of state.files) {
      try { await persistMaterial(file, state.description, user, project, typeId); saved++; await cleanFiles([file]); }
      catch { failed.push(file); }
    }
    sessions.delete(key);
    if (failed.length) save(d, { ...state, typeId, files: failed });
    const delivered = await reply(d, `已保存 ${saved} 个物料到「${project.name}」。${failed.length ? `\n${failed.length} 个保存失败，已保留暂存文件，可再次发送「结束上传物料」重试，或取消。` : ''}${config.publicBaseUrl ? `\n查看：${config.publicBaseUrl}/p/${project._id}?tab=materials` : ''}`).catch(() => false);
    if (!delivered) console.error('[qq-materials] 物料已保存，但结果回复失败');
    return true;
  }
  if (d.message_type === 102 || d.message_type === 103) {
    save(d, state);
    await reply(d, '上传物料请直接发送文件或图片，转发聊天记录不能作为物料附件。'); return true;
  }
  const attachments = Array.isArray(d.attachments) ? d.attachments : [];
  let accepted = 0;
  const errors: string[] = [];
  for (const attachment of attachments) {
    if (state.files.length >= 10) { errors.push('每次最多10个文件，请结束本次上传后分批发送。'); break; }
    try {
      const file = await downloadQqAttachment(attachment, TOTAL_LIMIT - state.files.reduce((n, f) => n + f.size, 0));
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'anon-qq-material-'));
      const tmp = path.join(dir, 'file');
      try { await fs.writeFile(tmp, file.buffer); } catch (err) { await fs.rmdir(dir).catch(() => {}); throw err; }
      state.files.push({ filename: file.filename, mime: file.mime, size: file.buffer.length, path: tmp }); accepted++;
    } catch (err) { errors.push(err instanceof AppError ? err.message : '附件下载失败，请重新发送。'); }
  }
  if (content && attachments.length === 0 && state.description.length < 4000) state.description = [state.description, content].filter(Boolean).join('\n').slice(0, 4000);
  save(d, state);
  await reply(d, `${attachments.length ? `本条收到 ${accepted} 个附件，本次共 ${state.files.length} 个。` : '已记录物料说明。'}${errors.length ? `\n${errors.join('\n')}` : ''}\n发完请发送「结束上传物料」。`);
  return true;
}

export async function handleQqMaterials(d: QqMessage): Promise<boolean> {
  try { return await process(d); }
  catch (err) {
    await clearQqMaterials(d);
    console.error('[qq-materials] 上传失败:', err instanceof AppError ? err.code : 'internal');
    await reply(d, err instanceof AppError ? err.message : '物料上传失败，请重新发送「开始上传物料」。').catch(() => {});
    return true;
  }
}
