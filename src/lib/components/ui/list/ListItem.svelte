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
    iconComponent?: any; // For custom icon components like AuggieAvatar (Svelte 5 components)
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
      padding: 'py-1 px-2',
      basePaddingX: 0, // px value for inline style
      iconSize: '12',
      titleSize: 'text-sm',
      subtitleSize: 'text-sm',
      gap: 'gap-2',
    },
    md: {
      padding: 'py-1 px-2',
      basePaddingX: 0, // px value for inline style
      iconSize: '14',
      titleSize: 'text-sm',
      subtitleSize: 'text-sm',
      gap: 'gap-2',
    },
  };

  const config = $derived(sizeConfig[size]);

  // Variant styles with active and selected states
  const variantStyles = $derived({
    default: cn(
      'hover:bg-background/50',
      selected && 'bg-background text-foreground',
      active && 'bg-background text-foreground border-border shadow-xs',
    ),
    ghost: cn(
      'hover:bg-background hover:text-foreground',
      selected && 'bg-background text-foreground',
      active && 'bg-background text-foreground border-border shadow-xs',
    ),
    subtle: cn(
      'hover:bg-muted/50',
      selected && 'bg-muted',
      active && 'bg-background text-foreground border-border shadow-xs',
    ),
  });

  // Badge variant styles
  const badgeVariantStyles = {
    default: 'bg-muted text-subtle',
    success: 'bg-green-500/20 text-green-600 dark:text-green-400',
    warning: 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400',
    error: 'bg-red-500/20 text-red-600 dark:text-red-400',
    info: 'bg-blue-500/20 text-blue-600 dark:text-blue-400',
  };

  let leftIndent = $derived(
    indent > 0 ? indent * indentSize + config.basePaddingX : config.basePaddingX,
  );
</script>

<button
  class={cn(
    // Base styles
    'relative w-full min-w-0 flex items-center text-left transition-colors duration-100',
    'border border-transparent bg-transparent text-subtle cursor-pointer font-inherit',
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
          <Fa {icon} size={config.iconSize} class="animate-spin opacity-60 w-3.5" />
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
            'leading-tight truncate max-w-full shrink-0',
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
            'flex-1 text-subtle truncate opacity-60',
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
          'transition-opacity',
          actionsClass,
        )}
      >
        {#each actions as action (action.label)}
          <TooltipShortcut label={action.tooltip ?? action.label} delayDuration={0}>
            <div
              role="button"
              tabindex={0}
              class={cn(
                'p-1 hover:bg-background/50 transition-colors cursor-pointer',
                'text-muted-foreground hover:text-foreground',
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
          'text-ui px-1.5 py-0.5 rounded',
          badgeVariantStyles[badgeVariant],
          badgeVariant === 'default' && 'group-hover:bg-background',
          badgeClass,
        )}
      >
        {badge}
      </div>
    {/if}
  </div>
</button>
