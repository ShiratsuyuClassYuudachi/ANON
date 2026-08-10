import { Schema, model, models, type HydratedDocument, type Model, type Types } from 'mongoose';
import type { IStageParticipant } from './StageRundown';

export interface IStageSignupReview {
  userId: Types.ObjectId;
  decision: 'approve' | 'reject';
  comment: string;
  updatedAt: Date;
}

export interface IStageSignupItem {
  _id: Types.ObjectId;
  name: string;
  durationMin: number;
  participants: IStageParticipant[];
  note: string;
  status: 'pending' | 'approved' | 'rejected';
  reviews: IStageSignupReview[];
}

export interface IStageSignup {
  projectId: Types.ObjectId;
  name: string;
  startAt: Date;
  endAt: Date;
  note: string;
  items: Types.DocumentArray<IStageSignupItem>;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export type StageSignupDoc = HydratedDocument<IStageSignup>;

const schema = new Schema<IStageSignup>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    name: { type: String, required: true },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
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
          note: { type: String, default: '' },
          status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
          reviews: {
            type: [
              {
                _id: false,
                userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
                decision: { type: String, enum: ['approve', 'reject'], required: true },
                comment: { type: String, default: '' },
                updatedAt: { type: Date, default: Date.now },
              },
            ],
            default: [],
          },
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
export const StageSignup: Model<IStageSignup> = models.StageSignup ?? model<IStageSignup>('StageSignup', schema);
