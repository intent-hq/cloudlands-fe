/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { SvelteURL } from 'svelte/reactivity';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { appClient } from '$lib/client';
import { SPECIALISTS } from '$lib/constants/specialists';
import type { ReduxStoreContext } from '$store/renderer/types';
import { initAppStore, store as appStore } from '$store/renderer/store';
import { selectActiveProviderId } from '$store/renderer/slices/provider-settings/provider-settings-selectors';
import { hydrateDefaultProvider } from '$store/renderer/slices/model/model-slice';
import { selectGitHubAuthError } from '$store/renderer/slices/github-auth/github-auth-selectors';
import { setGitHubAuthError } from '$store/renderer/slices/github-auth/github-auth-slice';
import { selectBundledSpecialists } from '$store/renderer/slices/specialists/specialists-selectors';
import {
  setBundledSpecialists,
  setFileSpecialists,
} from '$store/renderer/slices/specialists/specialists-slice';
import { selectSelectedModel } from '$store/renderer/slices/model/model-selectors';
import { setSelectedModel } from '$store/renderer/slices/model/model-slice';
import { selectMcpError } from '$store/renderer/slices/mcp-settings/mcp-settings-selectors';
import { setError as setMcpError } from '$store/renderer/slices/mcp-settings/mcp-settings-slice';
import { selectThemeError } from '$store/renderer/slices/theme/theme-selectors';
import { setThemeError } from '$store/renderer/slices/theme/theme-slice';
import {
  selectCodeFontFamily,
  selectNotificationEnabled,
} from '$store/renderer/slices/user-preferences/user-preferences-selectors';
import {
  setCodeFontFamily,
  setNotificationEnabled,
} from '$store/renderer/slices/user-preferences/user-preferences-slice';
import {
  selectInstalledEditors,
  selectInstalledEditorsLoading,
} from '$store/renderer/slices/external-editors/external-editors-selectors';
import {
  fetchEditorsSuccess,
  setLoading as setExternalEditorsLoading,
} from '$store/renderer/slices/external-editors/external-editors-slice';
import { selectAutoUpdateError } from '$store/renderer/slices/auto-update/auto-update-selectors';
import {
  installUpdate,
  simulateSetState,
} from '$store/renderer/slices/auto-update/auto-update-slice';
import { resolveHashToTarget } from '$shared/app-ui-targets';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { mockInvoke, registerMockIpcHandler, resetMockIpcRouter } from '$shared/ipc-mock-router';
import {
  REQUIRED_SETTINGS_STATES,
  SETTINGS_CAPTURE_FIXTURES,
  SETTINGS_PROTOCOL_FIXTURES,
  SETTINGS_STATE_FIXTURE_CONTEXT,
  SETTINGS_TABS,
  createSettingsFixtureUpdate,
  type SettingsCaptureFixture,
  type SettingsFixtureState,
  type SettingsOwnerSnapshot,
  type SettingsStateFixtureContext,
} from './settings-page.fixtures';

const STORE_CONTEXT = 'redux-store-context';

const mocks = vi.hoisted(() => ({
  page: { url: new URL('http://localhost/settings#default-model') },
  previousPath: '/',
  navigateBack: vi.fn(),
}));

vi.mock('$app/state', () => ({ page: mocks.page }));
vi.mock('$lib/utils/workspace-navigation', () => ({
  getSettingsPreviousPath: () => mocks.previousPath,
  navigateBackFromSettings: mocks.navigateBack,
}));
vi.mock('svelte-fa', async () => ({
  default: (await import('$lib/components/workspace/sidebar/__tests__/mocks/Fa.svelte')).default,
}));

