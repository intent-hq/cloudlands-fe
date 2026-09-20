<script lang="ts">
  import { untrack } from 'svelte';
  import * as Accordion from './index';

  let { multiple = false }: { multiple?: boolean } = $props();
  let value = $state<string | string[]>(untrack(() => (multiple ? [] : 'first')));
</script>

<Accordion.Root type={multiple ? 'multiple' : 'single'} bind:value>
  <Accordion.Item value="first">
    <Accordion.Header><Accordion.Trigger>First section</Accordion.Trigger></Accordion.Header>
    <Accordion.Content><div data-accordion-panel-content>First panel</div></Accordion.Content>
  </Accordion.Item>
  <Accordion.Item value="second">
    <Accordion.Header><Accordion.Trigger>Second section</Accordion.Trigger></Accordion.Header>
    <Accordion.Content><div data-accordion-panel-content>Second panel</div></Accordion.Content>
  </Accordion.Item>
</Accordion.Root>
