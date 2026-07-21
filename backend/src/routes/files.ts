import path from 'path';
import { Router } from 'express';
import { authRequired } from '../middleware/auth';
import { requirePermission } from '../middleware/projectAccess';
import { upload, fixFilename } from '../middleware/upload';
import { File } from '../models/File';
import { Membership } from '../models/Membership';
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
    const doc = await File.create({
      projectId: req.project!._id,
      filename: fixFilename(req.file.originalname),
      path: req.file.path,
      mime: req.file.mimetype,
      size: req.file.size,
      uploadedBy: req.userId,
    });
    res.status(201).json({
      file: { id: doc._id.toString(), filename: doc.filename, mime: doc.mime, size: doc.size },
    });
  }),
);

export const filesRouter = Router();
filesRouter.use(authRequired);

filesRouter.get(
  '/:id',
  ah(async (req, res) => {
    const doc = await File.findById(req.params.id);
    if (!doc) throw new AppError(404, 'not_found', '文件不存在');
    if (!req.user!.isSuperAdmin) {
      const m = await Membership.exists({ projectId: doc.projectId, userId: req.userId });
      if (!m) throw new AppError(403, 'forbidden', '没有权限访问该文件');
    }
    res.download(path.resolve(doc.path), doc.filename);
  }),
);
