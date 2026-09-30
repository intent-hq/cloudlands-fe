/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';
import type { PanelLayoutSliceState } from '$store/renderer/slices/panel-layout/panel-layout-types';
import { warmImport } from '../../../../test/warm-import';

// Keep Markdown processing, both link handlers, selectors, and action creators real.
// Observe the app boundaries instead of mocking handleLink at the component boundary.
const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  invoke: vi.fn().mockResolvedValue(undefined),
  backendRequest: vi.fn(),
  navigateToRoute: vi.fn(),
  openBrowserPanel: vi.fn(),
  getPanelLayoutManager: vi.fn(),
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  const { createCollection } = await import('@themislib/themis/utils/collections/collection-utils');
  return createAppStoreMockModule({
    state: {
      tabState: { currentTabId: 'active-workspace' },
      workspace: {
        workspaces: createCollection('id', [
          {
            id: 'owning-workspace',
            worktreePath: '/host/worktrees/owner',
            path: '/host/clone',
          },
          {
            id: 'active-workspace',
            worktreePath: '/host/worktrees/active',
            path: '/host/clone',
          },
        ]),
      },
    },
    dispatch: mocks.dispatch,
  });
});
vi.mock('$shared/generated/ipc-client', () => ({ invoke: mocks.invoke }));
vi.mock('$lib/client/live/backend-transport', () => ({ backendRequest: mocks.backendRequest }));
vi.mock('$lib/utils/navigation.client', () => ({ navigateToRoute: mocks.navigateToRoute }));
vi.mock('$features/layout/panel-layout-adapter', () => ({
  getPanelLayoutManager: mocks.getPanelLayoutManager,
}));
vi.mock('$lib/utils/browser-link-open', () => ({
  resolveBrowserLinkForOpen: async (url: string) => ({ url }),
}));
vi.mock('$lib/components/patterns/notify', () => ({
  notify: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

warmImport(() => import('../MarkdownViewer.svelte'));
warmImport(() => import('$store/renderer/slices/workspace/workspace-selectors'));
warmImport(() => import('$lib/utils/workspaces-link-handler'));
warmImport(
  () => import('$store/renderer/slices/workspace-navigation/sagas/workspace-navigation-tab-saga'),
);

let originalUrl: string;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.backendRequest.mockResolvedValue({ note: { id: 'spec', title: 'Spec' } });
  mocks.getPanelLayoutManager.mockReturnValue({ openBrowserPanel: mocks.openBrowserPanel });
  originalUrl = window.location.href;
  window.history.replaceState({}, '', '/workspace/active-workspace/agent/chat?panel=other');
});
afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', originalUrl);
});

async function renderLink(href: string, isStreaming = false) {
  const MarkdownViewer = (await import('../MarkdownViewer.svelte')).default;
  const view = render(MarkdownViewer, {
    props: {
      content: `[**Open target**](${href})`,
      workspaceId: 'owning-workspace',
      isStreaming,
    },
  });
  view.container.setAttribute('data-panel-id', 'panel-chat');
  const link = (await screen.findByRole('link', { name: 'Open target' })) as HTMLAnchorElement;
  return { ...view, link };
}

function expectNoBrowserOrEditor() {
  expect(mocks.invoke).not.toHaveBeenCalled();
  expect(mocks.getPanelLayoutManager).not.toHaveBeenCalled();
  expect(mocks.openBrowserPanel).not.toHaveBeenCalled();
  expect(mocks.navigateToRoute).not.toHaveBeenCalled();
}

