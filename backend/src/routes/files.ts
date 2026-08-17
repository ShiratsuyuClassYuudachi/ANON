import { Router } from 'express';
import { authRequired, rejectApiKey } from '../middleware/auth';
import { requirePermission } from '../middleware/projectAccess';
import { upload } from '../middleware/upload';
import { File } from '../models/File';
import { Membership } from '../models/Membership';
import { Resource } from '../models/Resource';
import { ResourceType } from '../models/ResourceType';
import { ResourceVersion } from '../models/ResourceVersion';
import { persistUploads, sendStoredFile } from '../services/storage';
import { canSee } from '../services/visibility';
import { ah } from '../utils/async';
import { AppError } from '../utils/errors';

export const projectFilesRouter = Router({ mergeParams: true });
projectFilesRouter.use(authRequired);

projectFilesRouter.post(
  '/',
  ...requirePermission('file:upload'),
  upload.single('file'),
  ah(async (req, res) => {
    if (!req.file) throw new AppError(400, 'bad_request', '缺少文件');
    const [doc] = await persistUploads([req.file], req.project!._id, req.userId);
    res.status(201).json({
      file: { id: doc._id.toString(), filename: doc.filename, mime: doc.mime, size: doc.size },
    });
  }),
);

export const filesRouter = Router();
filesRouter.use(authRequired, rejectApiKey);

filesRouter.get(
  '/:id',
  ah(async (req, res) => {
    const doc = await File.findById(req.params.id);
    if (!doc) throw new AppError(404, 'not_found', '文件不存在');
    if (!req.user!.isSuperAdmin) {
      const m = await Membership.findOne({ projectId: doc.projectId, userId: req.userId });
      if (!m) throw new AppError(403, 'forbidden', '没有权限访问该文件');
      // 资源版本的文件还需过可见范围校验，否则撤销可见性后仍可下载
      const rv = await ResourceVersion.findOne({ fileId: doc._id }).lean();
      if (rv) {
        const resource = await Resource.findById(rv.resourceId).lean();
        const type = resource ? await ResourceType.findById(resource.typeId).lean() : null;
        const visible = canSee(
          { userId: req.userId!, roleName: m.roleName, isSuperAdmin: false },
          resource?.visibility,
          type?.visibility,
        );
        if (!visible) throw new AppError(403, 'forbidden', '没有权限访问该文件');
      }
    }
    await sendStoredFile(res, doc.path, doc.filename);
  }),
);
