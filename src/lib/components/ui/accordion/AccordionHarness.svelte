<script lang="ts">
  import { untrack } from 'svelte';
  import * as Accordion from './index';

  let { multiple = false }: { multiple?: boolean } = $props();
  let value = $state<string | string[]>(untrack(() => (multiple ? [] : 'first')));
</script>

<Accordion.Root type={multiple ? 'multiple' : 'single'} bind:value>
  <Accordion.Item value="first">
    <Accordion.Header><Accordion.Trigger>First section</Accordion.Trigger></Accordion.Header>
    <Accordion.Content>First panel</Accordion.Content>
  </Accordion.Item>
  <Accordion.Item value="second">
    <Accordion.Header><Accordion.Trigger>Second section</Accordion.Trigger></Accordion.Header>
    <Accordion.Content>Second panel</Accordion.Content>
  </Accordion.Item>
</Accordion.Root>
