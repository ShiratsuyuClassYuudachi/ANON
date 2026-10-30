import type { Types } from 'mongoose';
import type { IVisibility } from '../models/ResourceType';
import type { VisibilityLike, Viewer } from './visibility';
import { canSee } from './visibility';

export type MaterialCategory = {
  _id: Types.ObjectId;
  parentId?: Types.ObjectId | null;
  visibility?: IVisibility | VisibilityLike | null;
};

export function indexMaterialCategories(types: Iterable<MaterialCategory>): Map<string, MaterialCategory> {
  return new Map([...types].map((type) => [type._id.toString(), type]));
}

function categoryVisibilityChain(
  type: MaterialCategory | null | undefined,
  categories: Map<string, MaterialCategory>,
): (VisibilityLike | null | undefined)[] {
  const chain: (VisibilityLike | null | undefined)[] = [];
  const seen = new Set<string>();
  let current = type;
  while (current) {
    const id = current._id.toString();
    if (seen.has(id)) break;
    seen.add(id);
    chain.push(current.visibility);
    current = current.parentId ? categories.get(current.parentId.toString()) : undefined;
  }
  return chain;
}

export function canSeeMaterialCategory(
  viewer: Viewer,
  type: MaterialCategory,
  categories: Map<string, MaterialCategory>,
): boolean {
  return canSee(viewer, ...categoryVisibilityChain(type, categories));
}

export function canSeeMaterialResource(
  viewer: Viewer,
  resourceVisibility: VisibilityLike | null | undefined,
  type: MaterialCategory | null | undefined,
  categories: Map<string, MaterialCategory>,
): boolean {
  return canSee(viewer, resourceVisibility, ...categoryVisibilityChain(type, categories));
}
