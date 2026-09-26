import { randomUUID } from 'node:crypto';
import { BrowserWindow, ipcMain, shell } from 'electron';
import { z } from 'zod';
import { getMainWindow } from '../../../main/state';
import { captureLocalIdentityConnection, onBackendStatus } from '../../backend/main/backend.ipc';
import {
  COLLABORATION_AUTH,
  type CollaborationAction,
  type CollaborationOutcome,
  type CollaborationRequest,
  type CollaborationPolicy,
} from '../types';
import {
  CollaborationAuthFlow,
  type CollaborationAttempt,
  type PreparedCollaborationIdentity,
} from './collaboration-auth-flow';

const actionSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('policy'),
      policy: z.object({ multiplayer: z.boolean(), gitlab: z.boolean() }).strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal('choose'),
      target: z
        .object({ provider: z.enum(['github', 'gitlab']), host: z.string().min(1).max(253) })
        .strict(),
    })
    .strict(),
  z.object({ type: z.literal('connect'), token: z.string().min(1).max(10000).optional() }).strict(),
  ...(['refresh', 'confirm', 'open-browser', 'cancel'] as const).map((type) =>
    z.object({ type: z.literal(type) }).strict(),
  ),
]);
const messageSchema = z.object({ requestId: z.string().uuid(), action: actionSchema }).strict();
let active: { flow: CollaborationAuthFlow; contentsId: number; requestId: string } | null = null;
let sequence = 0;
let releaseAttempt: (() => void) | undefined;
let registered = false;
const policies = new Map<number, CollaborationPolicy>();

/** Narrow continuation consumed by invitation joining; no redemption or session storage here. */
export function prepareCollaborationIdentity(
  request: CollaborationRequest,
  options: { attempt?: CollaborationAttempt; parent?: BrowserWindow | null } = {},
): Promise<CollaborationOutcome<PreparedCollaborationIdentity>> {
  const parent =
    options.parent === undefined
      ? (BrowserWindow.getFocusedWindow() ?? getMainWindow())
      : options.parent;
  request = structuredClone(request);
  if (!parent || parent.isDestroyed() || parent.webContents.isDestroyed())
    return Promise.resolve({ kind: 'cancelled', request });
  registerCollaborationAuthHandlers();
  active?.flow.cancel();
  releaseAttempt?.();
  const generation = ++sequence;
  const requestId = randomUUID();
  const contents = parent.webContents;
  let windowAlive = true;
  const original = options.attempt ?? { id: requestId, metadataRevision: 0, current: () => true };
  const attempt: CollaborationAttempt = {
    id: original.id,
    metadataRevision: original.metadataRevision,
    current: () =>
      original.current() && windowAlive && !contents.isDestroyed() && generation === sequence,
  };
  const send = (channel: string, payload: unknown) => {
    try {
      if (!contents.isDestroyed()) {
        contents.send(channel, payload);
        return true;
      }
    } catch {
      /* Window teardown must still settle the continuation. */
    }
    return false;
  };
  return new Promise((resolve) => {
    let acknowledged = false;
    const timer = setTimeout(() => {
      if (!acknowledged) flow.cancel();
    }, 3000);
    const gone = () => {
      windowAlive = false;
      policies.delete(contents.id);
      contents.removeListener('destroyed', gone);
      contents.removeListener('render-process-gone', gone);
      contents.removeListener('did-navigate', gone);
      flow.cancel();
    };
    releaseAttempt = gone;
    const offStatus = onBackendStatus((status) => {
      if (status !== 'connected') flow.invalidate();
    });
    const cleanup = () => {
      clearTimeout(timer);
      offStatus();
      if (active?.requestId === requestId) active = null;
    };
    const flow = new CollaborationAuthFlow(requestId, request, {
      local: captureLocalIdentityConnection(),
      attempt,
      policy: () => policies.get(contents.id) ?? { multiplayer: false, gitlab: false },
      isLatest: () => generation === sequence,
      openBrowser: (url) => shell.openExternal(url),
      show: (view) => {
        acknowledged = true;
        if (!send(COLLABORATION_AUTH.SHOW, view)) flow.cancel();
      },
      finish: (outcome) => {
        cleanup();
        if (outcome.kind !== 'ready') {
          contents.removeListener('destroyed', gone);
          contents.removeListener('render-process-gone', gone);
          contents.removeListener('did-navigate', gone);
        }
        send(COLLABORATION_AUTH.DISMISS, { requestId });
        resolve(outcome);
      },
    });
    active = { flow, contentsId: contents.id, requestId };
    contents.once('destroyed', gone);
    contents.once('render-process-gone', gone);
    contents.once('did-navigate', gone);
    if (!send(COLLABORATION_AUTH.SHOW, flow.snapshot())) flow.cancel();
  });
}

export function registerCollaborationAuthHandlers(): void {
  if (registered) return;
  registered = true;
  ipcMain.handle(COLLABORATION_AUTH.POLICY, async (event, input: unknown) => {
    const parsed = z
      .object({ multiplayer: z.boolean(), gitlab: z.boolean() })
      .strict()
      .safeParse(input);
    if (!parsed.success) return { ok: false };
    policies.set(event.sender.id, parsed.data);
    if (active?.contentsId === event.sender.id)
      await active.flow.action({ type: 'policy', policy: parsed.data });
    return { ok: true };
  });
  ipcMain.handle(COLLABORATION_AUTH.OPEN, (event) => {
    // Only the local sign-in surface can open; it performs the flag handshake before any RPC.
    const parent = BrowserWindow.fromWebContents(event.sender);
    void prepareCollaborationIdentity({ scope: 'settings' }, { parent }).catch(() => {});
    return { ok: true };
  });
  ipcMain.handle(COLLABORATION_AUTH.ACTION, async (event, input: unknown) => {
    const parsed = messageSchema.safeParse(input);
    // Do not send Zod errors or the rejected input through diagnostics: it may contain a PAT.
    if (
      !parsed.success ||
      !active ||
      event.sender.id !== active.contentsId ||
      parsed.data.requestId !== active.requestId
    )
      return { ok: false };
    await active.flow.action(parsed.data.action as CollaborationAction);
    return { ok: true };
  });
}
