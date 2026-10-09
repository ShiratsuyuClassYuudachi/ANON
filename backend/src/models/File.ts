import { Schema, model, models, type HydratedDocument, type Model, type Types } from 'mongoose';

export interface IFile {
  /** 为空表示个人文件（如 QQ 单聊聊天记录导出）：仅上传者本人/超管可下载 */
  projectId?: Types.ObjectId;
  filename: string;
  path: string;
  mime: string;
  size: number;
  uploadedBy: Types.ObjectId;
}

export type FileDoc = HydratedDocument<IFile>;

const schema = new Schema<IFile>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project' },
    filename: { type: String, required: true },
    path: { type: String, required: true },
    mime: { type: String, default: 'application/octet-stream' },
    size: { type: Number, required: true },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

// vitest 在同一 fork 中跨测试文件复用外部化的 mongoose 实例，模型需幂等注册
export const File: Model<IFile> = models.File ?? model<IFile>('File', schema);
