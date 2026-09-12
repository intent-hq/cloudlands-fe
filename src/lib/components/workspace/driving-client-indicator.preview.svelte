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
  import { initializeLayout } from '$store/renderer/slices/panel-layout/panel-layout-slice';
  import type { PanelTab } from '$store/renderer/slices/panel-layout/panel-layout-types';
  import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';

  /**
   * The live sidebar card over a seeded `browserClients` slice and panel
   * layout (REV-2, spec Model 8): the driving-client indicator under the
   * repository/branch row and the "Set Current Client as Primary"
   * ellipsis-menu action. The indicator needs a browser tab in the layout
   * (except for an offline pin), so every state seeds the layout too.
   */
  export interface DrivingClientIndicatorPreviewProps {
    width: number;
    /** Open the card's ellipsis menu once mounted (captures the switch action). */
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

  const browserTab: PanelTab = {
    id: 'preview-browser-tab',
    type: 'browser',
    title: 'Preview',
    closable: true,
    browserUrl: 'http://127.0.0.1:5173/',
  };

  /**
   * Seed the real store the way the sagas would after `client.list` +
   * `workspace.getBrowserClient` and a layout restore with (or without) a
   * browser tab in the panel.
   */
  function seed(
    clients: LiveClient[],
    browserClient: WorkspaceBrowserClient,
    tabs: PanelTab[] = [browserTab],
  ) {
    return () => {
      store.dispatch(setWorkspaceEntity(workspace));
      store.dispatch(
        initializeLayout(PREVIEW_WORKSPACE_ID, {
          root: { type: 'panel', panelId: 'main' },
          panels: { main: { id: 'main', tabs, activeTabId: tabs[0]?.id ?? null } },
          focusedPanelId: 'main',
        }),
      );
      store.dispatch(ownClientIdReceived(PREVIEW_OWN_CLIENT_ID));
      store.dispatch(liveClientsReceived(clients));
      store.dispatch(workspaceBrowserClientReceived(PREVIEW_WORKSPACE_ID, browserClient));
    };
  }

  const resolved = (client: LiveClient) => ({ clientId: client.clientId, name: client.name });

  export const preview = definePreview<DrivingClientIndicatorPreviewProps>({
    id: 'driving-client-indicator',
    title: 'Driving client indicator',
    defaultState: 'driving-elsewhere',
    states: {
      'single-client': {
        props: { width: 360 },
        setup: seed([ownClient], { source: 'default', resolved: resolved(ownClient) }),
      },
      'driving-here': {
        props: { width: 360 },
        setup: seed([ownClient, otherClient], { source: 'default', resolved: resolved(ownClient) }),
      },
      'driving-elsewhere': {
        props: { width: 360 },
        setup: seed([ownClient, otherClient], {
          source: 'default',
          resolved: resolved(otherClient),
        }),
      },
      'driving-elsewhere-menu-open': {
        props: { width: 360, menuOpen: true },
        setup: seed([ownClient, otherClient], {
          source: 'default',
          resolved: resolved(otherClient),
        }),
      },
      'no-browser-tabs': {
        props: { width: 360 },
        setup: seed(
          [ownClient, otherClient],
          { source: 'default', resolved: resolved(otherClient) },
          [],
        ),
      },
      'pinned-offline': {
        props: { width: 360 },
        setup: seed(
          [ownClient],
          { source: 'workspace', clientId: OFFLINE_CLIENT_ID, resolved: null },
          [],
        ),
      },
    },
  });
</script>

<script lang="ts">
  import { tick } from 'svelte';
  import WorkspaceProgressCard from './sidebar/WorkspaceProgressCard.svelte';

  let { width, menuOpen = false }: DrivingClientIndicatorPreviewProps = $props();

  let cardElement: HTMLElement | null = $state(null);

  // The menu is a live dropdown; the scene opens it the way a user would so
  // the "Set Current Client as Primary" item is visible in the capture.
  $effect(() => {
    if (!menuOpen || !cardElement) return;
    const element = cardElement;
    void tick().then(() => {
      const trigger = element.querySelector<HTMLElement>('[data-workspace-actions-trigger]');
      trigger?.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }),
      );
    });
  });
</script>

<section
  class="flex min-h-[200px] flex-col overflow-hidden rounded-lg border border-border bg-sidebar px-3 py-3 text-sidebar-foreground"
  style:width={`${width}px`}
  data-driving-client-indicator-preview
  data-preview-width={width}
  bind:this={cardElement}
>
  <WorkspaceProgressCard workspaceId={PREVIEW_WORKSPACE_ID} />
</section>
