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

  $effect(() => {
    if (!linkActionMenuState.visible) return;
    adjustedX = linkActionMenuState.x;
    adjustedY = linkActionMenuState.y;
    // Measure after render to keep the menu on-screen
    requestAnimationFrame(() => adjustPosition());

    // Use mousedown so the menu closes before any other click handler fires
    const handleMouseDown = (event: MouseEvent) => {
      if (menuElement && !menuElement.contains(event.target as Node)) {
        hideLinkActionMenu();
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    const releaseEscapeLayer = pushEscapeLayer(() => {
      hideLinkActionMenu();
    });

    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      releaseEscapeLayer();
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
      aria-label={m.navigation_linkActionMenu_menu_ariaLabel()}
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
