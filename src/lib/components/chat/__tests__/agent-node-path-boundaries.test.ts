/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, fireEvent, screen, waitFor, within } from '@testing-library/svelte';
import { store as appStore } from '$store/renderer/store';
import { chatChangesSaga } from '$store/renderer/slices/chat-changes/sagas/chat-changes-saga';
import { gitConsumerReadSaga } from '$store/renderer/slices/git/sagas/git-consumer-read-saga';
import {
  bulkUpsertSessions,
  removeSession,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import { AgentId, WorkspaceId } from '$shared/types/branded-ids';
import { agentFileRefreshTriggered } from '$store/renderer/slices/chat-changes/chat-changes-slice';
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
  default: (
    await import('$features/file-tracking/components/diff/__tests__/mocks/MockDiffViewer.svelte')
  ).default,
  hashContent: (content: string) => content,
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
let stopOwners: (() => void)[];

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
  stopOwners = [appStore.runSaga(chatChangesSaga), appStore.runSaga(gitConsumerReadSaga)];
  appStore.dispatch(bulkUpsertSessions([agent()]));
  restoreExternal = overrideMockIpcHandler('shell:openExternal', openExternal);
  openExternal.mockClear();
});
afterEach(() => {
  cleanup();
  for (const stop of stopOwners) stop();
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

describe('nested agent path policies', () => {
  for (const [renderer, component] of [
    ['static', MessageContent],
    ['streaming', StreamingMessageContent],
  ] as const) {
    for (const kind of ['thinking', 'history', 'nav fence', 'nav block'] as const) {
      it(`${renderer} ${kind} preserves click-time provenance and local/note/web routes`, async () => {
        const links =
          '[File](src/a.ts) [Note](intent://local/note/spec) [Web](https://example.com).';
        const content =
          kind === 'thinking'
            ? [{ type: 'thinking', text: links }]
            : kind === 'history'
              ? [
                  { type: 'text', text: '<group:Prepping>' },
                  { type: 'thinking', text: links },
                  { type: 'text', text: '</group:Prepping>Done.' },
                ]
              : kind === 'nav fence'
                ? [
                    {
                      type: 'text',
                      text: '```nav-link\n{"target":"intent://local/file/src/a.ts","label":"File"}\n```\n```nav-link\n{"target":"intent://local/note/spec","label":"Note"}\n```',
                    },
                  ]
                : [
                    { type: 'nav-link', target: 'intent://local/file/src/a.ts', label: 'File' },
                    { type: 'nav-link', target: 'intent://local/note/spec', label: 'Note' },
                  ];
        appStore.dispatch(
          bulkUpsertSessions([agent({ placement: undefined, nodePath: undefined })]),
        );
        render(component, { agentId: id, workspaceId, content, isStreaming: kind === 'thinking' });
        for (const disclosure of screen.queryAllByTestId(
          /^(reasoning|response-group)-disclosure$/,
        )) {
          if (disclosure.getAttribute('aria-expanded') === 'false')
            await fireEvent.click(disclosure);
        }
        if (kind === 'history') {
          const historyRow = await screen.findByTestId('reasoning-history-row');
          await fireEvent.click(within(historyRow).getByRole('button', { expanded: false }));
        }
        const link = await screen.findByRole('link', { name: 'File' });
        if (kind === 'thinking')
          expect(link.closest('[data-reasoning-expanded-body]')).not.toBeNull();
        if (kind === 'history')
          expect(link.closest('[data-reasoning-history-body]')).not.toBeNull();
        appStore.dispatch(bulkUpsertSessions([agent()]));
        const dispatch = vi.spyOn(appStore, 'dispatch');
        await fireEvent.click(link);
        await fireEvent.keyDown(link, { key: 'Enter', ctrlKey: true, metaKey: true });
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(
          dispatch.mock.calls.filter(([a]) => a.type === 'workspaceNavigation/openWorkspaceFile'),
        ).toEqual([]);
        expect(openExternal).not.toHaveBeenCalled();
        await fireEvent.click(await screen.findByRole('link', { name: 'Note' }));
        await waitFor(() =>
          expect(
            dispatch.mock.calls.some(([a]) => a.type === 'workspaceNavigation/openWorkspaceNote'),
          ).toBe(true),
        );
        if (kind === 'thinking' || kind === 'history') {
          await fireEvent.click(await screen.findByRole('link', { name: 'Web' }));
          await waitFor(() =>
            expect(openExternal).toHaveBeenCalledWith({ url: 'https://example.com/' }),
          );
        }
        appStore.dispatch(
          bulkUpsertSessions([agent({ placement: undefined, nodePath: undefined })]),
        );
        dispatch.mockClear();
        await fireEvent.click(link);
        await waitFor(() =>
          expect(
            dispatch.mock.calls.filter(([a]) => a.type === 'workspaceNavigation/openWorkspaceFile'),
          ).toHaveLength(1),
        );
      });
    }
  }
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('placement changes during lazy diff reads', () => {
  for (const mode of ['per-turn', 'aggregate', 'staging', 'refresh'] as const) {
    for (const phase of ['git.diffs', 'file.read'] as const) {
      for (const recorded of [false, true]) {
        it(`${mode}: invalidates pending ${phase} and keeps ${recorded ? 'recorded' : 'unavailable'} remote content`, async () => {
          const pending = deferred<unknown>();
          const path = 'src/pending.ts';
          let refreshing = mode !== 'refresh';
          backend.onRequest('git.numstat', () => []);
          backend.onRequest('git.diffs', () =>
            !refreshing ? [] : phase === 'git.diffs' ? pending.promise : [{ path, hunks: [] }],
          );
          backend.onRequest('file.read', () =>
            phase === 'file.read' ? pending.promise : { content: 'HEAD NEW' },
          );
          backend.onRequest('git.showFile', () => ({ content: 'HEAD OLD' }));
          appStore.dispatch(
            bulkUpsertSessions([agent({ placement: undefined, nodePath: undefined })]),
          );
          const change = {
            filePath: path,
            action: 'modify' as const,
            additions: 1,
            deletions: 1,
            toolName: 'edit_file',
            toolCallId: 'pending-edit',
          };
          const modeProps = {
            isAggregate: mode === 'aggregate',
            showStagingControls: mode === 'staging' || mode === 'refresh',
          };
          const view = render(ChatChangesPanelHarness, {
            agentId: id,
            changes: [change],
            ...modeProps,
          });
          if (mode === 'refresh') {
            await screen.findByRole('button', { name: 'Open file' });
            backend.requests.length = 0;
            refreshing = true;
            appStore.dispatch(agentFileRefreshTriggered(workspaceId, path));
          }
          await waitFor(() => expect(backend.requests.some((r) => r.method === phase)).toBe(true));
          const readsBefore = backend.requests.length;
          appStore.dispatch(bulkUpsertSessions([agent()]));
          await view.rerender({
            agentId: id,
            ...modeProps,
            changes: [
              recorded
                ? { ...change, oldContent: 'RECORDED OLD', newContent: 'RECORDED NEW' }
                : change,
            ],
          });
          pending.resolve(phase === 'git.diffs' ? [{ path, hunks: [] }] : { content: 'HEAD NEW' });
          await new Promise((resolve) => setTimeout(resolve, 20));
          expect(
            backend.requests
              .slice(readsBefore)
              .filter((r) => ['git.diffs', 'git.showFile', 'file.read'].includes(r.method)),
          ).toEqual([]);
          if (recorded)
            await waitFor(() =>
              expect(screen.getByTestId('new-content').textContent).toBe('RECORDED NEW'),
            );
          else
            await screen.findByText(
              'This file’s content is unavailable in the recorded tool output.',
            );
          expect(document.body.textContent).not.toContain('HEAD NEW');
          expect(document.body.textContent).not.toContain('HEAD OLD');
        });
      }
    }
  }
});

describe('parent diff read controls', () => {
  const path = 'src/local-parent.ts';
  const change = {
    filePath: path,
    action: 'modify' as const,
    additions: 1,
    deletions: 0,
    toolName: 'edit_file',
    toolCallId: 'local-parent',
  };
  const diff = [
    {
      path,
      hunks: [
        {
          oldStart: 1,
          oldLines: 0,
          newStart: 1,
          newLines: 1,
          lines: [{ type: 'Addition', content: 'LOCAL NEW', newNumber: 1 }],
        },
      ],
    },
  ];
  for (const mode of ['aggregate', 'staging', 'refresh'] as const) {
    it(`keeps ${mode} head reads working while the agent stays local`, async () => {
      appStore.dispatch(bulkUpsertSessions([agent({ placement: undefined, nodePath: undefined })]));
      backend.onRequest('git.numstat', () => []);
      backend.onRequest('git.diffs', (params) =>
        (params as { staged?: boolean })?.staged ? [] : diff,
      );
      backend.onRequest('git.showFile', () => ({ content: 'LOCAL OLD' }));
      let content = 'LOCAL NEW';
      backend.onRequest('file.read', () => ({ content }));
      render(ChatChangesPanelHarness, {
        agentId: id,
        changes: [change],
        isAggregate: mode === 'aggregate',
        showStagingControls: mode !== 'aggregate',
      });
      await waitFor(() => expect(screen.getByTestId('new-content').textContent).toBe('LOCAL NEW'));
      if (mode === 'refresh') {
        content = 'LOCAL REFRESHED';
        appStore.dispatch(agentFileRefreshTriggered(workspaceId, path));
        await waitFor(() =>
          expect(screen.getByTestId('new-content').textContent).toBe('LOCAL REFRESHED'),
        );
      }
      expect(backend.requests.some((r) => r.method === 'file.read')).toBe(true);
    });
  }
  for (const mode of ['per-turn', 'aggregate', 'staging'] as const) {
    it(`cancels ${mode} enrichment when the panel unmounts`, async () => {
      appStore.dispatch(bulkUpsertSessions([agent({ placement: undefined, nodePath: undefined })]));
      const pending = deferred<unknown>();
      backend.onRequest('git.numstat', () => []);
      backend.onRequest('git.diffs', () => pending.promise);
      const view = render(ChatChangesPanelHarness, {
        agentId: id,
        changes: [change],
        isAggregate: mode === 'aggregate',
        showStagingControls: mode === 'staging',
      });
      await waitFor(() =>
        expect(backend.requests.some((r) => r.method === 'git.diffs')).toBe(true),
      );
      const before = backend.requests.length;
      view.unmount();
      pending.resolve(diff);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(backend.requests.slice(before)).toEqual([]);
    });
  }
});

describe('agent media provenance before mounting', () => {
  for (const [renderer, component] of [
    ['static', MessageContent],
    ['streaming', StreamingMessageContent],
  ] as const) {
    for (const kind of [
      'text',
      'thinking',
      'history',
      'video',
      'nested video',
      'video fence',
    ] as const) {
      it(`${renderer} ${kind} blocks remote media and revokes mounted local media`, async () => {
        const text =
          'Preview ![preview](intent://local/file/output.png) and ![movie](intent://local/file/output.mp4). End.';
        const content =
          kind === 'video fence'
            ? [
                {
                  type: 'text',
                  text: '```ws-block:video\n{"path":"output.mp4","poster":"intent://local/file/poster.png"}\n```',
                },
              ]
            : kind === 'nested video'
              ? [
                  {
                    type: 'tool_result',
                    id: 'orphan-media',
                    tool_use_id: 'unmatched',
                    output: [
                      {
                        type: 'video',
                        source: {
                          kind: 'workspace',
                          url: `workspace-file://${workspaceId}/nested.mp4`,
                          mimeType: 'video/mp4',
                        },
                      },
                    ],
                  },
                ]
              : kind === 'history'
                ? [
                    { type: 'text', text: '<group:Prepping>' },
                    { type: 'thinking', text },
                    { type: 'text', text: '</group:Prepping>Done.' },
                  ]
                : kind === 'video'
                  ? [
                      {
                        type: 'video',
                        source: {
                          kind: 'workspace',
                          url: `workspace-file://${workspaceId}/output.mp4`,
                          mimeType: 'video/mp4',
                        },
                      },
                    ]
                  : [{ type: kind, text }];
        const { container } = render(component, {
          agentId: id,
          workspaceId,
          content,
          isStreaming: kind === 'thinking',
        });
        for (const disclosure of screen.queryAllByTestId(
          /^(reasoning|response-group)-disclosure$/,
        )) {
          if (disclosure.getAttribute('aria-expanded') === 'false')
            await fireEvent.click(disclosure);
        }
        if (kind === 'history') {
          const historyRow = await screen.findByTestId('reasoning-history-row');
          await fireEvent.click(within(historyRow).getByRole('button', { expanded: false }));
        }
        const headMedia = () =>
          container.querySelectorAll(
            'img[src^="workspace-file:"],video[src^="workspace-file:"],video[poster^="workspace-file:"]',
          );
        await waitFor(() =>
          expect(
            container.querySelector('img, video, [data-testid="media-unavailable"]'),
          ).not.toBeNull(),
        );
        expect(headMedia()).toHaveLength(0);
        await waitFor(() =>
          expect(container.querySelector('[data-testid="media-unavailable"]')).not.toBeNull(),
        );
        appStore.dispatch(
          bulkUpsertSessions([agent({ placement: undefined, nodePath: undefined })]),
        );
        await waitFor(() => expect(headMedia().length).toBeGreaterThan(0));
        appStore.dispatch(bulkUpsertSessions([agent()]));
        await waitFor(() => expect(headMedia()).toHaveLength(0));
      });
    }
  }
});

describe('remote media allowed controls', () => {
  for (const [renderer, component] of [
    ['static', MessageContent],
    ['streaming', StreamingMessageContent],
  ] as const) {
    it(`${renderer} preserves web and asset images and embedded transcript bytes`, async () => {
      const { container } = render(component, {
        agentId: id,
        workspaceId,
        content: [
          {
            type: 'text',
            text: `![web](https://example.com/image.png) ![asset](workspace-asset://${workspaceId}/image.png)`,
          },
          { type: 'image', mimeType: 'image/png', data: 'AAAA' },
        ],
      });
      await waitFor(() => expect(container.querySelector('img[src^="https:"]')).not.toBeNull());
      expect(container.querySelector('img[src^="workspace-asset:"]')).not.toBeNull();
      expect(container.querySelector('img[src^="data:"]')).not.toBeNull();
    });
  }
});
