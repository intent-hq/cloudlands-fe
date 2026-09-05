<script lang="ts">
  import * as Accordion from '$lib/components/ui/accordion';
  import * as Tabs from '$lib/components/ui/tabs';
  import type { CatalogRendererProps } from '../catalog-renderers';

  let { componentId, fixture }: CatalogRendererProps = $props();
  let tab = $state('overview');
  let section = $state('details');
</script>

<div data-catalog-renderer-fixture={fixture.id}>
  {#if componentId === 'tabs'}
    <div
      data-catalog-rendered-state="default subtle selected proximity-hover keyboard-navigation disabled compact reduced-motion"
    >
      <Tabs.Root bind:value={tab}>
        <Tabs.List aria-label="Catalog tabs">
          <Tabs.Trigger value="overview">Overview</Tabs.Trigger>
          <Tabs.Trigger value="activity">Activity</Tabs.Trigger>
          <Tabs.Trigger value="disabled" disabled>Disabled</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="overview">Overview content</Tabs.Content>
        <Tabs.Content value="activity">Activity content</Tabs.Content>
      </Tabs.Root>
      <Tabs.Root value="one" variant="subtle" class="mt-4">
        <Tabs.List aria-label="Subtle catalog tabs">
          <Tabs.Trigger value="one">Subtle one</Tabs.Trigger>
          <Tabs.Trigger value="two">Subtle two</Tabs.Trigger>
        </Tabs.List>
      </Tabs.Root>
    </div>
  {:else if componentId === 'accordion'}
    <div
      data-catalog-rendered-state="single multiple open closed disabled keyboard-navigation reduced-motion"
    >
      <Accordion.Root bind:value={section}>
        <Accordion.Item value="details">
          <Accordion.Header><Accordion.Trigger>Details</Accordion.Trigger></Accordion.Header>
          <Accordion.Content class={section === 'details' ? undefined : 'hidden'}
            >Accordion details</Accordion.Content
          >
        </Accordion.Item>
        <Accordion.Item value="history">
          <Accordion.Header><Accordion.Trigger>History</Accordion.Trigger></Accordion.Header>
          <Accordion.Content class={section === 'history' ? undefined : 'hidden'}
            >Accordion history</Accordion.Content
          >
        </Accordion.Item>
      </Accordion.Root>
    </div>
  {/if}
</div>
