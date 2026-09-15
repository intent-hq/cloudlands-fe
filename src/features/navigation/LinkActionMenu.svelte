<script lang="ts">
  import * as Menu from '$lib/components/ui/menu';
  import { writeTextToClipboard } from '$lib/utils/clipboard';
  import { m } from '$shared/paraglide/messages.js';
  import { setShowCreateModal } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
  import { setWorkspaceInitializerPendingGitHubPrefill } from '$store/renderer/slices/workspace-initializer/workspace-initializer-slice';
  import { store as appStore } from '$store/renderer/store';
  import { hideLinkActionMenu, linkActionMenuState } from './link-action-menu-state.svelte';
  import { openInBrowserPanel, openInExternalBrowser } from './link-handler';

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
      class="z-[100] py-0.5 min-w-40"
      aria-label={m.navigation_linkActionMenu_menu_ariaLabel()}
    >
      <Menu.Item
        class="w-full px-3 py-1 text-sm text-left transition-colors flex items-center gap-2 outline-none focus-visible:bg-accent text-foreground hover:bg-accent cursor-pointer"
        onSelect={handleStartWorkspace}
      >
        {startWorkspaceLabel}
      </Menu.Item>
      <Menu.Separator />
      <Menu.Item
        class="w-full px-3 py-1 text-sm text-left transition-colors flex items-center gap-2 outline-none focus-visible:bg-accent text-foreground hover:bg-accent cursor-pointer"
        onSelect={handleOpenInBrowser}
      >
        {m.navigation_linkActionMenu_openInBrowser_label()}
      </Menu.Item>
      {#if linkActionMenuState.workspaceId}
        <Menu.Item
          class="w-full px-3 py-1 text-sm text-left transition-colors flex items-center gap-2 outline-none focus-visible:bg-accent text-foreground hover:bg-accent cursor-pointer"
          onSelect={handleOpenInApp}
        >
          {m.navigation_linkActionMenu_openInApp_label()}
        </Menu.Item>
      {/if}
      <Menu.Item
        class="w-full px-3 py-1 text-sm text-left transition-colors flex items-center gap-2 outline-none focus-visible:bg-accent text-foreground hover:bg-accent cursor-pointer"
        onSelect={handleCopyLink}
      >
        {m.navigation_linkActionMenu_copyLink_label()}
      </Menu.Item>
    </Menu.Content>
  </Menu.Root>
{/if}
