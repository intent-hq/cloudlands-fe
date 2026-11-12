import { IPC_CHANNELS } from '../../../shared/ipc-registry';
import { CHIEF_WORKSPACE_ID } from '../../../shared/types/branded-ids';
/** Main-window offline media leases. Never route through dock capture authority. */
import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { randomUUID } from 'node:crypto';
import { createAuthorizedIpcHandler, isTrustedRendererUrl } from '../../../main/ipc-authorization';
import { isChatWindow } from '../../../main/chat-window-identity';
import {
  getStrictBackendBindingForWebContents,
  onStrictBackendBindingRetired,
} from '../../../main/window-backend';
import { getBackendClientForId } from '../../backend/main/backend.ipc';
import { parsePrincipalSnapshot } from '../../../shared/types/principal';
import {
  ChatMediaBeginSchema,
  ChatMediaScopeSchema,
  ChatMediaControlSchema,
  type ChatMediaBegin,
  type ChatMediaControl,
} from '../../../shared/chat-media-ipc';
import {
  DockSavedMediaSchema,
  defaultDockMediaEdit,
  type DockSavedMedia,
} from '../../../shared/dock-media-edit';
import {
  exportDockMedia,
  transcribeDockMedia,
  releaseDockMediaJob,
  type DockMediaJobContext,
} from './dock-media-output';
import type { DockNativeResult } from '../../../shared/dock-evidence';

type Binding = NonNullable<ReturnType<typeof getStrictBackendBindingForWebContents>>;
type Client = ReturnType<typeof getBackendClientForId>;
interface Lease {
  context: DockMediaJobContext;
  request: ChatMediaBegin;
  sender: Electron.WebContents;
  frame: Electron.WebFrameMain;
  binding: Binding;
  client: Client;
  connection: NonNullable<ReturnType<Client['getRepositoryConnection']>>;
  dead: boolean;
  listeners: Set<() => void>;
  cleanup: (() => void)[];
  jobs: Set<string>;
}
const unavailable = (): DockNativeResult<never> => ({ ok: false, error: 'unavailable' });
const fingerprint = (media: DockSavedMedia) =>
  JSON.stringify({ source: media.source, saved: media.saved });
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object';
const unwrap = (value: unknown, key: string) =>
  record(value) && key in value ? value[key] : value;

