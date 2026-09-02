<script lang="ts">
  import { cn } from '$lib/utils';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import { Fa } from 'svelte-fa';
  import { TooltipShortcut } from '$lib/components/ui/tooltip';

  interface Props extends HTMLButtonAttributes {
    class?: string;
    selected?: boolean;
    active?: boolean; // Currently active/focused item (e.g., open file)
    variant?: 'default' | 'ghost' | 'subtle';
    size?: 'sm' | 'md';
    icon?: any; // FontAwesome icon or Lucide icon component
    iconComponent?: any; // For custom icon components like AgentAvatar (Svelte 5 components)
    iconProps?: Record<string, any>; // Props to pass to the icon component
    iconClass?: string;
    title?: string;
    subtitle?: string;
    titleClass?: string;
    subtitleClass?: string;
    badge?: string | number;
    badgeClass?: string;
    badgeVariant?: 'default' | 'success' | 'warning' | 'error' | 'info';
    loading?: boolean;
    disabled?: boolean;
    children?: any;
    iconSnippet?: any; // Custom icon snippet for inline SVG or custom rendering
    onclick?: (e: MouseEvent) => void;
    onRightClick?: (e: MouseEvent) => void;
    actions?: Array<{
      icon: any;
      label: string;
      tooltip?: string; // Optional tooltip text (defaults to label if not provided)
      onClick: (e: MouseEvent) => void;
      className?: string;
    }>;
    actionsVisible?: 'always' | 'hover';
    actionsClass?: string;
    indent?: number; // For tree-like structures
    indentSize?: number; // Size of each indent level in px (default: 22)
  }

  let {
    class: className,
    selected = false,
    active = false,
    variant = 'default',
    size = 'md',
    icon,
    iconComponent: IconComponent,
    iconProps = {},
    iconClass,
    title = '',
    subtitle = '',
    titleClass,
    subtitleClass,
    badge,
    badgeClass,
    badgeVariant = 'default',
    loading = false,
    disabled = false,
    children,
    iconSnippet,
    onclick,
    onRightClick,
    actions = [],
    actionsClass,
    actionsVisible = 'hover',
    indent = 0,
    indentSize = 22,
    ...restProps
  }: Props = $props();

  // Size configurations
  const sizeConfig = {
    sm: {
      padding: 'min-h-7 px-2 py-0.5',
      basePaddingX: 0, // px value for inline style
      iconSize: '12',
      titleSize: 'type-body',
      subtitleSize: 'type-caption',
      gap: 'gap-2',
    },
    md: {
      padding: 'min-h-8 px-2 py-1.5',
      basePaddingX: 0, // px value for inline style
      iconSize: '14',
      titleSize: 'type-body',
      subtitleSize: 'type-caption',
      gap: 'gap-2',
    },
  };

  const config = $derived(sizeConfig[size]);

  // Variant styles with active and selected states
  const variantStyles = $derived({
    default: cn(
      'hover:bg-accent/60 hover:text-accent-foreground',
      selected && 'bg-accent text-accent-foreground',
      active && 'border-input bg-card text-foreground',
    ),
    ghost: cn(
      'hover:bg-accent/60 hover:text-accent-foreground',
      selected && 'bg-accent text-accent-foreground',
      active && 'border-input bg-card text-foreground',
    ),
    subtle: cn(
      'hover:bg-muted',
      selected && 'bg-accent text-accent-foreground',
      active && 'border-input bg-card text-foreground',
    ),
  });

  // Badge variant styles
  const badgeVariantStyles = {
    default: 'bg-muted text-subtle',
    success: 'bg-success/20 text-success',
    warning: 'bg-warning/20 text-warning',
    error: 'bg-danger-background/10 text-danger',
    info: 'bg-info/20 text-info',
  };

  let leftIndent = $derived(
    indent > 0 ? indent * indentSize + config.basePaddingX : config.basePaddingX,
  );
</script>

