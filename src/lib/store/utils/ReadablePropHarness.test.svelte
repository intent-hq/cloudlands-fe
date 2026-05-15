<script lang="ts">
  import { readableProp } from './svelte-context';

  let { value }: { value: string } = $props();

  const value$ = readableProp(() => value);
</script>

<div data-testid="value">{$value$}</div>