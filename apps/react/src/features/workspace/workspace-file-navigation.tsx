import { useCallback, type RefObject } from 'react';
import type { ShouldBlockFn } from '@tanstack/react-router';
import { store } from '@/store';
import {
  selectFileContentEntry,
  selectFileIsDirty,
  selectFileReadContext,
  selectFileSaveState,
} from '@/store/files/files-selectors';
import { m } from '$shared/paraglide/messages.js';
import { WorkspaceUnsavedNavigation } from './workspace-unsaved-navigation';

export function WorkspaceFileNavigation({
  workspaceId,
  path,
  editorHost,
}: {
  workspaceId: string;
  path: string;
  editorHost: RefObject<HTMLDivElement | null>;
}) {
  const entry = selectFileContentEntry(workspaceId, path).value;
  const context = selectFileReadContext(workspaceId).value;
  const save = selectFileSaveState(workspaceId, path).value;
  const isCurrent = useCallback(
    () => selectFileReadContext.select(store.state, workspaceId) === context,
    [workspaceId, context],
  );
  const readProtection = useCallback(() => {
    const currentSave = selectFileSaveState.select(store.state, workspaceId, path);
    return {
      snapshot: selectFileContentEntry.select(store.state, workspaceId, path),
      dirty: selectFileIsDirty.select(store.state, workspaceId, path),
      pending: currentSave.pending,
      uncertain: currentSave.uncertain,
    };
  }, [workspaceId, path]);
  const isSameResource = useCallback(
    ({ current, next }: Parameters<ShouldBlockFn>[0]) => {
      const search = next.search as Record<string, unknown>;
      return (
        next.pathname === current.pathname &&
        search.file === path &&
        !search.agent &&
        !search.diff &&
        !search.attachment &&
        !search.attachmentAgent
      );
    },
    [path],
  );
  return (
    <WorkspaceUnsavedNavigation
      context={context}
      snapshot={entry}
      pendingSave={save.pending}
      uncertain={save.uncertain}
      isCurrent={isCurrent}
      readProtection={readProtection}
      isSameResource={isSameResource}
      editorHost={editorHost}
      title={m.workspace_fileNavigation_title_label()}
      description={m.workspace_fileNavigation_discard_description()}
    />
  );
}
