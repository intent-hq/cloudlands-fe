<script lang="ts">
  import {
  faArrowsRotate,
  faChevronDown,
} from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';

  import Button from '$lib/components/ui/button/button.svelte';
  import type { DropdownGroup } from '$lib/components/ui/dropdown';
  import { cn } from '$lib/utils';

  interface Props {
    group: DropdownGroup;
    groupIndex: number;
    collapsed: boolean;
    refreshing: boolean;
    onToggle: (key: string) => void;
    onRefresh: (key: string) => void;
  }

  let { group, groupIndex, collapsed, refreshing, onToggle, onRefresh }: Props = $props();
</script>

{#if group.label}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class={cn(
      'group/header px-3 text-xs font-medium text-muted-foreground flex items-center gap-2 cursor-pointer select-none',
      groupIndex > 0 && 'pt-1.5',
    )}
    role="button"
    tabindex="-1"
    aria-label="{group.label} models"
    aria-expanded={!collapsed}
    onclick={() => onToggle(group.key)}
    onkeydown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onToggle(group.key);
      }
    }}
  >
    <span>{group.label}</span>
    <span class="ml-auto flex items-center gap-0.5">
      <Button
        variant="ghost-light"
        size="xs"
        class={cn(
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:opacity-100',
          refreshing && 'opacity-50! cursor-not-allowed',
        )}
        onclick={(e) => {
          e.stopPropagation();
          onRefresh(group.key);
        }}
        title="Refresh {group.label} models"
        aria-label="Refresh {group.label} models"
        disabled={refreshing}
      >
        <Fa
          icon={faArrowsRotate}
          size={10}
          class={cn('text-subtle transition-transform duration-500', refreshing && 'animate-spin')}
        />
      </Button>
      <Fa
        icon={faChevronDown}
        class={cn('text-subtle transition-transform duration-150', collapsed && 'rotate-90')}
        size={12}
      />
    </span>
  </div>
{/if}