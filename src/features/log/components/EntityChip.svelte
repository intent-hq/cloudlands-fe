<!--
  EntityChip - Inline clickable chip for referencing entities (files, notes, agents, etc.)

  Displays as a subtle inline badge that can be clicked or hovered for more details.
-->

<script lang="ts">
  import { cn } from '$lib/utils';
  import Fa from 'svelte-fa';
  import type { IconDefinition } from '@fortawesome/fontawesome-common-types';
  import {
    faFile,
    faNoteSticky,
    faRobot,
    faCodeBranch,
    faTerminal,
    faFolder,
  } from '@fortawesome/free-solid-svg-icons';
  import * as Tooltip from '$lib/components/ui/tooltip';

  type EntityType =
    | 'file'
    | 'note'
    | 'agent'
    | 'branch'
    | 'command'
    | 'folder'
    | 'text'
    | 'custom'
    | 'blank';

  interface Props {
    type?: EntityType;
    label: string;
    sublabel?: string;
    icon?: IconDefinition;
    iconClass?: string;
    onClick?: () => void;
    class?: string;
    variant?: 'default' | 'muted' | 'accent' | 'outline';
  }

  let {
    type = 'custom',
    label,
    sublabel,
    icon,
    iconClass,
    onClick,
    class: className,
    variant = 'default',
  }: Props = $props();

  // Get default icon for entity type
  const defaultIcons: Record<EntityType, IconDefinition | null> = {
    file: faFile,
    note: faNoteSticky,
    agent: faRobot,
    branch: faCodeBranch,
    command: faTerminal,
    folder: faFolder,
    text: faFile,
    custom: null,
    blank: null,
  };

  let displayIcon = $derived(icon || defaultIcons[type]);

  // Variant styles
  const variantStyles = {
    default: 'bg-muted/50 text-foreground hover:bg-muted',
    muted: 'bg-transparent text-muted-foreground hover:bg-muted/50',
    accent: 'bg-primary/10 text-primary hover:bg-primary/20',
    outline: 'bg-transparent text-foreground border border-border hover:bg-muted/50',
  };
</script>

<!-- Provider ensures proper context and cleanup during component destruction -->
<Tooltip.Provider>
  <Tooltip.Root>
    <Tooltip.Trigger>
      <button
        type="button"
        class={cn(
          'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium',
          'transition-colors duration-150 cursor-pointer',
          'border border-transparent',
          variantStyles[variant],
          onClick && 'hover:border-border/50',
          className,
        )}
        onclick={onClick}
        disabled={!onClick}
      >
        {#if displayIcon}
          <Fa icon={displayIcon} class="text-[10px] opacity-60 {iconClass}" />
        {/if}
        <span class="truncate max-w-[120px]">{label}</span>
      </button>
    </Tooltip.Trigger>
    {#if sublabel}
      <Tooltip.Content side="top" class="text-xs">
        <p class="font-mono text-muted-foreground">{sublabel}</p>
      </Tooltip.Content>
    {/if}
  </Tooltip.Root>
</Tooltip.Provider>
