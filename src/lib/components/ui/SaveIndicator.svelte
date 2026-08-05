<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import Fa from 'svelte-fa';
  import {
  faCircle,
  faCheck,
  faCloudArrowUp,
  faSpinner,
} from '@fortawesome/free-solid-svg-icons';
  import {
  fade,
  scale,
} from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    isDirty?: boolean;
    isSaving?: boolean;
    isAutoSaving?: boolean;
    onSave?: () => void;
    disabled?: boolean;
    size?: 'xs' | 'sm' | 'md';
    class?: string;
  }

  let {
    isDirty = false,
    isSaving = false,
    isAutoSaving = false,
    onSave,
    disabled = false,
    size = 'sm',
    class: className = '',
  }: Props = $props();

  // Determine the current state
  const state = $derived.by(() => {
    if (isSaving) return 'saving';
    if (isAutoSaving) return 'auto-saving';
    if (isDirty) return 'unsaved';
    return 'saved';
  });

  // Get the appropriate icon and tooltip
  const iconConfig = $derived.by(() => {
    switch (state) {
      case 'saving':
        return {
          icon: faSpinner,
          tooltip: m.ui_saveIndicator_saving_tooltip(),
          class: 'animate-spin text-blue-500',
        };
      case 'auto-saving':
        return {
          icon: faCloudArrowUp,
          tooltip: m.ui_saveIndicator_autoSaving_tooltip(),
          class: 'text-ghost animate-pulse',
        };
      case 'unsaved':
        return {
          icon: faCircle,
          tooltip: m.ui_saveIndicator_clickToSave_tooltip(),
          class: 'text-yellow-500',
        };
      case 'saved':
      default:
        return {
          icon: faCheck,
          tooltip: m.ui_saveIndicator_saved_tooltip(),
          class: 'text-green-500',
        };
    }
  });

  // Size configurations
  const sizeConfig = {
    xs: { button: 'h-5 w-5', icon: 'h-2.5 w-2.5', dot: 'h-1.5 w-1.5' },
    sm: { button: 'h-6 w-6', icon: 'h-3 w-3', dot: 'h-2 w-2' },
    md: { button: 'h-8 w-8', icon: 'h-4 w-4', dot: 'h-2.5 w-2.5' },
  };

  const config = $derived.by(() => sizeConfig[size]);
  const isClickable = $derived.by(() => state === 'unsaved' && !disabled && !!onSave);
</script>

<Tooltip content={iconConfig?.tooltip} side="bottom" delayDuration={500}>
  <Button
    variant="ghost"
    size="icon"
    class={`relative transition-all duration-200 p-0 min-w-0 hover:bg-muted disabled:opacity-100 disabled:cursor-default ${config.button} ${className}`}
    onclick={isClickable ? onSave : undefined}
    disabled={!isClickable}
    aria-label={iconConfig?.tooltip}
  >
    <div class="relative flex items-center justify-center w-full h-full">
      {#key state}
        <div
          class="absolute inset-0 flex items-center justify-center"
          in:scale={{ duration: 200, easing: cubicOut, start: 0.8 }}
          out:fade={{ duration: 150 }}
        >
          {#if state === 'unsaved'}
            <!-- Unsaved: Show a dot that pulses subtly -->
            <div class="relative">
              <div class={`${config.dot} rounded-full bg-yellow-500 animate-pulse`}></div>
              <div
                class="absolute inset-0 rounded-full bg-yellow-500 opacity-30 animate-ping"
              ></div>
            </div>
          {:else}
            <!-- Other states: Show the icon -->
            <Fa icon={iconConfig?.icon} class="{config.icon} {iconConfig?.class}" />
          {/if}
        </div>
      {/key}
    </div>
  </Button>
</Tooltip>
