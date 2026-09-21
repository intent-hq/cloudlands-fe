<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  export const preview = definePreview({
    id: 'settings-sidebar',
    title: 'Settings sidebar navigation',
    defaultState: 'default',
    states: { default: { props: {} }, narrow: { props: { narrow: true } } },
  });
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { store } from '$store/renderer/store';
  import { setBundledSpecialists } from '$store/renderer/slices/specialists/specialists-slice';
  import type { SettingsTab } from '$lib/components/patterns/settings/types';
  import SettingsSidebarNav from './SettingsSidebarNav.svelte';
  import SettingsSidebarBack from './SettingsSidebarBack.svelte';
  import AIBehaviorSidebar, { type AIBehaviorView } from './AIBehaviorSidebar.svelte';

  let { narrow = false }: { narrow?: boolean } = $props();
  let activeTab = $state<SettingsTab>('display');
  let activeView = $state<AIBehaviorView>({ type: 'system-prompt' });
  let backCount = $state(0);

  onMount(() => {
    const previous = store.state.specialists.bundledSpecialists;
    store.dispatch(
      setBundledSpecialists([
        {
          id: 'implementor',
          name: 'Implementor',
          description: 'Implementation fixture',
          defaultBehaviorPrompt: '',
        },
        {
          id: 'reviewer',
          name: 'Reviewer with a longer specialist name',
          description: 'Review fixture',
          defaultBehaviorPrompt: '',
        },
      ]),
    );
    return () => store.dispatch(setBundledSpecialists(previous));
  });
</script>

<aside
  class="relative flex h-[760px] w-full max-w-60 flex-col bg-sidebar text-foreground"
  style:max-width={narrow ? '192px' : undefined}
  data-settings-sidebar-preview
>
  <SettingsSidebarBack onBack={() => (backCount += 1)} />
  <SettingsSidebarNav {activeTab} onSelect={(tab) => (activeTab = tab)}>
    {#snippet agentsNavigation()}
      <AIBehaviorSidebar
        {activeView}
        isActive={activeTab === 'specialists'}
        onSelect={(view) => {
          activeView = view;
          activeTab = 'specialists';
        }}
      />
    {/snippet}
  </SettingsSidebarNav>
  <output class="sr-only" data-settings-back-count>{backCount}</output>
</aside>
