<script lang="ts">
  import * as Menu from '$lib/components/ui/menu';
  import { writeTextToClipboard } from '$lib/utils/clipboard';
  import { m } from '$shared/paraglide/messages.js';
  import { setShowCreateModal } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
  import { setWorkspaceInitializerPendingGitHubPrefill } from '$store/renderer/slices/workspace-initializer/workspace-initializer-slice';
  import { store as appStore } from '$store/renderer/store';
  import { hideLinkActionMenu, linkActionMenuState } from './link-action-menu-state.svelte';
  import type { PullRequestWorkspace } from '$lib/client/app-client';
  import { openInBrowserPanel, openInExternalBrowser, openLinkedWorkspace } from './link-handler';

  let menuElement: HTMLElement | null = $state(null);
  const menuAnchor = $derived.by(() => {
    const x = linkActionMenuState.x;
    const y = linkActionMenuState.y;
    return {
      getBoundingClientRect: () => DOMRect.fromRect({ x, y, width: 0, height: 0 }),
    };
  });

  function handleOpenAutoFocus(event: Event) {
    event.preventDefault();
    menuElement?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }

  $effect(() => {
    if (!linkActionMenuState.visible) return;
    const anchorElement = linkActionMenuState.anchorElement;

    // The menu is position:fixed at the click point — dismiss on scroll
    // (capture phase: chat scrolls in nested containers) and resize so it
    // never floats at stale coordinates.
    const handleScroll = (event: Event) => {
      if (menuElement && event.target instanceof Node && menuElement.contains(event.target)) {
        return;
      }
      hideLinkActionMenu();
    };
    const handleResize = () => hideLinkActionMenu();
    const handlePointerDown = (event: PointerEvent) => {
      if (!menuElement?.contains(event.target as Node)) hideLinkActionMenu();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleResize);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleResize);
      // Restore focus to the triggering element if focus is still inside the menu
      if (
        anchorElement?.isConnected &&
        (document.activeElement === document.body ||
          (document.activeElement && menuElement?.contains(document.activeElement)))
      ) {
        anchorElement.focus();
      }
    };
  });

  const startWorkspaceLabel = $derived(
    linkActionMenuState.gitHubRef?.kind === 'pr'
      ? m.navigation_linkActionMenu_startWorkspacePr_label({
          number: linkActionMenuState.gitHubRef.number,
        })
      : m.navigation_linkActionMenu_startWorkspaceIssue_label({
          number: linkActionMenuState.gitHubRef?.number ?? 0,
        }),
  );

  // The workspace the click came from is never offered: the user is already there.
  const originalWorkspaces = $derived(
    linkActionMenuState.gitHubRef?.kind === 'pr'
      ? linkActionMenuState.linkedWorkspaces.filter(
          (workspace) => workspace.id !== linkActionMenuState.workspaceId,
        )
      : [],
  );

  function workspaceName(workspace: PullRequestWorkspace): string {
    return workspace.title.trim() || m.navigation_linkActionMenu_untitledWorkspace_label();
  }

  async function handleOpenOriginalWorkspace(workspace: PullRequestWorkspace) {
    hideLinkActionMenu();
    await openLinkedWorkspace(workspace.id);
  }

  function handleStartWorkspace() {
    const ref = linkActionMenuState.gitHubRef;
    const { url } = linkActionMenuState;
    hideLinkActionMenu();
    if (!ref) return;
    appStore.dispatch(
      setWorkspaceInitializerPendingGitHubPrefill({
        owner: ref.owner,
        repo: ref.repo,
        number: ref.number,
        kind: ref.kind,
        url,
      }),
    );
    appStore.dispatch(setShowCreateModal(true));
  }

  async function handleOpenInBrowser() {
    const { url } = linkActionMenuState;
    hideLinkActionMenu();
    await openInExternalBrowser(url);
  }

  async function handleOpenInApp() {
    const { url, workspaceId } = linkActionMenuState;
    hideLinkActionMenu();
    if (workspaceId) {
      await openInBrowserPanel(url, workspaceId);
    } else {
      await openInExternalBrowser(url);
    }
  }

  async function handleCopyLink() {
    const { url } = linkActionMenuState;
    hideLinkActionMenu();
    await writeTextToClipboard(url);
  }
</script>

{#snippet archivedTag(workspace: PullRequestWorkspace)}
  {#if workspace.archived}
    <span class="shrink-0 text-muted-foreground">
      {m.navigation_linkActionMenu_archivedWorkspace_label()}
    </span>
  {/if}
{/snippet}

{#if linkActionMenuState.visible}
  <Menu.Root
    open={linkActionMenuState.visible}
    onOpenChange={(open) => {
      if (!open) hideLinkActionMenu();
    }}
  >
    <Menu.Content
      bind:ref={menuElement}
      customAnchor={menuAnchor}
      side="bottom"
      align="start"
      sideOffset={0}
      collisionPadding={10}
      strategy="fixed"
      preventScroll={false}
      onOpenAutoFocus={handleOpenAutoFocus}
      class="min-w-40"
      aria-label={m.navigation_linkActionMenu_menu_ariaLabel()}
    >
      {#if linkActionMenuState.gitHubRef}
        <Menu.Item onSelect={handleStartWorkspace}>{startWorkspaceLabel}</Menu.Item>
        <Menu.Separator />
      {/if}
      <Menu.Item onSelect={handleOpenInBrowser}>
        {m.navigation_linkActionMenu_openInBrowser_label()}
      </Menu.Item>
      {#if linkActionMenuState.workspaceId}
        <Menu.Item onSelect={handleOpenInApp}>
          {m.navigation_linkActionMenu_openInApp_label()}
        </Menu.Item>
      {/if}
      <Menu.Separator />
      <Menu.Item onSelect={handleCopyLink}>
        {m.navigation_linkActionMenu_copyLink_label()}
      </Menu.Item>
      <!-- Last, so a lookup that resolves while the menu is open never shifts the items above. -->
      {#if originalWorkspaces.length === 1}
        {@const workspace = originalWorkspaces[0]}
        <Menu.Separator />
        <Menu.Item onSelect={() => handleOpenOriginalWorkspace(workspace)}>
          {m.navigation_linkActionMenu_openInOriginalWorkspace_label()}
        </Menu.Item>
      {:else if originalWorkspaces.length > 1}
        <Menu.Separator />
        <Menu.Sub>
          <Menu.SubTrigger>
            {m.navigation_linkActionMenu_openInOriginalWorkspace_label()}
          </Menu.SubTrigger>
          <Menu.SubContent class="max-w-72">
            {#each originalWorkspaces as workspace (workspace.id)}
              <Menu.Item onSelect={() => handleOpenOriginalWorkspace(workspace)}>
                <span class="min-w-0 flex-1 truncate">{workspaceName(workspace)}</span>
                {@render archivedTag(workspace)}
              </Menu.Item>
            {/each}
          </Menu.SubContent>
        </Menu.Sub>
      {/if}
    </Menu.Content>
  </Menu.Root>
{/if}