vi.mock('$lib/components/settings/ProviderSelector.svelte', async () => ({
  default: (await import('./mocks/SettingsStateFixture.svelte')).default,
}));
vi.mock('$lib/components/settings/AIBehaviorEditor.svelte', async () => ({
  default: (await import('./mocks/SettingsStateFixture.svelte')).default,
}));
vi.mock('$lib/components/settings/ConnectionsSettings.svelte', async () => ({
  default: (await import('./mocks/SettingsStateFixture.svelte')).default,
}));
vi.mock('$lib/components/settings/VoiceSettings.svelte', async () => ({
  default: (await import('./mocks/SettingsStateFixture.svelte')).default,
}));
vi.mock('$lib/components/settings/DevicesSettings.svelte', async () => ({
  default: (await import('$lib/components/chat/__tests__/mocks/SlotOnly.svelte')).default,
}));
vi.mock('$lib/components/settings/GitWorkspaceSettings.svelte', async () => ({
  default: (await import('./mocks/GitWorkspaceSettingsFixture.svelte')).default,
}));
vi.mock('$lib/components/settings/LanguageSettings.svelte', async () => ({
  default: (await import('./mocks/SettingsStateFixture.svelte')).default,
}));
vi.mock('$lib/components/settings/OpenInAppsSettings.svelte', async () => ({
  default: (await import('$lib/components/chat/__tests__/mocks/SlotOnly.svelte')).default,
}));
vi.mock('$lib/components/settings/McpServersSettings.svelte', async () => ({
  default: (await import('$lib/components/chat/__tests__/mocks/SlotOnly.svelte')).default,
}));
vi.mock('$lib/components/settings/BackgroundAgentSettings.svelte', async () => ({
  default: (await import('./mocks/SettingsStateFixture.svelte')).default,
}));
vi.mock('$lib/components/settings/ColorThemeSettings.svelte', async () => ({
  default: (await import('./mocks/SettingsStateFixture.svelte')).default,
}));
vi.mock('$lib/components/settings/NotificationSettings.svelte', async () => ({
  default: (await import('./mocks/SettingsStateFixture.svelte')).default,
}));
vi.mock('$lib/components/settings/RtkSettings.svelte', async () => ({
  default: (await import('$lib/components/chat/__tests__/mocks/SlotOnly.svelte')).default,
}));
vi.mock('$lib/components/settings/WebSocketApiSettings.svelte', async () => ({
  default: (await import('./mocks/SettingsStateFixture.svelte')).default,
}));
vi.mock('$lib/components/settings/AgentBackendSettings.svelte', async () => ({
  default: (await import('$lib/components/chat/__tests__/mocks/SlotOnly.svelte')).default,
}));

import SettingsPage from '../+page.svelte';

let storeContext: ReduxStoreContext | undefined;
const originalInvoke = window.electronAPI!.invoke;
type SettingsCatalog = Awaited<ReturnType<typeof appClient.settings.list>>;
let settingsCatalogResponse: SettingsCatalog;

beforeAll(() => {
  storeContext = initAppStore(appStore);
});

beforeEach(() => {
  resetMockIpcRouter();
  vi.clearAllMocks();
  mocks.previousPath = '/';
  window.electronAPI!.invoke = vi.fn((channel: string, ...args: unknown[]) =>
    mockInvoke(channel, ...args),
  );
  settingsCatalogResponse = [...SETTINGS_PROTOCOL_FIXTURES.list.response.settings];
  registerMockIpcHandler(IPC_CHANNELS.BACKEND.REQUEST, (payload) => {
    if (JSON.stringify(payload) === JSON.stringify(SETTINGS_PROTOCOL_FIXTURES.list.request)) {
      return { ok: true, result: { settings: settingsCatalogResponse } };
    }
    const update = payload as ReturnType<typeof createSettingsFixtureUpdate>['request'];
    expect(update.method).toBe('settings.update');
    return { ok: true, result: { applied: update.params.changes } };
  });
  registerMockIpcHandler(IPC_CHANNELS.BACKEND.GET_STATUS, () => ({ status: 'connected' }));
  (globalThis as typeof globalThis & { __APP_VERSION__: string }).__APP_VERSION__ = '2.0.10';
  window.history.pushState({}, '', '/settings#default-model');
  mocks.page.url = new SvelteURL(window.location.href);
  (
    window.localStorage.getItem as unknown as { mockReturnValue(value: string | null): void }
  ).mockReturnValue(null);
  Object.defineProperty(Element.prototype, 'scrollTo', { value: vi.fn(), configurable: true });
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    value: vi.fn(),
    configurable: true,
  });
  appStore.dispatch(simulateSetState({ status: 'idle' }));
});

afterEach(() => {
  cleanup();
  window.electronAPI!.invoke = originalInvoke;
  resetMockIpcRouter();
  vi.useRealTimers();
});

afterAll(() => {
  storeContext?.dispose();
  storeContext = undefined;
});

