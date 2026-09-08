/**
 * LiveWorkspacesClient tests — includeArchived parameter handling.
 *
 * Ensures `list({ includeArchived: true })` sends the param to the daemon,
 * bare `list()` omits it (default false), and `subscribe`'s typed
 * `workspace.subscribe` channel seq-0 snapshot includes archived workspaces
 * (intentd#521) — the sole data path (intent-hq/monorepo#1697).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LiveWorkspacesClient } from '../live-workspaces-client';
import * as backendTransport from '../backend-transport';
import { createTestWorkspaceId } from '../../../../test/factories/workspace.factory';

describe('LiveWorkspacesClient', () => {
  let client: LiveWorkspacesClient;
  let backendRequestSpy: ReturnType<typeof vi.spyOn>;
  let onNotificationSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    client = new LiveWorkspacesClient();
    backendRequestSpy = vi.spyOn(backendTransport, 'backendRequest');
    onNotificationSpy = vi
      .spyOn(backendTransport, 'onBackendNotification')
      .mockImplementation(() => () => {});
    vi.spyOn(backendTransport, 'onBackendReconnected').mockImplementation(() => () => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('list()', () => {
    it('sends includeArchived: true when option is provided', async () => {
      backendRequestSpy.mockResolvedValue({ workspaces: [] });

      await client.list({ includeArchived: true });

      expect(backendRequestSpy).toHaveBeenCalledWith('workspace.list', {
        includeArchived: true,
      });
    });

    it('omits params when includeArchived is false', async () => {
      backendRequestSpy.mockResolvedValue({ workspaces: [] });

      await client.list({ includeArchived: false });

      expect(backendRequestSpy).toHaveBeenCalledWith('workspace.list', undefined);
    });

    it('omits params when no options provided (default archived-free)', async () => {
      backendRequestSpy.mockResolvedValue({ workspaces: [] });

      await client.list();

      expect(backendRequestSpy).toHaveBeenCalledWith('workspace.list', undefined);
    });

    it('normalizes returned workspaces', async () => {
      const testId = createTestWorkspaceId();
      const rawWorkspace = {
        id: testId,
        title: 'Test Workspace',
        status: 'active',
        branch: 'main',
        changesets: [],
        timeline: [],
        conversationInfo: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };
      backendRequestSpy.mockResolvedValue({ workspaces: [rawWorkspace] });

      const result = await client.list({ includeArchived: true });

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: testId,
        title: 'Test Workspace',
      });
    });
  });

  describe('subscribe()', () => {
    it('registers the global workspace.subscribe channel and reconciles its snapshot verbatim', async () => {
      backendRequestSpy.mockImplementation((method: unknown) => {
        if (method === 'workspace.subscribe') {
          return Promise.resolve({ subscriptionId: 'chan-1' });
        }
        return Promise.resolve({ success: true });
      });

      const handler = vi.fn();
      const unsubscribe = client.subscribe(handler);

      await vi.waitFor(() => {
        expect(backendRequestSpy).toHaveBeenCalledWith('workspace.subscribe', {});
      });

      // The daemon's seq-0 snapshot for the one GLOBAL channel includes
      // archived workspaces (intentd#521) — reconciled verbatim, no `list()`
      // call involved (intent-hq/monorepo#1697: no legacy fetchAll).
      const archivedWorkspace = {
        id: createTestWorkspaceId(),
        title: 'Archived WS',
        status: 'archived',
        branch: 'main',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };
      const notifyHandler = onNotificationSpy.mock.calls.at(-1)?.[0] as
        ((n: { method: string; params?: unknown }) => void) | undefined;
      notifyHandler?.({
        method: 'subscription.push',
        params: {
          subscriptionId: 'chan-1',
          kind: 'snapshot',
          seq: 0,
          snapshot: [archivedWorkspace],
        },
      });

      expect(handler).toHaveBeenLastCalledWith([
        expect.objectContaining({ id: archivedWorkspace.id, title: 'Archived WS' }),
      ]);
      unsubscribe();
    });
  });
});
