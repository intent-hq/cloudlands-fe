import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { m } from '$shared/paraglide/messages.js';

const mocks = vi.hoisted(() => ({ dispatch: vi.fn() }));
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => ({
      userPreferences: { languagePreference: 'system', githubLinkDefaultAction: 'show-choices' },
    }),
    dispatch: mocks.dispatch,
  });
});

import LanguageSettings from './LanguageSettings.svelte';
import GitHubLinkSettings from './GitHubLinkSettings.svelte';
import {
  setLanguagePreference,
  setGithubLinkDefaultAction,
} from '$store/renderer/slices/user-preferences/user-preferences-slice';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('custom settings Select labels', () => {
  it('keeps the language purpose and description when changing the locale preference', async () => {
    render(LanguageSettings);
    const trigger = screen.getByRole('combobox', { name: m.settings_language_label() });
    expect(
      document.getElementById(trigger.getAttribute('aria-describedby')!)?.textContent?.trim(),
    ).toBeTruthy();
    trigger.focus();
    await fireEvent.keyDown(trigger, { key: 'Enter' });
    await fireEvent.pointerUp(screen.getByRole('option', { name: 'Deutsch' }), {
      pointerType: 'mouse',
    });
    expect(mocks.dispatch).toHaveBeenCalledWith(setLanguagePreference('de'));
    expect(screen.getByRole('combobox', { name: m.settings_language_label() })).toBe(trigger);
  });

  it('changes the link preference without executing a link command', async () => {
    render(GitHubLinkSettings);
    const trigger = screen.getByRole('combobox', {
      name: m.settings_githubLinks_defaultAction_label(),
    });
    expect(
      document.getElementById(trigger.getAttribute('aria-describedby')!)?.textContent?.trim(),
    ).toBeTruthy();
    trigger.focus();
    await fireEvent.keyDown(trigger, { key: 'Enter' });
    await fireEvent.pointerUp(
      screen.getByRole('option', { name: m.settings_githubLinks_copyLink_option() }),
      { pointerType: 'mouse' },
    );
    expect(mocks.dispatch).toHaveBeenCalledExactlyOnceWith(setGithubLinkDefaultAction('copy-link'));
  });
});