function createFixtureContext(
  fixture: SettingsCaptureFixture,
  catalog: SettingsCatalog,
): SettingsStateFixtureContext {
  const routerValue = String(
    catalog.find(({ path }) => path === 'model.defaultProvider')?.value ?? 'missing',
  );
  const snapshot = (value: string): SettingsOwnerSnapshot => ({
    state: value as SettingsFixtureState,
    value,
  });
  const editor = (id: string) => ({
    id,
    name: id,
    shortLabel: id,
    appName: `${id}.app`,
    category: 'ide' as const,
    handlerType: 'generic' as const,
    priority: 1,
    installed: true,
  });
  let readOwner: () => SettingsOwnerSnapshot;
  let writeOwner: (value: SettingsFixtureState) => void;

  switch (fixture.stateOwner) {
    case 'Redux providerSettings':
      writeOwner = (value) => appStore.dispatch(hydrateDefaultProvider(value));
      readOwner = () => snapshot(selectActiveProviderId.select(appStore.state));
      break;
    case 'Redux auth':
      writeOwner = (value) => appStore.dispatch(setGitHubAuthError(value));
      readOwner = () => snapshot(selectGitHubAuthError.select(appStore.state) ?? 'success');
      break;
    case 'Redux specialists':
      writeOwner = (value) =>
        appStore.dispatch(
          setBundledSpecialists(value === 'empty' ? [] : [{ ...SPECIALISTS[0], id: value }]),
        );
      readOwner = () => {
        const specialist = selectBundledSpecialists.select(appStore.state)[0];
        return snapshot(specialist?.id ?? 'empty');
      };
      break;
    case 'Redux model':
      writeOwner = (value) =>
        appStore.dispatch(setSelectedModel({ providerId: 'codex', model: value }));
      readOwner = () =>
        snapshot(selectSelectedModel.select(appStore.state, 'codex').replace(/^codex:/, ''));
      break;
    case 'Redux notifications':
      writeOwner = (value) => appStore.dispatch(setNotificationEnabled(value === 'success'));
      readOwner = () =>
        snapshot(selectNotificationEnabled.select(appStore.state) ? 'success' : 'disabled');
      break;
    case 'Redux MCP':
      writeOwner = (value) => appStore.dispatch(setMcpError(value));
      readOwner = () => snapshot(selectMcpError.select(appStore.state) ?? 'success');
      break;
    case 'Redux theme':
      writeOwner = (value) => appStore.dispatch(setThemeError(value));
      readOwner = () => snapshot(selectThemeError.select(appStore.state) ?? 'success');
      break;
    case 'Redux userPreferences':
      writeOwner = (value) => appStore.dispatch(setCodeFontFamily(value));
      readOwner = () => snapshot(selectCodeFontFamily.select(appStore.state));
      break;
    case 'Redux externalEditors':
      writeOwner = (value) => {
        appStore.dispatch(
          fetchEditorsSuccess(value === 'empty' || value === 'loading' ? [] : [editor(value)], 123),
        );
        appStore.dispatch(setExternalEditorsLoading(value === 'loading'));
      };
      readOwner = () => {
        if (selectInstalledEditorsLoading.select(appStore.state)) return snapshot('loading');
        const installedEditor = selectInstalledEditors.select(appStore.state)[0];
        return snapshot(installedEditor?.id ?? 'empty');
      };
      break;
    case 'Redux autoUpdate':
      writeOwner = (value) => appStore.dispatch(simulateSetState({ error: value }));
      readOwner = () => snapshot(selectAutoUpdateError.select(appStore.state) ?? 'success');
      break;
    case 'daemon settings': {
      const owner = snapshot(routerValue);
      return {
        fixture,
        catalogSize: catalog.length,
        ownerSource: 'router',
        owner,
        transition: async () => {
          const update = createSettingsFixtureUpdate('success');
          const [applied] = await appClient.settings.update([...update.request.params.changes]);
          return snapshot(String(applied.value));
        },
      };
    }
    case 'local availability': {
      let availability = snapshot(fixture.state);
      return {
        fixture,
        catalogSize: catalog.length,
        ownerSource: 'local',
        owner: availability,
        transition: async () => {
          availability = snapshot('success');
          return availability;
        },
      };
    }
    case 'local draft': {
      let draft = snapshot(fixture.state);
      return {
        fixture,
        catalogSize: catalog.length,
        ownerSource: 'local',
        owner: draft,
        transition: async () => {
          draft = snapshot('success');
          return draft;
        },
      };
    }
    case 'local pairing': {
      let pairing = snapshot(fixture.state);
      return {
        fixture,
        catalogSize: catalog.length,
        ownerSource: 'local',
        owner: pairing,
        transition: async () => {
          pairing = snapshot('success');
          return pairing;
        },
      };
    }
  }

  writeOwner(fixture.state);
  return {
    fixture,
    catalogSize: catalog.length,
    ownerSource: 'redux',
    owner: readOwner(),
    transition: async () => {
      writeOwner('success');
      return readOwner();
    },
  };
}

