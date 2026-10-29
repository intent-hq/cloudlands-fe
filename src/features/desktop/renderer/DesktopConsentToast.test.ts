import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { m } from '$shared/paraglide/messages.js';
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
  it('renders retained permission guidance alongside the still-unconsumed consent', () => {
    mock.state.desktopControl = desktopControlReducer(
      mock.state.desktopControl,
      desktopEntryPatched('workspace', 'agent', 0, {
        error: 'macOS Accessibility access is missing.',
      }),
    );
    render(DesktopConsentToast, {
      workspaceId: 'workspace',
      agentId: 'agent',
      requestId: 'request',
    });
    expect(screen.getByRole('status').textContent).toContain('Accessibility');
    expect(screen.getByRole('button', { name: 'Allow once' }).hasAttribute('disabled')).toBe(false);
    expect(mock.dispatch).not.toHaveBeenCalled();
  });
  it('shows every macOS permission as one checklist with a single relaunch hint', async () => {
    mock.state.desktopControl = desktopControlReducer(
      mock.state.desktopControl,
      desktopEntryPatched('workspace', 'agent', 0, {
        submitting: true,
        settingUp: true,
        error: m.desktop_os_setup_description(),
        osChecklist: { accessibility: true, screenRecording: false, screenCapture: 'unavailable' },
      }),
    );
    render(DesktopConsentToast, {
      workspaceId: 'workspace',
      agentId: 'agent',
      requestId: 'request',
    });
    const items = within(screen.getByRole('list', { name: 'macOS permissions' })).getAllByRole(
      'listitem',
    );
    expect(
      items.map((item) => [item.dataset.state, item.textContent?.replace(/\s+/g, ' ').trim()]),
    ).toEqual([
      ['done', 'Accessibility Allowed'],
      ['waiting', 'Screen Recording Not allowed yet'],
      ['waiting', 'Screen capture check Waits for the items above'],
    ]);
    expect(screen.getAllByText(/quit and reopen Intent/)).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Deny' }).hasAttribute('disabled')).toBe(false);
    mock.state.desktopControl = desktopControlReducer(
      mock.state.desktopControl,
      desktopEntryPatched('workspace', 'agent', 0, {
        osChecklist: { accessibility: true, screenRecording: true, screenCapture: 'pending' },
      }),
    );
    (store as unknown as { emitState(): void }).emitState();
    await tick();
    expect(screen.getAllByRole('listitem').at(-1)?.textContent).toContain('Checking');
    mock.state.desktopControl = desktopControlReducer(
      mock.state.desktopControl,
      desktopEntryPatched('workspace', 'agent', 0, {
        osChecklist: { accessibility: true, screenRecording: true, screenCapture: 'unavailable' },
      }),
    );
    (store as unknown as { emitState(): void }).emitState();
    await tick();
    expect(screen.getAllByRole('listitem').at(-1)?.dataset.state).toBe('failed');
    expect(mock.dispatch).not.toHaveBeenCalled();
  });
  it('shows no checklist before an Allow gesture', () => {
    render(DesktopConsentToast, {
      workspaceId: 'workspace',
      agentId: 'agent',
      requestId: 'request',
    });
    expect(screen.queryByRole('list', { name: 'macOS permissions' })).toBeNull();
  });
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
