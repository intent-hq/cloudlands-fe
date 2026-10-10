import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => {
  let value = 'sans';
  const subscribers = new Set<(value: string) => void>();
  return {
    dispatch: vi.fn(),
    desktop: undefined as unknown,
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
    }),
  });
});

vi.mock('$store/renderer/slices/user-preferences/user-preferences-selectors', () => ({
  selectAgentFontStyle: () => mockState.fontStyle,
}));
vi.mock('$store/renderer/slices/user-preferences/user-preferences-slice', () => ({
  setAgentFontStyle: (style: string) => ({
    type: 'fontSettings/setAgentFontStyle',
    payload: [style],
  }),
}));

import AgentViewSettingsDropdown from '../AgentViewSettingsDropdown.svelte';
import { desktopPermissionRequested } from '$store/renderer/slices/desktop-control/desktop-control-slice';

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
      const checkbox = screen.getByRole('menuitemcheckbox', {
        name: 'Allow desktop control without asking',
      });
      expect(checkbox.getAttribute('aria-checked')).toBe(String(allowed));
      expect(screen.getByText(/For Windows workstation/).textContent).toContain(
        'use Stop to end current control',
      );
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
    expect(
      screen.queryByRole('menuitemcheckbox', { name: 'Allow desktop control without asking' }),
    ).toBeNull();
  });
});