async function expectFile(path: string, line?: number, adjacent = false) {
  await waitFor(() =>
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'workspaceNavigation/openWorkspaceFile',
      payload: [
        'owning-workspace',
        path,
        {
          filePathIsLiteral: true,
          line,
          openInAdjacentPanel: adjacent,
          sourcePanelId: 'panel-chat',
        },
      ],
    }),
  );
  // No duplicate file open or accidental navigation action from a bubbling click.
  expect(mocks.dispatch.mock.calls.map(([action]) => action.type)).toEqual([
    'panelLayout/focusPanel',
    'workspaceNavigation/openWorkspaceFile',
  ]);
  expect(mocks.backendRequest).not.toHaveBeenCalled();
  expectNoBrowserOrEditor();

  // Consume the actual action through the production saga and layout reducer.
  // A decoded literal suffix must still be intact in the opened tab, not merely
  // at the link handler's dispatch boundary.
  const { workspaceNavigationTabSaga } =
    await import('$store/renderer/slices/workspace-navigation/sagas/workspace-navigation-tab-saga');
  const { panelLayoutReducer, emptyWorkspaceState } =
    await import('$store/renderer/slices/panel-layout/panel-layout-slice');
  let layout: PanelLayoutSliceState = {
    byWorkspaceId: {
      'owning-workspace': {
        ...emptyWorkspaceState,
        root: {
          type: 'split',
          direction: 'horizontal',
          children: [
            { type: 'panel', panelId: 'panel-chat' },
            { type: 'panel', panelId: 'panel-right' },
          ],
          sizes: [50, 50],
        },
        columnCount: 2,
        focusedPanelId: 'panel-chat',
        panels: {
          'panel-chat': {
            id: 'panel-chat',
            tabs: [{ id: 'agent-tab', type: 'agent', title: 'Agent', agentId: 'agent-1' }],
            activeTabId: 'agent-tab',
          },
          'panel-right': { id: 'panel-right', tabs: [], activeTabId: null },
        },
      },
    },
  };
  const channel = stdChannel();
  const task = runSaga(
    {
      channel,
      dispatch: (action) => {
        layout = panelLayoutReducer(layout, action);
      },
      getState: () => ({ panelLayout: layout }),
    },
    workspaceNavigationTabSaga,
  );
  try {
    channel.put(mocks.dispatch.mock.calls[1][0]);
    const panels = Object.values(layout.byWorkspaceId['owning-workspace']!.panels);
    const tabs = panels.flatMap((panel) => panel.tabs).filter((tab) => tab.type === 'file');
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toMatchObject({
      type: 'file',
      workspaceId: 'owning-workspace',
      filePath: path,
      title: path.split('/').pop(),
    });
    expect(tabs[0].data?.line).toBe(line);
    const targetPanel = panels.find((panel) => panel.tabs.includes(tabs[0]))!;
    expect(targetPanel.activeTabId).toBe(tabs[0].id);
    expect(targetPanel.id === 'panel-chat').toBe(!adjacent);
  } finally {
    task.cancel();
    await task.toPromise();
  }
}

describe.each([false, true])('rendered file links (streaming=%s)', (isStreaming) => {
  it.each([
    ['docs/design.md', 'docs/design.md', undefined],
    ['/host/worktrees/owner/docs/design.md', 'docs/design.md', undefined],
    ['./packages/cloudlands-fe/src/app.ts:17:4', 'packages/cloudlands-fe/src/app.ts', 17],
    [
      '/host/worktrees/owner/packages/cloudlands-fe/src/app.ts#L17',
      'packages/cloudlands-fe/src/app.ts',
      17,
    ],
    ['docs/r%C3%A9sum%C3%A9%20%231%3F%25.md#L23', 'docs/résumé #1?%.md', 23],
    ['/host/worktrees/owner/docs/r%C3%A9sum%C3%A9%20%231%3F%25.md:23', 'docs/résumé #1?%.md', 23],
    ['docs/literal%2520%23L42.md', 'docs/literal%20#L42.md', undefined],
    ['docs/filename%23L42', 'docs/filename#L42', undefined],
    ['docs/filename%3A17', 'docs/filename:17', undefined],
    ['docs/design.md%23L42', 'docs/design.md#L42', undefined],
    ['/host/worktrees/owner/docs/design.md%3A17', 'docs/design.md:17', undefined],
    ['docs/design.md%23L42#L9', 'docs/design.md#L42', 9],
    ['/host/worktrees/owner/docs/design.md%3A17:9', 'docs/design.md:17', 9],
    ['readme.md:17', 'readme.md', 17],
    ['readme.md:17:4', 'readme.md', 17],
  ])('opens %s in the message owner', async (href, path, line) => {
    const { link } = await renderLink(href, isStreaming);
    // The sanitizer disambiguates a bare filename:line from a URL scheme.
    const renderedHref = href.startsWith('readme.md:') ? `./${href}` : href;
    expect(link.getAttribute('href')).toBe(renderedHref);
    expect(link.href).toBe(new URL(renderedHref, window.location.href).href);
    if (href === 'docs/design.md') {
      // The DOM resolves against the nested app route; navigation must use the raw href.
      expect(link.pathname).toBe('/workspace/active-workspace/agent/docs/design.md');
    }
    expect(await fireEvent.click(link.querySelector('strong')!)).toBe(false);
    await expectFile(path, line);
  });

  it('keeps canonical app file links in the owning workspace', async () => {
    const { link } = await renderLink('intent://local/file/docs/report%20%231.pdf#L8', isStreaming);
    expect(await fireEvent.click(link)).toBe(false);
    await expectFile('docs/report #1.pdf', 8);
  });

  it.each([
    ['intent://local/file/docs/design.md%23L42', 'docs/design.md#L42', undefined],
    ['intent://local/owning-workspace/file/docs/design.md%3A17', 'docs/design.md:17', undefined],
    ['intent://local/file/docs/design.md%23L42#L9', 'docs/design.md#L42', 9],
    ['intent://local/file/docs/design.md%3A17:9', 'docs/design.md:17', 9],
    ['intent://local/file/docs/literal%2523L42', 'docs/literal%23L42', undefined],
  ])('preserves the literal filename in app link %s', async (href, path, line) => {
    const { link } = await renderLink(href, isStreaming);
    expect(await fireEvent.click(link)).toBe(false);
    await expectFile(path, line);
  });
});

