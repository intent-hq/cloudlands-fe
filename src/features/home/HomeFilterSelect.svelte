<script lang="ts">
  import { Select } from '$lib/components/ui/select';
  import Fa from 'svelte-fa';
  import { faChevronDown } from '@fortawesome/free-solid-svg-icons';
  let {
    value,
    options,
    label,
    disabled = false,
    onchange,
  }: {
    value: string;
    options: { value: string; label: string }[];
    label: string;
    disabled?: boolean;
    onchange: (value: string) => void;
  } = $props();
</script>

<Select.Root {value} {onchange} {disabled}>
  <Select.Trigger
    variant="ghost"
    class="home-control-fill h-9 max-w-full gap-2 rounded-xl px-3"
    aria-label={label}
  >
    <span class="truncate">{options.find((option) => option.value === value)?.label}</span>
    <Fa icon={faChevronDown} class="shrink-0 text-muted-foreground" />
  </Select.Trigger>
  <Select.Content portal class="w-max min-w-48">
    {#each options as option (option.value)}
      <Select.Item value={option.value} label={option.label}>{option.label}</Select.Item>
    {/each}
  </Select.Content>
</Select.Root>
