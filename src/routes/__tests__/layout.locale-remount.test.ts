/**
 * Regression test for the locale-keyed remount in the root +layout.svelte:
 * dispatching `userPreferences/setLanguagePreference` must re-render every
 * mounted `m.*()` string immediately (no reload), via the
 * `{#key $resolvedLocale$}` block that remounts the rendered tree.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { installConsoleTeardownGuard } from './helpers/console-teardown-guard';

installConsoleTeardownGuard();

vi.mock('$store/renderer/root-store-lifecycle', () => ({
  startRootStoreLifecycle: () => () => {},
}));
vi.mock('$store/renderer/seeders', () => ({}));
vi.mock('$features/backend/splash-gate', () => ({ wireSplashGate: () => () => {} }));
vi.mock('$lib/utils/history-navigation', () => ({
  attachMouseHistoryNavigation: () => () => {},
  handleHistoryNavigateIpc: () => {},
}));
import { store as appStore } from '$store/renderer/store';
import { setLanguagePreference } from '$store/renderer/slices/user-preferences/user-preferences-slice';
import { applyLanguagePreference } from '$lib/i18n/locale';
import { m } from '$shared/paraglide/messages.js';
import RootLayout from '../+layout.svelte';

// A raw snippet's render() re-runs on remount, so the probe re-evaluates its
// m.*() string exactly when the {#key} block tears the tree down and back up.
const childrenSnippet = createRawSnippet(() => ({
  render: () => `<div data-testid="locale-probe">${m.settings_language_label()}</div>`,
}));

describe('root +layout.svelte locale-keyed remount', () => {
  beforeEach(() => {
    appStore.init();
    applyLanguagePreference('en');
  });

  afterEach(() => {
    cleanup();
    appStore.dispose();
    applyLanguagePreference('en');
  });

  it('re-renders mounted m.*() strings when the language preference changes', async () => {
    applyLanguagePreference('de');
    const german = m.settings_language_label();
    applyLanguagePreference('en');
    const english = m.settings_language_label();
    expect(german).not.toBe(english);

    render(RootLayout, { props: { children: childrenSnippet } });
    expect(screen.getByTestId('locale-probe').textContent).toBe(english);

    // At runtime the user-preferences persistence saga applies the dispatched
    // preference to the module-level Paraglide locale; sagas are stubbed out
    // here, so apply it directly alongside the dispatch.
    appStore.dispatch(setLanguagePreference('de'));
    applyLanguagePreference('de');

    await waitFor(() => {
      expect(screen.getByTestId('locale-probe').textContent).toBe(german);
    });
  });
});