describe('rendered navigation controls', () => {
  it('routes the completed link after a streaming render is replaced', async () => {
    const view = await renderLink('docs/draft.md', true);
    await fireEvent.click(view.link);
    await expectFile('docs/draft.md');
    mocks.dispatch.mockClear();

    await view.rerender({
      content: '[Final file](/host/worktrees/owner/docs/final%20report.md#L31)',
      isStreaming: false,
    });
    const finalLink = await screen.findByRole('link', { name: 'Final file' });
    expect(screen.queryByRole('link', { name: 'Open target' })).toBeNull();
    expect(await fireEvent.click(finalLink)).toBe(false);
    await expectFile('docs/final report.md', 31);
  });

  it.each(['click', 'enter'] as const)(
    'opens modified file %s beside its source panel',
    async (activation) => {
      const { link } = await renderLink('docs/design.md#L12');
      const modifiers = { ctrlKey: true, metaKey: true };
      const accepted =
        activation === 'click'
          ? await fireEvent.click(link, modifiers)
          : await fireEvent.keyDown(link, { key: 'Enter', ...modifiers });
      expect(accepted).toBe(false);
      await expectFile('docs/design.md', 12, true);
    },
  );

  it.each([false, true])('opens a note in the owner (modified=%s)', async (modified) => {
    const { link } = await renderLink('intent://local/note/spec');
    expect(await fireEvent.click(link, { ctrlKey: modified, metaKey: modified })).toBe(false);
    await waitFor(() =>
      expect(mocks.dispatch).toHaveBeenCalledWith({
        type: 'workspaceNavigation/openWorkspaceNote',
        payload: [
          'owning-workspace',
          'spec',
          {
            openInAdjacentPanel: modified,
            openInNewAdjacentPanel: false,
            sourcePanelId: 'panel-chat',
          },
        ],
      }),
    );
    expect(mocks.backendRequest).toHaveBeenCalledWith('note.get', {
      workspaceId: 'owning-workspace',
      noteId: 'spec',
    });
    expectNoBrowserOrEditor();
  });

  it('opens a plain web link in the external browser', async () => {
    const { link } = await renderLink('https://example.com/docs');
    expect(await fireEvent.click(link)).toBe(false);
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith('shell:openExternal', {
        url: 'https://example.com/docs',
      }),
    );
    expect(mocks.dispatch).not.toHaveBeenCalled();
    expect(mocks.openBrowserPanel).not.toHaveBeenCalled();
    expect(mocks.navigateToRoute).not.toHaveBeenCalled();
  });

  it('opens a modified web link in the owning workspace browser panel', async () => {
    const { link } = await renderLink('https://example.com/docs');
    expect(await fireEvent.click(link, { ctrlKey: true, metaKey: true })).toBe(false);
    await waitFor(() =>
      expect(mocks.openBrowserPanel).toHaveBeenCalledWith(
        'https://example.com/docs',
        undefined,
        'panel-chat',
        undefined,
      ),
    );
    expect(mocks.getPanelLayoutManager).toHaveBeenCalledWith('owning-workspace');
    expect(mocks.dispatch.mock.calls.map(([action]) => action.type)).toEqual([
      'panelLayout/focusPanel',
    ]);
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.navigateToRoute).not.toHaveBeenCalled();
  });
});
