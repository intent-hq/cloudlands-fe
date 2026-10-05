import { randomUUID } from 'node:crypto';
import { BrowserWindow } from 'electron';
import { getMainWindow } from '../../../main/state';
import {
  captureCollaborationPolicy,
  onCollaborationPolicyChanged,
} from '../../collaboration-auth/main/collaboration-auth.ipc';
import { captureLocalIdentityConnection } from '../../backend/main/backend.ipc';
import type {
  CollaborationAttempt,
  LocalIdentityLease,
} from '../../collaboration-auth/main/collaboration-auth-flow';

export interface InviteAttempt extends CollaborationAttempt {
  local: LocalIdentityLease;
  parent: BrowserWindow | null;
  allowed(provider?: 'github' | 'gitlab'): boolean;
  /** Original window/attempt still exists, even before its policy is admitted. */
  alive(): boolean;
  /** Acknowledged renderer readiness may admit an initially blocked attempt once, in its original window. */
  admit(): boolean;
  release(): void;
  cancelled: Promise<void>;
}

export function captureInviteAttempt(): InviteAttempt {
  const parent = BrowserWindow.getFocusedWindow() ?? getMainWindow();
  const contents = parent?.webContents;
  let policy = captureCollaborationPolicy(contents?.id ?? null);
  let admitted = policy();
  let enabledObserved = admitted;
  let live = true;
  let cancel!: () => void;
  const cancelled = new Promise<void>((resolve) => {
    cancel = resolve;
  });
  let offPolicy: (() => void) | undefined;
  const release = () => {
    offPolicy?.();
    live = false;
    cancel();
    contents?.removeListener('destroyed', release);
    contents?.removeListener('render-process-gone', release);
    contents?.removeListener('did-navigate', release);
    contents?.removeListener('did-navigate-in-page', release);
  };
  if (contents)
    offPolicy = onCollaborationPolicyChanged(contents.id, () => {
      if (enabledObserved) release();
      // Initial hydration may supply enabled policy for the first time. Once seen,
      // any subsequent policy revision invalidates this attempt, even while its
      // renderer acknowledgement is still in flight.
      else enabledObserved = captureCollaborationPolicy(contents.id)();
    });
  contents?.once('destroyed', release);
  contents?.once('render-process-gone', release);
  contents?.once('did-navigate', release);
  contents?.once('did-navigate-in-page', release);
  const alive = () => live && !!contents && !contents.isDestroyed();
  const current = () => alive() && admitted && policy();
  return {
    id: randomUUID(),
    metadataRevision: 0,
    local: captureLocalIdentityConnection(),
    parent,
    alive,
    admit: () => {
      if (!alive()) return false;
      if (!admitted) {
        policy = captureCollaborationPolicy(contents?.id ?? null);
        admitted = policy();
      }
      return current();
    },
    allowed: (provider) => current() && policy(provider),
    current,
    release,
    cancelled,
  };
}
