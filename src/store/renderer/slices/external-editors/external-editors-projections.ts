import type { StoreSelectorSelect } from '@themislib/themis/types';
import { getItems, type Collection } from '@themislib/themis/utils/collections/collection-utils';
import type { ExternalEditorsState, InstalledEditor } from './external-editors-slice';

export const getInstalledEditorsCollection = (state: {
  externalEditors: ExternalEditorsState;
}): Collection<InstalledEditor, 'id'> => state.externalEditors.editors;

export function createInstalledEditorsProjection<
  State extends { externalEditors: ExternalEditorsState },
>(selectInstalledEditorsCollection: {
  select: StoreSelectorSelect<Collection<InstalledEditor, 'id'>, [], State>;
}) {
  return (state: State): InstalledEditor[] => {
    const editors = getItems(selectInstalledEditorsCollection.select(state));
    const order = state.externalEditors.editorOrder ?? [];
    if (!order.length) return editors;
    const byId = new Map(editors.map((editor) => [editor.id, editor]));
    const ordered = order.flatMap((id) => {
      const editor = byId.get(id);
      return editor ? [editor] : [];
    });
    const orderedIds = new Set(order);
    return [...ordered, ...editors.filter(({ id }) => !orderedIds.has(id))];
  };
}

export const getInstalledEditorsLoading = (state: {
  externalEditors: ExternalEditorsState;
}): boolean => state.externalEditors.loading;

export const getLastFetched = (state: { externalEditors: ExternalEditorsState }): number =>
  state.externalEditors.lastFetched;