function renderSettings(
  url: string,
  fixtureId?: string,
  catalog: SettingsCatalog = [...SETTINGS_PROTOCOL_FIXTURES.list.response.settings],
) {
  window.history.pushState({}, '', url);
  mocks.page.url.href = window.location.href;
  const requestedTab = mocks.page.url.searchParams.get('tab');
  const fixture = fixtureId
    ? SETTINGS_CAPTURE_FIXTURES.find(({ id }) => id === fixtureId)
    : SETTINGS_CAPTURE_FIXTURES.find(({ tab }) => tab === requestedTab);
  const activeFixture = fixture ?? SETTINGS_CAPTURE_FIXTURES[0];
  const fixtureContext = createFixtureContext(activeFixture, catalog);
  return render(SettingsPage, {
    context: new Map([
      [STORE_CONTEXT, storeContext],
      [SETTINGS_STATE_FIXTURE_CONTEXT, fixtureContext],
    ]),
  });
}

async function exerciseFixtureSaveMode(saveMode: string, fixture: HTMLElement) {
  const fixtureScreen = within(fixture);
  if (saveMode === 'immediate') {
    await fireEvent.click(fixtureScreen.getByRole('button', { name: 'Apply immediately' }));
  } else if (saveMode === 'autosave') {
    await fireEvent.input(fixtureScreen.getByRole('textbox', { name: 'Autosave value' }), {
      target: { value: 'saved draft' },
    });
  } else if (saveMode === 'blur-or-enter') {
    const input = fixtureScreen.getByRole('textbox', { name: 'Blur or Enter value' });
    await fireEvent.input(input, { target: { value: 'saved on blur' } });
    await fireEvent.blur(input);
  } else if (saveMode === 'explicit') {
    await fireEvent.click(fixtureScreen.getByRole('button', { name: 'Save changes' }));
  } else {
    await fireEvent.click(fixtureScreen.getByRole('button', { name: 'Review save' }));
    await fireEvent.click(fixtureScreen.getByRole('button', { name: 'Confirm fixture save' }));
  }
  await waitFor(() =>
    expect(fixtureScreen.getByTestId('fixture-save-state').textContent).toContain('saved:success'),
  );
}

