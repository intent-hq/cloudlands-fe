/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, fireEvent, screen, waitFor } from '@testing-library/svelte';
import { store as appStore } from '$store/renderer/store';
import {
  bulkUpsertSessions,
  removeSession,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import { AgentId, WorkspaceId } from '$shared/types/branded-ids';
import { AgentStatus, type AgentSession } from '$shared/types';
import { overrideMockIpcHandler } from '$shared/ipc-mock-router';
import { handleLink } from '$features/navigation/link-handler';
const openExternal = vi.fn();
let restoreExternal: () => void;
import MessageContent from '$lib/components/chat/MessageContent.svelte';
import StreamingMessageContent from '$lib/components/chat/StreamingMessageContent.svelte';
import ChatChangesPanelHarness from '$lib/components/chat/ChatChangesPanelHarness.svelte';
import ToolDetails from '$lib/components/chat/ToolDetails.svelte';
import { getFileChangesFromMessages } from '$lib/utils/get-file-changes-from-messages';
vi.mock('$features/file-tracking/components/diff/DiffViewer.svelte', async () => ({
  default: (await import('$lib/components/chat/__tests__/mocks/SlotOnly.svelte')).default,
}));
vi.mock(
  '$lib/client/live/backend-transport',
  async () => (await import('@/test/mocks/backend-transport.mock')).mockBackendTransportModule,
);
import {
  installMockBackend,
  resetMockBackend,
  type MockBackendHandle,
} from '@/test/mocks/backend-transport.mock';
import TrackedChangeDiffViewer from '$features/file-tracking/components/diff/TrackedChangeDiffViewer.svelte';
import { ChangeStage } from '$features/file-tracking/types';
let backend: MockBackendHandle;

const id = 'remote-review';
const workspaceId = 'preview-chat-changes';
const agent = (fields: Partial<AgentSession> = {}): AgentSession => ({
  id: AgentId(id),
  workspaceId: WorkspaceId(workspaceId),
  backendSessionId: null,
  name: 'Remote',
  status: AgentStatus.Halted,
  messages: [],
  createdAt: '2026-09-28T08:00:00Z',
  updatedAt: '2026-09-28T08:00:00Z',
  placement: { target: 'remote', checkout: 'isolated' },
  nodeId: 'node-build',
  leaseId: 'lease-build',
  effectiveIsolation: 'isolated',
  nodeState: 'offline',
  nodePath: '/node-only',
  ...fields,
});
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      callback: IntersectionObserverCallback;
      constructor(cb: IntersectionObserverCallback) {
        this.callback = cb;
      }
      observe(target: Element) {
        queueMicrotask(() =>
          this.callback(
            [{ isIntersecting: true, target } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver,
          ),
        );
      }
      disconnect() {}
      unobserve() {}
    },
  );
  backend = installMockBackend();
  backend.onRequest('git.diffs', () => [{ path: 'src/no-content.ts', hunks: [] }]);
  backend.onRequest('git.showFile', () => ({ content: 'head old' }));
  backend.onRequest('file.read', () => ({ content: 'head new' }));
  backend.onRequest('note.get', () => ({
    note: {
      id: 'spec',
      title: 'Spec',
      content: '',
      tags: [],
      createdAt: '2026-09-28T08:00:00Z',
      updatedAt: '2026-09-28T08:00:00Z',
    },
  }));
  appStore.init();
  appStore.dispatch(bulkUpsertSessions([agent()]));
  restoreExternal = overrideMockIpcHandler('shell:openExternal', openExternal);
  openExternal.mockClear();
});
afterEach(() => {
  cleanup();
  restoreExternal();
  appStore.dispatch(removeSession(id));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetMockBackend();
});
describe('node path boundaries', () => {
  for (const [label, component] of [
    ['static', MessageContent],
    ['streaming', StreamingMessageContent],
  ] as const) {
    for (const href of ['src/file.ts', 'intent://local/file/src/file.ts']) {
      it(label + ' guards ' + href + ' at click time and preserves local control', async () => {
        appStore.dispatch(
          bulkUpsertSessions([agent({ placement: undefined, nodePath: undefined })]),
        );
        const spy = vi.spyOn(appStore, 'dispatch');
        render(component, {
          agentId: id,
          workspaceId,
          content: [{ type: 'text', text: `[Remote file](${href})` }],
        });
        const link = await screen.findByRole('link', { name: 'Remote file' });
        appStore.dispatch(bulkUpsertSessions([agent()]));
        spy.mockClear();
        openExternal.mockClear();
        await fireEvent.click(link);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(
          spy.mock.calls.filter(([a]) => a.type === 'workspaceNavigation/openWorkspaceFile'),
        ).toEqual([]);
        expect(openExternal.mock.calls).toEqual([]);
        appStore.dispatch(
          bulkUpsertSessions([agent({ placement: undefined, nodePath: undefined })]),
        );
        await fireEvent.click(link);
        await waitFor(() => {
          expect(
            spy.mock.calls.filter(([a]) => a.type === 'workspaceNavigation/openWorkspaceFile'),
          ).toHaveLength(1);
        });
      });
    }
    it(label + ' keeps remote web and note links usable', async () => {
      const spy = vi.spyOn(appStore, 'dispatch');
      render(component, {
        agentId: id,
        workspaceId,
        content: [
          { type: 'text', text: '[Web](https://example.com) [Note](intent://local/note/spec)' },
        ],
      });
      await fireEvent.click(await screen.findByRole('link', { name: 'Web' }));
      await waitFor(() =>
        expect(openExternal).toHaveBeenCalledWith({ url: 'https://example.com/' }),
      );
      await fireEvent.click(await screen.findByRole('link', { name: 'Note' }));
      await waitFor(() =>
        expect(
          spy.mock.calls.some(([a]) => a.type === 'workspaceNavigation/openWorkspaceNote'),
        ).toBe(true),
      );
    });
    it(label + ' nested tool file must keep remote agent provenance', async () => {
      const spy = vi.spyOn(appStore, 'dispatch');
      render(component, {
        agentId: id,
        workspaceId,
        content: [
          {
            type: 'tool_result',
            id: 'orphan',
            tool_use_id: 'unmatched-call',
            output: [
              {
                type: 'tool_use',
                id: 'nested-read',
                name: 'read_file',
                input: { path: '/node-only/nested.ts' },
              },
            ],
          },
        ],
      });
      const link = await screen.findByTestId('tool-call-file-link');
      await fireEvent.click(link);
      expect(
        spy.mock.calls.filter(([a]) => a.type === 'workspaceNavigation/openWorkspaceFile'),
      ).toEqual([]);
      appStore.dispatch(bulkUpsertSessions([agent({ placement: undefined, nodePath: undefined })]));
      spy.mockClear();
      await fireEvent.click(link);
      expect(
        spy.mock.calls.filter(([a]) => a.type === 'workspaceNavigation/openWorkspaceFile'),
      ).toHaveLength(1);
    });
  }
  for (const [name, content] of [
    ['missing', {}],
    ['empty', { oldContent: '', newContent: '' }],
    [
      'raw patch',
      {
        oldContent: '',
        newContent:
          'diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-old\n+new\n',
      },
    ],
  ] as const) {
    it(name + ' transcript diff must not read from head when lazy child mounts', async () => {
      const slimChanges = getFileChangesFromMessages([
        {
          id: 'slim',
          role: 'assistant',
          timestamp: '2026-09-28T08:00:00Z',
          contentBlocks: [
            {
              type: 'tool_use',
              id: 'slim-create',
              name: 'save_file',
              input: { path: 'src/no-content.ts', file_content: 'truncated preview' },
              inputTruncated: true,
            },
          ],
        },
      ]).changes;
      const changes =
        name === 'missing'
          ? slimChanges
          : [
              {
                filePath: 'src/no-content.ts',
                action: 'modify' as const,
                additions: 1,
                deletions: 1,
                toolName: 'edit_file',
                toolCallId: 'edit-empty',
                ...content,
              },
            ];
      expect(changes).toHaveLength(1);
      render(ChatChangesPanelHarness, { agentId: id, isAggregate: true, changes });
      await waitFor(() => expect(document.querySelector('.inline-diff-container')).not.toBeNull());
      await screen.findByText('This file’s content is unavailable in the recorded tool output.');
      const calls = backend.requests.filter((r) =>
        ['git.diffs', 'git.showFile', 'file.read'].includes(r.method),
      );
      expect(calls).toEqual([]);
    });
  }
  for (const parsedResult of [
    { type: 'file-view', content: 'hello' },
    { type: 'file-edit', newContent: 'new' },
    { type: 'file-edit', content: 'edited' },
  ] as const) {
    it(
      'guards ToolDetails ' +
        parsedResult.type +
        ' ' +
        ('newContent' in parsedResult ? 'new' : 'fallback') +
        ' at click time',
      async () => {
        const spy = vi.spyOn(appStore, 'dispatch');
        render(ToolDetails, {
          agentId: id,
          workspaceId,
          input: {},
          result: 'ok',
          parsedResult: {
            ...parsedResult,
            filePath: '/node-only/details.ts',
            fileName: 'details.ts',
          },
        });
        const button = await screen.findByRole('button', { name: /details.ts/ });
        await fireEvent.click(button);
        expect(
          spy.mock.calls.filter(([a]) => a.type === 'workspaceNavigation/openWorkspaceFile'),
        ).toEqual([]);
        appStore.dispatch(removeSession(id));
        appStore.dispatch(
          bulkUpsertSessions([agent({ placement: undefined, nodePath: undefined })]),
        );
        spy.mockClear();
        await fireEvent.click(button);
        expect(
          spy.mock.calls.filter(([a]) => a.type === 'workspaceNavigation/openWorkspaceFile'),
        ).toHaveLength(1);
      },
    );
  }

  it('keeps local lazy content reads working through the backend transport', async () => {
    appStore.dispatch(bulkUpsertSessions([agent({ placement: undefined, nodePath: undefined })]));
    render(ChatChangesPanelHarness, {
      agentId: id,
      changes: [
        {
          filePath: 'src/no-content.ts',
          action: 'modify',
          additions: 1,
          deletions: 1,
          toolName: 'edit_file',
          toolCallId: 'local-empty',
        },
      ],
    });
    await waitFor(() => expect(backend.requests.some((r) => r.method === 'file.read')).toBe(true));
    expect(backend.requests).toEqual(
      expect.arrayContaining([
        { method: 'git.diffs', params: { workspaceId, paths: ['src/no-content.ts'] } },
        {
          method: 'git.showFile',
          params: { workspaceId, filePath: 'src/no-content.ts', ref: ':0' },
        },
        { method: 'file.read', params: { workspaceId, path: 'src/no-content.ts' } },
      ]),
    );
  });
  it('keeps node transcript refreshes from falling back to head reads', async () => {
    const change = {
      id: 'refresh',
      file: 'src/refresh.ts',
      relativePath: 'src/refresh.ts',
      stage: ChangeStage.Unstaged,
      stats: { additions: 1, deletions: 1 },
      attribution: { timestamp: 0 },
    };
    const view = render(TrackedChangeDiffViewer, {
      workspaceId,
      change,
      allowHeadReads: false,
      useProvidedContent: true,
      refreshKey: 0,
    });
    await screen.findByText('This file’s content is unavailable in the recorded tool output.');
    await view.rerender({
      workspaceId,
      change,
      allowHeadReads: false,
      useProvidedContent: true,
      refreshKey: 1,
    });
    await screen.findByText('This file’s content is unavailable in the recorded tool output.');
    expect(
      backend.requests.filter((r) => ['git.diffs', 'git.showFile', 'file.read'].includes(r.method)),
    ).toEqual([]);
  });

  it('checks file URL provenance before requesting the native editor', async () => {
    const canOpenFile = vi.fn(() => false);
    await handleLink('file:///node-only/file.ts', {
      workspaceId: WorkspaceId(workspaceId),
      canOpenFile,
    });
    expect(canOpenFile).toHaveBeenCalledOnce();
    expect(openExternal).not.toHaveBeenCalled();
    canOpenFile.mockReturnValue(true);
    await handleLink('file:///node-only/file.ts', {
      workspaceId: WorkspaceId(workspaceId),
      canOpenFile,
    });
    expect(openExternal).toHaveBeenCalledWith({ url: 'vscode://file//node-only/file.ts' });
  });
});
