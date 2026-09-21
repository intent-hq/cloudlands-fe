/**
 * @vitest-environment jsdom
 *
 * Settings deep links through the boot window (intent-hq/intent#5514): the
 * collaborator-only redirect must not fire while the window identity is still
 * the boot-time default, so `/settings?tab=providers` lands on Providers for
 * an administrator once daemon state loads.
 */
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workspace, WorkspaceId } from '$shared/types';
import { WorkspaceStatusEnum } from '$shared/types';
import { initAppStore, store as appStore } from '$store/renderer/store';
import type { ReduxStoreContext } from '$store/renderer/types';
import { connectionsListReceived } from '$store/renderer/slices/connections/connections-slice';
import {
  guestSessionsListReceived,
  guestSessionsListUnavailable,
} from '$store/renderer/slices/guest-sessions/guest-sessions-slice';
import type { GuestSessionRecord } from '$store/renderer/slices/guest-sessions/guest-sessions-types';
import {
  replaceWorkspaceList,
  setWorkspaceHasLoaded,
} from '$store/renderer/slices/workspace/workspace-slice';
import { warmImport } from '../../../../test/warm-import';

const mocks = vi.hoisted(() => ({
  page: { url: new URL('http://localhost/settings?tab=providers') },
}));

vi.mock('$app/state', () => ({ page: mocks.page }));
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

const GUEST_SESSION: GuestSessionRecord = {
  id: 'guest-1',
  label: 'studio.local',
  host: '10.0.0.5',
  hosts: ['10.0.0.5'],
  port: 8443,
  fingerprint: 'AB:CD',
  tcAddress: null,
  hostname: 'studio.local',
  principalId: 'prin-guest',
  login: 'octocat',
  tokenEncrypted: true,
  updatedAt: 1,
};

function makeWorkspace(id: string, myRole: Workspace['myRole']): Workspace {
  return {
    id: id as WorkspaceId,
    title: id,
    branch: 'main',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: WorkspaceStatusEnum.Active,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    myRole,
  } as Workspace;
}

let storeContext: ReduxStoreContext | undefined;

function renderSettings(tab: string) {
  window.history.pushState({}, '', `/settings?tab=${tab}`);
  mocks.page.url = new URL(window.location.href);
  return render(SettingsPage, { context: new Map([['redux-store-context', storeContext]]) });
}

function urlTab(): string | null {
  return new URL(window.location.href).searchParams.get('tab');
}

function currentTab(): string | null {
  return (
    document
      .querySelector('[aria-current="page"][data-settings-tab]')
      ?.getAttribute('data-settings-tab') ?? null
  );
}

/** The window identity settles as an owner window: no host joined. */
function settleAsOwner() {
  appStore.dispatch(guestSessionsListUnavailable());
}

/** The window identity settles as a guest window bound to a joined host. */
function settleAsGuest() {
  appStore.dispatch(
    guestSessionsListReceived({ sessions: [GUEST_SESSION], openIds: [], connectedIds: [] }),
  );
  appStore.dispatch(
    connectionsListReceived({
      connections: [],
      activeId: GUEST_SESSION.id,
      windowBackendId: GUEST_SESSION.id,
    }),
  );
}

beforeEach(() => {
  storeContext = initAppStore(appStore);
  (globalThis as typeof globalThis & { __APP_VERSION__: string }).__APP_VERSION__ = '2.0.10';
  Object.defineProperty(Element.prototype, 'scrollTo', { value: vi.fn(), configurable: true });
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    value: vi.fn(),
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  storeContext?.dispose();
  storeContext = undefined;
});

describe('settings deep link through the boot window (intent-hq/intent#5514)', () => {
  it.each(['providers', 'connections'])(
    'keeps ?tab=%s while identity is unsettled and shows it once the window settles as an owner',
    async (tab) => {
      renderSettings(tab);

      // Boot window: the tab is withheld (not rendered), but the deep link is kept.
      expect(document.querySelector(`[data-settings-tab="${tab}"]`)).toBeNull();
      expect(urlTab()).toBe(tab);
      expect(currentTab()).toBeNull();

      settleAsOwner();

      await waitFor(() => expect(currentTab()).toBe(tab));
      expect(urlTab()).toBe(tab);
    },
  );

  it.each(['providers', 'connections'])(
    'redirects ?tab=%s to display once the window settles as a collaborator-only guest',
    async (tab) => {
      renderSettings(tab);
      expect(urlTab()).toBe(tab);

      settleAsGuest();

      await waitFor(() => expect(currentTab()).toBe('display'));
      expect(urlTab()).toBe('display');
      expect(document.querySelector(`[data-settings-tab="${tab}"]`)).toBeNull();
    },
  );

  it('redirects ?tab=providers to display for a settled owner window whose workspaces are all collaborator-role', async () => {
    settleAsOwner();
    appStore.dispatch(
      replaceWorkspaceList([
        makeWorkspace('ws-a', 'collaborator'),
        makeWorkspace('ws-b', 'collaborator'),
      ]),
    );
    appStore.dispatch(setWorkspaceHasLoaded(true));

    renderSettings('providers');

    await waitFor(() => expect(currentTab()).toBe('display'));
    expect(urlTab()).toBe('display');
    expect(document.querySelector('[data-settings-tab="providers"]')).toBeNull();
    expect(document.querySelector('[data-settings-tab="connections"]')).toBeNull();
  });
});