describe('settings state and save-mode fixtures', () => {
  it('pins state ownership, save modes, and the required interaction-state matrix', () => {
    const states = new Set(SETTINGS_TABS.flatMap((tab) => [...tab.states]));
    const declaredOwners = new Set(SETTINGS_TABS.flatMap((tab) => [...tab.stateOwners]));
    const capturedOwners = new Set(SETTINGS_CAPTURE_FIXTURES.map(({ stateOwner }) => stateOwner));
    const declaredSaveModes = new Set(SETTINGS_TABS.flatMap((tab) => [...tab.saveModes]));
    const capturedSaveModes = new Set(SETTINGS_CAPTURE_FIXTURES.map(({ saveMode }) => saveMode));
    for (const state of REQUIRED_SETTINGS_STATES) expect(states.has(state)).toBe(true);
    expect(capturedOwners).toEqual(declaredOwners);
    expect(capturedSaveModes).toEqual(declaredSaveModes);
    for (const tab of SETTINGS_TABS) {
      expect(tab.stateOwners.length).toBeGreaterThan(0);
      expect(tab.saveModes.length).toBeGreaterThan(0);
    }
  });

  it.each(SETTINGS_CAPTURE_FIXTURES)(
    'exercises the $id state and save mode',
    async ({ id, url, label, tab, state, stateOwner, saveMode }) => {
      if (stateOwner === 'daemon settings') {
        settingsCatalogResponse = settingsCatalogResponse.map((setting) =>
          setting.path === 'model.defaultProvider' ? { ...setting, value: state } : setting,
        );
      }

      const catalog = await appClient.settings.list();

      renderSettings(url, id, catalog);

      const activeTab = screen.getByRole('button', { name: label });
      await waitFor(() => expect(activeTab.getAttribute('aria-current')).toBe('page'));

      const renderedState = screen.getAllByTestId('settings-state-fixture')[0];
      const fixtureScreen = within(renderedState);
      expect(renderedState.dataset.tab).toBe(tab);
      expect(renderedState.dataset.state).toBe(state);
      expect(renderedState.dataset.stateOwner).toBe(stateOwner);
      expect(renderedState.dataset.ownerSource).toBe(
        stateOwner.startsWith('Redux')
          ? 'redux'
          : stateOwner.startsWith('local ')
            ? 'local'
            : 'router',
      );
      expect(renderedState.dataset.ownerValue).toBe(state);
      expect(renderedState.dataset.saveMode).toBe(saveMode);
      await waitFor(() => expect(renderedState.dataset.catalogSize).toBe('2'));

      if (state === 'loading' || state === 'success')
        expect(fixtureScreen.getByRole('status')).toBeTruthy();
      if (state === 'empty') {
        await fireEvent.click(fixtureScreen.getByRole('button', { name: /Add .* item/ }));
        await waitFor(() =>
          expect(fixtureScreen.getByTestId('fixture-action-state').textContent).toContain(
            'add:success',
          ),
        );
      }
      if (state === 'validation') {
        expect(fixtureScreen.getByRole('alert')).toBeTruthy();
        expect(
          fixtureScreen
            .getByRole('textbox', { name: 'Fixture value' })
            .getAttribute('aria-invalid'),
        ).toBe('true');
      }
      if (state === 'error') {
        await fireEvent.click(fixtureScreen.getByRole('button', { name: 'Retry' }));
        await waitFor(() =>
          expect(fixtureScreen.getByTestId('fixture-action-state').textContent).toContain(
            'retry:success',
          ),
        );
      }
      if (state === 'disabled') {
        expect(
          (fixtureScreen.getByRole('button', { name: 'Unavailable setting' }) as HTMLButtonElement)
            .disabled,
        ).toBe(true);
      }
      if (state === 'confirmation') {
        expect(fixtureScreen.getByRole('dialog', { name: 'Confirm settings change' })).toBeTruthy();
        await fireEvent.click(fixtureScreen.getByRole('button', { name: 'Confirm state change' }));
        await waitFor(() =>
          expect(fixtureScreen.getByTestId('fixture-action-state').textContent).toContain(
            'confirm:success',
          ),
        );
      }

      await exerciseFixtureSaveMode(saveMode, renderedState);
      expect(renderedState.dataset.state).toBe('success');
      expect(renderedState.dataset.ownerValue).toBe('success');

      if (stateOwner === 'daemon settings') {
        expect(window.electronAPI!.invoke).toHaveBeenCalledWith(
          IPC_CHANNELS.BACKEND.REQUEST,
          createSettingsFixtureUpdate('success').request,
        );
      }

      await waitFor(() =>
        expect(window.electronAPI!.invoke).toHaveBeenCalledWith(
          IPC_CHANNELS.BACKEND.REQUEST,
          SETTINGS_PROTOCOL_FIXTURES.list.request,
        ),
      );
    },
  );
});

