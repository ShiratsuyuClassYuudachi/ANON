import { Schema, model, models, type HydratedDocument, type Model, type Types } from 'mongoose';

export interface IStageParticipant {
  cn: string;
  contact: string;
}

export type StageExecutionStatus = 'idle' | 'running' | 'finished';

export interface IStageActual {
  itemId: Types.ObjectId;
  startedAt: Date;
  endedAt: Date | null;
}

/** 执行状态：计划数据（startAt/durationMin）执行期不改写，实际记录全在此子文档 */
export interface IStageExecution {
  status: StageExecutionStatus;
  currentItemId: Types.ObjectId | null;
  startedAt: Date | null; // 首个节目实际上场时刻
  finishedAt: Date | null;
  shiftMin: number; // 顺延累积（分钟，可负=提前）
  actuals: IStageActual[]; // 每节目至多一条（最近一次执行）
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
  execution: IStageExecution;
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
    execution: {
      type: new Schema<IStageExecution>(
        {
          status: { type: String, enum: ['idle', 'running', 'finished'], default: 'idle' },
          currentItemId: { type: Schema.Types.ObjectId, default: null },
          startedAt: { type: Date, default: null },
          finishedAt: { type: Date, default: null },
          shiftMin: { type: Number, default: 0 },
          actuals: {
            type: [
              {
                _id: false,
                itemId: { type: Schema.Types.ObjectId, required: true },
                startedAt: { type: Date, required: true },
                endedAt: { type: Date, default: null },
              },
            ],
            default: [],
          },
        },
        { _id: false },
      ),
      default: () => ({ status: 'idle', currentItemId: null, startedAt: null, finishedAt: null, shiftMin: 0, actuals: [] }),
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);
schema.index({ projectId: 1, startAt: 1 });

// vitest 在同一 fork 中跨测试文件复用外部化的 mongoose 实例，模型需幂等注册
export const StageRundown: Model<IStageRundown> = models.StageRundown ?? model<IStageRundown>('StageRundown', schema);