<button
  data-slot="list-item"
  data-selected={selected || undefined}
  data-active={active || undefined}
  aria-current={active ? 'true' : undefined}
  class={cn(
    // Base styles
    'relative flex w-full min-w-0 cursor-pointer items-center rounded-md border border-transparent bg-transparent text-left font-inherit text-foreground outline-none transition-colors',
    'focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40',
    'motion-reduce:transition-none',
    'group',

    // Size styles
    config.padding,

    // Variant styles
    variantStyles[variant],

    // State styles
    disabled && 'opacity-50 cursor-not-allowed pointer-events-none',

    // Custom class
    className,
  )}
  style={`margin-left: ${leftIndent}px; padding-right: ${config.basePaddingX}px; width: calc(100% - ${leftIndent}px);`}
  {disabled}
  {onclick}
  oncontextmenu={onRightClick}
  {...restProps}
>
  <div class="relative w-full flex items-center {config.gap}">
    <!-- Icon Section -->
    {#if iconSnippet}
      <div class={cn('shrink-0 flex items-center justify-center', iconClass)}>
        {@render iconSnippet()}
      </div>
    {:else if icon || IconComponent}
      <div class={cn('shrink-0 flex items-center justify-center', iconClass)}>
        {#if loading && icon}
          <Fa
            {icon}
            size={config.iconSize}
            class="w-3.5 animate-spin opacity-60 motion-reduce:animate-none"
          />
        {:else if IconComponent}
          <IconComponent {...iconProps} />
        {:else if icon}
          <Fa
            {icon}
            size={config.iconSize}
            class={cn('opacity-60 w-3.5', (selected || active) && 'opacity-90')}
          />
        {/if}
      </div>
    {/if}

    <!-- Content Section -->
    <div class="flex-1 min-w-0 flex items-center gap-1">
      {#if title}
        <div
          class={cn(
            config.titleSize,
            'max-w-full min-w-0 shrink truncate font-medium leading-5',
            selected || active,
            titleClass,
          )}
        >
          {title}
        </div>
      {/if}

      {#if subtitle}
        <div
          class={cn(
            config.subtitleSize,
            'min-w-0 flex-1 truncate text-muted-foreground',
            subtitleClass,
          )}
        >
          {subtitle}
        </div>
      {/if}

      <!-- Custom content slot -->
      {#if children}
        {@render children()}
      {/if}
    </div>

    <!-- Actions Section -->
    {#if actions.length > 0}
      <div
        class={cn(
          'shrink-0 flex items-center gap-1',
          actionsVisible === 'hover' && 'opacity-0 group-hover:opacity-100',
          'transition-opacity motion-reduce:transition-none',
          actionsClass,
        )}
      >
        {#each actions as action (action.label)}
          <TooltipShortcut label={action.tooltip ?? action.label} delayDuration={0}>
            <div
              role="button"
              tabindex={0}
              class={cn(
                'cursor-pointer rounded-sm border border-transparent p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 motion-reduce:transition-none',
                action.className,
              )}
              onclick={(e: MouseEvent) => {
                e.stopPropagation();
                action.onClick(e);
              }}
              onkeydown={(e: KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation();
                  e.preventDefault();
                  action.onClick(e as any);
                }
              }}
            >
              <Fa icon={action.icon} size="10" />
            </div>
          </TooltipShortcut>
        {/each}
      </div>
    {/if}

    <!-- Badge Section -->
    {#if badge !== undefined && badge !== null}
      <div
        class={cn(
          'shrink-0',
          'type-caption rounded-sm px-1.5 py-0.5',
          badgeVariantStyles[badgeVariant],
          badgeVariant === 'default' && 'group-hover:bg-muted',
          badgeClass,
        )}
      >
        {badge}
      </div>
    {/if}
  </div>
</button>

<style>
  [data-slot='list-item'],
  [role='button'] {
    transition-duration: var(--motion-fast);
  }

  [data-slot='list-item'][data-active] {
    box-shadow: var(--elevation-raised);
  }
</style>
