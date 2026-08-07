import { Schema, model, models, type HydratedDocument, type Model, type Types } from 'mongoose';

export interface IStageParticipant {
  cn: string;
  contact: string;
}

export interface IStageRundownItem {
  _id: Types.ObjectId;
  name: string;
  durationMin: number;
  participants: IStageParticipant[];
  attachmentIds: Types.ObjectId[];
  note: string;
}

export interface IStageRundown {
  projectId: Types.ObjectId;
  name: string;
  startAt: Date;
  note: string;
  items: Types.DocumentArray<IStageRundownItem>;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export type StageRundownDoc = HydratedDocument<IStageRundown>;

const schema = new Schema<IStageRundown>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    name: { type: String, required: true },
    startAt: { type: Date, required: true },
    note: { type: String, default: '' },
    items: {
      type: [
        {
          name: { type: String, required: true },
          durationMin: { type: Number, required: true },
          participants: {
            type: [
              {
                _id: false,
                cn: { type: String, required: true },
                contact: { type: String, default: '' },
              },
            ],
            default: [],
          },
          attachmentIds: [{ type: Schema.Types.ObjectId, ref: 'File' }],
          note: { type: String, default: '' },
        },
      ],
      default: [],
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);
schema.index({ projectId: 1, startAt: 1 });

// vitest 在同一 fork 中跨测试文件复用外部化的 mongoose 实例，模型需幂等注册
export const StageRundown: Model<IStageRundown> = models.StageRundown ?? model<IStageRundown>('StageRundown', schema);
