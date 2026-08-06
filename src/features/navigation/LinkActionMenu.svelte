<script lang="ts">
  import { goto } from '$app/navigation';
  import Portal from '$lib/components/ui/Portal.svelte';
  import { writeTextToClipboard } from '$lib/utils/clipboard';
  import { pushEscapeLayer } from '$lib/utils/escapeLayers';
  import { m } from '$shared/paraglide/messages.js';
  import { setWorkspaceInitializerPendingGitHubPrefill } from '$store/renderer/slices/workspace-initializer/workspace-initializer-slice';
  import { store as appStore } from '$store/renderer/store';
  import { hideLinkActionMenu, linkActionMenuState } from './link-action-menu-state.svelte';
  import { openInBrowserPanel, openInExternalBrowser } from './link-handler';

  let menuElement: HTMLElement | null = $state(null);
  let adjustedX = $state(0);
  let adjustedY = $state(0);

  function adjustPosition() {
    adjustedX = linkActionMenuState.x;
    adjustedY = linkActionMenuState.y;
    if (!menuElement) return;
    const rect = menuElement.getBoundingClientRect();
    if (linkActionMenuState.x + rect.width > window.innerWidth - 10) {
      adjustedX = window.innerWidth - rect.width - 10;
    }
    if (linkActionMenuState.y + rect.height > window.innerHeight - 10) {
      adjustedY = window.innerHeight - rect.height - 10;
    }
  }

  function menuItems(): HTMLButtonElement[] {
    return menuElement ? Array.from(menuElement.querySelectorAll('button[role="menuitem"]')) : [];
  }

  // ARIA menu keyboard pattern: Arrow cycling, Home/End; Enter/Space activate
  // the focused button natively.
  function handleMenuKeyDown(event: KeyboardEvent) {
    const items = menuItems();
    if (items.length === 0) return;
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex: number | null = null;
    if (event.key === 'ArrowDown') {
      nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
    } else if (event.key === 'ArrowUp') {
      nextIndex = currentIndex < 0 ? items.length - 1 : (currentIndex - 1 + items.length) % items.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = items.length - 1;
    }
    if (nextIndex !== null) {
      event.preventDefault();
      items[nextIndex]?.focus();
    }
  }

  $effect(() => {
    if (!linkActionMenuState.visible) return;
    adjustedX = linkActionMenuState.x;
    adjustedY = linkActionMenuState.y;
    const anchorElement = linkActionMenuState.anchorElement;
    // Measure after render to keep the menu on-screen, then move focus into
    // the menu so keyboard users can operate it.
    requestAnimationFrame(() => {
      adjustPosition();
      menuItems()[0]?.focus();
    });

    // Use mousedown so the menu closes before any other click handler fires
    const handleMouseDown = (event: MouseEvent) => {
      if (menuElement && !menuElement.contains(event.target as Node)) {
        hideLinkActionMenu();
      }
    };
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
    document.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleResize);
    const releaseEscapeLayer = pushEscapeLayer(() => {
      hideLinkActionMenu();
    });

    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleResize);
      releaseEscapeLayer();
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
      ? m.navigation_linkActionMenu_startWorkspacePr_label({ number: linkActionMenuState.gitHubRef.number })
      : m.navigation_linkActionMenu_startWorkspaceIssue_label({
          number: linkActionMenuState.gitHubRef?.number ?? 0,
        }),
  );

  async function handleStartWorkspace() {
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
    await goto('/');
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
  <Portal zIndex={100}>
    <div
      bind:this={menuElement}
      class="fixed z-[100] bg-popover border border-border shadow-lg py-0.5 min-w-40"
      style="left: {adjustedX}px; top: {adjustedY}px;"
      role="menu"
      tabindex="-1"
      aria-label={m.navigation_linkActionMenu_menu_ariaLabel()}
      onkeydown={handleMenuKeyDown}
    >
      <button
        type="button"
        class="w-full px-3 py-1 text-sm text-left transition-colors flex items-center gap-2 outline-none focus-visible:bg-accent text-foreground hover:bg-accent cursor-pointer"
        onclick={handleStartWorkspace}
        role="menuitem"
      >
        {startWorkspaceLabel}
      </button>
      <div class="h-px bg-border my-0.5"></div>
      <button
        type="button"
        class="w-full px-3 py-1 text-sm text-left transition-colors flex items-center gap-2 outline-none focus-visible:bg-accent text-foreground hover:bg-accent cursor-pointer"
        onclick={handleOpenInBrowser}
        role="menuitem"
      >
        {m.navigation_linkActionMenu_openInBrowser_label()}
      </button>
      {#if linkActionMenuState.workspaceId}
        <button
          type="button"
          class="w-full px-3 py-1 text-sm text-left transition-colors flex items-center gap-2 outline-none focus-visible:bg-accent text-foreground hover:bg-accent cursor-pointer"
          onclick={handleOpenInApp}
          role="menuitem"
        >
          {m.navigation_linkActionMenu_openInApp_label()}
        </button>
      {/if}
      <button
        type="button"
        class="w-full px-3 py-1 text-sm text-left transition-colors flex items-center gap-2 outline-none focus-visible:bg-accent text-foreground hover:bg-accent cursor-pointer"
        onclick={handleCopyLink}
        role="menuitem"
      >
        {m.navigation_linkActionMenu_copyLink_label()}
      </button>
    </div>
  </Portal>
{/if}
