/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, expect, it, vi } from 'vitest';
import { m } from '$shared/paraglide/messages.js';

const navigation = vi.hoisted(() => ({ navigateToSettings: vi.fn(async () => {}) }));
vi.mock('$lib/utils/workspace-navigation', () => navigation);

import NoBackendScreen from './NoBackendScreen.svelte';

afterEach(cleanup);

it('sends the user to Settings → Machines to add the first machine', async () => {
  render(NoBackendScreen);
  expect(screen.getByRole('heading', { name: m.intentWeb_noBackend_title() })).toBeTruthy();
  await fireEvent.click(
    screen.getByRole('button', { name: m.intentWeb_noBackend_addMachine_label() }),
  );
  expect(navigation.navigateToSettings).toHaveBeenCalledWith({ tab: 'devices' });
});
