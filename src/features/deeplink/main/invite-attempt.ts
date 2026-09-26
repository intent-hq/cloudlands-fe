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
  release(): void;
  cancelled: Promise<void>;
}

export function captureInviteAttempt(): InviteAttempt {
  const parent = BrowserWindow.getFocusedWindow() ?? getMainWindow();
  const contents = parent?.webContents;
  const allowed = captureCollaborationPolicy(contents?.id ?? null);
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
  if (contents) offPolicy = onCollaborationPolicyChanged(contents.id, release);
  contents?.once('destroyed', release);
  contents?.once('render-process-gone', release);
  contents?.once('did-navigate', release);
  contents?.once('did-navigate-in-page', release);
  return {
    id: randomUUID(),
    metadataRevision: 0,
    local: captureLocalIdentityConnection(),
    parent,
    allowed,
    current: () => live && !!contents && !contents.isDestroyed() && allowed(),
    release,
    cancelled,
  };
}
