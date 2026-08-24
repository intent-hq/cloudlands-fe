/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { appClient } from '$lib/client';
import { SPECIALISTS } from '$lib/constants/specialists';
import type { ReduxStoreContext } from '$store/renderer/types';
import { initAppStore, store as appStore } from '$store/renderer/store';
import { selectActiveProviderId } from '$store/renderer/slices/provider-settings/provider-settings-selectors';
import { hydrateActiveProvider } from '$store/renderer/slices/provider-settings/provider-settings-slice';
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
import { requestUiHighlight } from '$store/renderer/slices/ui-highlight/ui-highlight-slice';
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
  default: (await import('$lib/components/chat/__tests__/mocks/SlotOnly.svelte')).default,
}));
vi.mock('$lib/components/settings/GitWorkspaceSettings.svelte', async () => ({
  default: (await import('$lib/components/chat/__tests__/mocks/SlotOnly.svelte')).default,
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
  mocks.page.url = new URL(window.location.href);
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
  document.documentElement.classList.remove('light', 'dark');
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
    catalog.find(({ path }) => path === 'providers.active')?.value ?? 'missing',
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
      writeOwner = (value) => appStore.dispatch(hydrateActiveProvider(value));
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
  mocks.page.url = new URL(window.location.href);
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

async function exerciseFixtureSaveMode(saveMode: string) {
  if (saveMode === 'immediate') {
    await fireEvent.click(screen.getByRole('button', { name: 'Apply immediately' }));
  } else if (saveMode === 'autosave') {
    await fireEvent.input(screen.getByRole('textbox', { name: 'Autosave value' }), {
      target: { value: 'saved draft' },
    });
  } else if (saveMode === 'blur-or-enter') {
    const input = screen.getByRole('textbox', { name: 'Blur or Enter value' });
    await fireEvent.input(input, { target: { value: 'saved on blur' } });
    await fireEvent.blur(input);
  } else if (saveMode === 'explicit') {
    await fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  } else {
    await fireEvent.click(screen.getByRole('button', { name: 'Review save' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Confirm fixture save' }));
  }
  await waitFor(() =>
    expect(screen.getByTestId('fixture-save-state').textContent).toContain('saved:success'),
  );
}

describe('settings deterministic capture fixtures', () => {
  it('covers every tab in light/dark at desktop/compact dimensions with stable IDs', () => {
    expect(SETTINGS_CAPTURE_FIXTURES).toHaveLength(24);
    expect(new Set(SETTINGS_CAPTURE_FIXTURES.map(({ id }) => id)).size).toBe(24);
    for (const tab of SETTINGS_TABS) {
      expect(SETTINGS_CAPTURE_FIXTURES.filter((fixture) => fixture.tab === tab.id)).toHaveLength(4);
    }
  });

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
    'renders $id deterministically',
    async ({ id, url, label, heading, theme, width, height, tab, state, stateOwner, saveMode }) => {
      Object.defineProperties(window, {
        innerWidth: { value: width, configurable: true },
        innerHeight: { value: height, configurable: true },
      });
      document.documentElement.classList.add(theme);

      if (stateOwner === 'daemon settings') {
        settingsCatalogResponse = settingsCatalogResponse.map((setting) =>
          setting.path === 'providers.active' ? { ...setting, value: state } : setting,
        );
      }

      const catalog = await appClient.settings.list();

      renderSettings(url, id, catalog);

      const activeTab = screen.getByRole('button', { name: label });
      await waitFor(() => expect(activeTab.className).toContain('text-foreground'));
      expect(document.documentElement.classList.contains(theme)).toBe(true);
      expect(window.innerWidth).toBe(width);
      expect(window.innerHeight).toBe(height);
      if (heading) expect(screen.getByRole('heading', { name: heading })).toBeTruthy();

      const renderedState = screen.getByTestId('settings-state-fixture');
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
      expect(screen.getByText(`Fixture state: ${state}`)).toBeTruthy();

      if (state === 'loading' || state === 'success')
        expect(screen.getByRole('status')).toBeTruthy();
      if (state === 'empty') {
        await fireEvent.click(screen.getByRole('button', { name: /Add .* item/ }));
        await waitFor(() =>
          expect(screen.getByTestId('fixture-action-state').textContent).toContain('add:success'),
        );
      }
      if (state === 'validation') {
        expect(screen.getByRole('alert')).toBeTruthy();
        expect(
          screen.getByRole('textbox', { name: 'Fixture value' }).getAttribute('aria-invalid'),
        ).toBe('true');
      }
      if (state === 'error') {
        await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        await waitFor(() =>
          expect(screen.getByTestId('fixture-action-state').textContent).toContain('retry:success'),
        );
      }
      if (state === 'disabled') {
        expect(
          (screen.getByRole('button', { name: 'Unavailable setting' }) as HTMLButtonElement)
            .disabled,
        ).toBe(true);
      }
      if (state === 'confirmation') {
        expect(screen.getByRole('dialog', { name: 'Confirm settings change' })).toBeTruthy();
        await fireEvent.click(screen.getByRole('button', { name: 'Confirm state change' }));
        await waitFor(() =>
          expect(screen.getByTestId('fixture-action-state').textContent).toContain(
            'confirm:success',
          ),
        );
      }

      await exerciseFixtureSaveMode(saveMode);
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
  it('keeps an accessible page name without a visible content-area heading', () => {
    const { container } = renderSettings('/settings?tab=general');
    const main = container.querySelector('main');
    const heading = screen.getByRole('heading', { level: 1, name: 'Settings' });

    expect(heading.className).toContain('sr-only');
    expect(heading.id).toBe('settings-page-title');
    expect(main?.getAttribute('aria-labelledby')).toBe(heading.id);
    expect(container.querySelector('main > header')).toBeNull();
  });

  it.each([
    ['providers', null],
    ['agents', null],
    ['tools', null],
    ['fonts-colors', 'Appearance'],
    ['notifications', 'Notifications'],
    ['general', 'Updates'],
  ])('uses the shared wide section layout for %s', (tab, heading) => {
    const { container } = renderSettings(`/settings?tab=${tab}`);
    const content = container.querySelector('main');

    expect(content?.className).toContain(tab === 'agents' ? 'max-w-6xl' : 'max-w-4xl');
    expect(content?.className).toContain('flex-col');
    if (heading) expect(screen.getByRole('heading', { name: heading })).toBeTruthy();
  });

  it('widens the settings content for every Agents editor view', async () => {
    appStore.dispatch(setBundledSpecialists([...SPECIALISTS]));
    const { container } = renderSettings('/settings?tab=agents');
    const content = container.querySelector('main');
    const editorSection = container.querySelector('#default-model');
    const navigation = screen.getByRole('navigation', { name: 'Settings' });

    expect(content?.className).toContain('max-w-6xl');
    expect(content?.className).not.toContain('max-w-4xl');
    expect(content?.className).toContain('xl:h-full');
    expect(content?.className).toContain('xl:min-h-0');
    expect(content?.className).toContain('xl:py-8');
    expect(editorSection?.className).toContain('xl:min-h-0');
    expect(editorSection?.className).toContain('xl:flex-1');
    expect(editorSection?.className).toContain('xl:flex-col');

    await fireEvent.click(within(navigation).getByRole('button', { name: 'Implementor' }));

    expect(content?.className).toContain('max-w-6xl');
    expect(content?.className).not.toContain('max-w-4xl');
    expect(content?.className).toContain('xl:h-full');
    expect(content?.className).toContain('xl:min-h-0');
    expect(content?.className).toContain('xl:py-8');
    expect(editorSection?.className).toContain('xl:min-h-0');
    expect(editorSection?.className).toContain('xl:flex-1');
    expect(editorSection?.className).toContain('xl:flex-col');

    await fireEvent.click(within(navigation).getByRole('button', { name: 'Create Specialist' }));

    expect(content?.className).toContain('max-w-6xl');
    expect(content?.className).not.toContain('max-w-4xl');
    expect(content?.className).toContain('xl:h-full');
    expect(content?.className).toContain('xl:min-h-0');
    expect(content?.className).toContain('xl:py-8');
    expect(editorSection?.className).toContain('xl:min-h-0');
    expect(editorSection?.className).toContain('xl:flex-1');
    expect(editorSection?.className).toContain('xl:flex-col');

    await fireEvent.click(within(navigation).getByRole('button', { name: 'Implementor' }));
    await fireEvent.click(within(navigation).getByRole('button', { name: 'Providers' }));

    expect(content?.className).toContain('max-w-4xl');
    expect(content?.className).not.toContain('max-w-6xl');
    expect(content?.className).not.toContain('xl:h-full');
  });

  it.each([
    ['accounts', 'Providers'],
    ['agents', 'Agents'],
    ['setup', 'Tools'],
    ['fonts-colors', 'Appearance'],
    ['notifications', 'General'],
    ['general', 'General'],
    ['connections', 'Connections'],
    ['interface-system', 'Appearance'],
    ['unknown', 'General'],
  ])('maps ?tab=%s to %s', async (tab, label) => {
    renderSettings(`/settings?tab=${tab}`);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: label }).getAttribute('aria-current')).toBe('page'),
    );
  });

  it('renders the Agent Backend section on Advanced and no longer on Tools', async () => {
    const advanced = renderSettings('/settings?tab=advanced');
    await waitFor(() => expect(advanced.container.querySelector('#agent-backend')).not.toBeNull());
    expect(screen.getByRole('heading', { name: 'Agent Backend' })).toBeTruthy();

    cleanup();

    const tools = renderSettings('/settings?tab=tools');
    await waitFor(() => expect(tools.container.querySelector('#mcp-servers')).not.toBeNull());
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

  it('exposes sidebar navigation buttons with the active page marked', async () => {
    renderSettings('/settings?tab=accounts');
    expect(screen.getByRole('navigation', { name: 'Settings' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Providers' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(screen.getByRole('button', { name: 'Agents' }).hasAttribute('aria-current')).toBe(false);
  });

  it('renders compact agent selection only inside the existing settings sidebar', async () => {
    const implementorDefinition = SPECIALISTS.find(({ id }) => id === 'implementor')!;
    const { container } = renderSettings('/settings?tab=agents');
    appStore.dispatch(setBundledSpecialists([...SPECIALISTS]));
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
        {
          id: 'sidebar-custom',
          name: 'Sidebar Custom',
          description: 'Project specialist',
          model: '',
          behaviorPrompt: 'Custom prompt',
          filePath: '/repo/.intent/specialists/sidebar-custom.md',
          source: 'project',
        },
      ]),
    );
    const navigation = screen.getByRole('navigation', { name: 'Settings' });
    const agentNavigation = navigation.querySelector('[data-settings-agents-submenu]');
    await waitFor(() =>
      expect(
        within(navigation).getByRole('button', { name: 'Sidebar Custom Project' }),
      ).toBeTruthy(),
    );
    const agents = within(navigation).getByRole('button', { name: 'Agents' });
    const allAgents = within(navigation).getByRole('button', { name: 'All agents' });
    const implementor = within(navigation).getByRole('button', { name: 'Implementor' });
    const customSpecialist = within(navigation).getByRole('button', {
      name: 'Sidebar Custom Project',
    });
    const createSpecialist = within(navigation).getByRole('button', {
      name: 'Create Specialist',
    });
    const connections = within(navigation).getByRole('button', { name: 'Connections' });
    const navigationButtons = within(navigation).getAllByRole('button');

    expect(agentNavigation).not.toBeNull();
    expect(agentNavigation?.contains(allAgents)).toBe(true);
    expect(agentNavigation?.contains(implementor)).toBe(true);
    expect(agentNavigation?.contains(customSpecialist)).toBe(true);
    expect(agentNavigation?.contains(createSpecialist)).toBe(true);
    expect(navigationButtons.indexOf(agents)).toBeLessThan(navigationButtons.indexOf(allAgents));
    expect(navigationButtons.indexOf(createSpecialist)).toBeLessThan(
      navigationButtons.indexOf(connections),
    );
    expect(within(navigation).queryByText('Specialists')).toBeNull();
    expect(agentNavigation?.querySelectorAll('[data-icon], svg, img')).toHaveLength(1);
    expect(createSpecialist.querySelectorAll('[data-icon="plus"]')).toHaveLength(1);
    expect(allAgents.querySelector('[data-icon], svg, img')).toBeNull();
    expect(agentNavigation?.querySelectorAll('[data-specialist-modified-marker]')).toHaveLength(1);
    expect(implementor.querySelector('[data-specialist-modified-marker]')?.textContent).toBe('*');
    expect(implementor.querySelector('[data-specialist-modified-marker]')?.className).toContain(
      'text-ui',
    );
    expect(implementor.querySelector('[data-specialist-modified-marker]')?.className).toContain(
      'text-muted-foreground',
    );
    expect(customSpecialist.querySelector('[data-specialist-modified-marker]')).toBeNull();
    expect(within(customSpecialist).getByText('Project')).toBeTruthy();
    expect(allAgents.querySelector('[data-specialist-modified-marker]')).toBeNull();
    expect(createSpecialist.querySelector('[data-specialist-modified-marker]')).toBeNull();
    for (const specialist of agentNavigation?.querySelectorAll('button') ?? []) {
      if (specialist !== createSpecialist) {
        expect(specialist.querySelector('[data-icon], svg, img')).toBeNull();
      }
    }
    expect(agents.querySelector('[data-slot="settings-sidebar-icon"] [data-icon]')).not.toBeNull();
    expect(agents.getAttribute('aria-current')).toBe('page');
    expect(agents.className).not.toContain('bg-muted font-medium');
    expect(agents.className).not.toContain('shadow-xs');
    expect(allAgents.getAttribute('aria-current')).toBe('true');
    expect(allAgents.className).toContain('bg-muted text-foreground');
    expect(implementor.className).not.toContain('bg-muted text-foreground');
    expect(container.querySelector('main [data-settings-agents-submenu]')).toBeNull();
    expect(container.querySelector('main #default-model')?.children).toHaveLength(1);
    expect(container.querySelector('main #default-model')?.className).not.toContain('grid-cols');

    await fireEvent.click(implementor);

    expect(screen.getByTestId('ai-behavior-view').textContent).toContain('specialist:implementor');
    expect(implementor.getAttribute('aria-current')).toBe('true');
    expect(implementor.className).toContain('bg-muted text-foreground');
    expect(allAgents.hasAttribute('aria-current')).toBe(false);
    expect(allAgents.className).not.toContain('bg-muted text-foreground');
    expect(agents.className).not.toContain('shadow-xs');

    await fireEvent.click(createSpecialist);

    expect(screen.getByTestId('ai-behavior-view').textContent).toContain('create-specialist');
    expect(createSpecialist.getAttribute('aria-current')).toBe('true');
    expect(createSpecialist.className).toContain('bg-muted text-foreground');
    expect(implementor.className).not.toContain('bg-muted text-foreground');

    await fireEvent.click(allAgents);

    expect(screen.getByTestId('ai-behavior-view').textContent).toContain('system-prompt');
    expect(allAgents.getAttribute('aria-current')).toBe('true');
  });

  it('collapses the nested agent navigation when another settings category is selected', async () => {
    renderSettings('/settings?tab=agents');
    const navigation = screen.getByRole('navigation', { name: 'Settings' });

    expect(within(navigation).getByRole('button', { name: 'All agents' })).toBeTruthy();

    await fireEvent.click(within(navigation).getByRole('button', { name: 'Providers' }));

    expect(navigation.querySelector('[data-settings-agents-submenu]')).toBeNull();
    expect(within(navigation).queryByRole('button', { name: 'All agents' })).toBeNull();
  });

  it('activates a clicked sidebar item while preserving params and hash', async () => {
    renderSettings('/settings?tab=accounts&specialist=reviewer#integrations');
    const providers = screen.getByRole('button', { name: 'Providers' });
    const advanced = screen.getByRole('button', { name: 'Advanced' });
    advanced.focus();
    await fireEvent.click(advanced);

    expect(document.activeElement).toBe(advanced);
    expect(advanced.getAttribute('aria-current')).toBe('page');
    expect(providers.hasAttribute('aria-current')).toBe(false);
    expect(window.location.search).toBe('?tab=advanced&specialist=reviewer');
    expect(window.location.hash).toBe('#integrations');
  });

  it.each([
    ['/settings?specialist=reviewer', 'specialist:reviewer'],
    ['/settings?view=create-specialist', 'create-specialist'],
  ])('opens the requested Agents query view for %s', async (url, expectedView) => {
    renderSettings(url);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Agents' }).getAttribute('aria-current')).toBe(
        'page',
      ),
    );
    expect(screen.getByTestId('ai-behavior-view').textContent).toContain(expectedView);
  });

  it.each([
    ['/settings?tab=agents&workspaceId=query-owner', 'value', 'query-owner'],
    ['/settings?tab=agents', 'null', 'none'],
  ])(
    'passes the expected workspace identity to AI behavior settings for %s',
    async (url, kind, value) => {
      renderSettings(url);

      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Agents' }).getAttribute('aria-current')).toBe(
          'page',
        ),
      );
      const workspaceId = screen.getByTestId('ai-behavior-workspace-id');
      expect(workspaceId.dataset.workspaceIdKind).toBe(kind);
      expect(workspaceId.textContent?.trim()).toBe(value);
    },
  );
});

describe('settings back and footer behavior', () => {
  it('shows the back label and delegates click navigation', async () => {
    mocks.previousPath = '/';
    renderSettings('/settings');
    const back = screen.getByRole('button', { name: /Back/ });
    expect(back.textContent).toContain('Back');
    await fireEvent.click(back);
    expect(mocks.navigateBack).toHaveBeenCalledOnce();
  });

  it('renders version and support state when the app is up to date', () => {
    renderSettings('/settings?tab=general');
    expect(screen.getByText(/v2\.0\.10/)).toBeTruthy();
    expect(screen.getByText('Up to date')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Support' }).getAttribute('href')).toBe(
      'https://www.intentapp.dev/docs',
    );
    expect(screen.getByRole('link', { name: 'Support' }).getAttribute('target')).toBe('_blank');
  });

  it('dispatches install when an update is ready', async () => {
    appStore.dispatch(simulateSetState({ status: 'downloaded' }));
    renderSettings('/settings?tab=general');
    const update = screen.getByRole('button', { name: 'Update available' });
    const dispatchSpy = vi.spyOn(appStore, 'dispatch');
    await fireEvent.click(update);
    expect(dispatchSpy).toHaveBeenCalledWith(installUpdate());
  });
});

describe('settings hash target integration', () => {
  it.each([
    ['default-model', 'quickActions.defaultModel', 'Agents'],
    ['utility-default-model', 'utility-default-model', 'Tools'],
    ['notifications', 'notifications', 'General'],
    ['color-theme', 'color-theme', 'Appearance'],
    ['note-font', 'note-font', 'Appearance'],
    ['agent-chat-font', 'agent-chat-font', 'Appearance'],
    ['code-font', 'code-font', 'Appearance'],
  ])(
    'activates the registry tab and highlight target for /settings#%s',
    async (hash, expectedId, tabLabel) => {
      const target = resolveHashToTarget(hash);
      expect(target?.id).toBe(expectedId);

      renderSettings(`/settings#${hash}`);

      const expectedTab = screen.getByRole('button', { name: tabLabel });
      await waitFor(() => expect(expectedTab.getAttribute('aria-current')).toBe('page'));

      const targetElement = await waitFor(() => {
        const element = document.querySelector<HTMLElement>(target?.highlightSelector ?? '');
        expect(element).not.toBeNull();
        return element as HTMLElement;
      });

      storeContext.store.dispatch(requestUiHighlight(target!.id));
      await waitFor(() => {
        expect(targetElement.classList.contains('ui-highlight-pulse-ring')).toBe(true);
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
    renderSettings('/settings?tab=fonts-colors#note-font');
    await Promise.resolve();
    await Promise.resolve();

    const noteFont = document.getElementById('note-font')!;
    const codeFont = document.getElementById('code-font')!;
    const container = noteFont.closest('.overflow-auto') as HTMLElement;
    const scrollTo = vi.mocked(container.scrollTo);
    Object.defineProperty(noteFont, 'offsetTop', { value: 140, configurable: true });
    Object.defineProperty(codeFont, 'offsetTop', { value: 360, configurable: true });
    const pendingBeforeReschedule = vi.getTimerCount();

    window.history.replaceState({}, '', '/settings?tab=fonts-colors#code-font');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(vi.getTimerCount()).toBe(pendingBeforeReschedule);
    await vi.advanceTimersByTimeAsync(100);

    expect(scrollTo).toHaveBeenCalledOnce();
    expect(scrollTo).toHaveBeenCalledWith({ top: 340, behavior: 'smooth' });
  });

  it('cancels a pending hash scroll when the hash is removed', async () => {
    vi.useFakeTimers();
    renderSettings('/settings?tab=fonts-colors#note-font');
    await Promise.resolve();
    await Promise.resolve();
    const container = document
      .getElementById('note-font')!
      .closest('.overflow-auto') as HTMLElement;
    const scrollTo = vi.mocked(container.scrollTo);
    const pendingBeforeRemoval = vi.getTimerCount();

    window.history.replaceState({}, '', '/settings?tab=fonts-colors');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(vi.getTimerCount()).toBe(pendingBeforeRemoval - 1);
    await vi.advanceTimersByTimeAsync(100);

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('cancels a pending hash scroll when the page unmounts', async () => {
    vi.useFakeTimers();
    const view = renderSettings('/settings?tab=fonts-colors#note-font');
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
