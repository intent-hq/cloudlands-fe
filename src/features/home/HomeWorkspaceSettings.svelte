<script lang="ts">
  import { Select } from '$lib/components/ui/select';
  import Fa from 'svelte-fa';
  import { faChevronDown } from '@fortawesome/free-solid-svg-icons';
  import { m } from '$shared/paraglide/messages.js';
  import type { HomeWorkspacesState } from './home-workspaces-slice';
  let {
    view,
    onchange,
  }: { view: HomeWorkspacesState; onchange: (changes: Partial<HomeWorkspacesState>) => void } =
    $props();
  const dateOptions = $derived([
    { value: 'all', label: m.home_updated_anytime() },
    { value: 'day', label: m.home_updated_day() },
    { value: 'week', label: m.home_updated_week() },
    { value: 'month', label: m.home_updated_month() },
  ]);
  const groupingOptions = $derived([
    { value: 'status', label: m.layout_allCard_status_label() },
    { value: 'repository', label: m.home_repository() },
    { value: 'none', label: m.settings_mcp_form_auth_none() },
  ]);
</script>

<div class="shrink-0">
  <Select.Root
    value={view.updatedWithin ?? 'all'}
    onchange={(value) => {
      if (value === 'all' || value === 'day' || value === 'week' || value === 'month')
        onchange({ updatedWithin: value, selectedId: null });
    }}
  >
    <Select.Trigger
      variant="ghost"
      class="h-9 w-auto shrink-0 gap-2 rounded-full bg-muted/50 px-3"
      aria-label={m.home_updated_filter()}
    >
      <span class="text-muted-foreground">{m.home_updated_filter()}</span>
      <span
        >{dateOptions.find((option) => option.value === (view.updatedWithin ?? 'all'))?.label}</span
      >
      <Fa icon={faChevronDown} class="text-muted-foreground" />
    </Select.Trigger>
    <Select.Content portal>
      {#each dateOptions as option (option.value)}
        <Select.Item value={option.value} label={option.label}>{option.label}</Select.Item>
      {/each}
    </Select.Content>
  </Select.Root>
</div>
<div class="shrink-0">
  <Select.Root
    value={view.groupBy}
    onchange={(value) => {
      if (value === 'status' || value === 'repository' || value === 'none')
        onchange({ groupBy: value });
    }}
  >
    <Select.Trigger
      variant="ghost"
      class="h-9 w-auto shrink-0 gap-2 rounded-full bg-muted/50 px-3"
      aria-label={m.layout_sidebarPanel_groupBy_label()}
    >
      <span class="text-muted-foreground">{m.layout_sidebarPanel_groupBy_label()}</span>
      <span>{groupingOptions.find((option) => option.value === view.groupBy)?.label}</span>
      <Fa icon={faChevronDown} class="text-muted-foreground" />
    </Select.Trigger>
    <Select.Content portal>
      {#each groupingOptions as option (option.value)}
        <Select.Item value={option.value} label={option.label}>{option.label}</Select.Item>
      {/each}
    </Select.Content>
  </Select.Root>
</div>
