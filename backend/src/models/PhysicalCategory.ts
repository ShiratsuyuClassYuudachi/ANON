import { Schema, model, models, type HydratedDocument, type Model, type Types } from 'mongoose';

export interface IPhysicalCategory {
  projectId: Types.ObjectId;
  name: string;
  order: number;
}

export type PhysicalCategoryDoc = HydratedDocument<IPhysicalCategory>;

const schema = new Schema<IPhysicalCategory>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    name: { type: String, required: true, trim: true, maxlength: 50 },
    order: { type: Number, required: true, default: 0 },
  },
  { timestamps: true },
);
schema.index({ projectId: 1, order: 1 });

export const PhysicalCategory: Model<IPhysicalCategory> =
  models.PhysicalCategory ?? model<IPhysicalCategory>('PhysicalCategory', schema);

export const DEFAULT_PHYSICAL_CATEGORIES = [
  '印刷品', '设备器材', '装饰布置', '耗材文具', '证件票券', '其他',
] as const;
