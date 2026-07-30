import { Schema, model, models, type HydratedDocument, type Model, type Types } from 'mongoose';

export interface IRole {
  name: string;
  permissions: string[];
}

export interface ITicketType {
  name: string;
  priceCents: number;
  count: number;
}

export type ProjectStatus = 'draft' | 'preparing' | 'active' | 'settling' | 'completed' | 'archived' | 'cancelled';

export interface IProject {
  name: string;
  description: string;
  status: ProjectStatus;
  startDate?: Date;
  endDate?: Date;
  location: string;
  timezone: string;
  currentStage: string;
  createdBy: Types.ObjectId;
  roles: IRole[];
  ticketPriceCents: number;
  ticketCount: number;
  ticketTypes: ITicketType[];
}

export type ProjectDoc = HydratedDocument<IProject>;

const schema = new Schema<IProject>(
  {
    name: { type: String, required: true },
    description: { type: String, default: '' },
    status: { type: String, enum: ['draft', 'preparing', 'active', 'settling', 'completed', 'archived', 'cancelled'], default: 'preparing' },
    startDate: Date,
    endDate: Date,
    location: { type: String, default: '' },
    timezone: { type: String, default: 'Asia/Shanghai' },
    currentStage: { type: String, default: '' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    roles: [{ name: String, permissions: [String], _id: false }],
    ticketPriceCents: { type: Number, default: 0 },
    ticketCount: { type: Number, default: 0 },
    ticketTypes: { type: [{ name: String, priceCents: Number, count: Number, _id: false }], default: [] },
  },
  { timestamps: true },
);

// vitest 在同一 fork 中跨测试文件复用外部化的 mongoose 实例，模型需幂等注册
export const Project: Model<IProject> = models.Project ?? model<IProject>('Project', schema);
