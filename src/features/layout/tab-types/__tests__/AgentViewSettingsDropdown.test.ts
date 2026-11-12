import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => {
  let value = 'sans';
  const subscribers = new Set<(value: string) => void>();
  return {
    dispatch: vi.fn(),
    desktop: undefined as unknown,
    session: undefined as unknown,
    fontStyle: {
      set(next: string) {
        value = next;
        subscribers.forEach((run) => run(value));
      },
      subscribe(run: (value: string) => void) {
        run(value);
        subscribers.add(run);
        return () => subscribers.delete(run);
      },
    },
  };
});

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    dispatch: mockState.dispatch,
    state: () => ({
      desktopControl: { byKey: { [JSON.stringify(['workspace', 'agent'])]: mockState.desktop } },
      agentSessions: {
        byAgentId: mockState.session ? { agent: mockState.session } : {},
      },
    }),
  });
});

vi.mock('$store/renderer/slices/user-preferences/user-preferences-selectors', () => ({
  selectAgentFontStyle: () => mockState.fontStyle,
  selectChatContentWidth: () => ({
    subscribe: (run: (value: string) => void) => (run('full'), () => {}),
  }),
  selectChatAuroraEnabled: () => ({
    subscribe: (run: (value: boolean) => void) => (run(true), () => {}),
  }),
  selectCollapseToolRuns: () => ({
    subscribe: (run: (value: boolean) => void) => (run(false), () => {}),
  }),
}));
vi.mock(
  '$store/renderer/slices/user-preferences/user-preferences-slice',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('$store/renderer/slices/user-preferences/user-preferences-slice')
    >()),
    setAgentFontStyle: (style: string) => ({
      type: 'fontSettings/setAgentFontStyle',
      payload: [style],
    }),
    setChatContentWidth: (width: string) => ({
      type: 'userPreferences/setChatContentWidth',
      payload: [width],
    }),
    setChatAuroraEnabled: (enabled: boolean) => ({
      type: 'userPreferences/setChatAuroraEnabled',
      payload: [enabled],
    }),
    setCollapseToolRuns: (enabled: boolean) => ({
      type: 'userPreferences/setCollapseToolRuns',
      payload: [enabled],
    }),
  }),
);

import AgentViewSettingsDropdown from '../AgentViewSettingsDropdown.svelte';
import { desktopPermissionRequested } from '$store/renderer/slices/desktop-control/desktop-control-slice';
import { setAgentPermissionPolicyRequested } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';

describe('AgentViewSettingsDropdown', () => {
  beforeEach(() => {
    mockState.dispatch.mockClear();
    mockState.desktop = undefined;
    mockState.fontStyle.set('sans');
  });
  afterEach(cleanup);

  it('moves agent font selection into the view settings menu', async () => {
    render(AgentViewSettingsDropdown);

    await fireEvent.click(screen.getByRole('button', { name: 'View settings' }));
    expect(
      screen.getByRole('menuitemradio', { name: /Sans-serif/ }).getAttribute('aria-checked'),
    ).toBe('true');
    await fireEvent.click(screen.getByRole('menuitemradio', { name: /Mono/ }));

    expect(mockState.dispatch).toHaveBeenCalledWith({
      type: 'fontSettings/setAgentFontStyle',
      payload: ['monospace'],
    });
  });
});

describe('desktop permission in the agent menu', () => {
  it.each([true, false])(
    'shows remembered permission %s for the current primary and changes only future starts',
    async (allowed) => {
      mockState.desktop = {
        permission: { computerId: 'computer', computerName: 'Windows workstation', allowed },
        state: { status: 'active', sessionId: 'session' },
        saving: false,
        loading: false,
      };
      render(AgentViewSettingsDropdown, { workspaceId: 'workspace', agentId: 'agent' });
      await fireEvent.click(screen.getByRole('button', { name: 'View settings' }));
      const checkbox = screen.getByRole('menuitemcheckbox', { name: 'Desktop control' });
      expect(checkbox.getAttribute('aria-checked')).toBe(String(allowed));
      expect(screen.queryByText(/Windows workstation/)).toBeNull();
      expect(screen.queryByText(/use Stop to end current control/)).toBeNull();
      await fireEvent.click(checkbox);
      expect(mockState.dispatch).toHaveBeenCalledWith(
        desktopPermissionRequested('workspace', 'agent', 'computer', !allowed),
      );
    },
  );
  it('hides the setting when the primary is unsupported, unavailable or unauthorized', async () => {
    mockState.desktop = undefined;
    render(AgentViewSettingsDropdown, { workspaceId: 'workspace', agentId: 'agent' });
    await fireEvent.click(screen.getByRole('button', { name: 'View settings' }));
    expect(screen.queryByRole('menuitemcheckbox', { name: 'Desktop control' })).toBeNull();
  });
});

describe('ask before using tools in the agent menu', () => {
  const ASK = 'Ask before using tools';
  function agentSession(fields: Record<string, unknown>) {
    return { id: 'agent', workspaceId: 'workspace', name: 'Agent', messages: [], ...fields };
  }
  beforeEach(() => {
    mockState.dispatch.mockClear();
    mockState.desktop = undefined;
    mockState.session = undefined;
  });
  afterEach(cleanup);

  it.each([
    ['interactive', true, 'allow'],
    ['allow', false, 'interactive'],
    ['auto', false, 'interactive'],
    ['deny', false, 'interactive'],
  ])(
    'checks the switch from effective policy %s and sends the opposite policy',
    async (effective, checked, sent) => {
      mockState.session = agentSession({
        permissionPolicy: null,
        effectivePermissionPolicy: effective,
      });
      render(AgentViewSettingsDropdown, { workspaceId: 'workspace', agentId: 'agent' });
      await fireEvent.click(screen.getByRole('button', { name: 'View settings' }));
      const toggle = screen.getByRole('menuitemcheckbox', { name: ASK });
      expect(toggle.getAttribute('aria-checked')).toBe(String(checked));
      await fireEvent.click(toggle);
      expect(mockState.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: setAgentPermissionPolicyRequested.type,
          payload: ['workspace', 'agent', sent],
        }),
      );
    },
  );

  it.each([
    ['an older daemon omits permissionPolicy', { effectivePermissionPolicy: 'allow' }],
    ['a remote agent omits effectivePermissionPolicy', { permissionPolicy: null }],
  ])('hides the toggle when %s', async (_label, fields) => {
    mockState.session = agentSession(fields);
    render(AgentViewSettingsDropdown, { workspaceId: 'workspace', agentId: 'agent' });
    await fireEvent.click(screen.getByRole('button', { name: 'View settings' }));
    expect(screen.queryByRole('menuitemcheckbox', { name: ASK })).toBeNull();
  });

  it('hides the toggle without an agent', async () => {
    render(AgentViewSettingsDropdown);
    await fireEvent.click(screen.getByRole('button', { name: 'View settings' }));
    expect(screen.queryByRole('menuitemcheckbox', { name: ASK })).toBeNull();
  });
});
