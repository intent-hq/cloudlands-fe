import { resolveBackendTransport } from '$lib/client/live/backend-transport-factory';
import type { BackendTransport } from '$lib/client/live/backend-transport-types';
import { overrideMockIpcHandler } from '$shared/ipc-mock-router';
import { settleNoteContent } from '$features/notes/notes-write-service';
import { store as appStore } from '$store/renderer/store';
import { selectIsDarkTheme } from '$store/renderer/slices/theme/theme-selectors';
import { setThemeName } from '$store/renderer/slices/theme/theme-slice';
import { selectSubscriptionSnapshotStatus } from '$store/renderer/slices/agent-subscription-ui/agent-subscription-ui-selectors';
import { setSubscriptionSnapshot } from '$store/renderer/slices/agent-subscription-ui/agent-subscription-ui-slice';
import {
  SHARING_AGENT_ID,
  SHARING_NOTE_ID,
  SHARING_WORKSPACE_ID,
  sharingNote,
  type SharingState,
} from './content-sharing.preview-fixtures';

export interface SharingCapture {
  kind: 'clipboard' | 'blocked';
  text: string;
}

const scopes: Array<{ closed: boolean; restore: () => void }> = [];

/** Preview-only boundary: no request ever falls through to a live daemon. */
export function isolateSharingPreview(
  state: SharingState,
  onCapture: (capture: SharingCapture) => void,
) {
  let disposed = false;
  let subscriptionRefreshScheduled = false;
  // ChatPanel marks the agent viewed and invalidates this snapshot on mount.
  // UI-only mode has no read saga, so deliver the fictional refresh locally.
  const unsubscribeSubscriptions = appStore.getReadableState().subscribe((storeState) => {
    if (
      disposed ||
      subscriptionRefreshScheduled ||
      selectSubscriptionSnapshotStatus.select(
        storeState,
        SHARING_WORKSPACE_ID,
        SHARING_AGENT_ID,
      ) !== 'loading'
    ) {
      return;
    }
    subscriptionRefreshScheduled = true;
    queueMicrotask(() => {
      subscriptionRefreshScheduled = false;
      if (disposed) return;
      appStore.dispatch(
        setSubscriptionSnapshot(SHARING_WORKSPACE_ID, SHARING_AGENT_ID, {
          subscriptions: [],
          delegationGroups: [],
          agentStatuses: {},
          waitingState: 'idle',
        }),
      );
    });
  });
  // CatalogShell owns DOM theme classes; Monaco reads the Redux theme instead.
  // Mirror only for this preview, without persisting a user preference.
  const priorTheme = selectIsDarkTheme.select(appStore.state) ? 'dark' : 'light';
  const syncTheme = () => {
    appStore.dispatch(
      setThemeName(document.documentElement.classList.contains('dark') ? 'dark' : 'light'),
    );
  };
  syncTheme();
  const themeObserver = new MutationObserver(syncTheme);
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  const transport = resolveBackendTransport();
  const original = { ...transport };
  const local: BackendTransport = {
    isAvailable: () => true,
    request: async <T>(method: string, params?: unknown): Promise<T> => {
      const input = (params ?? {}) as Record<string, unknown>;
      let result: unknown;
      switch (method) {
        case 'note.get':
          result = state === 'note-stale' ? null : sharingNote;
          break;
        case 'note.setContent':
          result = { ok: true, newContent: input.content, rev: 2 };
          break;
        case 'drafts.get':
        case 'note.lineAttribution.load':
          result = null;
          break;
        case 'drafts.set':
          result = { ok: true, updatedAt: sharingNote.updatedAt };
          break;
        case 'drafts.clear':
          result = { ok: true };
          break;
        case 'agent.getQueue':
          result = { queue: [] };
          break;
        case 'agent.listUserMessages':
          result = { items: [], total: 0 };
          break;
        case 'client.hello':
          result = { server: { capabilities: {} } };
          break;
        case 'principal.me':
          result = { principal: null };
          break;
        case 'comment.list':
        case 'note.listVersions':
          result = [];
          break;
        case 'note.presence.subscribe':
          result = { subscriptionId: 'preview-presence' };
          break;
        case 'note.presence.unsubscribe':
        case 'note.presence.setCursor':
          result = { ok: true };
          break;
        default:
          onCapture({ kind: 'blocked', text: `Preview blocked backend method: ${method}` });
          throw new Error(`Preview does not implement ${method}`);
      }
      return result as T;
    },
    subscribe: async <T>() => ({ subscriptionId: 'preview-content-sharing' }) as T,
    unsubscribe: async () => {},
    onNotification: () => () => {},
    onReconnected: () => () => {},
  };
  Object.assign(transport, local);

  const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  const writeText = async (text: string) => {
    if (state === 'clipboard-failure') throw new Error('Simulated preview clipboard denial');
    onCapture({ kind: 'clipboard', text });
  };
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  const restores = [
    overrideMockIpcHandler('system:write-clipboard', async (input) => {
      await writeText((input as { text: string }).text);
      return { success: true };
    }),
    overrideMockIpcHandler('workspace:get-root', () => null),
    overrideMockIpcHandler('workspace:get', () => ({
      success: true,
      data: {
        id: SHARING_WORKSPACE_ID,
        title: 'Content sharing · fictional workspace',
        status: 'active',
        worktreePath: '/preview/content-sharing',
      },
    })),
  ];
  const scope = {
    closed: false,
    restore: () => {
      appStore.dispatch(setThemeName(priorTheme));
      Object.assign(transport, original);
      for (const restore of restores.reverse()) restore();
      if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
      else Reflect.deleteProperty(navigator, 'clipboard');
    },
  };
  scopes.push(scope);
  return async () => {
    if (disposed) return;
    disposed = true;
    unsubscribeSubscriptions();
    themeObserver.disconnect();
    // Let child editor teardown enqueue its last local save before restoring the boundary.
    await Promise.resolve();
    await settleNoteContent(SHARING_WORKSPACE_ID, SHARING_NOTE_ID);
    scope.closed = true;
    // Route/HMR remounts can install the next scene while an editor flush is pending.
    // Only unwind closed scopes from the top, preserving the newer fixture's boundary.
    while (scopes.at(-1)?.closed) scopes.pop()?.restore();
  };
}
