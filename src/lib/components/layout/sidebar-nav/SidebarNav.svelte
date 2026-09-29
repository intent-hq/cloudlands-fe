<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { m } from '$shared/paraglide/messages.js';
  import { Button } from '$lib/components/ui/button';
  import Fa from 'svelte-fa';
  import { faHouse } from '@fortawesome/free-solid-svg-icons';
  import { cn } from '$lib/utils';
  import WorkspaceTabFlare from '../WorkspaceTabFlare.svelte';
  import { WORKSPACE_TAB_MOTION_DURATION_MS } from '../titlebar-geometry';
  import { effectiveShortcutReadable } from '$lib/utils/effective-shortcuts';
  import TitlebarNavigationTooltip from '../TitlebarNavigationTooltip.svelte';
  import { selectOnboardingActive } from '$store/renderer/slices/sidebar-nav/sidebar-nav-selectors';

  const onboardingActive$ = selectOnboardingActive();
  const tabShortcut$ = effectiveShortcutReadable('navigation.go-to-tab');
  const homeShortcut = $derived($tabShortcut$.replace(/([1-8])-9$/, '1'));
  const isHome = $derived(page.url.pathname === '/');
</script>

{#if !$onboardingActive$}
  <nav
    class="sidebar-nav flex shrink-0 items-end"
    aria-label={m.layout_sidebarNav_ariaLabel()}
    data-top-navigation
  >
    <div
      class={cn(
        'home-tab relative flex h-(--control-height-medium) w-12 shrink-0 items-center border transition-[background-color,border-color] duration-spring-moderate motion-reduce:transition-none',
        isHome
          ? 'rounded-t-md border-border border-b-0 bg-sidebar text-foreground shadow-none'
          : 'rounded-md border-transparent text-muted-foreground hover:bg-sidebar/50 hover:text-foreground',
      )}
      data-home-tab
      data-active={isHome}
    >
      <WorkspaceTabFlare
        side="leading"
        visible={isHome}
        durationMs={WORKSPACE_TAB_MOTION_DURATION_MS}
      />
      <WorkspaceTabFlare
        side="trailing"
        visible={isHome}
        durationMs={WORKSPACE_TAB_MOTION_DURATION_MS}
      />
      <TitlebarNavigationTooltip label={m.home_navigation_description()} shortcut={homeShortcut}>
        <Button
          variant="plain"
          size="icon"
          class="sidebar-nav-btn flex h-(--control-height-medium) w-12 cursor-pointer items-center justify-center rounded-[inherit] focus-visible:text-foreground"
          onclick={() => goto('/')}
          aria-label={m.home_navigation_label()}
          aria-current={isHome ? 'page' : undefined}
          data-nav-item="home"
          data-titlebar-spaces-control
        >
          <Fa icon={faHouse} class="pointer-events-none size-4" />
        </Button>
      </TitlebarNavigationTooltip>
    </div>
  </nav>
{/if}
