<script lang="ts">
  import { Dropdown, type DropdownOption } from '$lib/components/ui/dropdown';

  let invocations = $state(0);
  let openChanges = $state<boolean[]>([]);

  const options: DropdownOption[] = [
    { value: 'alpha', label: 'Alpha' },
    {
      value: 'more',
      label: 'More',
      type: 'submenu',
      children: [
        { value: 'child-a', label: 'Child action', onclick: () => (invocations += 1) },
        { value: 'child-b', label: 'Other child' },
      ],
    },
  ];
</script>

<Dropdown
  {options}
  placeholder="Open menu"
  searchable={false}
  portal
  onopenchange={(open) => (openChanges = [...openChanges, open])}
/>
<output data-testid="submenu-result">{JSON.stringify({ invocations, openChanges })}</output>
