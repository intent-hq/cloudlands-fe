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
  discardSpecialistDraft,
} from '$store/renderer/slices/specialists/specialists-slice';
import { warmImport } from '../../../../test/warm-import';

const mocks = vi.hoisted(() => ({
  page: { url: new URL('http://localhost/settings?tab=agents&specialist=implementor') },
}));

vi.mock('$app/state', () => ({ page: mocks.page }));
vi.mock('$lib/components/patterns/notify', () => ({
  notify: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('$lib/utils/workspace-navigation', () => ({
  getSettingsPreviousPath: () => '/',
  navigateBackFromSettings: vi.fn(),
}));
vi.mock('svelte-fa', async () => ({
  default: (await import('$lib/components/workspace/sidebar/__tests__/mocks/Fa.svelte')).default,
}));

warmImport(() => import('$lib/components/chat/__tests__/mocks/SlotOnly.svelte'));

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
import { appClient } from '$lib/client';
import { specialistsSaga } from '$store/renderer/slices/specialists/sagas/specialists-saga';
import type { SpecialistCatalog, SpecialistDef } from '$lib/client/app-client';

let storeContext: ReduxStoreContext | undefined;

beforeAll(() => {
  storeContext = initAppStore(appStore);
});

beforeEach(() => {
  appStore.dispatch(discardSpecialistDraft('user'));
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

describe('specialist creation draft navigation', () => {
  it('restores unsaved fields after leaving and reopening Settings', async () => {
    window.history.replaceState({}, '', '/settings?tab=specialists&view=create-specialist');
    mocks.page.url = new URL(window.location.href);
    const options = { context: new Map([['redux-store-context', storeContext]]) };
    const page = render(SettingsPage, options);
    await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Draft reviewer' } });
    await fireEvent.input(screen.getByLabelText('Description'), {
      target: { value: 'Review safely' },
    });
    await fireEvent.input(document.getElementById('create-specialist-prompt')!, {
      target: { value: 'Keep this unfinished prompt' },
    });
    page.unmount();
    render(SettingsPage, options);
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Draft reviewer');
    expect((screen.getByLabelText('Description') as HTMLInputElement).value).toBe('Review safely');
    expect((document.getElementById('create-specialist-prompt') as HTMLTextAreaElement).value).toBe(
      'Keep this unfinished prompt',
    );
  });
});

describe('specialist creation progress in Settings', () => {
  let stopSaga: (() => void) | undefined;
  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: Error) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }
  async function startCreate() {
    const write = deferred<SpecialistDef>();
    const catalog = deferred<SpecialistCatalog>();
    const create = vi.spyOn(appClient.specialists, 'create').mockReturnValue(write.promise);
    const list = vi.spyOn(appClient.specialists, 'listCatalog').mockReturnValue(catalog.promise);
    vi.spyOn(appClient.specialists, 'subscribeCatalog').mockImplementation(() => () => {});
    stopSaga = appStore.runSaga(specialistsSaga);
    window.history.replaceState({}, '', '/settings?tab=specialists&view=create-specialist');
    mocks.page.url = new URL(window.location.href);
    appStore.dispatch(setBundledSpecialists([]));
    appStore.dispatch(setFileSpecialists([]));
    const options = { context: new Map([['redux-store-context', storeContext]]) };
    const page = render(SettingsPage, options);
    await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Draft reviewer' } });
    await fireEvent.input(screen.getByLabelText('Description'), {
      target: { value: 'Description to keep' },
    });
    await fireEvent.input(document.getElementById('create-specialist-prompt')!, {
      target: { value: 'Prompt to keep' },
    });
    const button = within(screen.getByTestId('create-specialist-details-column')).getByRole(
      'button',
      { name: 'Create Specialist' },
    );
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    await fireEvent.click(button);
    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    const definition: SpecialistDef = {
      id: 'draft-reviewer',
      name: 'Draft reviewer',
      description: 'Description to keep',
      behaviorPrompt: 'Prompt to keep',
      source: 'user',
    };
    return { write, catalog, create, list, page, options, button, definition };
  }
  afterEach(() => {
    stopSaga?.();
    stopSaga = undefined;
    vi.restoreAllMocks();
  });

  it('keeps the accessible busy state until the saved specialist reaches the sidebar', async () => {
    const h = await startCreate();
    await waitFor(() => expect(h.button.getAttribute('aria-busy')).toBe('true'));
    expect((h.button as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Discard' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    await fireEvent.click(h.button);
    expect(h.create).toHaveBeenCalledOnce();
    h.write.resolve(h.definition);
    await waitFor(() => expect(h.list).toHaveBeenCalledOnce());
    await waitFor(() => expect(h.button.getAttribute('aria-busy')).toBe('true'));
    expect(window.location.search).toContain('view=create-specialist');
    h.catalog.resolve({ specialists: [h.definition] });
    await waitFor(() => expect(window.location.search).toContain('specialist=draft-reviewer'));
    expect(
      await within(screen.getByRole('navigation', { name: 'Settings' })).findByRole('button', {
        name: 'Draft reviewer',
      }),
    ).toBeTruthy();
    await fireEvent.click(
      within(screen.getByRole('navigation', { name: 'Settings' })).getByRole('button', {
        name: 'Create Specialist',
      }),
    );
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('');
  });

  it('retains progress across unmount and never navigates a newly mounted form on completion', async () => {
    const h = await startCreate();
    h.page.unmount();
    render(SettingsPage, h.options);
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Draft reviewer');
    expect(
      within(screen.getByTestId('create-specialist-details-column'))
        .getByRole('button', { name: 'Create Specialist' })
        .getAttribute('aria-busy'),
    ).toBe('true');
    h.write.resolve(h.definition);
    await waitFor(() => expect(h.list).toHaveBeenCalledOnce());
    h.catalog.resolve({ specialists: [h.definition] });
    await waitFor(() => expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe(''));
    expect(window.location.search).toContain('view=create-specialist');
    expect(h.create).toHaveBeenCalledOnce();
  });

  it('keeps input after a failed write and permits a successful retry', async () => {
    const h = await startCreate();
    h.write.reject(new Error('Write unavailable'));
    await screen.findByRole('alert');
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Draft reviewer');
    expect((h.button as HTMLButtonElement).disabled).toBe(false);
    h.create.mockResolvedValue(h.definition);
    await fireEvent.click(h.button);
    await waitFor(() => expect(h.list).toHaveBeenCalledOnce());
    h.catalog.resolve({ specialists: [h.definition] });
    await waitFor(() =>
      expect(appStore.state.specialists.creationByContext.user.status).toBe('editing'),
    );
    await waitFor(() => expect(window.location.search).toContain('specialist=draft-reviewer'));
    expect(h.create).toHaveBeenCalledTimes(2);
  });

  it('offers refresh-only recovery after the write succeeds but the catalog fails', async () => {
    const h = await startCreate();
    h.write.resolve(h.definition);
    await waitFor(() => expect(h.list).toHaveBeenCalledOnce());
    h.catalog.reject(new Error('Refresh unavailable'));
    await screen.findByRole('alert');
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Draft reviewer');
    expect((screen.getByLabelText('Name') as HTMLInputElement).disabled).toBe(true);
    expect(window.location.search).toContain('view=create-specialist');
    h.list.mockResolvedValue({ specialists: [h.definition] });
    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(window.location.search).toContain('specialist=draft-reviewer'));
    expect(h.create).toHaveBeenCalledOnce();
  });
});
