import { Router } from 'express';
import { authRequired } from '../middleware/auth';
import { loadMembership, requirePermission } from '../middleware/projectAccess';
import { ApiKey } from '../models/ApiKey';
import { CustomTool, type CustomToolDoc } from '../models/CustomTool';
import { User } from '../models/User';
import { logActivity } from '../services/activity';
import { ALL_PERMISSIONS } from '../services/permissions';
import { ah } from '../utils/async';
import { AppError } from '../utils/errors';
import { signToolLaunchToken } from '../utils/jwt';

export const customToolsRouter = Router({ mergeParams: true });
customToolsRouter.use(authRequired, loadMembership);

function toolJson(t: CustomToolDoc, userName: string) {
  return {
    id: t._id.toString(),
    name: t.name,
    url: t.url,
    description: t.description,
    mode: t.mode,
    passToken: t.passToken,
    scopes: t.scopes,
    createdBy: { userId: t.createdBy.toString(), name: userName },
    createdAt: t.createdAt.toISOString(),
  };
}

interface ToolBody {
  name: string;
  url: string;
  description: string;
  mode: 'embed' | 'link';
  passToken: boolean;
  scopes: string[];
}

function parseToolBody(b: Record<string, unknown>, existing?: CustomToolDoc): ToolBody {
  const name = existing && b.name === undefined ? existing.name : String(b.name ?? '').trim();
  if (!name) throw new AppError(400, 'bad_request', '名称不能为空');
  if (name.length > 50) throw new AppError(400, 'bad_request', '名称过长');
  const url = existing && b.url === undefined ? existing.url : String(b.url ?? '').trim();
  if (url.length > 1000) throw new AppError(400, 'invalid_url', '链接仅支持 http/https');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new AppError(400, 'invalid_url', '链接仅支持 http/https');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new AppError(400, 'invalid_url', '链接仅支持 http/https');
  }
  const mode = b.mode === undefined ? (existing?.mode ?? 'embed') : String(b.mode);
  if (mode !== 'embed' && mode !== 'link') throw new AppError(400, 'bad_request', '无效的打开方式');
  const description = existing && b.description === undefined ? existing.description : String(b.description ?? '').trim();
  if (description.length > 200) throw new AppError(400, 'bad_request', '描述过长');
  const passToken = b.passToken === undefined ? (existing?.passToken ?? false) : b.passToken === true;
  const rawScopes = b.scopes === undefined ? (existing?.scopes ?? []) : Array.isArray(b.scopes) ? b.scopes : [];
  const scopes = rawScopes.map((s) => String(s)).filter((s) => (ALL_PERMISSIONS as readonly string[]).includes(s));
  return { name, url, description, mode, passToken, scopes };
}

customToolsRouter.get(
  '/',
  ah(async (req, res) => {
    const tools = await CustomTool.find({ projectId: req.project!._id }).sort({ createdAt: 1 });
    const userIds = [...new Set(tools.map((t) => t.createdBy.toString()))];
    const users = userIds.length ? await User.find({ _id: { $in: userIds } }).lean() : [];
    const nameById = new Map(users.map((u) => [u._id.toString(), u.name]));
    res.json({ tools: tools.map((t) => toolJson(t, nameById.get(t.createdBy.toString()) ?? '未知用户')) });
  }),
);

customToolsRouter.post(
  '/',
  ...requirePermission('tools:manage'),
  ah(async (req, res) => {
    const body = parseToolBody(req.body ?? {});
    const tool = await CustomTool.create({ ...body, projectId: req.project!._id, createdBy: req.userId });
    logActivity({
      projectId: req.project!._id,
      actorId: req.userId!,
      type: 'customtool:create',
      message: `添加自定义工具「${tool.name}」`,
      sourceType: 'custom_tool',
      sourceId: tool._id,
    });
    res.status(201).json({ tool: toolJson(tool, req.user!.name) });
  }),
);

customToolsRouter.patch(
  '/:toolId',
  ...requirePermission('tools:manage'),
  ah(async (req, res) => {
    const tool = await CustomTool.findOne({ _id: req.params.toolId, projectId: req.project!._id });
    if (!tool) throw new AppError(404, 'not_found', '工具不存在');
    const body = parseToolBody(req.body ?? {}, tool);
    Object.assign(tool, body);
    await tool.save();
    res.json({ tool: toolJson(tool, req.user!.name) });
  }),
);

customToolsRouter.delete(
  '/:toolId',
  ...requirePermission('tools:manage'),
  ah(async (req, res) => {
    const tool = await CustomTool.findOne({ _id: req.params.toolId, projectId: req.project!._id });
    if (!tool) throw new AppError(404, 'not_found', '工具不存在');
    await ApiKey.deleteMany({ toolId: tool._id });
    await tool.deleteOne();
    logActivity({
      projectId: req.project!._id,
      actorId: req.userId!,
      type: 'customtool:delete',
      message: `删除自定义工具「${tool.name}」`,
      sourceType: 'custom_tool',
      sourceId: tool._id,
    });
    res.json({ ok: true });
  }),
);

customToolsRouter.post(
  '/:toolId/launch',
  ah(async (req, res) => {
    const tool = await CustomTool.findOne({ _id: req.params.toolId, projectId: req.project!._id });
    if (!tool) throw new AppError(404, 'not_found', '工具不存在');
    if (!tool.passToken) throw new AppError(400, 'bad_request', '该工具未开启身份携带');
    res.json({
      launchToken: signToolLaunchToken({
        userId: req.userId!,
        toolId: tool._id.toString(),
        projectId: req.project!._id.toString(),
      }),
    });
  }),
);
