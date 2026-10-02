import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
const mock = vi.hoisted(() => ({ state: {} as any, dispatch: vi.fn() }));
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => mock.state, dispatch: mock.dispatch });
});
import { store } from '$store/renderer/store';
import DesktopConsentToast from './DesktopConsentToast.svelte';
import { request } from './desktop-test-fixtures';
import {
  desktopControlReducer,
  desktopEventReceived,
  desktopEntryPatched,
  desktopDecisionRequested,
  desktopRequestExpired,
} from '$store/renderer/slices/desktop-control/desktop-control-slice';
beforeEach(() => {
  mock.dispatch.mockClear();
  mock.state = {
    desktopControl: desktopControlReducer(
      undefined,
      desktopEventReceived({ id: 'request', type: 'desktop:permission-requested', data: request }),
    ),
  };
});
afterEach(cleanup);
describe('connected consent prompt', () => {
  it('dispatches the exact request identity and disables all copies while submitting', async () => {
    render(DesktopConsentToast, {
      workspaceId: 'workspace',
      agentId: 'agent',
      requestId: 'request',
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Allow once' }));
    expect(mock.dispatch).toHaveBeenCalledWith(
      desktopDecisionRequested('workspace', 'agent', 'request', 'allow_once'),
    );
    mock.state.desktopControl = desktopControlReducer(
      mock.state.desktopControl,
      desktopEntryPatched('workspace', 'agent', 0, { submitting: true }),
    );
    (store as unknown as { emitState(): void }).emitState();
    await tick();
    expect(screen.getAllByRole('button').every((button) => button.hasAttribute('disabled'))).toBe(
      true,
    );
  });
  it('removes the actions when the request expires or is replaced', async () => {
    render(DesktopConsentToast, {
      workspaceId: 'workspace',
      agentId: 'agent',
      requestId: 'request',
    });
    mock.state.desktopControl = desktopControlReducer(
      mock.state.desktopControl,
      desktopRequestExpired('workspace', 'agent', 'request'),
    );
    (store as unknown as { emitState(): void }).emitState();
    await tick();
    expect(screen.queryByRole('button', { name: 'Allow once' })).toBeNull();
    mock.state.desktopControl = desktopControlReducer(
      mock.state.desktopControl,
      desktopEventReceived({
        id: 'new-request',
        type: 'desktop:permission-requested',
        data: { ...request, requestId: 'next' },
      }),
    );
    (store as unknown as { emitState(): void }).emitState();
    await tick();
    expect(screen.queryByRole('button', { name: 'Allow once' })).toBeNull();
  });
});