describe('settings tab route and focus behavior', () => {
  it('labels the main region with the accessible page name', () => {
    const { container } = renderSettings('/settings?tab=display');
    const main = container.querySelector('main');
    const heading = screen.getByRole('heading', { level: 1, name: 'Settings' });

    expect(main?.getAttribute('aria-labelledby')).toBe(heading.id);
  });

  it.each([
    ['accounts', 'Providers', 'page'],
    ['agents', 'Agent Behavior', 'page'],
    ['setup', 'Setup', 'page'],
    ['tools', 'Setup', 'page'],
    ['git-workspace', 'Setup', 'page'],
    ['fonts-colors', 'Display', 'page'],
    ['notifications', 'App Behavior', 'page'],
    ['general', 'Display', 'page'],
    ['connections', 'Connections', 'page'],
    ['devices', 'Devices', 'page'],
    ['machines', 'Devices', 'page'],
    ['interface-system', 'Display', 'page'],
    ['input', 'Input', 'page'],
    ['unknown', 'Display', 'page'],
  ])('maps ?tab=%s to %s', async (tab, label, current) => {
    renderSettings(`/settings?tab=${tab}`);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: label }).getAttribute('aria-current')).toBe(
        current,
      ),
    );
  });

  it.each(['devices', 'machines'])(
    'maps the compatible #%s hash to the Devices tab',
    async (hash) => {
      const { container } = renderSettings(`/settings#${hash}`);
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Devices' }).getAttribute('aria-current')).toBe(
          'page',
        ),
      );
      expect(container.querySelector('#devices')).not.toBeNull();
    },
  );

  it('renders Agent Backend only on Advanced while the legacy Tools tab resolves to Setup', async () => {
    const advanced = renderSettings('/settings?tab=advanced');
    await waitFor(() => expect(advanced.container.querySelector('#agent-backend')).not.toBeNull());

    cleanup();

    const tools = renderSettings('/settings?tab=tools');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Setup' }).getAttribute('aria-current')).toBe(
        'page',
      ),
    );
    expect(tools.container.querySelector('#agent-backend')).toBeNull();
  });

  it.each([
    ['/settings#agent-backend'],
    // Legacy deep link from when the section lived on Tools.
    ['/settings?tab=setup#agent-backend'],
  ])('routes %s to the Advanced tab that now renders the section', async (url) => {
    renderSettings(url);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Advanced' }).getAttribute('aria-current')).toBe(
        'page',
      ),
    );
    expect(document.querySelector('#agent-backend')).not.toBeNull();
  });

  it.each([
    ['/settings?tab=input#voice', 'Input', 'voice'],
    ['/settings?tab=connections#voice', 'Input', 'voice'],
    ['/settings?tab=advanced#workspace-api', 'Advanced', 'workspace-api'],
    ['/settings?tab=system#workspace-api', 'Advanced', 'workspace-api'],
    ['/settings?tab=agent-behavior#agent-features', 'Agent Behavior', 'agent-features'],
    ['/settings?tab=behavior#agent-features', 'Agent Behavior', 'agent-features'],
  ])('routes canonical and legacy URL %s to %s', async (url, category, sectionId) => {
    renderSettings(url);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: category }).getAttribute('aria-current')).toBe(
        'page',
      ),
    );
    expect(document.getElementById(sectionId)).not.toBeNull();
  });

  it('activates selected specialist views', async () => {
    const implementorDefinition = SPECIALISTS.find(({ id }) => id === 'implementor')!;
    renderSettings('/settings?tab=specialists');
    appStore.dispatch(setBundledSpecialists([]));
    appStore.dispatch(
      setFileSpecialists([
        {
          id: implementorDefinition.id,
          name: implementorDefinition.name,
          description: implementorDefinition.description,
          model: '',
          behaviorPrompt: `${implementorDefinition.defaultBehaviorPrompt}\nModified`,
          roleReminder: implementorDefinition.roleReminder,
          filePath: '/Users/test/.intent/specialists/implementor.md',
          source: 'user',
        },
      ]),
    );
    const navigation = screen.getByRole('navigation', { name: 'Settings' });
    const implementor = await within(navigation).findByRole('button', { name: 'Implementor' });
    const createSpecialist = within(navigation).getByRole('button', {
      name: 'Create Specialist',
    });
    expect(implementor.hasAttribute('aria-current')).toBe(false);

    await fireEvent.click(implementor);

    expect(screen.getByTestId('ai-behavior-view').textContent).toContain('specialist:implementor');
    expect(implementor.getAttribute('aria-current')).toBe('true');

    await fireEvent.click(createSpecialist);

    expect(screen.getByTestId('ai-behavior-view').textContent).toContain('create-specialist');
    expect(createSpecialist.getAttribute('aria-current')).toBe('true');
  });

  it('activates a specialist after navigating between settings tabs', async () => {
    renderSettings('/settings?tab=agent-behavior');
    const navigation = screen.getByRole('navigation', { name: 'Settings' });

    await fireEvent.click(within(navigation).getByRole('button', { name: 'Providers' }));
    await fireEvent.click(within(navigation).getByRole('button', { name: 'Implementor' }));

    expect(
      within(navigation).getByRole('button', { name: 'Implementor' }).getAttribute('aria-current'),
    ).toBe('true');
    expect(screen.getByTestId('ai-behavior-view').textContent).toContain('specialist:implementor');
    expect(window.location.search).toBe('?tab=specialists&specialist=implementor');
    expect(window.location.hash).toBe('#specialist-implementor');
  });

  it('keeps Providers and Global Instructions default-model entry points on shared state', async () => {
    appStore.dispatch(hydrateDefaultProvider('codex'));
    appStore.dispatch(setSelectedModel({ providerId: 'codex', model: 'shared-fixture' }));
    renderSettings('/settings?tab=providers');

    expect(selectSelectedModel.select(appStore.state, 'codex')).toBe('shared-fixture');

    await fireEvent.click(screen.getByRole('button', { name: 'Agent Behavior' }));

    await screen.findByTestId('global-instructions-default-model-row');
    expect(selectSelectedModel.select(appStore.state, 'codex')).toBe('shared-fixture');

    appStore.dispatch(setSelectedModel({ providerId: 'codex', model: 'updated-fixture' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Providers' }));
    expect(selectSelectedModel.select(appStore.state, 'codex')).toBe('updated-fixture');
  });

  it('activates a clicked sidebar item while preserving params and hash', async () => {
    renderSettings('/settings?tab=connections&specialist=reviewer#integrations');
    const connections = screen.getByRole('button', { name: 'Connections' });
    const advanced = screen.getByRole('button', { name: 'Advanced' });
    advanced.focus();
    await fireEvent.click(advanced);

    expect(document.activeElement).toBe(advanced);
    expect(advanced.getAttribute('aria-current')).toBe('page');
    expect(connections.hasAttribute('aria-current')).toBe(false);
    expect(window.location.search).toBe('?tab=advanced&specialist=reviewer');
    expect(window.location.hash).toBe('#integrations');
  });

  it.each([
    ['/settings?specialist=reviewer', 'specialist:reviewer'],
    ['/settings?view=create-specialist', 'create-specialist'],
  ])('opens the requested Specialists query view for %s', async (url, expectedView) => {
    renderSettings(url);
    expect((await screen.findByTestId('ai-behavior-view')).textContent).toContain(expectedView);
  });

  it('syncs canonical Specialists query views while Settings remains mounted', async () => {
    const replaceState = vi.spyOn(window.history, 'replaceState');
    renderSettings('/settings?tab=specialists&specialist=implementor#specialist-implementor');
    expect((await screen.findByTestId('ai-behavior-view')).textContent).toContain(
      'specialist:implementor',
    );

    window.history.pushState(
      {},
      '',
      '/settings?tab=specialists&specialist=reviewer#specialist-reviewer',
    );
    mocks.page.url.href = window.location.href;
    await waitFor(() =>
      expect(screen.getByTestId('ai-behavior-view').textContent).toContain('specialist:reviewer'),
    );

    window.history.pushState(
      {},
      '',
      '/settings?tab=specialists&view=create-specialist#create-specialist',
    );
    mocks.page.url.href = window.location.href;
    await waitFor(() =>
      expect(screen.getByTestId('ai-behavior-view').textContent).toContain('create-specialist'),
    );

    window.history.pushState(
      {},
      '',
      '/settings?tab=specialists&specialist=implementor#specialist-implementor',
    );
    mocks.page.url.href = window.location.href;
    await waitFor(() =>
      expect(screen.getByTestId('ai-behavior-view').textContent).toContain(
        'specialist:implementor',
      ),
    );
    expect(replaceState).not.toHaveBeenCalled();
  });

  it.each([
    ['/settings?tab=agent-behavior&workspaceId=query-owner', 'value', 'query-owner'],
    ['/settings?tab=agent-behavior', 'null', 'none'],
  ])(
    'passes the expected workspace identity to AI behavior settings for %s',
    async (url, kind, value) => {
      renderSettings(url);

      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'Agent Behavior' }).getAttribute('aria-current'),
        ).toBe('page'),
      );
      const workspaceId = screen.getByTestId('ai-behavior-workspace-id');
      expect(workspaceId.dataset.workspaceIdKind).toBe(kind);
      expect(workspaceId.textContent?.trim()).toBe(value);
    },
  );
});

