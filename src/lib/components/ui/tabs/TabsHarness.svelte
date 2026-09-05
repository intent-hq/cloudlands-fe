<script lang="ts">
  import SizeProvider from '../SizeProvider.svelte';
  import * as Tabs from './index';

  let { subtle = false, compact = false }: { subtle?: boolean; compact?: boolean } = $props();
  let value = $state('overview');
</script>

<SizeProvider size={compact ? 'compact' : 'default'}>
  <Tabs.Root bind:value variant={subtle ? 'subtle' : 'default'}>
    <Tabs.List aria-label="Project sections">
      <Tabs.Trigger value="overview">Overview</Tabs.Trigger>
      <Tabs.Trigger value="activity">Activity</Tabs.Trigger>
      <Tabs.Trigger value="disabled" disabled>Disabled</Tabs.Trigger>
    </Tabs.List>
    <Tabs.Content value="overview">Overview panel</Tabs.Content>
    <Tabs.Content value="activity">Activity panel</Tabs.Content>
  </Tabs.Root>
</SizeProvider>
