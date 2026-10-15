import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useBlocker, type ShouldBlockFn } from '@tanstack/react-router';
import { DestructiveConfirm } from '@/components/patterns/confirm';
import { m } from '$shared/paraglide/messages.js';

type Protection = { snapshot: unknown; dirty: boolean; pending: boolean; uncertain: boolean };

/** Router/dialog lifetime only; callers read drafts and receipts from their canonical owner. */
export function WorkspaceUnsavedNavigation({
  context,
  snapshot,
  pendingSave,
  uncertain,
  isCurrent,
  readProtection,
  isSameResource,
  editorHost,
  description,
  title,
}: {
  context: string | null;
  snapshot: unknown;
  pendingSave: boolean;
  uncertain: boolean;
  isCurrent: () => boolean;
  readProtection: () => Protection;
  isSameResource: (transition: Parameters<ShouldBlockFn>[0]) => boolean;
  editorHost: RefObject<HTMLDivElement | null>;
  description: string;
  title: string;
}) {
  const [confirmation, setConfirmation] = useState<{
    current: () => boolean;
    settle: (stay: boolean) => void;
  } | null>(null);
  const pending = useRef<typeof confirmation>(null);
  const active = useRef(false);
  const navigationAttempt = useRef<symbol | null>(null);
  const restoreEditor = useRef(false);

  const protectedNow = useCallback(() => {
    if (!active.current || !context || !isCurrent()) return false;
    const currentSave = readProtection();
    return currentSave.dirty || currentSave.pending || currentSave.uncertain;
  }, [context, isCurrent, readProtection]);

  const shouldBlockFn = useCallback<ShouldBlockFn>(
    (transition) => {
      const attempt = Symbol();
      navigationAttempt.current = attempt;
      // A second request supersedes the earlier dialog, never its captured destination.
      pending.current?.settle(true);
      // A router callback captured before this host retired cannot adopt its replacement.
      if (!active.current || !context || !isCurrent()) return true;
      if (!protectedNow()) return false;
      if (isSameResource(transition)) return false;
      const captured = readProtection();
      const currentSnapshot = () =>
        navigationAttempt.current === attempt &&
        active.current &&
        isCurrent() &&
        readProtection().snapshot === captured.snapshot &&
        readProtection().pending === captured.pending &&
        readProtection().uncertain === captured.uncertain;
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
    [context, isCurrent, readProtection, isSameResource, protectedNow],
  );

  useBlocker({ shouldBlockFn, enableBeforeUnload: protectedNow });
  useLayoutEffect(() => {
    active.current = true;
    return () => {
      navigationAttempt.current = null;
      active.current = false;
      pending.current?.settle(true);
    };
  }, [context, isCurrent, readProtection]);
  useLayoutEffect(() => {
    if (pending.current && !pending.current.current()) pending.current.settle(true);
  }, [snapshot, context, pendingSave, uncertain]);

  return (
    <DestructiveConfirm
      open={!!confirmation}
      title={title}
      description={description}
      details={pendingSave || uncertain ? m.workspace_fileNavigation_save_description() : undefined}
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
