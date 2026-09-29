<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { m } from '$shared/paraglide/messages.js';
  import { Button } from '$lib/components/ui/button';
  import Fa from 'svelte-fa';
  import { faHouse } from '@fortawesome/free-solid-svg-icons';
  import { cn } from '$lib/utils';
  import {
    TITLEBAR_NAVIGATION_CONTROL_CLASS,
    TITLEBAR_NAVIGATION_GLYPH_CLASS,
  } from '../titlebar-navigation';
  import TitlebarNavigationTooltip from '../TitlebarNavigationTooltip.svelte';
  import { selectOnboardingActive } from '$store/renderer/slices/sidebar-nav/sidebar-nav-selectors';

  const onboardingActive$ = selectOnboardingActive();
</script>

{#if !$onboardingActive$}
  <nav
    class="sidebar-nav flex h-8 shrink-0 items-center gap-0.5"
    aria-label={m.layout_sidebarNav_ariaLabel()}
    data-top-navigation
  >
    <TitlebarNavigationTooltip label={m.home_navigation_description()} shortcut="mod+o">
      <Button
        variant="ghost-light"
        size="icon"
        iconOnly
        class={cn('sidebar-nav-btn relative', TITLEBAR_NAVIGATION_CONTROL_CLASS)}
        onclick={() => goto('/')}
        aria-label={m.home_navigation_label()}
        aria-current={page.url.pathname === '/' ? 'page' : undefined}
        data-nav-item="home"
        data-titlebar-spaces-control
      >
        <span class={TITLEBAR_NAVIGATION_GLYPH_CLASS} data-titlebar-navigation-glyph>
          <Fa icon={faHouse} class="pointer-events-none size-4" />
        </span>
        {#if page.url.pathname === '/'}
          <span
            class="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-foreground"
            aria-hidden="true"
          ></span>
        {/if}
      </Button>
    </TitlebarNavigationTooltip>
  </nav>
{/if}
