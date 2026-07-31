import { Schema, model, models, type HydratedDocument, type Model, type Types } from 'mongoose';

export type PhysicalItemStatus = 'planned' | 'in_stock' | 'in_use' | 'returned' | 'disposed';

export const PHYSICAL_ITEM_STATUSES: PhysicalItemStatus[] = [
  'planned', 'in_stock', 'in_use', 'returned', 'disposed',
];

export const PHYSICAL_STATUS_LABELS: Record<PhysicalItemStatus, string> = {
  planned: '计划中',
  in_stock: '已入库',
  in_use: '使用中',
  returned: '已归还',
  disposed: '已处置',
};

export interface IPhysicalItem {
  projectId: Types.ObjectId;
  categoryId: Types.ObjectId;
  name: string;
  spec: string;
  unit: string;
  plannedQty: number;
  onHandQty: number;
  usedQty: number;
  lostQty: number;
  status: PhysicalItemStatus;
  responsibleId?: Types.ObjectId;
  location: string;
  tags: string[];
  note: string;
  createdBy: Types.ObjectId;
}

export type PhysicalItemDoc = HydratedDocument<IPhysicalItem>;

const schema = new Schema<IPhysicalItem>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    categoryId: { type: Schema.Types.ObjectId, ref: 'PhysicalCategory', required: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    spec: { type: String, default: '' },
    unit: { type: String, default: '个' },
    plannedQty: { type: Number, default: 0, min: 0 },
    onHandQty: { type: Number, default: 0, min: 0 },
    usedQty: { type: Number, default: 0, min: 0 },
    lostQty: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: PHYSICAL_ITEM_STATUSES, default: 'planned' },
    responsibleId: { type: Schema.Types.ObjectId, ref: 'User' },
    location: { type: String, default: '' },
    tags: [{ type: String }],
    note: { type: String, default: '' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);
schema.index({ projectId: 1, categoryId: 1 });
schema.index({ projectId: 1, status: 1 });

export const PhysicalItem: Model<IPhysicalItem> =
  models.PhysicalItem ?? model<IPhysicalItem>('PhysicalItem', schema);
