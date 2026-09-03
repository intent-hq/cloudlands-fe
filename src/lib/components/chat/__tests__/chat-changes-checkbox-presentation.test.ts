// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { dispatchMock } = vi.hoisted(() => ({ dispatchMock: vi.fn() }));

vi.mock('$lib/utils/workspace-route-context', () => ({
  getWorkspaceRouteContext: () => ({ workspaceId: 'workspace-1' }),
}));

vi.mock('$store/renderer/store', () => ({
  store: { dispatch: dispatchMock, state: {} },
}));

vi.mock('$store/renderer/slices/ui-layout/ui-layout-selectors', () => ({
  selectFoldUnchanged: () => ({
    subscribe: (run: (value: boolean) => void) => (run(false), vi.fn()),
  }),
  selectLineWrapping: () => ({
    subscribe: (run: (value: boolean) => void) => (run(false), vi.fn()),
  }),
}));

vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceById: () => ({
    subscribe: (run: (value: undefined) => void) => (run(undefined), vi.fn()),
  }),
}));

vi.mock('$store/renderer/slices/changes/changes-selectors', () => ({
  selectCurrentCommits: () => ({
    subscribe: (run: (value: never[]) => void) => (run([]), vi.fn()),
  }),
}));

vi.mock('$store/renderer/slices/chat-changes/chat-changes-selectors', () => ({
  selectAgentFileRefreshes: () => ({
    subscribe: (run: (value: never[]) => void) => (run([]), vi.fn()),
  }),
}));

vi.mock('$store/renderer/slices/agent-lock/agent-lock-selectors', () => ({
  selectLockedFilePaths: () => ({
    subscribe: (run: (value: Record<string, true>) => void) => (run({}), vi.fn()),
  }),
}));

vi.mock('$store/renderer/slices/transient-ui/transient-ui-selectors', () => ({
  selectViewedFiles: { select: () => ({}) },
}));

vi.mock('$store/renderer/slices/workspace-notes/workspace-notes-selectors', () => ({
  selectNoteById: { select: () => undefined },
}));

vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => ({
  selectAgentSession: { select: () => undefined },
}));

vi.mock('$features/layout/panel-layout-adapter', () => ({
  getPanelLayoutManager: vi.fn(),
}));

vi.mock('$features/git/git.client', () => ({ gitClient: {} }));
vi.mock('$features/git/git-cache', () => ({ gitCache: {} }));

vi.mock('$features/file-tracking/components/diff/diff-ipc-batcher', () => ({
  batchedGitBranchBaseDiff: vi.fn(),
  batchedGitDiff: vi.fn(),
  dedupedGitNumstat: vi.fn(),
  dedupedShowFile: vi.fn(),
}));

vi.mock('$lib/components/ui/toast', () => ({ toast: vi.fn() }));

vi.mock('@pierre/diffs', () => ({
  Virtualizer: class {
    setup() {}
    cleanUp() {}
  },
}));

vi.mock('../InlineDiffItem.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));

vi.mock('../CombinedInlineDiffItem.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));

vi.mock('$features/agent/components/agent-avatar/AgentAvatar.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));

import ChatChangesPanel from '../ChatChangesPanel.svelte';

class IntersectionObserverMock implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = '0px';
  readonly thresholds = [0];
  disconnect = vi.fn();
  observe = vi.fn();
  takeRecords = vi.fn(() => []);
  unobserve = vi.fn();
}

beforeEach(() => {
  dispatchMock.mockReset();
  vi.stubGlobal('IntersectionObserver', IntersectionObserverMock);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.scrollTo = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ChatChangesPanel viewed Toggle', () => {
  it('updates viewed state without triggering the file-header disclosure', async () => {
    const filePath = 'src/example.ts';
    const { container, getByRole, getByText } = render(ChatChangesPanel, {
      props: {
        changes: [
          {
            filePath,
            action: 'modify',
            additions: 1,
            deletions: 1,
            toolName: 'edit_file',
            toolCallId: 'tool-1',
            oldContent: 'const value = 1;',
            newContent: 'const value = 2;',
          },
        ],
      },
    });

    const header = await waitFor(() => {
      const element = container.querySelector<HTMLElement>(
        `[data-change-header-key="${filePath}"]`,
      );
      expect(element).toBeTruthy();
      return element!;
    });
    const toggle = getByRole('button', { name: 'Viewed', pressed: false });

    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(header.style.borderBottom).not.toBe('transparent');

    await fireEvent.click(toggle);

    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(getByText('1 viewed')).toBeTruthy();
    expect(header.style.borderBottom).toBe('1px solid transparent');
    expect(dispatchMock).toHaveBeenLastCalledWith({
      type: 'transientUi/setViewedFiles',
      payload: ['workspace-1', { [filePath]: '' }],
    });

    await fireEvent.click(toggle);

    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(header.style.borderBottom).not.toBe('transparent');
    expect(dispatchMock).toHaveBeenLastCalledWith({
      type: 'transientUi/setViewedFiles',
      payload: ['workspace-1', {}],
    });
  });
});
