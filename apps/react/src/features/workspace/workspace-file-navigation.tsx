import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useBlocker, type ShouldBlockFn } from '@tanstack/react-router';
import { DestructiveConfirm } from '@/components/patterns/confirm';
import { store } from '@/store';
import {
  selectFileContentEntry,
  selectFileIsDirty,
  selectFileReadContext,
  selectFileSaveState,
} from '@/store/files/files-selectors';
import { m } from '$shared/paraglide/messages.js';

/** Only the router decision is local. Drafts and running/unknown saves remain in files. */
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
  const [confirmation, setConfirmation] = useState<{
    current: () => boolean;
    settle: (stay: boolean) => void;
  } | null>(null);
  const pending = useRef<typeof confirmation>(null);
  const active = useRef(false);
  const navigationAttempt = useRef<symbol | null>(null);
  const restoreEditor = useRef(false);

  const protectedNow = useCallback(() => {
    if (
      !active.current ||
      !context ||
      selectFileReadContext.select(store.state, workspaceId) !== context
    )
      return false;
    const currentSave = selectFileSaveState.select(store.state, workspaceId, path);
    return (
      selectFileIsDirty.select(store.state, workspaceId, path) ||
      currentSave.pending ||
      currentSave.uncertain
    );
  }, [workspaceId, path, context]);

  const shouldBlockFn = useCallback<ShouldBlockFn>(
    ({ current, next }) => {
      const attempt = Symbol();
      navigationAttempt.current = attempt;
      // A second request supersedes the earlier dialog, never its captured destination.
      pending.current?.settle(true);
      // A router callback captured before this host retired cannot adopt its replacement.
      if (
        !active.current ||
        !context ||
        selectFileReadContext.select(store.state, workspaceId) !== context
      )
        return true;
      if (!protectedNow()) return false;
      const search = next.search as Record<string, unknown>;
      if (
        next.pathname === current.pathname &&
        search.file === path &&
        !search.agent &&
        !search.diff &&
        !search.attachment &&
        !search.attachmentAgent
      )
        return false;
      const captured = selectFileContentEntry.select(store.state, workspaceId, path);
      const capturedSave = selectFileSaveState.select(store.state, workspaceId, path);
      const currentSnapshot = () =>
        navigationAttempt.current === attempt &&
        active.current &&
        selectFileReadContext.select(store.state, workspaceId) === context &&
        selectFileContentEntry.select(store.state, workspaceId, path) === captured &&
        selectFileSaveState.select(store.state, workspaceId, path).pending ===
          capturedSave.pending &&
        selectFileSaveState.select(store.state, workspaceId, path).uncertain ===
          capturedSave.uncertain;
      return new Promise<boolean>((resolve) => {
        const request = {
          current: currentSnapshot,
          settle: (stay: boolean) => {
            if (pending.current !== request) return;
            const blocked = stay || !currentSnapshot();
            restoreEditor.current = blocked;
            pending.current = null;
            setConfirmation(null);
            resolve(blocked);
          },
        };
        pending.current = request;
        setConfirmation(request);
      }).then((stay) => stay || !currentSnapshot());
    },
    [workspaceId, path, context, protectedNow],
  );

  useBlocker({ shouldBlockFn, enableBeforeUnload: protectedNow });
  useLayoutEffect(() => {
    active.current = true;
    return () => {
      navigationAttempt.current = null;
      active.current = false;
      pending.current?.settle(true);
    };
  }, [workspaceId, path, context]);
  useLayoutEffect(() => {
    if (pending.current && !pending.current.current()) pending.current.settle(true);
  }, [entry, context, save.pending, save.uncertain]);

  return (
    <DestructiveConfirm
      open={!!confirmation}
      title={m.workspace_fileNavigation_title_label()}
      description={m.workspace_fileNavigation_discard_description()}
      details={
        save.pending || save.uncertain ? m.workspace_fileNavigation_save_description() : undefined
      }
      cancelLabel={m.workspace_fileNavigation_stay_label()}
      confirmLabel={m.workspace_fileNavigation_discard_label()}
      focusSubmit={false}
      focusCancel
      enterKey="ignore"
      modEnter="ignore"
      onConfirm={() => confirmation?.settle(false)}
      onCancel={() => confirmation?.settle(true)}
      onCloseAutoFocus={(event) => {
        if (!restoreEditor.current || !active.current) return;
        const input = editorHost.current?.querySelector<HTMLElement>('textarea, [role="textbox"]');
        if (input) {
          event.preventDefault();
          input.focus({ preventScroll: true });
        }
      }}
    />
  );
}
