<script lang="ts">
  import type { ComponentProps } from 'svelte';
  import SettingsSidebarNav from '../SettingsSidebarNav.svelte';

  type SettingsTab = ComponentProps<typeof SettingsSidebarNav>['activeTab'];

  interface Props {
    theme?: 'light' | 'dark';
    width?: number;
    zoom?: number;
  }

  let { theme = 'light', width = 240, zoom = 1 }: Props = $props();
  let activeTab = $state<SettingsTab>('setup');
</script>

<section class:dark={theme === 'dark'} style:width="{width}px" style:zoom data-testid="host">
  <div class="flex h-[420px] bg-sidebar text-foreground" data-testid="sidebar-shell">
    <SettingsSidebarNav {activeTab} onSelect={(tab) => (activeTab = tab)} />
  </div>
</section>