/** Production owns one registry. */
function createChatMediaLeases() {
  const leases = new Map<Electron.WebContents, Lease>();
  function current(lease: Lease): boolean {
    try {
      return (
        !lease.dead &&
        leases.get(lease.sender) === lease &&
        !lease.sender.isDestroyed() &&
        lease.sender.mainFrame === lease.frame &&
        isTrustedRendererUrl(lease.frame.url) &&
        isChatWindow(lease.binding.window) &&
        getStrictBackendBindingForWebContents(lease.sender) === lease.binding &&
        getBackendClientForId(lease.binding.backendId) === lease.client &&
        lease.client.getRepositoryConnection() === lease.connection
      );
    } catch {
      return false;
    }
  }
  async function retire(lease: Lease): Promise<void> {
    if (!lease.dead) {
      lease.dead = true;
      if (leases.get(lease.sender) === lease) leases.delete(lease.sender);
      for (const cleanup of lease.cleanup.splice(0)) cleanup();
      for (const listener of lease.listeners) listener();
      lease.listeners.clear();
    }
    await Promise.all(
      [...lease.jobs].map((id) => releaseDockMediaJob(lease.context.scope.sessionId, id)),
    );
    lease.jobs.clear();
  }
  function requireCurrent(lease: Lease): void {
    if (!current(lease)) {
      void retire(lease);
      throw new Error('media-session-retired');
    }
  }
  async function authorize(lease: Lease): Promise<void> {
    requireCurrent(lease);
    const principal = parsePrincipalSnapshot(
      lease.client.getAcknowledgedHello(),
      await lease.client.request('principal.me'),
    );
    requireCurrent(lease);
    if (!principal || principal.principal.id !== lease.request.principalId)
      throw new Error('media-principal-retired');
    const { workspaceId, agentId } = lease.request;
    if (workspaceId === CHIEF_WORKSPACE_ID) {
      if (!principal.principal.isAdministrator) throw new Error('media-workspace-unavailable');
    } else {
      const workspace = unwrap(
        await lease.client.request('workspace.get', { workspaceId }),
        'workspace',
      );
      requireCurrent(lease);
      if (
        !record(workspace) ||
        workspace.id !== workspaceId ||
        workspace.status === 'deleted' ||
        (!principal.principal.isAdministrator &&
          workspace.canManage !== true &&
          !['owner', 'collaborator', 'manager'].includes(String(workspace.myRole)))
      )
        throw new Error('media-workspace-unavailable');
    }
    const agent = unwrap(
      await lease.client.request('agent.get', { workspaceId, agentId }),
      'agent',
    );
    requireCurrent(lease);
    if (
      !record(agent) ||
      agent.id !== agentId ||
      agent.workspaceId !== workspaceId ||
      agent.retiredAt ||
      agent.pendingDeleteAt ||
      agent.status === 'deleted'
    )
      throw new Error('media-agent-retired');
    // Both reads are authorized by this acknowledged backend principal. Never trust a renderer-provided path or draft descriptor alone.
    const draft = await lease.client.request<unknown>('drafts.get', { workspaceId, agentId });
    requireCurrent(lease);
    if (!record(draft) || !Array.isArray(draft.attachments))
      throw new Error('media-draft-unavailable');
    const allowed = new Set<string>();
    for (const attachment of draft.attachments) {
      if (!record(attachment) || !record(attachment.screen)) continue;
      const row =
        attachment.screen.kind === 'image'
          ? attachment.screen.image
          : attachment.screen.kind === 'clip'
            ? attachment.screen.clip
            : null;
      if (!record(row) || row.mediaError) continue;
      const media = DockSavedMediaSchema.safeParse(row.media);
      if (
        media.success &&
        media.data.source.attachmentId === attachment.attachmentId &&
        media.data.source.path === attachment.path
      )
        allowed.add(fingerprint(media.data));
    }
    if (lease.request.media.some((media) => !allowed.has(fingerprint(media))))
      throw new Error('media-draft-retired');
  }
  async function begin(
    event: IpcMainInvokeEvent,
    input: unknown,
  ): Promise<DockNativeResult<{ sessionId: string }>> {
    const parsed = ChatMediaBeginSchema.safeParse(input);
    const binding = getStrictBackendBindingForWebContents(event.sender);
    if (
      !parsed.success ||
      !binding ||
      !isChatWindow(binding.window) ||
      !event.senderFrame ||
      event.senderFrame !== event.sender.mainFrame ||
      event.senderFrame !== binding.frame ||
      !isTrustedRendererUrl(event.senderFrame.url)
    )
      return unavailable();
    const client = getBackendClientForId(binding.backendId),
      connection = client.getRepositoryConnection();
    if (!connection) return unavailable();
    const previous = leases.get(event.sender);
    if (previous) void retire(previous);
    const listeners = new Set<() => void>();
    const lease: Lease = {
      request: parsed.data,
      sender: event.sender,
      frame: event.senderFrame,
      binding,
      client,
      connection,
      dead: false,
      listeners,
      cleanup: [],
      jobs: new Set(),
      context: {
        scope: {
          sessionId: randomUUID(),
          workspaceId: parsed.data.workspaceId,
          agentId: parsed.data.agentId,
          draftId: parsed.data.draftId,
        },
        backendId: binding.backendId,
        isCurrent: () => current(lease),
        onDispose: (listener) => {
          if (!current(lease)) {
            listener();
            return () => {};
          }
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
      },
    };
    leases.set(event.sender, lease);
    const timeout = setTimeout(() => {
      void retire(lease);
    }, 10 * 60_000);
    timeout.unref();
    lease.cleanup.push(
      () => clearTimeout(timeout),
      onStrictBackendBindingRetired(event.sender, () => {
        void retire(lease);
      }),
      client.onRepositoryConnectionEvent((event) => {
        if (event.type === 'closed' || event.type === 'identity-retired') void retire(lease);
      }),
    );
    try {
      await authorize(lease);
      requireCurrent(lease);
      return { ok: true, value: { sessionId: lease.context.scope.sessionId } };
    } catch {
      await retire(lease);
      return unavailable();
    }
  }
  function owned(event: IpcMainInvokeEvent, sessionId: string): Lease | null {
    const lease = leases.get(event.sender);
    return lease &&
      event.senderFrame === lease.frame &&
      lease.context.scope.sessionId === sessionId &&
      current(lease)
      ? lease
      : null;
  }
  async function control(
    event: IpcMainInvokeEvent,
    input: unknown,
  ): Promise<DockNativeResult<unknown>> {
    const parsed = ChatMediaControlSchema.safeParse(input);
    if (!parsed.success) return unavailable();
    const lease = owned(event, parsed.data.sessionId);
    if (!lease) return unavailable();
    const command: ChatMediaControl['control'] = parsed.data.control;
    if (command.action === 'release') {
      await releaseDockMediaJob(lease.context.scope.sessionId, command.jobId);
      lease.jobs.delete(command.jobId);
      return { ok: true, value: undefined };
    }
    try {
      if (
        !lease.request.media.some((media) => {
          const requested = command.request.media;
          return (
            JSON.stringify(media.source) === JSON.stringify(requested.source) &&
            (fingerprint(media) === fingerprint(requested) ||
              JSON.stringify(requested.saved) ===
                JSON.stringify(
                  media.saved ??
                    defaultDockMediaEdit(
                      media.source,
                      media.source.capturedMarks ?? [],
                      requested.transcript,
                    ),
                ))
          );
        })
      )
        return unavailable();
      await authorize(lease);
      requireCurrent(lease);
      if (lease.jobs.has(command.request.jobId) || lease.jobs.size >= 2)
        return { ok: false, error: 'limit' };
      lease.jobs.add(command.request.jobId);
      const result =
        command.action === 'export'
          ? await exportDockMedia(lease.context, command.request, () => {})
          : await transcribeDockMedia(lease.context, command.request, () => {});
      await authorize(lease);
      requireCurrent(lease);
      if (command.action === 'transcribe' || !result.ok) lease.jobs.delete(command.request.jobId);
      return result;
    } catch {
      await retire(lease);
      return unavailable();
    }
  }
  async function close(
    event: IpcMainInvokeEvent,
    input: unknown,
  ): Promise<DockNativeResult<boolean>> {
    const parsed = ChatMediaScopeSchema.safeParse(input);
    const lease = parsed.success ? owned(event, parsed.data.sessionId) : null;
    if (!lease) return unavailable();
    await retire(lease);
    return { ok: true, value: true };
  }
  return { begin, control, close };
}
export function setupChatMediaIPC(): void {
  const leases = createChatMediaLeases();
  ipcMain.handle(
    IPC_CHANNELS.CHAT_MEDIA.BEGIN,
    createAuthorizedIpcHandler(IPC_CHANNELS.CHAT_MEDIA.BEGIN, leases.begin),
  );
  ipcMain.handle(
    IPC_CHANNELS.CHAT_MEDIA.CONTROL,
    createAuthorizedIpcHandler(IPC_CHANNELS.CHAT_MEDIA.CONTROL, leases.control),
  );
  ipcMain.handle(
    IPC_CHANNELS.CHAT_MEDIA.CLOSE,
    createAuthorizedIpcHandler(IPC_CHANNELS.CHAT_MEDIA.CLOSE, leases.close),
  );
}
