<script lang="ts">
  import GroupedCombobox from './grouped-combobox.svelte';
  let value = $state('');
</script>

<div data-testid="clipping-parent" class="h-20 overflow-auto">
  <GroupedCombobox
    bind:value
    placeholder="Choose a project"
    defaultCollapsed={false}
    groups={[
      {
        key: 'projects',
        label: 'Projects',
        options: [
          { value: 'alpha', label: 'Alpha' },
          { value: 'beta', label: 'Beta' },
        ],
      },
    ]}
  />
</div>
<output aria-label="Selected project">{value}</output>
