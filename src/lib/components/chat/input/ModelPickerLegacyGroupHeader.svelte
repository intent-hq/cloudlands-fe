<script lang="ts">
  import { faChevronDown } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';

  import { Button } from '$lib/components/ui/button';
  import { cn } from '$lib/utils';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    group: { label: string };
    groupIndex: number;
    expanded: boolean;
    disabled?: boolean;
    onToggle: () => void;
  }

  let { group, groupIndex, expanded, disabled = false, onToggle }: Props = $props();

  function handleClick() {
    if (!disabled) onToggle();
  }

  function handleKeydown(event: KeyboardEvent) {
    if (disabled) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    onToggle();
  }
</script>

<Button
  variant="ghost-light"
  class={cn(
    'group type-caption h-auto w-full justify-start rounded-none border-x-0 border-b-0 border-t border-border px-3 pb-1.5 pt-2.5 font-medium text-muted-foreground transition-colors hover:bg-muted/20 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring aria-disabled:opacity-100',
    groupIndex > 0 && 'mt-1.5',
    disabled && 'cursor-default hover:bg-transparent hover:text-muted-foreground',
  )}
  aria-label={m.chat_modelPicker_legacyModels_ariaLabel()}
  aria-expanded={expanded}
  aria-disabled={disabled}
  onclick={handleClick}
  onkeydown={handleKeydown}
>
  <span>{group.label}</span>
  <Fa
    icon={faChevronDown}
    class={cn(
      'ml-auto text-subtle transition-[color,transform] duration-150 group-hover:text-muted-foreground',
      !expanded && 'rotate-90',
    )}
    size={12}
  />
</Button>
