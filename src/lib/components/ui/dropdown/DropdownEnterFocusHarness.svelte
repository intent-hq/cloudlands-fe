<script lang="ts">
  import { Dropdown, type DropdownOption } from '$lib/components/ui/dropdown';

  let { closeOnSelect = true, portal = false }: { closeOnSelect?: boolean; portal?: boolean } =
    $props();

  let value = $state('');

  const options: DropdownOption[] = [
    { value: 'alpha', label: 'Alpha' },
    { value: 'beta', label: 'Beta' },
    { value: 'gamma', label: 'Gamma' },
  ];
</script>

<Dropdown {options} bind:value placeholder="Pick a letter" searchable {closeOnSelect} {portal} />
<output data-testid="enter-focus-value">{value}</output>
