import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => {
  let value = 'sans';
  const subscribers = new Set<(value: string) => void>();
  return {
    dispatch: vi.fn(),
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
  return createAppStoreMockModule({ dispatch: mockState.dispatch });
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

describe('AgentViewSettingsDropdown', () => {
  beforeEach(() => {
    mockState.dispatch.mockClear();
    mockState.fontStyle.set('sans');
  });
  afterEach(cleanup);

  it('moves agent font selection into the view settings menu', async () => {
    render(AgentViewSettingsDropdown);

    await fireEvent.click(screen.getByRole('button', { name: 'View settings' }));
    expect(screen.getByRole('radio', { name: /Sans-serif/ }).getAttribute('aria-checked')).toBe(
      'true',
    );
    await fireEvent.click(screen.getByRole('radio', { name: /Mono/ }));

    expect(mockState.dispatch).toHaveBeenCalledWith({
      type: 'fontSettings/setAgentFontStyle',
      payload: ['monospace'],
    });
  });
});
