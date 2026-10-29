<script lang="ts">
  import * as Tabs from './index';

  let { showPeople = true }: { showPeople?: boolean } = $props();
  let value = $state('people');
</script>

<Tabs.Root bind:value variant="icon">
  <Tabs.List aria-label="Sidebar sections">
    <Tabs.Trigger value="overview">Overview</Tabs.Trigger>
    {#if showPeople}
      <Tabs.Trigger value="people">People</Tabs.Trigger>
    {/if}
    <Tabs.Trigger value="files">Files</Tabs.Trigger>
  </Tabs.List>
</Tabs.Root>
