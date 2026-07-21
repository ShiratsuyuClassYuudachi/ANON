import type { ProjectDoc } from '../models/Project';
import type { TodoDoc } from '../models/Todo';

export interface TemplateTodo {
  title: string;
  category: string;
  note: string;
  nodeOffsetMs: number | null;
  dueOffsetMs: number | null;
  remindOffsetMs: number | null;
}

export interface TodoTemplate {
  name: string;
  exportedAt: string;
  anchorField: 'start' | 'end' | 'export';
  anchorDate: string;
  todos: TemplateTodo[];
}

export function buildTemplate(project: ProjectDoc, todos: TodoDoc[]): TodoTemplate {
  const anchorField = project.startDate ? 'start' : project.endDate ? 'end' : 'export';
  const anchorDate = project.startDate ?? project.endDate ?? new Date();
  const anchorMs = anchorDate.getTime();
  const offset = (d?: Date) => (d ? d.getTime() - anchorMs : null);
  return {
    name: `${project.name} 待办模板`,
    exportedAt: new Date().toISOString(),
    anchorField,
    anchorDate: anchorDate.toISOString(),
    todos: todos.map((t) => ({
      title: t.title,
      category: t.category,
      note: t.note,
      nodeOffsetMs: offset(t.nodeAt),
      dueOffsetMs: offset(t.dueAt),
      remindOffsetMs: offset(t.remindAt),
    })),
  };
}

export function applyTemplate(tpl: TodoTemplate, anchorDate: Date) {
  const base = anchorDate.getTime();
  const at = (offset: number | null) => (offset === null ? undefined : new Date(base + offset));
  return tpl.todos.map((t) => ({
    title: t.title,
    category: t.category ?? '',
    note: t.note ?? '',
    nodeAt: at(t.nodeOffsetMs),
    dueAt: at(t.dueOffsetMs),
    remindAt: at(t.remindOffsetMs),
  }));
}
