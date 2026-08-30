/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SPECIALISTS } from '$lib/constants/specialists';
import { initAppStore, store as appStore } from '$store/renderer/store';
import type { ReduxStoreContext } from '$store/renderer/types';
import {
  setBundledSpecialists,
  setFileSpecialists,
} from '$store/renderer/slices/specialists/specialists-slice';

const mocks = vi.hoisted(() => ({
  page: { url: new URL('http://localhost/settings?tab=agents&specialist=implementor') },
}));

vi.mock('$app/state', () => ({ page: mocks.page }));
vi.mock('$lib/utils/workspace-navigation', () => ({
  getSettingsPreviousPath: () => '/',
  navigateBackFromSettings: vi.fn(),
}));
vi.mock('svelte-fa', async () => ({
  default: (await import('$lib/components/workspace/sidebar/__tests__/mocks/Fa.svelte')).default,
}));

async function slotOnly() {
  return {
    default: (await import('$lib/components/chat/__tests__/mocks/SlotOnly.svelte')).default,
  };
}

vi.mock('$lib/components/settings/ProviderSelector.svelte', slotOnly);
vi.mock('$lib/components/settings/ConnectionsSettings.svelte', slotOnly);
vi.mock('$lib/components/settings/GitWorkspaceSettings.svelte', slotOnly);
vi.mock('$lib/components/settings/OpenInAppsSettings.svelte', slotOnly);
vi.mock('$lib/components/settings/McpServersSettings.svelte', slotOnly);
vi.mock('$lib/components/settings/BackgroundAgentSettings.svelte', slotOnly);
vi.mock('$lib/components/settings/ColorThemeSettings.svelte', slotOnly);
vi.mock('$lib/components/settings/NotificationSettings.svelte', slotOnly);
vi.mock('$lib/components/settings/RtkSettings.svelte', slotOnly);
vi.mock('$lib/components/settings/WebSocketApiSettings.svelte', slotOnly);
vi.mock('$lib/components/settings/AgentBackendSettings.svelte', slotOnly);
vi.mock('$lib/components/chat/input/ModelPicker.svelte', slotOnly);
vi.mock('$features/external-editors/components/OpenComboButton.svelte', slotOnly);
vi.mock('$lib/components/settings/SpecialistModelOptions.svelte', slotOnly);

import SettingsPage from '../+page.svelte';

let storeContext: ReduxStoreContext | undefined;

beforeAll(() => {
  storeContext = initAppStore(appStore);
});

beforeEach(() => {
  window.history.pushState({}, '', '/settings?tab=agents&specialist=implementor');
  mocks.page.url = new URL(window.location.href);
  (globalThis as typeof globalThis & { __APP_VERSION__: string }).__APP_VERSION__ = '2.0.10';
  Object.defineProperty(Element.prototype, 'scrollTo', { value: vi.fn(), configurable: true });
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    value: vi.fn(),
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
});

afterAll(() => {
  storeContext?.dispose();
  storeContext = undefined;
});

describe('settings collapsed built-in override chrome', () => {
  it('shows Reset only for the winning built-in override', async () => {
    const implementor = SPECIALISTS.find(({ id }) => id === 'implementor')!;
    const specWriter = SPECIALISTS.find(({ id }) => id === 'spec-writer')!;
    const verifier = SPECIALISTS.find(({ id }) => id === 'verifier')!;
    const custom = {
      id: 'alpha-custom',
      name: 'Alpha Custom',
      description: 'Custom specialist',
      model: '',
      behaviorPrompt: 'Custom prompt',
      filePath: '/Users/test/.intent/specialists/alpha-custom.md',
      source: 'user' as const,
    };
    const override = {
      id: implementor.id,
      name: implementor.name,
      description: implementor.description,
      model: '',
      behaviorPrompt: `${implementor.defaultBehaviorPrompt}\nModified`,
      roleReminder: implementor.roleReminder,
      filePath: '/Users/test/.intent/specialists/implementor.md',
      source: 'user' as const,
    };
    appStore.dispatch(setBundledSpecialists([specWriter, verifier]));
    appStore.dispatch(setFileSpecialists([override, custom]));

    render(SettingsPage, { context: new Map([['redux-store-context', storeContext]]) });

    const navigation = screen.getByRole('navigation', { name: 'Settings' });
    const implementorButton = within(navigation).getByRole('button', { name: 'Implementor' });

    await fireEvent.click(implementorButton);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Reset' })).toBeTruthy());

    appStore.dispatch(setBundledSpecialists([specWriter, implementor, verifier]));
    appStore.dispatch(setFileSpecialists([custom]));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Reset' })).toBeNull());
  });

  it('keeps a custom user specialist editable without built-in override chrome', async () => {
    window.history.replaceState({}, '', '/settings?tab=agents&specialist=custom-specialist');
    mocks.page.url = new URL(window.location.href);
    appStore.dispatch(setBundledSpecialists([]));
    appStore.dispatch(
      setFileSpecialists([
        {
          id: 'custom-specialist',
          name: 'Custom Specialist',
          description: 'Custom description',
          model: '',
          behaviorPrompt: 'Custom prompt',
          filePath: '/Users/test/.intent/specialists/custom-specialist.md',
          source: 'user',
        },
      ]),
    );

    render(SettingsPage, { context: new Map([['redux-store-context', storeContext]]) });

    const navigation = screen.getByRole('navigation', { name: 'Settings' });
    const customButton = within(navigation).getByRole('button', { name: 'Custom Specialist' });

    await fireEvent.click(customButton);

    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Name' })).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Reset' })).toBeNull();
  });
});
