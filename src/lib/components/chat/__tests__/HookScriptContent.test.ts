/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { dispatchMock, hooks } = vi.hoisted(() => ({
  dispatchMock: vi.fn(),
  hooks: [
    {
      hookId: 'hook-1',
      workspaceId: 'ws-1',
      name: 'ci-watch',
      code: 'const status = await ws.ci.status();',
      lastLogs: 'all green',
      state: 'scheduled',
    },
  ],
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => ({}), dispatch: dispatchMock });
});
vi.mock('$store/renderer/slices/background-hooks/background-hooks-selectors', () => ({
  selectBackgroundHooks: () => ({
    subscribe: (run: (value: typeof hooks) => void) => {
      run(hooks);
      return () => undefined;
    },
  }),
}));
vi.mock('$lib/components/editor/CodeBlock.svelte', async () => ({
  default: (await import('../../workspace/sidebar/__tests__/mocks/MockSimple.svelte')).default,
}));

import HookScriptContent from '../HookScriptContent.svelte';
import {
  backgroundHooksRefetchRequested,
  backgroundHooksSubscribeRequested,
  backgroundHooksUnsubscribeRequested,
} from '$store/renderer/slices/background-hooks/background-hooks-slice';

describe('HookScriptContent', () => {
  afterEach(() => {
    cleanup();
    dispatchMock.mockClear();
  });

  it('owns a hook subscription lease and renders the last-run logs', async () => {
    const view = render(HookScriptContent, { props: { workspaceId: 'ws-1', hookId: 'hook-1' } });
    await waitFor(() => {
      expect(dispatchMock).toHaveBeenCalledWith(backgroundHooksSubscribeRequested('ws-1'));
      expect(dispatchMock).toHaveBeenCalledWith(backgroundHooksRefetchRequested('ws-1'));
    });

    await fireEvent.click(screen.getByRole('tab', { name: 'Last run logs' }));
    expect(screen.getByTestId('hook-script-content-logs').textContent).toContain('all green');

    view.unmount();
    expect(dispatchMock).toHaveBeenCalledWith(backgroundHooksUnsubscribeRequested('ws-1'));
  });
});
