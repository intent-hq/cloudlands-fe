/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { store as appStore } from '$store/renderer/store';
import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
import { selectChatChangesConsumers } from '$store/renderer/slices/chat-changes/chat-changes-selectors';
import { selectGitRead } from '$store/renderer/slices/git/git-selectors';
import { gitReadRequested } from '$store/renderer/slices/git/git-slice';
import { backendRequest } from '$lib/client/live/backend-transport';
import Harness, { preview } from '$lib/components/chat/chat-changes-panel.preview';

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(() => {
    throw new Error('Preview attempted a live daemon read');
  }),
  onBackendEvent: vi.fn(() => () => {}),
}));
vi.mock('$features/file-tracking/components/diff/DiffViewer.svelte', async () => ({
  default: (
    await import('$features/file-tracking/components/diff/__tests__/mocks/MockDiffViewer.svelte')
  ).default,
  hashContent: (content: string) => content,
}));

let disposeRoot: () => void;
let disposePreview: void | (() => void);

beforeEach(() => {
  vi.clearAllMocks();
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
      constructor(private callback: IntersectionObserverCallback) {}
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
  disposeRoot = startRootStoreLifecycle(appStore, { startSagas: () => [] });
});

afterEach(() => {
  cleanup();
  disposePreview?.();
  disposePreview = undefined;
  disposeRoot();
  vi.unstubAllGlobals();
});

describe('chat changes preview owner lifecycle', () => {
  it.each(['populated', 'populated-linked', 'remote-offline'])(
    'resolves %s transcript reads without a daemon and disposes its owners',
    async (name) => {
      const state = preview.states[name];
      disposePreview = state.setup?.();
      const view = render(Harness, state.props);
      const expectedCount = name === 'remote-offline' ? 2 : 3;
      await waitFor(() => {
        expect(screen.getAllByTestId('new-content')).toHaveLength(expectedCount);
      });
      expect(screen.getAllByTestId('old-content').map((el) => el.textContent)).toEqual(
        Array(expectedCount).fill('const spacing = 4;\n'),
      );
      expect(screen.getAllByTestId('new-content').map((el) => el.textContent)).toEqual(
        Array(expectedCount).fill('const spacing = 8;\n'),
      );
      expect(backendRequest).not.toHaveBeenCalled();
      expect(
        selectChatChangesConsumers.select(appStore.state, 'preview-chat-changes'),
      ).toHaveLength(1);
      view.unmount();
      disposePreview?.();
      disposePreview = undefined;
      expect(selectChatChangesConsumers.select(appStore.state, 'preview-chat-changes')).toEqual([]);
      appStore.dispatch(
        gitReadRequested('preview-chat-changes', 'after-dispose', 'read', {
          kind: 'trackedDiff',
          filePath: 'disposed.ts',
          stage: 'committed',
          allowHeadReads: false,
          providedOld: 'before',
          providedNew: 'after',
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(
        selectGitRead.select(appStore.state, 'preview-chat-changes', 'after-dispose')?.result,
      ).toBeNull();
    },
  );
});
