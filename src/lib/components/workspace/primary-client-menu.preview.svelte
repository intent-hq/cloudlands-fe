<script lang="ts" module>
  import type { Workspace } from '$shared/types';
  import { WorkspaceStatus } from '$shared/types';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import type { LiveClient, WorkspaceBrowserClient } from '$shared/types/browser-clients';
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import {
    PREVIEW_FIXTURE_IDS,
    PREVIEW_FIXTURE_TIMESTAMPS,
    definePreviewFixture,
  } from '$lib/component-catalog/preview-fixtures';
  import { store } from '$store/renderer/configured-store';
  import {
    liveClientsReceived,
    ownClientIdReceived,
    workspaceBrowserClientReceived,
  } from '$store/renderer/slices/browser-clients/browser-clients-slice';
  import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
  import { admitLegacyPrincipal } from '../../../test/fixtures/principal-state';

  /** Live sidebar card over a seeded client registry, with its menu open or closed. */
  export interface PrimaryClientMenuPreviewProps {
    width: number;
    /** Open the card's menu and its primary-client submenu once mounted. */
    menuOpen?: boolean;
  }

  export const PREVIEW_OWN_CLIENT_ID = 'client-preview-own';
  export const PREVIEW_WORKSPACE_ID = WorkspaceId(`${PREVIEW_FIXTURE_IDS.workspace}-driving`);

  const liveClientFixture = definePreviewFixture<LiveClient>({
    clientId: PREVIEW_OWN_CLIENT_ID,
    name: 'Intent Desktop',
    hostname: 'studio-mbp',
    prettyHostname: 'Studio MacBook Pro',
    deviceKind: 'laptop',
    capabilities: { browserExec: true },
    connections: 1,
    transports: ['ws'],
    connectedAt: PREVIEW_FIXTURE_TIMESTAMPS.createdAt,
  });
  const ownClient = liveClientFixture();
  const otherClient = liveClientFixture({
    clientId: 'client-preview-other',
    hostname: 'office-linux',
    prettyHostname: 'Office Linux',
    deviceKind: 'desktop',
  });
  const longNameClient = liveClientFixture({
    clientId: 'client-preview-long',
    hostname: 'design-studio',
    prettyHostname: 'Amelia Wattenberger’s Design Studio MacBook Pro',
    deviceKind: 'laptop',
  });
  const OFFLINE_CLIENT_ID = 'client-preview-offline';

  const workspace = definePreviewFixture<Workspace>({
    id: PREVIEW_WORKSPACE_ID,
    title: 'Improve frontend previews',
    branch: 'frontend-previews',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: WorkspaceStatus.Active,
    displayStatus: 'idle',
    attention: 'none',
    activity: 'idle',
    repositoryOwner: 'intent-hq',
    repositoryName: 'cloudlands-fe',
    repositoryPath: '/repos/cloudlands-fe',
    worktreePath: '/repos/cloudlands-fe/worktrees/frontend-previews',
    ...PREVIEW_FIXTURE_TIMESTAMPS,
  })();

  /** Seed the real store the way the sagas would after `client.list` + `workspace.getBrowserClient`. */
  function seed(
    clients: LiveClient[],
    browserClient: WorkspaceBrowserClient,
    role: 'owner' | 'guest' = 'owner',
  ) {
    return () => {
      admitLegacyPrincipal(role);
      store.dispatch(setWorkspaceEntity(workspace));
      store.dispatch(ownClientIdReceived(PREVIEW_OWN_CLIENT_ID));
      store.dispatch(liveClientsReceived(clients, PREVIEW_WORKSPACE_ID));
      store.dispatch(workspaceBrowserClientReceived(PREVIEW_WORKSPACE_ID, browserClient));
    };
  }

  const resolved = (client: LiveClient) => ({ clientId: client.clientId, name: client.name });
  const offlinePin: WorkspaceBrowserClient = {
    source: 'workspace',
    clientId: OFFLINE_CLIENT_ID,
    resolved: null,
  };

  /** Unpinned, routed to the host of agent tabs that is no longer connected. */
  const offlineTabHost: WorkspaceBrowserClient = {
    source: 'default',
    resolved: null,
    target: { clientId: OFFLINE_CLIENT_ID, via: 'tabs' },
  };

  export const preview = definePreview<PrimaryClientMenuPreviewProps>({
    id: 'primary-client-menu',
    title: 'Primary client menu',
    defaultState: 'elsewhere',
    states: {
      elsewhere: {
        props: { width: 300, menuOpen: true },
        setup: seed([ownClient, otherClient], {
          source: 'default',
          resolved: resolved(otherClient),
        }),
      },
      here: {
        props: { width: 300, menuOpen: true },
        setup: seed([ownClient, otherClient], {
          source: 'workspace',
          clientId: PREVIEW_OWN_CLIENT_ID,
          resolved: resolved(ownClient),
        }),
      },
      offline: {
        props: { width: 300, menuOpen: true },
        setup: seed([ownClient], offlinePin),
      },
      'offline-closed': {
        props: { width: 300 },
        setup: seed([ownClient], offlinePin),
      },
      'offline-tab-host': {
        props: { width: 300, menuOpen: true },
        setup: seed([ownClient, otherClient], offlineTabHost),
      },
      'long-name': {
        props: { width: 300, menuOpen: true },
        setup: seed([ownClient, longNameClient], {
          source: 'default',
          resolved: resolved(longNameClient),
        }),
      },
      'no-browser': {
        props: { width: 300, menuOpen: true },
        setup: seed([liveClientFixture({ capabilities: {} }), otherClient], {
          source: 'default',
          resolved: resolved(otherClient),
        }),
      },
      guest: {
        props: { width: 300, menuOpen: true },
        setup: seed(
          [ownClient, otherClient],
          { source: 'default', resolved: resolved(otherClient) },
          'guest',
        ),
      },
      unresolved: {
        props: { width: 300, menuOpen: true },
        setup: seed([ownClient], { source: 'default', resolved: null }),
      },
    },
  });
</script>

<script lang="ts">
  import { tick } from 'svelte';
  import WorkspaceProgressCard from './sidebar/WorkspaceProgressCard.svelte';

  let { width, menuOpen = false }: PrimaryClientMenuPreviewProps = $props();

  let cardElement: HTMLElement | null = $state(null);

  // The menus are live dropdowns; open them the way a user would for the capture.
  $effect(() => {
    if (!menuOpen || !cardElement) return;
    const element = cardElement;
    void tick().then(async () => {
      const trigger = element.querySelector<HTMLElement>('[data-workspace-actions-trigger]');
      trigger?.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }),
      );
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const submenu = document.querySelector<HTMLElement>('[data-action-id="primary-client"]');
        if (submenu) {
          submenu.click();
          return;
        }
      }
    });
  });
</script>

<div class="flex min-h-[340px] w-full" data-primary-client-menu-preview>
  <section
    class="flex shrink-0 flex-col overflow-hidden border-r border-border bg-sidebar px-3 py-3 text-sidebar-foreground"
    style:width={`${width}px`}
    bind:this={cardElement}
  >
    <WorkspaceProgressCard workspaceId={PREVIEW_WORKSPACE_ID} />
  </section>
</div>
