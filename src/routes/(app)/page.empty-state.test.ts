/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { m } from '$shared/paraglide/messages.js';

const { dispatch } = vi.hoisted(() => ({ dispatch: vi.fn() }));
vi.mock('$store/renderer/store', () => ({ store: { dispatch } }));

import HomePage from './+page.svelte';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('home empty state', () => {
  it('requests the workspace creation flow only when the primary action is activated', async () => {
    render(HomePage);
    expect(dispatch).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByRole('button', { name: m.home_emptyState_newSpace_label() }));

    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'sidebarNav/setShowCreateModal',
      payload: [true],
    });
  });
});
