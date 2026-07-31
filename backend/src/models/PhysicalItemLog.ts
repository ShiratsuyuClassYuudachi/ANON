import { Schema, model, models, type HydratedDocument, type Model, type Types } from 'mongoose';

export type PhysicalLogType = 'adjust_on_hand' | 'adjust_used' | 'adjust_lost' | 'status_change';

export interface IPhysicalItemLog {
  itemId: Types.ObjectId;
  projectId: Types.ObjectId;
  type: PhysicalLogType;
  qty: number;
  /** status_change 时记录目标状态 */
  status?: string;
  note: string;
  operatorId: Types.ObjectId;
}

export type PhysicalItemLogDoc = HydratedDocument<IPhysicalItemLog>;

const schema = new Schema<IPhysicalItemLog>(
  {
    itemId: { type: Schema.Types.ObjectId, ref: 'PhysicalItem', required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    type: { type: String, enum: ['adjust_on_hand', 'adjust_used', 'adjust_lost', 'status_change'], required: true },
    qty: { type: Number, default: 0 },
    status: { type: String, enum: ['planned', 'in_stock', 'in_use', 'returned', 'disposed'] },
    note: { type: String, default: '' },
    operatorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);
schema.index({ itemId: 1, createdAt: -1 });

export const PhysicalItemLog: Model<IPhysicalItemLog> =
  models.PhysicalItemLog ?? model<IPhysicalItemLog>('PhysicalItemLog', schema);