describe('settings back and footer behavior', () => {
  it('delegates back navigation', async () => {
    mocks.previousPath = '/';
    renderSettings('/settings');
    const back = screen.getByRole('button', { name: /Back/ });
    await fireEvent.click(back);
    expect(mocks.navigateBack).toHaveBeenCalledOnce();
  });

  it('dispatches install when an update is ready', async () => {
    appStore.dispatch(simulateSetState({ status: 'downloaded' }));
    renderSettings('/settings?tab=app-behavior');
    const update = screen.getByRole('button', { name: 'Update available' });
    const dispatchSpy = vi.spyOn(appStore, 'dispatch');
    await fireEvent.click(update);
    expect(dispatchSpy).toHaveBeenCalledWith(installUpdate());
  });
});

describe('settings hash target integration', () => {
  it.each([
    ['default-model', 'quickActions.defaultModel', 'Agent Behavior', 'page'],
    ['global-instructions', 'quickActions.defaultModel', 'Agent Behavior', 'page'],
    ['utility-default-model', 'utility-default-model', 'Providers', 'page'],
    ['updates', 'updates', 'App Behavior', 'page'],
    ['open-in', 'open-in', 'App Behavior', 'page'],
    ['github-link-action', 'github-link-action', 'App Behavior', 'page'],
    ['notifications', 'notifications', 'App Behavior', 'page'],
    ['agent-features', 'agent-features', 'Agent Behavior', 'page'],
    ['mcp-servers', 'mcp-servers', 'Connections', 'page'],
    ['cli-optimization', 'cli-optimization', 'Setup', 'page'],
    ['workspace-api', 'workspace-api', 'Advanced', 'page'],
    ['keyboard-shortcuts', 'keyboard-shortcuts', 'Input', 'page'],
    ['voice', 'voice', 'Input', 'page'],
    ['language', 'language', 'Display', 'page'],
    ['color-theme', 'color-theme', 'Display', 'page'],
    ['note-font', 'note-font', 'Display', 'page'],
    ['agent-chat-font', 'agent-chat-font', 'Display', 'page'],
    ['code-font', 'code-font', 'Display', 'page'],
  ])(
    'activates the registry tab and target for /settings#%s',
    async (hash, expectedId, tabLabel, expectedCurrent) => {
      const target = resolveHashToTarget(hash);
      expect(target?.id).toBe(expectedId);

      renderSettings(`/settings#${hash}`);

      const expectedTab = screen.getByRole('button', { name: tabLabel });
      await waitFor(() => expect(expectedTab.getAttribute('aria-current')).toBe(expectedCurrent));

      await waitFor(() => {
        const element = document.querySelector<HTMLElement>(target?.highlightSelector ?? '');
        expect(element).not.toBeNull();
      });
    },
  );

  it('waits 100 ms before scrolling the active hash target in its content container', async () => {
    vi.useFakeTimers();
    renderSettings('/settings#note-font');
    await Promise.resolve();
    await Promise.resolve();

    const target = document.getElementById('note-font');
    expect(target).not.toBeNull();
    Object.defineProperty(target!, 'offsetTop', { value: 140, configurable: true });
    const container = target!.closest('.overflow-auto') as HTMLElement;
    const scrollTo = vi.mocked(container.scrollTo);

    await vi.advanceTimersByTimeAsync(99);
    expect(scrollTo).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(scrollTo).toHaveBeenCalledWith({ top: 120, behavior: 'smooth' });
  });

  it('cancels the previous hash scroll when a newer hash is scheduled', async () => {
    vi.useFakeTimers();
    renderSettings('/settings?tab=display#note-font');
    await Promise.resolve();
    await Promise.resolve();

    const noteFont = document.getElementById('note-font')!;
    const codeFont = document.getElementById('code-font')!;
    const container = noteFont.closest('.overflow-auto') as HTMLElement;
    const scrollTo = vi.mocked(container.scrollTo);
    Object.defineProperty(noteFont, 'offsetTop', { value: 140, configurable: true });
    Object.defineProperty(codeFont, 'offsetTop', { value: 360, configurable: true });
    const pendingBeforeReschedule = vi.getTimerCount();

    window.history.replaceState({}, '', '/settings?tab=display#code-font');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(vi.getTimerCount()).toBe(pendingBeforeReschedule);
    await vi.advanceTimersByTimeAsync(100);

    expect(scrollTo).toHaveBeenCalledOnce();
    expect(scrollTo).toHaveBeenCalledWith({ top: 340, behavior: 'smooth' });
  });

  it('cancels a pending hash scroll when the hash is removed', async () => {
    vi.useFakeTimers();
    renderSettings('/settings?tab=display#note-font');
    await Promise.resolve();
    await Promise.resolve();
    const container = document
      .getElementById('note-font')!
      .closest('.overflow-auto') as HTMLElement;
    const scrollTo = vi.mocked(container.scrollTo);
    const pendingBeforeRemoval = vi.getTimerCount();

    window.history.replaceState({}, '', '/settings?tab=display');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(vi.getTimerCount()).toBe(pendingBeforeRemoval - 1);
    await vi.advanceTimersByTimeAsync(100);

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('cancels a pending hash scroll when the page unmounts', async () => {
    vi.useFakeTimers();
    const view = renderSettings('/settings?tab=display#note-font');
    await Promise.resolve();
    await Promise.resolve();
    const container = document
      .getElementById('note-font')!
      .closest('.overflow-auto') as HTMLElement;
    const scrollTo = vi.mocked(container.scrollTo);
    const pendingBeforeUnmount = vi.getTimerCount();

    view.unmount();
    expect(vi.getTimerCount()).toBeLessThan(pendingBeforeUnmount);
    await vi.advanceTimersByTimeAsync(100);

    expect(scrollTo).not.toHaveBeenCalled();
  });
});
