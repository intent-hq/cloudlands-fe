/** Mock daemon → real relay → IPC result → saga/reducer → existing dialog. */
import { fireEvent, render, screen } from '@testing-library/svelte';
import { runSaga, stdChannel } from 'redux-saga';
import { describe, expect, it, vi } from 'vitest';
import { warmImport } from '../../../test/warm-import';
import { JsonRpcError } from './json-rpc-errors';
import { createWorkspaceImportRelay } from './workspace-import-relay';
import { createWorkspaceTransferRelay, type RelayRpcClient } from './workspace-transfer-relay';
import {
  initialState as initialImport,
  importStartRequested,
  workspaceImportReducer,
} from '../../../store/renderer/slices/workspace-import/workspace-import-slice';
import { workspaceImportSaga } from '../../../store/renderer/slices/workspace-import/sagas/workspace-import-saga';
import {
  initialState as initialTransfer,
  transferStartRequested,
  workspaceTransferReducer,
} from '../../../store/renderer/slices/workspace-transfer/workspace-transfer-slice';
import { workspaceTransferSaga } from '../../../store/renderer/slices/workspace-transfer/sagas/workspace-transfer-saga';
import type { WorkspaceTransferState } from '../../../store/renderer/slices/workspace-transfer/workspace-transfer-types';

vi.mock('$lib/utils/navigation.client', () => ({ navigateToRoute: vi.fn() }));
vi.mock('$lib/client/live/backend-transport', () => ({ backendRequest: vi.fn() }));
vi.mock('$lib/components/patterns/notify', () => ({ notify: { warning: vi.fn() } }));
vi.mock('svelte-fa', async () => ({
  default: (await import('../../../lib/components/workspace/sidebar/__tests__/mocks/Fa.svelte'))
    .default,
}));
// The archive parser has its own real-ZIP coverage in workspace-import-relay.test.ts.
vi.mock('./zip-manifest', () => ({
  readZipManifest: vi.fn(async () => ({ formatVersion: 1, workspaceId: 'ws-1' })),
}));

warmImport(() => import('../../../lib/components/modals/ImportWorkspaceModal.svelte'));
warmImport(() => import('../../../lib/components/modals/TransferWorkspaceModal.svelte'));

describe('workspace import failure surfaces', () => {
  it.each(['file', 'remote'] as const)(
    'shows a safe commit cause after a %s import fails',
    async (kind) => {
      const detail = 'UNIQUE constraint failed: interrupted_agent.agent_id';
      const logger = { info: vi.fn(), warn: vi.fn() };
      const request = vi.fn(async (method: string, params?: unknown) => {
        if (method === 'workspace.import.commit') {
          throw new JsonRpcError({
            code: -32603,
            message: 'Internal error',
            data: `${detail}; Authorization: Bearer private-marker`,
          });
        }
        if (method === 'workspace.import.begin')
          return { importId: 'import-1', maxChunkBytes: 64 } as never;
        if (method === 'workspace.import.chunk')
          return { importId: 'import-1', seq: (params as { seq: number }).seq } as never;
        if (method === 'workspace.import.abort')
          return { importId: 'import-1', aborted: true } as never;
        if (method === 'host.status') return { ready: true } as never;
        throw new Error(`Unexpected target method: ${method}`);
      });
      const client: RelayRpcClient = { request, on: vi.fn(), off: vi.fn() };
      const bytes = Buffer.from('archive fixture');
      const fileRelay = createWorkspaceImportRelay({
        showOpenDialog: async () => '/tmp/workspace.zip',
        openFile: async () => ({
          size: async () => bytes.length,
          read: async (offset, length) => bytes.subarray(offset, offset + length),
          close: vi.fn(async () => undefined),
        }),
        broadcastProgress: vi.fn(),
        isOwnerGone: () => false,
        logger,
      });
      const sourceRequest = vi.fn(async (method: string) => {
        if (method === 'events.subscribe') return { subscriptionId: 'sub-1' } as never;
        if (method === 'workspace.export.start')
          return { exportId: 'export-1', maxChunkBytes: 64 } as never;
        if (method === 'workspace.export.read')
          return {
            exportId: 'export-1',
            seq: 0,
            totalChunks: 1,
            data: bytes.toString('base64'),
          } as never;
        if (method === 'events.unsubscribe') return {} as never;
        if (method === 'workspace.export.abort')
          return { exportId: 'export-1', aborted: true } as never;
        throw new Error(`Unexpected source method: ${method}`);
      });
      const listeners = new Set<(event: { method: string; params?: unknown }) => void>();
      const source: RelayRpcClient = {
        request: sourceRequest,
        on: (_event, listener) => listeners.add(listener),
        off: (_event, listener) => listeners.delete(listener),
      };
      const remoteRelay = createWorkspaceTransferRelay({
        createTargetClient: async () => ({ client, dispose: vi.fn() }),
        showSaveDialog: vi.fn(),
        openFileSink: vi.fn(),
        broadcastProgress: vi.fn(),
        isOwnerGone: () => false,
        logger,
      });
      const destination = { kind: 'server', connectionId: 'conn-1' } as const;
      const invoke = vi
        .spyOn(window.electronAPI!, 'invoke')
        .mockImplementation(async (channel, params) => {
          if (channel === 'transfer:import-start') return fileRelay.start(params, client, 101);
          if (channel === 'transfer:start') return remoteRelay.start(params, source, 101);
          throw new Error(`Unexpected IPC channel: ${channel}`);
        });
      let importState = initialImport;
      let transferState: WorkspaceTransferState = {
        ...initialTransfer,
        open: true,
        step: 'confirm',
        workspaceId: 'ws-1',
        destination,
      };
      const channel = stdChannel();
      const dispatch = vi.fn((action) => {
        importState = workspaceImportReducer(importState, action);
        transferState = workspaceTransferReducer(transferState, action);
        channel.put(action);
      });
      const task = runSaga(
        {
          channel,
          dispatch,
          getState: () => ({ workspaceImport: importState, workspaceTransfer: transferState }),
        },
        kind === 'file' ? workspaceImportSaga : workspaceTransferSaga,
      );

      try {
        dispatch(
          kind === 'file'
            ? importStartRequested({ reuseLastFile: false })
            : transferStartRequested(),
        );
        if (kind === 'remote') {
          await vi.waitFor(() =>
            expect(sourceRequest).toHaveBeenCalledWith('workspace.export.start', {
              workspaceId: 'ws-1',
            }),
          );
          for (const listener of listeners)
            listener({
              method: 'events.event',
              params: {
                event: {
                  type: 'workspace:transfer:ready',
                  data: {
                    workspaceId: 'ws-1',
                    exportId: 'export-1',
                    manifest: { formatVersion: 1, workspaceId: 'ws-1' },
                    archiveSizeBytes: bytes.length,
                    archiveSha256: 'ab'.repeat(32),
                    maxChunkBytes: 64,
                    totalChunks: 1,
                  },
                },
              },
            });
        }
        await vi.waitFor(() =>
          expect(kind === 'file' ? importState.runStatus : transferState.runStatus).toBe('failed'),
        );
        expect(request).toHaveBeenCalledWith(
          'workspace.import.commit',
          { importId: 'import-1' },
          { timeoutMs: 600_000 },
        );
        const onRetry = vi.fn();
        if (kind === 'file') {
          expect(invoke).toHaveBeenCalledWith('transfer:import-start', { reuseLastFile: false });
          const Modal = (await import('../../../lib/components/modals/ImportWorkspaceModal.svelte'))
            .default;
          render(Modal, { props: { ...importState, onRetry } });
        } else {
          expect(invoke).toHaveBeenCalledWith('transfer:start', {
            workspaceId: 'ws-1',
            destination,
          });
          const Modal = (
            await import('../../../lib/components/modals/TransferWorkspaceModal.svelte')
          ).default;
          render(Modal, { props: { ...transferState, onRetry } });
        }
        const reason = screen.getByTestId(
          kind === 'file' ? 'import-failed-reason' : 'transfer-failed-reason',
        );
        expect(reason.textContent).toContain(detail);
        expect(reason.textContent).not.toContain('private-marker');
        expect(logger.warn).toHaveBeenCalledWith(
          kind === 'file' ? 'workspace import failed' : 'workspace transfer failed',
          expect.objectContaining({ error: expect.stringContaining(detail) }),
        );
        expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('private-marker');
        await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        expect(onRetry).toHaveBeenCalledOnce();
      } finally {
        task.cancel();
        invoke.mockRestore();
      }
    },
  );
});
